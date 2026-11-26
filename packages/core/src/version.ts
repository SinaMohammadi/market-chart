/** Version of `@market-chart/core`, used for plugin compatibility checks. Keep in sync with package.json. */
export const CORE_VERSION = '0.1.0';

type Version = [number, number, number];

function parse(version: string): Version | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function compare(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}

function satisfiesComparator(v: Version, comparator: string): boolean {
  if (comparator === '*' || comparator === '') return true;
  const op = /^(\^|~|>=|<=|>|<|=)?(.*)$/.exec(comparator)!;
  const target = parse(op[2]!);
  if (!target) throw new Error(`invalid version range "${comparator}"`);
  const c = compare(v, target);
  switch (op[1]) {
    case '>=':
      return c >= 0;
    case '<=':
      return c <= 0;
    case '>':
      return c > 0;
    case '<':
      return c < 0;
    case '^': {
      // ^1.2.3 → >=1.2.3 <2.0.0; ^0.2.3 → >=0.2.3 <0.3.0; ^0.0.3 → exactly 0.0.3.
      if (c < 0) return false;
      if (target[0] > 0) return v[0] === target[0];
      if (target[1] > 0) return v[0] === 0 && v[1] === target[1];
      return v[0] === 0 && v[1] === 0 && v[2] === target[2];
    }
    case '~':
      return c >= 0 && v[0] === target[0] && v[1] === target[1];
    default:
      return c === 0;
  }
}

/**
 * Minimal semver range check: `*`, exact `1.2.3`, `>=`, `<=`, `>`, `<`, `^`, `~`,
 * space-separated AND and `||` OR. Throws on malformed ranges.
 */
export function satisfiesVersion(version: string, range: string): boolean {
  const v = parse(version);
  if (!v) throw new Error(`invalid version "${version}"`);
  return range.split('||').some((part) =>
    part
      .trim()
      .split(/\s+/)
      .every((comparator) => satisfiesComparator(v, comparator)),
  );
}
