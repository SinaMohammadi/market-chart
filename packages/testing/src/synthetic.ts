import type { LinePoint, OhlcBar } from '@market-chart/core';
import { createRandom, gaussian } from './random.js';

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export interface RandomWalkOptions {
  /** Number of bars. */
  count: number;
  /** Bar interval in ms. */
  interval: number;
  /** Time of the first bar (UTC ms). Default: 2024-01-01T00:00:00Z. */
  start?: number;
  startPrice?: number;
  /** Per-bar volatility as a fraction of price (e.g. 0.01 = 1%). */
  volatility?: number;
  /** Per-bar drift as a fraction of price. */
  drift?: number;
  seed?: number;
  /** Price decimals to round to. */
  precision?: number;
  /** Typical volume per bar. */
  baseVolume?: number;
  /** Skip weekends (Sat/Sun, UTC) — useful for stock/forex-like data. */
  skipWeekends?: boolean;
}

/**
 * Generates a deterministic geometric random walk of OHLCV bars.
 * **Synthetic data** — not real market prices.
 */
export function generateBars(options: RandomWalkOptions): OhlcBar[] {
  const {
    count,
    interval,
    start = Date.UTC(2024, 0, 1),
    startPrice = 100,
    volatility = 0.01,
    drift = 0,
    seed = 1,
    precision = 2,
    baseVolume = 1000,
    skipWeekends = false,
  } = options;
  const random = createRandom(seed);
  const factor = 10 ** precision;
  const round = (v: number): number => Math.round(v * factor) / factor;
  const bars: OhlcBar[] = [];
  let price = startPrice;
  let time = start;
  for (let i = 0; i < count; i++) {
    if (skipWeekends) {
      while ([0, 6].includes(new Date(time).getUTCDay())) time += interval >= DAY ? interval : DAY;
    }
    const open = price;
    const steps = 4;
    let high = open;
    let low = open;
    let p = open;
    for (let s = 0; s < steps; s++) {
      p *= 1 + drift / steps + (volatility / Math.sqrt(steps)) * gaussian(random);
      p = Math.max(p, 1 / factor);
      high = Math.max(high, p);
      low = Math.min(low, p);
    }
    const close = p;
    const wick = volatility * open * 0.3;
    high += random() * wick;
    low = Math.max(1 / factor, low - random() * wick);
    const move = Math.abs(close - open) / (open * volatility || 1);
    const volume = Math.round(baseVolume * (0.4 + random() * 0.8 + move * 0.6));
    bars.push({
      time,
      open: round(open),
      high: round(high),
      low: round(low),
      close: round(close),
      volume,
    });
    price = close;
    time += interval;
  }
  return bars;
}

/** Close prices as line points. */
export function barsToLine(bars: readonly OhlcBar[]): LinePoint[] {
  return bars.map((b) => ({ time: b.time, value: b.close }));
}

/** Volume as histogram points coloured by candle direction. */
export function barsToVolume(
  bars: readonly OhlcBar[],
  upColor: string,
  downColor: string,
): LinePoint[] {
  return bars.map((b) => ({
    time: b.time,
    value: b.volume ?? 0,
    color: b.close >= b.open ? upColor : downColor,
  }));
}

export interface SyntheticAsset {
  readonly symbol: string;
  readonly description: string;
  readonly startPrice: number;
  readonly volatility: number;
  readonly precision: number;
  readonly baseVolume: number;
  readonly skipWeekends: boolean;
  readonly seed: number;
}

/**
 * Parameter presets that *resemble* the behaviour of common instruments.
 * All generated data is synthetic and must not be presented as real or exchange-verified.
 */
export const syntheticAssets: Readonly<Record<string, SyntheticAsset>> = {
  BTCUSDT: {
    symbol: 'BTCUSDT',
    description: 'Synthetic crypto pair (BTC-like)',
    startPrice: 42000,
    volatility: 0.012,
    precision: 2,
    baseVolume: 850,
    skipWeekends: false,
    seed: 11,
  },
  ETHUSDT: {
    symbol: 'ETHUSDT',
    description: 'Synthetic crypto pair (ETH-like)',
    startPrice: 2300,
    volatility: 0.015,
    precision: 2,
    baseVolume: 12000,
    skipWeekends: false,
    seed: 12,
  },
  EURUSD: {
    symbol: 'EURUSD',
    description: 'Synthetic FX pair (EUR/USD-like)',
    startPrice: 1.095,
    volatility: 0.0015,
    precision: 5,
    baseVolume: 50000,
    skipWeekends: true,
    seed: 13,
  },
  AAPL: {
    symbol: 'AAPL',
    description: 'Synthetic equity (large-cap tech-like)',
    startPrice: 185,
    volatility: 0.008,
    precision: 2,
    baseVolume: 60000,
    skipWeekends: true,
    seed: 14,
  },
  NDXLIKE: {
    symbol: 'NDXLIKE',
    description: 'Synthetic index (NASDAQ-100-like)',
    startPrice: 16800,
    volatility: 0.006,
    precision: 2,
    baseVolume: 0,
    skipWeekends: true,
    seed: 15,
  },
  XAUUSD: {
    symbol: 'XAUUSD',
    description: 'Synthetic gold-like commodity',
    startPrice: 2050,
    volatility: 0.004,
    precision: 2,
    baseVolume: 9000,
    skipWeekends: true,
    seed: 16,
  },
  XAGUSD: {
    symbol: 'XAGUSD',
    description: 'Synthetic silver-like commodity',
    startPrice: 23.5,
    volatility: 0.007,
    precision: 3,
    baseVolume: 7000,
    skipWeekends: true,
    seed: 17,
  },
};

export function generateAsset(
  symbol: keyof typeof syntheticAssets | string,
  count: number,
  interval: number,
): OhlcBar[] {
  const asset = syntheticAssets[symbol];
  if (!asset) throw new Error(`unknown synthetic asset "${symbol}"`);
  return generateBars({ count, interval, ...asset });
}

/**
 * Simulates a realtime feed on top of historical bars: ticks update the last bar and roll over to a
 * new bar every `interval`. Pure and deterministic — drive it from a timer in demos or tests.
 */
export class TickSimulator {
  private bar: OhlcBar;
  private elapsed = 0;
  private readonly random: () => number;
  private readonly interval: number;
  private readonly volatility: number;
  private readonly factor: number;

  constructor(
    lastBar: OhlcBar,
    options: { interval: number; volatility?: number; seed?: number; precision?: number },
  ) {
    this.bar = lastBar;
    this.interval = options.interval;
    this.volatility = options.volatility ?? 0.001;
    this.random = createRandom(options.seed ?? 99);
    this.factor = 10 ** (options.precision ?? 2);
  }

  /** Advances simulated time by `elapsed` ms and returns the updated (or new) bar. */
  next(elapsed: number): OhlcBar {
    const round = (v: number): number => Math.round(v * this.factor) / this.factor;
    const price = Math.max(
      1 / this.factor,
      this.bar.close * (1 + this.volatility * gaussian(this.random)),
    );
    this.elapsed += elapsed;
    if (this.elapsed >= this.interval) {
      this.elapsed -= this.interval;
      const open = this.bar.close;
      this.bar = {
        time: this.bar.time + this.interval,
        open,
        high: round(Math.max(open, price)),
        low: round(Math.min(open, price)),
        close: round(price),
        volume: Math.round(this.random() * 20),
      };
      return this.bar;
    }
    this.bar = {
      time: this.bar.time,
      open: this.bar.open,
      high: round(Math.max(this.bar.high, price)),
      low: round(Math.min(this.bar.low, price)),
      close: round(price),
      volume: (this.bar.volume ?? 0) + Math.round(this.random() * 20),
    };
    return this.bar;
  }
}
