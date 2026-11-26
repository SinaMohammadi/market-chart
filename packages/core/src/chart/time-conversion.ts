import type { Timeline } from '../model/timeline.js';
import { lowerBound } from '../utils/binary-search.js';

/**
 * Fractional logical index for any time. Times between bars interpolate linearly;
 * times outside the data extrapolate using the nearest bar interval. Null without data.
 */
export function timeToLogical(timeline: Timeline, time: number): number | null {
  const n = timeline.length;
  if (n === 0 || !Number.isFinite(time)) return null;
  const times = timeline.times;
  if (n === 1) return time === times[0] ? 0 : null;
  const i = lowerBound(times, time, n);
  if (i < n && times[i] === time) return i;
  if (i === 0) return (time - times[0]!) / (times[1]! - times[0]!);
  if (i === n) return n - 1 + (time - times[n - 1]!) / (times[n - 1]! - times[n - 2]!);
  return i - 1 + (time - times[i - 1]!) / (times[i]! - times[i - 1]!);
}

/** Inverse of `timeToLogical`. */
export function logicalToTime(timeline: Timeline, logical: number): number | null {
  const n = timeline.length;
  if (n === 0 || !Number.isFinite(logical)) return null;
  const times = timeline.times;
  if (n === 1) return Math.round(logical) === 0 ? times[0]! : null;
  if (logical <= 0) return times[0]! + logical * (times[1]! - times[0]!);
  if (logical >= n - 1)
    return times[n - 1]! + (logical - (n - 1)) * (times[n - 1]! - times[n - 2]!);
  const i = Math.floor(logical);
  const f = logical - i;
  return times[i]! + f * (times[i + 1]! - times[i]!);
}
