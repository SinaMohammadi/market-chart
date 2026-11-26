/** Recursively optional version of T. Arrays and functions are treated as leaves. */
export type DeepPartial<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly unknown[]
    ? T
    : T extends object
      ? { [K in keyof T]?: DeepPartial<T[K]> }
      : T;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/**
 * Returns a new object: `base` deeply merged with `patch`. Never mutates inputs.
 * `undefined` in the patch is ignored; arrays are replaced, not concatenated.
 * Keys `__proto__`, `constructor` and `prototype` are skipped to avoid prototype pollution
 * from untrusted (e.g. imported) configuration.
 */
export function deepMerge<T>(base: T, patch: DeepPartial<NoInfer<T>> | undefined): T {
  if (patch === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch as T;
  const result: Record<string, unknown> = { ...base };
  for (const key of Object.keys(patch)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const value = (patch as Record<string, unknown>)[key];
    if (value === undefined) continue;
    const current = result[key];
    result[key] =
      isPlainObject(current) && isPlainObject(value) ? deepMerge(current, value) : value;
  }
  return result as T;
}
