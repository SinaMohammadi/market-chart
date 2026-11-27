import type { OhlcBar, TradingSession } from '@market-chart/core';
import type { Trade } from './types.js';
import { ChartsError, assertPositive } from './types.js';

export interface ProfileRow {
  readonly low: number;
  readonly high: number;
  readonly volume: number;
  /** Buy / sell split. Exact with trades; with bars, a bar's volume counts as buying when it closed up. */
  readonly buy: number;
  readonly sell: number;
}

export interface VolumeProfile {
  readonly from: number;
  readonly to: number;
  readonly rowSize: number;
  /** Ascending by price. */
  readonly rows: readonly ProfileRow[];
  readonly totalVolume: number;
  /** Index of the point of control (largest row). */
  readonly pocIndex: number;
  readonly valueAreaLow: number;
  readonly valueAreaHigh: number;
  /** True when built from OHLCV bars (volume spread evenly over each bar's range), false when from trades. */
  readonly approximate: boolean;
}

export interface VolumeProfileOptions {
  /** Number of rows (default 24); ignored when `rowSize` is set. */
  readonly rows?: number;
  readonly rowSize?: number;
  /** Share of volume in the value area (default 0.7). */
  readonly valueArea?: number;
  /** Inclusive time window (default: everything). */
  readonly from?: number;
  readonly to?: number;
}

/**
 * Value area by the standard method: start at the POC and repeatedly add the larger neighbouring row
 * (above or below) until the target share of volume is reached.
 */
export function valueArea(
  volumes: readonly number[],
  pocIndex: number,
  share: number,
): { low: number; high: number } {
  const total = volumes.reduce((a, b) => a + b, 0);
  let low = pocIndex;
  let high = pocIndex;
  let sum = volumes[pocIndex] ?? 0;
  while (sum < total * share && (low > 0 || high < volumes.length - 1)) {
    const below = low > 0 ? volumes[low - 1]! : -1;
    const above = high < volumes.length - 1 ? volumes[high + 1]! : -1;
    if (above >= below) sum += volumes[++high]!;
    else sum += volumes[--low]!;
  }
  return { low, high };
}

function pocOf(volumes: readonly number[]): number {
  let best = 0;
  const centre = (volumes.length - 1) / 2;
  for (let i = 1; i < volumes.length; i++) {
    if (
      volumes[i]! > volumes[best]! ||
      (volumes[i] === volumes[best] && Math.abs(i - centre) < Math.abs(best - centre))
    )
      best = i;
  }
  return best;
}

/** Volume-by-price histogram from OHLCV bars or from trades. */
export function computeVolumeProfile(
  input: { readonly bars?: readonly OhlcBar[]; readonly trades?: readonly Trade[] },
  options: VolumeProfileOptions = {},
): VolumeProfile | null {
  const share = options.valueArea ?? 0.7;
  if (!(share > 0 && share <= 1)) throw new ChartsError('valueArea must be in (0, 1]');
  const from = options.from ?? -Infinity;
  const to = options.to ?? Infinity;
  const trades = input.trades?.filter((t) => t.time >= from && t.time <= to);
  const bars = input.bars?.filter(
    (b) => b.time >= from && b.time <= to && Number.isFinite(b.volume ?? Number.NaN),
  );
  const exact = trades !== undefined;
  const items = exact ? trades! : (bars ?? []);
  if (!items.length) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const item of items) {
    const lo = 'price' in item ? item.price : item.low;
    const hi = 'price' in item ? item.price : item.high;
    if (lo < min) min = lo;
    if (hi > max) max = hi;
  }
  let rowSize = options.rowSize;
  if (rowSize !== undefined) assertPositive(rowSize, 'rowSize');
  else {
    const rows = options.rows ?? 24;
    if (!Number.isInteger(rows) || rows < 1 || rows > 2000)
      throw new ChartsError('rows must be an integer between 1 and 2000');
    rowSize = max > min ? (max - min) / rows : Math.max(Math.abs(min) * 1e-4, 1e-9);
  }
  const base = Math.floor(min / rowSize) * rowSize;
  const count = Math.max(1, Math.floor((max - base) / rowSize) + 1);
  const buy = new Float64Array(count);
  const sell = new Float64Array(count);
  const rowOf = (price: number): number =>
    Math.min(count - 1, Math.max(0, Math.floor((price - base) / rowSize! + 1e-9)));
  if (exact) {
    for (const t of trades!) (t.side === 'buy' ? buy : sell)[rowOf(t.price)]! += t.size;
  } else {
    for (const b of bars!) {
      const target = b.close >= b.open ? buy : sell;
      const volume = b.volume!;
      if (b.high <= b.low) {
        target[rowOf(b.low)]! += volume;
        continue;
      }
      const first = rowOf(b.low);
      const last = rowOf(b.high);
      for (let r = first; r <= last; r++) {
        const lo = Math.max(b.low, base + r * rowSize);
        const hi = Math.min(b.high, base + (r + 1) * rowSize);
        if (hi > lo) target[r]! += (volume * (hi - lo)) / (b.high - b.low);
      }
    }
  }
  const rows: ProfileRow[] = [];
  const volumes: number[] = [];
  for (let r = 0; r < count; r++) {
    const volume = buy[r]! + sell[r]!;
    volumes.push(volume);
    rows.push({
      low: base + r * rowSize,
      high: base + (r + 1) * rowSize,
      volume,
      buy: buy[r]!,
      sell: sell[r]!,
    });
  }
  const pocIndex = pocOf(volumes);
  const va = valueArea(volumes, pocIndex, share);
  const times = items.map((i) => i.time);
  return {
    from: Math.min(...times),
    to: Math.max(...times),
    rowSize,
    rows,
    totalVolume: volumes.reduce((a, b) => a + b, 0),
    pocIndex,
    valueAreaLow: rows[va.low]!.low,
    valueAreaHigh: rows[va.high]!.high,
    approximate: !exact,
  };
}

const DAY = 86_400_000;

/**
 * Splits items into sessions: the trading days of a `TradingSession` (exchange hours in its time zone;
 * pre-market and after-hours items join the session they lead into), or fixed lengths from 00:00 UTC
 * (default one UTC day).
 */
export function sessions<T extends { readonly time: number }>(
  items: readonly T[],
  by: number | TradingSession = DAY,
): T[][] {
  const out: T[][] = [];
  let key = Number.NaN;
  const keyOf =
    typeof by === 'number'
      ? (time: number) => Math.floor(time / by)
      : (time: number) => by.sessionDay(time);
  for (const item of items) {
    const k = keyOf(item.time);
    if (k !== key) {
      out.push([]);
      key = k;
    }
    out[out.length - 1]!.push(item);
  }
  return out;
}

export interface TpoRow {
  readonly low: number;
  readonly high: number;
  /** One letter per period that traded in this row, in period order. */
  readonly letters: string;
}

export interface TpoSession {
  readonly start: number;
  readonly end: number;
  readonly rowSize: number;
  readonly rows: readonly TpoRow[];
  readonly pocPrice: number;
  readonly valueAreaLow: number;
  readonly valueAreaHigh: number;
  readonly initialBalanceLow: number;
  readonly initialBalanceHigh: number;
  readonly periods: number;
}

export interface MarketProfileOptions {
  /** Length of a TPO period in minutes (default 30). */
  readonly periodMinutes?: number;
  /** Price height of a row. Default: about 1/30 of the median session range, rounded to a nice step. */
  readonly rowSize?: number;
  readonly valueArea?: number;
  /** Periods that form the initial balance (default 2, i.e. the first hour with 30-minute periods). */
  readonly initialBalancePeriods?: number;
  /** Fixed session length from 00:00 UTC (default one day); ignored when `session` is set. */
  readonly sessionMs?: number;
  /** Exchange trading days (see `createTradingSession`), instead of UTC days. */
  readonly session?: TradingSession;
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function niceStep(raw: number): number {
  const e = 10 ** Math.floor(Math.log10(raw));
  const f = raw / e;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e;
}

/** Market profile (TPO) per session from intraday bars. */
export function computeMarketProfile(
  bars: readonly OhlcBar[],
  options: MarketProfileOptions = {},
): TpoSession[] {
  const periodMs = (options.periodMinutes ?? 30) * 60_000;
  assertPositive(periodMs, 'periodMinutes');
  const share = options.valueArea ?? 0.7;
  const ib = options.initialBalancePeriods ?? 2;
  const groups = sessions(bars, options.session ?? options.sessionMs ?? DAY);
  if (!groups.length) return [];
  let rowSize = options.rowSize;
  if (rowSize === undefined) {
    const ranges = groups
      .map((g) => Math.max(...g.map((b) => b.high)) - Math.min(...g.map((b) => b.low)))
      .sort((a, b) => a - b);
    const median = ranges[Math.floor(ranges.length / 2)] || 1;
    rowSize = niceStep(median / 30);
  }
  assertPositive(rowSize, 'rowSize');
  const size = rowSize;
  const session = options.session;
  // With a session, TPO periods count from the session's open and only bars in trading hours take part.
  const inHours = session
    ? groups.map((g) => g.filter((b) => session.isOpen(b.time))).filter((g) => g.length > 0)
    : groups;
  return inHours.map((group) => {
    const start = session
      ? (session.sessionsOf(session.sessionDay(group[0]!.time))[0]?.open ?? group[0]!.time)
      : Math.floor(group[0]!.time / (options.sessionMs ?? DAY)) * (options.sessionMs ?? DAY);
    const low = Math.floor(Math.min(...group.map((b) => b.low)) / size) * size;
    const high = Math.max(...group.map((b) => b.high));
    const count = Math.max(1, Math.floor((high - low) / size + 1e-9) + 1);
    const letters: string[] = Array.from({ length: count }, () => '');
    const marked: Set<number>[] = Array.from({ length: count }, () => new Set<number>());
    let ibLow = Infinity;
    let ibHigh = -Infinity;
    let periods = 0;
    for (const b of group) {
      const period = Math.floor((b.time - start) / periodMs);
      periods = Math.max(periods, period + 1);
      if (period < ib) {
        ibLow = Math.min(ibLow, b.low);
        ibHigh = Math.max(ibHigh, b.high);
      }
      const first = Math.max(0, Math.floor((b.low - low) / size + 1e-9));
      const last = Math.min(count - 1, Math.floor((b.high - low) / size + 1e-9));
      for (let r = first; r <= last; r++) {
        if (marked[r]!.has(period)) continue;
        marked[r]!.add(period);
        letters[r] += LETTERS[period % LETTERS.length]!;
      }
    }
    const counts = letters.map((l) => l.length);
    const poc = pocOf(counts);
    const va = valueArea(counts, poc, share);
    return {
      start,
      end: group[group.length - 1]!.time,
      rowSize: size,
      rows: letters.map((l, r) => ({
        low: low + r * size,
        high: low + (r + 1) * size,
        letters: l,
      })),
      pocPrice: low + (poc + 0.5) * size,
      valueAreaLow: low + va.low * size,
      valueAreaHigh: low + (va.high + 1) * size,
      initialBalanceLow: ibLow,
      initialBalanceHigh: ibHigh,
      periods,
    };
  });
}
