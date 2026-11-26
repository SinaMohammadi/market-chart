/**
 * Deep copy of calculator state that preserves prototypes (class instances keep their methods).
 * Handles primitives, arrays, typed arrays and plain/class objects; functions are shared.
 * Calculator state is acyclic by construction, so no cycle tracking is needed.
 */
export function cloneState<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (ArrayBuffer.isView(value)) return (value as unknown as Float64Array).slice() as unknown as T;
  if (Array.isArray(value)) return value.map((v) => cloneState(v)) as unknown as T;
  const copy = Object.create(Object.getPrototypeOf(value) as object) as Record<string, unknown>;
  for (const key of Object.keys(value))
    copy[key] = cloneState((value as Record<string, unknown>)[key]);
  return copy as T;
}
