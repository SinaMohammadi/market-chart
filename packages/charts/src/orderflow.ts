import type { HistogramPoint, OhlcBar } from '@market-chart/core';
import type { FootprintBar, FootprintLevel, Trade } from './types.js';
import { assertPositive, assertSorted } from './types.js';

export interface FootprintOptions {
  /** Bar length in ms (e.g. 60_000 for one-minute bars). Bars start at multiples of it (UTC). */
  readonly interval: number;
  /** Price bucket of a footprint level. */
  readonly tickSize: number;
}

/** Aggregates trades into footprint bars: OHLC, volume, delta and bid/ask volume per price level. */
export function aggregateFootprint(
  trades: readonly Trade[],
  options: FootprintOptions,
): FootprintBar[] {
  assertPositive(options.interval, 'interval');
  assertPositive(options.tickSize, 'tickSize');
  assertSorted(trades, 'trades');
  const out: FootprintBar[] = [];
  let start = Number.NaN;
  let open = 0;
  let high = 0;
  let low = 0;
  let close = 0;
  let volume = 0;
  let delta = 0;
  let levels = new Map<number, { bid: number; ask: number }>();
  const flush = (): void => {
    if (Number.isNaN(start)) return;
    const list: FootprintLevel[] = [...levels.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([k, v]) => ({
        price: Number((k * options.tickSize).toFixed(10)),
        bid: v.bid,
        ask: v.ask,
      }));
    out.push({ time: start, open, high, low, close, volume, delta, levels: list });
  };
  for (const t of trades) {
    const barStart = Math.floor(t.time / options.interval) * options.interval;
    if (barStart !== start) {
      flush();
      start = barStart;
      open = high = low = t.price;
      volume = 0;
      delta = 0;
      levels = new Map();
    }
    high = Math.max(high, t.price);
    low = Math.min(low, t.price);
    close = t.price;
    volume += t.size;
    delta += t.side === 'buy' ? t.size : -t.size;
    const key = Math.round(t.price / options.tickSize);
    const level = levels.get(key) ?? { bid: 0, ask: 0 };
    if (t.side === 'buy') level.ask += t.size;
    else level.bid += t.size;
    levels.set(key, level);
  }
  flush();
  return out;
}

/**
 * Cumulative volume delta as candles: open = CVD before the bar, close = after it, high/low = intrabar
 * extremes of the running CVD. Exact, because it is computed trade by trade.
 */
export function cumulativeVolumeDelta(
  trades: readonly Trade[],
  options: { readonly interval: number },
): OhlcBar[] {
  assertPositive(options.interval, 'interval');
  assertSorted(trades, 'trades');
  const out: OhlcBar[] = [];
  let cvd = 0;
  let current: { time: number; open: number; high: number; low: number; close: number } | null =
    null;
  for (const t of trades) {
    const barStart = Math.floor(t.time / options.interval) * options.interval;
    if (!current || current.time !== barStart) {
      if (current) out.push(current);
      current = { time: barStart, open: cvd, high: cvd, low: cvd, close: cvd };
    }
    cvd += t.side === 'buy' ? t.size : -t.size;
    current.high = Math.max(current.high, cvd);
    current.low = Math.min(current.low, cvd);
    current.close = cvd;
  }
  if (current) out.push(current);
  return out;
}

/** Delta per bar as histogram points coloured by sign. */
export function deltaHistogram(
  bars: readonly FootprintBar[],
  upColor = 'rgba(38, 166, 154, 0.8)',
  downColor = 'rgba(239, 83, 80, 0.8)',
): HistogramPoint[] {
  return bars.map((b) => ({
    time: b.time,
    value: b.delta,
    color: b.delta >= 0 ? upColor : downColor,
  }));
}
