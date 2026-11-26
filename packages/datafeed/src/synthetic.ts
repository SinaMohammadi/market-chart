import type { Unsubscribe } from '@market-chart/core';
import { defaultTimers } from './adapters.js';
import type { Timers } from './adapters.js';
import { alignTime, nextBarTime, parseTimeframe } from './timeframe.js';
import type { Candle, Datafeed, SymbolInfo, Timeframe, TimeRange } from './types.js';
import { DatafeedError } from './types.js';

export interface SyntheticSymbol {
  readonly symbol: string;
  readonly name?: string;
  readonly type?: SymbolInfo['type'];
  readonly startPrice?: number;
  /** Relative size of price moves (default 1; 2 = twice as volatile). */
  readonly volatility?: number;
  readonly pricePrecision?: number;
  /** Earliest bar (UTC ms); default: 2 years before `now()` at creation. */
  readonly historyStart?: number;
  /** No bars on Saturdays and Sundays (UTC), like stocks and forex. */
  readonly skipWeekends?: boolean;
  readonly seed?: number;
}

export interface SyntheticDatafeedOptions {
  readonly symbols?: readonly SyntheticSymbol[];
  readonly now?: () => number;
  readonly timers?: Timers;
  /** Realtime update period in ms (default 1000). */
  readonly tickMs?: number;
  /** Simulated latency of history requests, in ms (default 0). */
  readonly latencyMs?: number;
  /** Fraction of bars left out to simulate missing candles (default 0). */
  readonly gapRatio?: number;
  /** Most bars returned per history request (default 5000). */
  readonly maxBars?: number;
}

export interface SyntheticDatafeed extends Datafeed {
  /** Price of the synthetic path at a time (deterministic). */
  priceAt(symbol: string, time: number): number;
  /** Number of history requests served (handy in tests). */
  readonly requests: number;
}

const DEFAULT_SYMBOLS: readonly SyntheticSymbol[] = [
  {
    symbol: 'SYN:BTCUSD',
    name: 'Synthetic Bitcoin',
    type: 'crypto',
    startPrice: 42000,
    volatility: 1.6,
    pricePrecision: 1,
    seed: 11,
  },
  {
    symbol: 'SYN:ETHUSD',
    name: 'Synthetic Ether',
    type: 'crypto',
    startPrice: 2400,
    volatility: 1.9,
    pricePrecision: 2,
    seed: 23,
  },
  {
    symbol: 'SYN:EXAMPLE',
    name: 'Synthetic Example Corp.',
    type: 'stock',
    startPrice: 180,
    volatility: 0.8,
    pricePrecision: 2,
    skipWeekends: true,
    seed: 37,
  },
  {
    symbol: 'SYN:EURUSD',
    name: 'Synthetic EUR/USD',
    type: 'forex',
    startPrice: 1.09,
    volatility: 0.3,
    pricePrecision: 5,
    skipWeekends: true,
    seed: 41,
  },
];

/** 32-bit integer hash → [-1, 1]. */
function hash(seed: number, i: number): number {
  let h =
    Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^
    Math.imul(i | 0, 0xc2b2ae35) ^
    Math.imul(Math.floor(i / 4294967296), 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

/** Smooth value noise in [-1, 1]. */
function noise(seed: number, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const s = f * f * (3 - 2 * f);
  return hash(seed, i) * (1 - s) + hash(seed, i + 1) * s;
}

/** Scales (ms) and weights of the noise octaves that make up the log-price path. */
const OCTAVES: readonly (readonly [number, number])[] = [
  [365 * 86_400_000, 0.35],
  [60 * 86_400_000, 0.16],
  [10 * 86_400_000, 0.07],
  [2 * 86_400_000, 0.03],
  [8 * 3_600_000, 0.012],
  [3_600_000, 0.005],
  [600_000, 0.002],
  [60_000, 0.0008],
  [5_000, 0.0003],
];

/**
 * A deterministic, offline datafeed of **synthetic** prices (not real market data). The price is a pure
 * function of symbol and time, so any range, page or interval is consistent with the others, history is
 * unlimited back to `historyStart`, and realtime updates continue the same path. Use it for demos, tests and
 * benchmarks.
 */
export function createSyntheticDatafeed(options: SyntheticDatafeedOptions = {}): SyntheticDatafeed {
  const now = options.now ?? (() => Date.now());
  const timers = options.timers ?? defaultTimers;
  const created = now();
  const symbols = new Map((options.symbols ?? DEFAULT_SYMBOLS).map((s) => [s.symbol, s]));
  const maxBars = options.maxBars ?? 5000;
  const gapRatio = Math.min(Math.max(options.gapRatio ?? 0, 0), 0.9);
  let requests = 0;

  const spec = (symbol: string): SyntheticSymbol => {
    const s = symbols.get(symbol);
    if (!s) throw new DatafeedError(`unknown symbol "${symbol}"`);
    return s;
  };
  const historyStart = (s: SyntheticSymbol): number =>
    s.historyStart ?? alignTime(created - 730 * 86_400_000, '1D');
  const seedOf = (s: SyntheticSymbol): number =>
    s.seed ?? [...s.symbol].reduce((h, c) => Math.imul(h, 31) + c.charCodeAt(0), 7);
  const round = (s: SyntheticSymbol, v: number): number => {
    const f = 10 ** (s.pricePrecision ?? 2);
    return Math.round(v * f) / f;
  };
  const rawPrice = (s: SyntheticSymbol, time: number): number => {
    const seed = seedOf(s);
    let log = 0;
    OCTAVES.forEach(([scale, weight], k) => {
      log += noise(seed + k * 101, time / scale) * weight;
    });
    return (s.startPrice ?? 100) * Math.exp(log * (s.volatility ?? 1));
  };
  const isTrading = (s: SyntheticSymbol, time: number, interval: Timeframe): boolean => {
    if (
      s.skipWeekends &&
      parseTimeframe(interval).ms < 7 * 86_400_000 &&
      [0, 6].includes(new Date(time).getUTCDay())
    )
      return false;
    return gapRatio === 0 || (hash(seedOf(s) + 7919, Math.floor(time / 1000)) + 1) / 2 >= gapRatio;
  };
  const candle = (s: SyntheticSymbol, interval: Timeframe, time: number, until: number): Candle => {
    const end = Math.min(nextBarTime(time, interval), until);
    const open = rawPrice(s, time);
    const close = rawPrice(s, end);
    let high = Math.max(open, close);
    let low = Math.min(open, close);
    const samples = 12;
    for (let i = 1; i < samples; i++) {
      const p = rawPrice(s, time + ((end - time) * i) / samples);
      high = Math.max(high, p);
      low = Math.min(low, p);
    }
    const seed = seedOf(s) + 31;
    const wick =
      0.0015 * (s.volatility ?? 1) * Math.sqrt(Math.max((end - time) / 3_600_000, 1 / 60));
    high *= 1 + Math.abs(hash(seed, Math.floor(time / 1000))) * wick;
    low *= 1 - Math.abs(hash(seed + 1, Math.floor(time / 1000))) * wick;
    const minutes = Math.max((end - time) / 60_000, 1 / 60);
    const volume = Math.round(
      minutes *
        100 *
        (1.2 + hash(seed + 2, Math.floor(time / 1000))) *
        (1 + (Math.abs(close - open) / open) * 200),
    );
    return {
      time,
      open: round(s, open),
      high: round(s, Math.max(high, open, close)),
      low: round(s, Math.min(low, open, close)),
      close: round(s, close),
      volume,
    };
  };
  const bars = (
    s: SyntheticSymbol,
    interval: Timeframe,
    range: TimeRange,
    until: number,
  ): Candle[] => {
    parseTimeframe(interval);
    const out: Candle[] = [];
    const from = Math.max(range.from, historyStart(s));
    const to = Math.min(range.to, until);
    let t = alignTime(from, interval);
    if (t < from) t = nextBarTime(t, interval);
    for (; t <= to && out.length < maxBars; t = nextBarTime(t, interval)) {
      if (isTrading(s, t, interval)) out.push(candle(s, interval, t, until));
    }
    return out;
  };

  return {
    get requests() {
      return requests;
    },
    priceAt: (symbol, time) => round(spec(symbol), rawPrice(spec(symbol), time)),
    async searchSymbols(query) {
      const q = query.trim().toLowerCase();
      return [...symbols.values()]
        .filter(
          (s) => s.symbol.toLowerCase().includes(q) || (s.name ?? '').toLowerCase().includes(q),
        )
        .map((s) => info(s));
    },
    async resolveSymbol(symbol) {
      return info(spec(symbol));
    },
    async getHistoricalData(symbol, interval, range) {
      requests++;
      const s = spec(symbol);
      if (options.latencyMs)
        await new Promise<void>((resolve) => timers.setTimeout(resolve, options.latencyMs!));
      return bars(s, interval, range, now());
    },
    subscribe(symbol, interval, callback): Unsubscribe {
      const s = spec(symbol);
      parseTimeframe(interval);
      const handle = timers.setInterval(() => {
        const t = now();
        const time = alignTime(t, interval);
        if (isTrading(s, time, interval)) callback(candle(s, interval, time, t));
      }, options.tickMs ?? 1000);
      return () => timers.clearInterval(handle);
    },
  };

  function info(s: SyntheticSymbol): SymbolInfo {
    return {
      symbol: s.symbol,
      name: s.name ?? s.symbol,
      description: `${s.name ?? s.symbol} (synthetic data)`,
      exchange: 'SYNTHETIC',
      type: s.type ?? 'crypto',
      pricePrecision: s.pricePrecision ?? 2,
      minMove: 10 ** -(s.pricePrecision ?? 2),
      session: s.skipWeekends ? '0000-2400:12345' : '24x7',
      timeframes: ['1m', '5m', '15m', '1h', '4h', '1D', '1W'],
      historyStart: historyStart(s),
    };
  }
}
