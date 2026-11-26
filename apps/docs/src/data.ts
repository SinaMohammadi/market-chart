import type { LinePoint, OhlcBar } from '@market-chart/core';
import { DAY, HOUR, generateAsset } from '@market-chart/testing';

/**
 * Example data for the documentation. All of it is SYNTHETIC: seeded random walks from
 * `@market-chart/testing`, never real market prices.
 */
const cache = new Map<string, OhlcBar[]>();

export function syntheticBars(symbol = 'BTCUSDT', count = 600, interval = HOUR): OhlcBar[] {
  const key = `${symbol}:${count}:${interval}`;
  let bars = cache.get(key);
  if (!bars) cache.set(key, (bars = generateAsset(symbol, count, interval)));
  return bars;
}

export const dailyBars = (symbol = 'NDXLIKE', count = 500) => syntheticBars(symbol, count, DAY);

export function volumeOf(bars: readonly OhlcBar[]): LinePoint[] {
  return bars.map((b) => ({
    time: b.time,
    value: b.volume ?? 0,
    color: b.close >= b.open ? 'rgba(8,153,129,0.45)' : 'rgba(242,54,69,0.45)',
  }));
}

export const closes = (bars: readonly OhlcBar[]): LinePoint[] =>
  bars.map((b) => ({ time: b.time, value: b.close }));
