import { describe, expect, it } from 'vitest';
import { createTradingSession } from '@market-chart/core';
import type { OhlcBar } from '@market-chart/core';
import { generateBars, generateOrderBooks, generateTrades } from '@market-chart/testing';
import { aggregateFootprint, cumulativeVolumeDelta, deltaHistogram } from './orderflow.js';
import { computeMarketProfile, computeVolumeProfile, sessions, valueArea } from './profiles.js';
import { heatColor, heatmapEnvelope, kagiEnvelope, pointFigureEnvelope } from './renderers.js';
import {
  heikinAshi,
  kagi,
  lineBreak,
  pointAndFigure,
  rangeBars,
  renko,
  spread,
  tickBars,
} from './transforms.js';
import type { Trade } from './types.js';

const MINUTE = 60_000;
const bar = (time: number, close: number, open = close): OhlcBar => ({
  time,
  open,
  high: Math.max(open, close),
  low: Math.min(open, close),
  close,
  volume: 10,
});
const closes = (values: number[]): OhlcBar[] => values.map((v, i) => bar(i * MINUTE, v));
const strictlyIncreasing = (items: { time: number }[]): boolean =>
  items.every((x, i) => i === 0 || x.time > items[i - 1]!.time);

const random = generateBars({
  count: 500,
  interval: MINUTE,
  startPrice: 100,
  volatility: 0.01,
  seed: 4,
  baseVolume: 100,
});

describe('transforms', () => {
  it('Heikin-Ashi', () => {
    const [a, b] = heikinAshi([
      { time: 0, open: 10, high: 12, low: 9, close: 11 },
      { time: 1, open: 11, high: 13, low: 10, close: 12 },
    ]);
    expect(a).toMatchObject({ open: 10.5, close: 10.5, high: 12, low: 9 });
    expect(b!.open).toBe((10.5 + 10.5) / 2);
    expect(b!.close).toBe(11.5);
  });

  it('Renko bricks and two-box reversals', () => {
    const up = renko(closes([100, 101, 104.5, 106]), { boxSize: 2 });
    expect(up.map((b) => [b.open, b.close])).toEqual([
      [100, 102],
      [102, 104],
      [104, 106],
    ]);
    // A 1-box pullback does nothing; a 2-box drop reverses from the previous brick's open.
    expect(renko(closes([100, 104, 102.5]), { boxSize: 2 })).toHaveLength(2);
    const reversed = renko(closes([100, 104, 99.5]), { boxSize: 2 });
    expect(reversed.slice(2).map((b) => [b.open, b.close])).toEqual([[102, 100]]);
    expect(strictlyIncreasing(renko(random, { boxSize: { atr: 14 } }))).toBe(true);
  });

  it('three-line break', () => {
    // 10.5 stays above the lowest point of the last three lines (10): no reversal.
    expect(lineBreak(closes([10, 11, 12, 13, 12.5, 10.5]), { lines: 3 })).toHaveLength(3);
    const lines = lineBreak(closes([10, 11, 12, 13, 12.5, 9.5]), { lines: 3 });
    expect(lines.map((l) => [l.open, l.close])).toEqual([
      [10, 11],
      [11, 12],
      [12, 13],
      [12, 9.5],
    ]);
  });

  it('range bars from ticks', () => {
    const bars = rangeBars(
      [0, 0.5, 1.2, 1.0, 3.0].map((price, i) => ({ time: i, price })),
      { range: 1 },
    );
    expect(bars.every((b) => b.high - b.low <= 1 + 1e-9)).toBe(true);
    expect(bars[0]).toMatchObject({ open: 0, close: 1 });
    expect(strictlyIncreasing(bars)).toBe(true);
  });

  it('tick bars and spreads', () => {
    const trades: Trade[] = Array.from({ length: 10 }, (_, i) => ({
      time: i,
      price: 10 + i,
      size: 1,
      side: 'buy',
    }));
    const bars = tickBars(trades, { count: 4 });
    expect(bars.map((b) => b.volume)).toEqual([4, 4, 2]);
    expect(bars[0]).toMatchObject({ open: 10, high: 13, low: 10, close: 13 });
    const a = closes([10, 20, 30]);
    const b = [bar(0, 5), bar(2 * MINUTE, 10)];
    expect(spread(a, b).map((p) => p.value)).toEqual([5, 20]);
    expect(spread(a, b, 'ratio').map((p) => p.value)).toEqual([2, 3]);
  });

  it('Kagi columns with yang/yin switches', () => {
    const cols = kagi(closes([100, 105, 110, 104, 107, 112, 103]), { reversal: 4 });
    expect(cols.map((c) => [c.start, c.end])).toEqual([
      [100, 110],
      [110, 104],
      [104, 112],
      [112, 103],
    ]);
    expect(cols[2]!.switchPrice).toBeNull(); // already yang, 112 > shoulder 110 keeps it yang
    expect(cols[3]!.switchPrice).toBe(104); // falls below the waist 104 → yin
    expect(kagiEnvelope(cols)[0]).toMatchObject({ open: 100, close: 110, high: 110, low: 100 });
    expect(strictlyIncreasing(kagi(random, { reversal: 0.01, mode: 'percent' }))).toBe(true);
  });

  it('Point & Figure columns', () => {
    const cols = pointAndFigure(closes([100, 106, 104, 102]), { boxSize: 1, reversal: 3 });
    expect(cols.map((c) => [c.direction, c.low, c.high])).toEqual([
      ['X', 101, 106],
      ['O', 102, 105],
    ]);
    expect(pointFigureEnvelope(cols)[0]).toMatchObject({ open: 100.5, close: 106.5 });
    expect(strictlyIncreasing(pointAndFigure(random, { boxSize: { atr: 14 }, source: 'hl' }))).toBe(
      true,
    );
  });

  it('rejects invalid options', () => {
    expect(() => renko(random, { boxSize: 0 })).toThrow(/box size/);
    expect(() => lineBreak(random, { lines: 0 })).toThrow(/lines/);
    expect(() => tickBars([], { count: 0 })).toThrow(/count/);
  });
});

describe('profiles', () => {
  it('volume profile conserves volume and finds POC and value area', () => {
    const p = computeVolumeProfile({ bars: random }, { rows: 30 })!;
    const total = random.reduce((s, b) => s + (b.volume ?? 0), 0);
    expect(p.totalVolume).toBeCloseTo(total, 6);
    expect(p.rows.reduce((s, r) => s + r.volume, 0)).toBeCloseTo(total, 6);
    const poc = p.rows[p.pocIndex]!;
    expect(p.rows.every((r) => r.volume <= poc.volume)).toBe(true);
    const inVa = p.rows.filter(
      (r) => r.low >= p.valueAreaLow - 1e-9 && r.high <= p.valueAreaHigh + 1e-9,
    );
    expect(inVa.reduce((s, r) => s + r.volume, 0) / total).toBeGreaterThanOrEqual(0.7);
    expect(p.approximate).toBe(true);
  });

  it('exact buy/sell split from trades', () => {
    const trades: Trade[] = [
      { time: 1, price: 10, size: 2, side: 'buy' },
      { time: 2, price: 10, size: 1, side: 'sell' },
      { time: 3, price: 11, size: 5, side: 'sell' },
    ];
    const p = computeVolumeProfile({ trades }, { rowSize: 1 })!;
    expect(p.rows.map((r) => [r.low, r.buy, r.sell])).toEqual([
      [10, 2, 1],
      [11, 0, 5],
    ]);
    expect(p.approximate).toBe(false);
    expect(computeVolumeProfile({ trades: [] })).toBeNull();
  });

  it('value area expands towards the larger neighbour', () => {
    expect(valueArea([1, 5, 10, 2, 1], 2, 0.7)).toEqual({ low: 1, high: 2 });
  });

  it('market profile letters, POC and initial balance', () => {
    const day = Date.UTC(2024, 0, 2);
    const bars: OhlcBar[] = [
      { time: day, open: 10, high: 12, low: 10, close: 11 },
      { time: day + 30 * MINUTE, open: 11, high: 11, low: 9, close: 10 },
      { time: day + 60 * MINUTE, open: 10, high: 11, low: 10, close: 11 },
    ];
    const [s] = computeMarketProfile(bars, { rowSize: 1, initialBalancePeriods: 2 });
    expect(s!.rows.map((r) => r.letters)).toEqual(['B', 'ABC', 'ABC', 'A']);
    expect(s!.pocPrice).toBe(10.5);
    expect([s!.initialBalanceLow, s!.initialBalanceHigh]).toEqual([9, 12]);
    expect(s!.periods).toBe(3);
  });
});

describe('order flow', () => {
  const trades = generateTrades(random.slice(0, 20), {
    interval: MINUTE,
    tradesPerBar: 30,
    tickSize: 0.01,
  }) as Trade[];

  it('generates trades consistent with the bars', () => {
    const first = random[0]!;
    const barTrades = trades.filter((t) => t.time < first.time + MINUTE);
    expect(
      barTrades.every((t) => t.price >= first.low - 1e-9 && t.price <= first.high + 1e-9),
    ).toBe(true);
    expect(barTrades.reduce((s, t) => s + t.size, 0)).toBeCloseTo(first.volume!, 3);
  });

  it('footprint bars add up', () => {
    const footprint = aggregateFootprint(trades, { interval: MINUTE, tickSize: 0.05 });
    expect(footprint).toHaveLength(20);
    for (const b of footprint) {
      const bid = b.levels.reduce((s, l) => s + l.bid, 0);
      const ask = b.levels.reduce((s, l) => s + l.ask, 0);
      expect(bid + ask).toBeCloseTo(b.volume, 6);
      expect(ask - bid).toBeCloseTo(b.delta, 6);
      expect(b.levels.every((l, i) => i === 0 || l.price > b.levels[i - 1]!.price)).toBe(true);
    }
    expect(deltaHistogram(footprint)[0]!.value).toBe(footprint[0]!.delta);
  });

  it('CVD candles chain and match the total signed volume', () => {
    const cvd = cumulativeVolumeDelta(trades, { interval: MINUTE });
    const total = trades.reduce((s, t) => s + (t.side === 'buy' ? t.size : -t.size), 0);
    expect(cvd[cvd.length - 1]!.close).toBeCloseTo(total, 6);
    for (let i = 1; i < cvd.length; i++) expect(cvd[i]!.open).toBeCloseTo(cvd[i - 1]!.close, 9);
    expect(
      cvd.every((c) => c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close)),
    ).toBe(true);
  });

  it('order books and heatmap helpers', () => {
    const books = generateOrderBooks([{ time: 1, price: 100 }], { tickSize: 0.5, levels: 5 });
    expect(books[0]!.bids[0]![0]).toBe(99.5);
    expect(books[0]!.asks[4]![0]).toBe(102.5);
    expect(heatmapEnvelope(books)[0]!.value).toBe(100);
    expect(heatColor(0)).toBe('rgb(8, 14, 60)');
    expect(heatColor(1)).toBe('rgb(255, 255, 255)');
  });
});

describe('profiles by trading session', () => {
  // 30-minute bars from Monday 2024-01-08 12:00 UTC to Tuesday 23:30 UTC.
  const start = Date.parse('2024-01-08T12:00:00Z');
  const bars: OhlcBar[] = Array.from({ length: 72 }, (_, i) => ({
    time: start + i * 1_800_000,
    open: 100,
    high: 101 + (i % 5),
    low: 99 - (i % 3),
    close: 100,
    volume: 10,
  }));
  const nyse = createTradingSession({ hours: '0930-1600:12345', timeZone: 'America/New_York' });

  it('splits by the trading day instead of the UTC day', () => {
    const utc = sessions(bars);
    expect(utc.map((g) => new Date(g[0]!.time).toISOString())).toEqual([
      '2024-01-08T12:00:00.000Z',
      '2024-01-09T00:00:00.000Z',
    ]);
    // New York: the session ends at 21:00 UTC; later bars belong to the next trading day.
    const ny = sessions(bars, nyse);
    expect(ny.map((g) => new Date(g[0]!.time).toISOString())).toEqual([
      '2024-01-08T12:00:00.000Z',
      '2024-01-08T21:00:00.000Z',
      '2024-01-09T21:00:00.000Z',
    ]);
    expect(ny.flat()).toHaveLength(bars.length);
  });

  it('builds one market profile per trading day, from the open', () => {
    expect(computeMarketProfile(bars)).toHaveLength(2);
    // Regular hours only: periods count from the 09:30 open (14:30 UTC); the last group has only
    // after-hours bars and gives no profile.
    const profiles = computeMarketProfile(bars, { session: nyse });
    expect(profiles.map((p) => new Date(p.start).toISOString())).toEqual([
      '2024-01-08T14:30:00.000Z',
      '2024-01-09T14:30:00.000Z',
    ]);
    expect(profiles[0]!.periods).toBe(13);
  });
});
