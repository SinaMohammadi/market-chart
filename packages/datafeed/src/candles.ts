import { alignTime, nextBarTime, parseTimeframe } from './timeframe.js';
import type { TradingSession } from '@market-chart/core';
import type { Candle, Timeframe } from './types.js';
import { DatafeedError } from './types.js';

/** Timestamps below this are taken as seconds (≈ year 2286 in seconds, 1970 + 11 days in ms). */
const SECONDS_THRESHOLD = 1e11;

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return Number.NaN;
}

/** Largest time a JavaScript Date can represent (±100,000,000 days in ms). */
export const MAX_CANDLE_TIME = 8.64e15;
/** Prices and volumes beyond ±1e18 are rejected: they are data errors and break scale maths. */
export const MAX_CANDLE_VALUE = 1e18;

const LOCAL_ISO = /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d(:\d\d(\.\d+)?)?$/;
const NUMERIC = /^-?\d+(\.\d+)?$/;

/**
 * Converts seconds, milliseconds, ISO strings or Date objects to UTC ms (NaN when impossible).
 * ISO date-times without a zone are read as UTC, so results do not depend on the user's time zone.
 */
export function toTimestamp(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const text = value.trim();
    if (!NUMERIC.test(text)) {
      const parsed = Date.parse(LOCAL_ISO.test(text) ? `${text.replace(' ', 'T')}Z` : text);
      return Number.isFinite(parsed) ? parsed : Number.NaN;
    }
  }
  const n = toNumber(value);
  if (!Number.isFinite(n)) return Number.NaN;
  return Math.abs(n) < SECONDS_THRESHOLD ? n * 1000 : n;
}

export interface NormalizeResult {
  readonly candles: Candle[];
  /** Rows rejected because a field was missing or not a finite number. */
  readonly dropped: number;
  /** Rows whose time appeared more than once (the last one wins). */
  readonly duplicates: number;
}

/**
 * Turns untrusted rows into valid candles: accepts `{ time|t|timestamp|date, open|o, high|h, low|l, close|c,
 * volume|v }` objects or `[time, open, high, low, close, volume?]` arrays, numbers as strings, times in seconds,
 * ms or ISO format. Rows are sorted, duplicates resolved (last wins), and high/low widened to include
 * open and close.
 */
export function normalizeCandles(rows: readonly unknown[]): NormalizeResult {
  if (!Array.isArray(rows)) throw new DatafeedError('expected an array of candles');
  const byTime = new Map<number, Candle>();
  let dropped = 0;
  let duplicates = 0;
  for (const row of rows) {
    let t: unknown;
    let o: unknown;
    let h: unknown;
    let l: unknown;
    let c: unknown;
    let v: unknown;
    if (Array.isArray(row)) [t, o, h, l, c, v] = row;
    else if (row && typeof row === 'object') {
      const r = row as Record<string, unknown>;
      t = r['time'] ?? r['t'] ?? r['timestamp'] ?? r['date'] ?? r['openTime'];
      o = r['open'] ?? r['o'];
      h = r['high'] ?? r['h'];
      l = r['low'] ?? r['l'];
      c = r['close'] ?? r['c'] ?? r['price'] ?? r['value'];
      v = r['volume'] ?? r['v'] ?? r['vol'];
    } else {
      dropped++;
      continue;
    }
    const time = toTimestamp(t);
    const close = toNumber(c);
    const open = o === undefined ? close : toNumber(o);
    const high = h === undefined ? Math.max(open, close) : toNumber(h);
    const low = l === undefined ? Math.min(open, close) : toNumber(l);
    if (
      ![time, open, high, low, close].every(Number.isFinite) ||
      Math.abs(time) > MAX_CANDLE_TIME ||
      ![open, high, low, close].every((x) => Math.abs(x) <= MAX_CANDLE_VALUE)
    ) {
      dropped++;
      continue;
    }
    const raw = v === undefined || v === null || v === '' ? undefined : toNumber(v);
    const volume = raw !== undefined && Math.abs(raw) <= MAX_CANDLE_VALUE ? raw : undefined;
    if (byTime.has(time)) duplicates++;
    byTime.set(time, {
      time,
      open,
      high: Math.max(high, open, close),
      low: Math.min(low, open, close),
      close,
      ...(volume !== undefined && Number.isFinite(volume) ? { volume } : {}),
    });
  }
  const candles = [...byTime.values()].sort((a, b) => a.time - b.time);
  return { candles, dropped, duplicates };
}

/** Merges two sorted candle lists; on equal times `newer` wins (used for pagination and corrections). */
export function mergeCandles(older: readonly Candle[], newer: readonly Candle[]): Candle[] {
  const map = new Map<number, Candle>();
  for (const c of older) map.set(c.time, c);
  for (const c of newer) map.set(c.time, c);
  return [...map.values()].sort((a, b) => a.time - b.time);
}

/** Aggregates candles into a larger timeframe (e.g. 1m → 15m, 1h → 1D, 1D → 1W/1M). */
export function resampleCandles(candles: readonly Candle[], timeframe: Timeframe): Candle[] {
  parseTimeframe(timeframe);
  const out: Candle[] = [];
  let current: {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
  } | null = null;
  for (const c of candles) {
    const t = alignTime(c.time, timeframe);
    if (!current || current.time !== t) {
      if (current) out.push(current);
      current = {
        time: t,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        ...(c.volume !== undefined ? { volume: c.volume } : {}),
      };
      continue;
    }
    current.high = Math.max(current.high, c.high);
    current.low = Math.min(current.low, c.low);
    current.close = c.close;
    if (c.volume !== undefined) current.volume = (current.volume ?? 0) + c.volume;
  }
  if (current) out.push(current);
  return out;
}

const DAY_MS = 86_400_000;
/** Closed times are stepped over without filling; this bounds the work for very long gaps. */
const MAX_FILL_STEPS = 1_000_000;

/**
 * Inserts flat candles (open = high = low = close = previous close, volume 0) for missing bars between
 * existing ones. Without a session every missing time is filled (continuous markets); with one, only
 * trading hours (intraday) or trading days (daily bars), so nights, weekends and holidays stay empty.
 */
export function fillMissingCandles(
  candles: readonly Candle[],
  timeframe: Timeframe,
  maxFill = 10_000,
  session: TradingSession | null = null,
): Candle[] {
  const out: Candle[] = [];
  let filled = 0;
  // With a session: intraday bars only in trading hours, daily bars only on trading days.
  const unit = session ? parseTimeframe(timeframe).unit : null;
  const tradable = !session
    ? null
    : unit === 'D'
      ? (t: number) => session.isTradingDay(Math.floor(t / DAY_MS))
      : unit === 'W' || unit === 'M'
        ? null
        : (t: number) => session.isOpen(t);
  let steps = 0;
  for (const c of candles) {
    const prev = out[out.length - 1];
    if (prev) {
      for (
        let t = nextBarTime(prev.time, timeframe);
        t < c.time && filled < maxFill && steps < MAX_FILL_STEPS;
        t = nextBarTime(t, timeframe)
      ) {
        steps++;
        if (tradable && !tradable(t)) continue;
        out.push({
          time: t,
          open: prev.close,
          high: prev.close,
          low: prev.close,
          close: prev.close,
          volume: 0,
        });
        filled++;
      }
    }
    out.push(c);
  }
  return out;
}

/**
 * Builds candles from a stream of trades/ticks for one timeframe. `push` returns the updated forming candle,
 * which can be passed straight to `series.update()`.
 */
export class CandleAggregator {
  private current: {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  } | null = null;

  constructor(readonly timeframe: Timeframe) {
    parseTimeframe(timeframe);
  }

  push(tick: { readonly time: number; readonly price: number; readonly size?: number }): Candle {
    if (!Number.isFinite(tick.time) || !Number.isFinite(tick.price))
      throw new DatafeedError('tick needs finite time and price');
    const t = alignTime(tick.time, this.timeframe);
    if (!this.current || t > this.current.time) {
      this.current = {
        time: t,
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
        volume: 0,
      };
    } else if (t === this.current.time) {
      this.current.high = Math.max(this.current.high, tick.price);
      this.current.low = Math.min(this.current.low, tick.price);
      this.current.close = tick.price;
    } else {
      throw new DatafeedError('ticks must arrive in time order');
    }
    this.current.volume += tick.size ?? 0;
    return { ...this.current };
  }
}
