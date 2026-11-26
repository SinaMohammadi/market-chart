/** Minimal array-like view over numbers, satisfied by typed arrays and plain arrays. */
export interface NumberArrayLike {
  readonly length: number;
  readonly [index: number]: number;
}

/** First index in [0, length) whose value is >= target. Returns `length` if none. */
export function lowerBound(
  values: NumberArrayLike,
  target: number,
  length = values.length,
): number {
  let lo = 0;
  let hi = length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (values[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index in [0, length) whose value is > target. Returns `length` if none. */
export function upperBound(
  values: NumberArrayLike,
  target: number,
  length = values.length,
): number {
  let lo = 0;
  let hi = length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (values[mid]! <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Index of an exact match, or -1. */
export function indexOfSorted(
  values: NumberArrayLike,
  target: number,
  length = values.length,
): number {
  const i = lowerBound(values, target, length);
  return i < length && values[i] === target ? i : -1;
}
