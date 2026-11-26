import type { SeriesApi, SeriesData, SeriesType } from '@market-chart/core';

/** Appends beyond this many new points fall back to a full `setData`. */
const MAX_INCREMENTAL = 16;

/**
 * Pushes `next` into `series` with the cheapest correct operation:
 * - unchanged array identity → nothing
 * - same prefix (by reference) with the last point changed and/or a few points appended → `update()`
 * - anything else → `setData()`
 *
 * The prefix check compares element references, so immutable updates such as
 * `[...prev.slice(0, -1), updatedLast]` or `[...prev, newBar]` are applied incrementally.
 */
export function applySeriesData<T extends SeriesType>(
  series: SeriesApi<T>,
  prev: readonly SeriesData<T>[] | undefined,
  next: readonly SeriesData<T>[],
): void {
  if (prev === next) return;
  if (
    prev &&
    prev.length > 0 &&
    next.length >= prev.length &&
    next.length - prev.length <= MAX_INCREMENTAL
  ) {
    const stable = prev.length - 1;
    let samePrefix = true;
    for (let i = 0; i < stable; i++) {
      if (prev[i] !== next[i]) {
        samePrefix = false;
        break;
      }
    }
    if (samePrefix && prev[stable]!.time === next[stable]!.time) {
      if (prev[stable] !== next[stable]) series.update(next[stable]!);
      for (let i = prev.length; i < next.length; i++) series.update(next[i]!);
      return;
    }
  }
  series.setData(next);
}
