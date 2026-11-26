import type { OhlcBar } from '@market-chart/core';
import { DAY, HOUR, generateBars } from '@market-chart/testing';

/** SYNTHETIC instruments (seeded random walks), never real prices. Generated on the server. */
export const instruments = [
  { symbol: 'SYN-ALPHA', name: 'Alpha Index', startPrice: 4_800, seed: 11 },
  { symbol: 'SYN-BETA', name: 'Beta Coin', startPrice: 62_000, seed: 23 },
  { symbol: 'SYN-GAMMA', name: 'Gamma Corp.', startPrice: 182, seed: 37 },
  { symbol: 'SYN-DELTA', name: 'Delta FX', startPrice: 1.09, seed: 41 },
  { symbol: 'SYN-OMEGA', name: 'Omega Metals', startPrice: 2_350, seed: 53 },
  { symbol: 'SYN-SIGMA', name: 'Sigma Energy', startPrice: 78, seed: 61 },
] as const;

const START = Date.UTC(2024, 0, 1);

export function dailyBars(seed: number, startPrice: number, count = 120): OhlcBar[] {
  return generateBars({
    count,
    interval: DAY,
    start: START,
    startPrice,
    seed,
    volatility: 0.018,
    precision: startPrice < 10 ? 4 : 2,
  });
}

export function hourlyBars(seed: number, startPrice: number, count = 500): OhlcBar[] {
  return generateBars({
    count,
    interval: HOUR,
    start: START,
    startPrice,
    seed,
    volatility: 0.006,
    precision: startPrice < 10 ? 4 : 2,
  });
}
