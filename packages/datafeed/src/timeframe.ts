import type { Timeframe } from './types.js';
import { DatafeedError } from './types.js';

export type TimeframeUnit = 's' | 'm' | 'h' | 'D' | 'W' | 'M';

export interface ParsedTimeframe {
  readonly count: number;
  readonly unit: TimeframeUnit;
  /** Nominal length in ms (a month counts as 30 days; use `alignTime`/`nextBarTime` for calendar months). */
  readonly ms: number;
}

const UNIT_MS: Record<TimeframeUnit, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  D: 86_400_000,
  W: 7 * 86_400_000,
  M: 30 * 86_400_000,
};

/** Parses `5m`, `1h`, `1D`, `1W`, `1M` (also lower-case `d`/`w` and TradingView-style bare minutes like `60`). */
export function parseTimeframe(timeframe: Timeframe): ParsedTimeframe {
  const text = String(timeframe).trim();
  if (/^\d+$/.test(text)) return parseTimeframe(`${text}m`);
  const match = /^(\d+)?([smhdDwWM])$/.exec(text);
  if (!match) throw new DatafeedError(`invalid timeframe "${timeframe}"`);
  const count = match[1] ? Number(match[1]) : 1;
  const raw = match[2]!;
  const unit = (raw === 'd' ? 'D' : raw === 'w' || raw === 'W' ? 'W' : raw) as TimeframeUnit;
  if (!Number.isInteger(count) || count < 1 || count > 100_000)
    throw new DatafeedError(`invalid timeframe "${timeframe}"`);
  return { count, unit, ms: count * UNIT_MS[unit] };
}

const MONDAY_OFFSET = 4 * 86_400_000; // 1970-01-01 was a Thursday

/** Open time (UTC) of the bar containing `time`. Weeks start on Monday; months follow the calendar. */
export function alignTime(time: number, timeframe: Timeframe): number {
  const tf = parseTimeframe(timeframe);
  if (tf.unit === 'M') {
    const d = new Date(time);
    const months = d.getUTCFullYear() * 12 + d.getUTCMonth();
    const aligned = months - (months % tf.count);
    return Date.UTC(Math.floor(aligned / 12), aligned % 12, 1);
  }
  if (tf.unit === 'W') return Math.floor((time - MONDAY_OFFSET) / tf.ms) * tf.ms + MONDAY_OFFSET;
  return Math.floor(time / tf.ms) * tf.ms;
}

/** Open time of the bar after the one starting at `time`. */
export function nextBarTime(time: number, timeframe: Timeframe): number {
  const tf = parseTimeframe(timeframe);
  if (tf.unit === 'M') {
    const d = new Date(alignTime(time, timeframe));
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + tf.count, 1);
  }
  return alignTime(time, timeframe) + tf.ms;
}

/** Time range covering `count` bars ending at `to` (inclusive). */
export function rangeForBars(
  to: number,
  timeframe: Timeframe,
  count: number,
): { from: number; to: number } {
  const tf = parseTimeframe(timeframe);
  return { from: alignTime(to, timeframe) - (count - 1) * tf.ms, to };
}

/** True when `timeframe` bars can be built exactly from `base` bars (e.g. 15m from 5m, 1M from 1D). */
export function isMultipleOf(timeframe: Timeframe, base: Timeframe): boolean {
  const a = parseTimeframe(timeframe);
  const b = parseTimeframe(base);
  if (b.unit === 'M') return a.unit === 'M' && a.count % b.count === 0;
  // Calendar months (and weeks) are whole days, so any base that divides a day fits.
  if (a.unit === 'M') return 86_400_000 % b.ms === 0;
  return a.ms >= b.ms && a.ms % b.ms === 0;
}
