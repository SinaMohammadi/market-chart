// Publishing and repository hygiene: what goes into the npm tarballs and what may be committed.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../..', import.meta.url));
const packages = readdirSync(join(root, 'packages')).filter((d) =>
  existsSync(join(root, 'packages', d, 'package.json')),
);
const manifest = (dir: string) =>
  JSON.parse(readFileSync(join(root, 'packages', dir, 'package.json'), 'utf8')) as {
    name: string;
    private?: boolean;
    files?: string[];
    scripts?: Record<string, string>;
    publishConfig?: { access?: string };
    exports?: Record<string, unknown>;
    license?: string;
  };

const LIFECYCLE = [
  'preinstall',
  'install',
  'postinstall',
  'prepublish',
  'preprepare',
  'prepare',
  'postprepare',
];

describe('package manifests (security)', () => {
  it.each(packages)(
    '%s: whitelisted files, no install scripts, public access, dist-only exports',
    (dir) => {
      const p = manifest(dir);
      expect(p.private).not.toBe(true);
      expect(p.files).toEqual(['dist', 'README.md', 'LICENSE']);
      for (const script of LIFECYCLE) expect(p.scripts?.[script]).toBeUndefined();
      expect(p.publishConfig?.access).toBe('public');
      expect(p.license).toBe('MIT');
      expect(existsSync(join(root, 'packages', dir, 'LICENSE'))).toBe(true);
      // Leaf values of the exports map are the files; keys such as "./react" are subpaths.
      const targets: string[] = [];
      const walk = (v: unknown): void => {
        if (typeof v === 'string') targets.push(v);
        else if (v && typeof v === 'object') Object.values(v).forEach(walk);
      };
      walk(p.exports);
      expect(targets.length).toBeGreaterThan(0);
      for (const path of targets)
        if (path !== './package.json') expect(path, path).toMatch(/^\.\/dist\/[\w.-]+$/);
    },
  );
});

describe('.gitignore (security)', () => {
  const ignore = readFileSync(join(root, '.gitignore'), 'utf8').split(/\r?\n/);
  it.each([
    '.env',
    '.env.*',
    '.npmrc',
    '*.pem',
    '*.key',
    '.claude/',
    '*.log',
    '*.tgz',
    'node_modules/',
  ])('ignores %s', (pattern) => expect(ignore).toContain(pattern));
});

/** Source, docs and config files that are committed (build output and dependencies excluded). */
function committedFiles(dir = root, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'dist', '.next', '.claude', 'coverage', 'results', '.git'].includes(name))
      continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) committedFiles(path, out);
    else if (
      /\.(ts|tsx|js|mjs|cjs|json|md|html|css|yaml|yml)$|^_headers$/.test(name) &&
      name !== 'pnpm-lock.yaml'
    )
      out.push(path);
  }
  return out;
}

describe('repository content (security)', () => {
  const files = committedFiles();
  it('contains no secrets, private keys or tokens', () => {
    const patterns = [
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
      /AKIA[0-9A-Z]{16}/,
      /gh[pousr]_[A-Za-z0-9]{36,}/,
      /npm_[A-Za-z0-9]{36}/,
      /xox[abpr]-[A-Za-z0-9-]{10,}/,
      /sk-[A-Za-z0-9]{32,}/,
      /_authToken\s*=/,
    ];
    const hits = files.flatMap((f) => {
      const text = readFileSync(f, 'utf8');
      return patterns.filter((p) => p.test(text)).map((p) => `${relative(root, f)}: ${p}`);
    });
    expect(hits).toEqual([]);
  });
  it('contains no absolute local paths', () => {
    const local = /\b[A-Z]:[\\/](?:project|Users)[\\/]|\/home\/[a-z]+\/|\/Users\/[a-z]+\//i;
    const hits = files
      .filter((f) => !f.endsWith('publishing.test.ts'))
      .filter((f) => local.test(readFileSync(f, 'utf8')))
      .map((f) => relative(root, f));
    expect(hits).toEqual([]);
  });
});
