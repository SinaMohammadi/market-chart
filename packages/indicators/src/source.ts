import type { Bar, PriceSource } from './types.js';

export function price(bar: Bar, source: PriceSource): number {
  switch (source) {
    case 'open':
      return bar.open;
    case 'high':
      return bar.high;
    case 'low':
      return bar.low;
    case 'close':
      return bar.close;
    case 'hl2':
      return (bar.high + bar.low) / 2;
    case 'hlc3':
      return (bar.high + bar.low + bar.close) / 3;
    case 'ohlc4':
      return (bar.open + bar.high + bar.low + bar.close) / 4;
    case 'hlcc4':
      return (bar.high + bar.low + bar.close * 2) / 4;
  }
}

/** Volume, treating missing volume as 0. */
export function volumeOf(bar: Bar): number {
  return Number.isFinite(bar.volume) ? bar.volume : 0;
}

/** True range given the previous close (NaN on the first bar → high − low). */
export function trueRange(bar: Bar, prevClose: number): number {
  if (!Number.isFinite(prevClose)) return bar.high - bar.low;
  return Math.max(
    bar.high - bar.low,
    Math.abs(bar.high - prevClose),
    Math.abs(bar.low - prevClose),
  );
}
