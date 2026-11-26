import type { OhlcBar } from '@market-chart/core';
import { createRandom } from './random.js';

/** Same shape as `Trade` in `@market-chart/charts` (kept structural to avoid a package dependency). */
export interface SyntheticTrade {
  readonly time: number;
  readonly price: number;
  readonly size: number;
  readonly side: 'buy' | 'sell';
}

export interface SyntheticOrderBook {
  readonly time: number;
  readonly bids: (readonly [number, number])[];
  readonly asks: (readonly [number, number])[];
}

/**
 * **Synthetic** trades consistent with the given bars: each bar's trades walk from its open through its high
 * and low to its close, stay within the bar's range and add up to its volume. Upticks are mostly buys and
 * downticks mostly sells. Not real market data.
 */
export function generateTrades(
  bars: readonly OhlcBar[],
  options: { interval: number; tradesPerBar?: number; tickSize?: number; seed?: number },
): SyntheticTrade[] {
  const random = createRandom(options.seed ?? 7);
  const n = options.tradesPerBar ?? 40;
  const tick = options.tickSize ?? 0.01;
  const snap = (p: number): number => Math.round(p / tick) * tick;
  const out: SyntheticTrade[] = [];
  for (const bar of bars) {
    const highFirst = bar.close < bar.open;
    const anchors = [
      bar.open,
      highFirst ? bar.high : bar.low,
      highFirst ? bar.low : bar.high,
      bar.close,
    ];
    const weights = Array.from({ length: n }, () => 0.2 + random() * 1.8);
    const scale = (bar.volume ?? n) / weights.reduce((a, b) => a + b, 0);
    let prev = bar.open;
    for (let k = 0; k < n; k++) {
      const t = (k / Math.max(1, n - 1)) * (anchors.length - 1);
      const seg = Math.min(anchors.length - 2, Math.floor(t));
      const f = t - seg;
      const base = anchors[seg]! + (anchors[seg + 1]! - anchors[seg]!) * f;
      const noise = (random() - 0.5) * (bar.high - bar.low) * 0.1;
      const price = Math.min(bar.high, Math.max(bar.low, snap(base + noise)));
      const uptick = price > prev || (price === prev && random() < 0.5);
      const side = random() < 0.8 ? (uptick ? 'buy' : 'sell') : uptick ? 'sell' : 'buy';
      out.push({
        time: bar.time + Math.floor((k / n) * options.interval),
        price: Number(price.toFixed(10)),
        size: Number((weights[k]! * scale).toFixed(6)),
        side,
      });
      prev = price;
    }
  }
  return out;
}

/**
 * **Synthetic** order books around mid prices, with persistent "walls" at some price levels so that a
 * liquidity heatmap shows horizontal structure. Not real market data.
 */
export function generateOrderBooks(
  mids: readonly { time: number; price: number }[],
  options: { levels?: number; tickSize: number; baseSize?: number; seed?: number },
): SyntheticOrderBook[] {
  const random = createRandom(options.seed ?? 11);
  const levels = options.levels ?? 40;
  const base = options.baseSize ?? 10;
  const tick = options.tickSize;
  // Deterministic per-price wall strength (same price → same wall over time).
  const wall = (price: number): number => {
    const k = Math.round(price / tick);
    const h = Math.sin(k * 12.9898) * 43758.5453;
    const frac = h - Math.floor(h);
    return frac > 0.93 ? 6 + frac * 10 : 1;
  };
  return mids.map(({ time, price }) => {
    const mid = Math.round(price / tick) * tick;
    const side = (dir: 1 | -1): (readonly [number, number])[] =>
      Array.from({ length: levels }, (_, i) => {
        const p = Number((mid + dir * (i + 1) * tick).toFixed(10));
        const size = base * wall(p) * (0.4 + random()) * (1 + i / levels);
        return [p, Number(size.toFixed(3))] as const;
      });
    return { time, bids: side(-1), asks: side(1) };
  });
}
