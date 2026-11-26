import type { LinePoint, OhlcBar } from '@market-chart/core';
import { DAY, HOUR, generateAsset } from '@market-chart/testing';

/** All playground data is SYNTHETIC (seeded random walks), never real market prices. */
const cache = new Map<string, OhlcBar[]>();

export function syntheticBars(symbol: string, count: number, interval = HOUR): OhlcBar[] {
  const key = `${symbol}:${count}:${interval}`;
  let bars = cache.get(key);
  if (!bars) {
    bars = generateAsset(symbol, count, interval);
    cache.set(key, bars);
  }
  return bars;
}

export const dailyBars = (symbol: string, count = 400) => syntheticBars(symbol, count, DAY);

export function volume(bars: readonly OhlcBar[]): LinePoint[] {
  return bars.map((b) => ({
    time: b.time,
    value: b.volume ?? 0,
    color: b.close >= b.open ? 'rgba(38,166,154,0.45)' : 'rgba(239,83,80,0.45)',
  }));
}
