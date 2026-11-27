import { describe, expect, it } from 'vitest';
import { createTradingSession } from '@market-chart/core';
import * as defs from './definitions/index.js';
import { IndicatorRunner, computeIndicator } from './runner.js';
import type { Bar, IndicatorDefinition } from './types.js';

const HOUR = 3_600_000;

/** Hourly bars from `start` (UTC), prices rising by 1 per bar so every bar differs. */
function hourly(start: string, count: number): Bar[] {
  const t0 = Date.parse(start);
  return Array.from({ length: count }, (_, i) => ({
    time: t0 + i * HOUR,
    open: 100 + i,
    high: 101 + i,
    low: 99 + i,
    close: 100 + i,
    volume: 10,
  }));
}

/** Times of the bars where VWAP restarts (its value equals that bar's typical price). */
function resets(bars: readonly Bar[], context?: Parameters<typeof computeIndicator>[3]): string[] {
  const result = computeIndicator(
    defs.vwap as unknown as IndicatorDefinition,
    bars,
    { anchor: 'day', bandMultiplier: 0 },
    context,
  );
  const out: string[] = [];
  bars.forEach((bar, i) => {
    const typical = (bar.high + bar.low + bar.close) / 3;
    if (Math.abs(result.values[0]![i]! - typical) < 1e-9)
      out.push(new Date(bar.time).toISOString());
  });
  return out;
}

describe('session-based indicators', () => {
  // Monday 2024-01-08 10:00 UTC to Wednesday 03:00 UTC.
  const bars = hourly('2024-01-08T10:00:00Z', 42);
  const nyse = createTradingSession({ hours: '0930-1600:12345', timeZone: 'America/New_York' });

  it('VWAP restarts at UTC midnight without a session (unchanged default)', () => {
    expect(resets(bars)).toEqual([
      '2024-01-08T10:00:00.000Z',
      '2024-01-09T00:00:00.000Z',
      '2024-01-10T00:00:00.000Z',
    ]);
  });

  it("VWAP restarts with each trading day of the exchange's session", () => {
    // New York closes at 16:00 (21:00 UTC in winter): after-hours and pre-market bars join the next
    // trading day, so the restart is at the first bar after the close.
    expect(resets(bars, { session: nyse })).toEqual([
      '2024-01-08T10:00:00.000Z',
      '2024-01-08T21:00:00.000Z',
      '2024-01-09T21:00:00.000Z',
    ]);
  });

  it('pivots use the previous trading day in the chosen time zone', () => {
    const crypto = createTradingSession({ hours: '24x7' });
    const run = (session: typeof crypto | null) =>
      computeIndicator(
        defs.pivotPoints as unknown as IndicatorDefinition,
        bars,
        { period: 'day' },
        { session },
      ).values[0]!;
    const utc = run(crypto);
    const tehran = run(crypto.withTimeZone('Asia/Tehran'));
    // The first change of the pivot is at the first new day: 00:00 UTC, or 20:30 UTC in Tehran
    // (the first hourly bar of the Tehran day is 21:00 UTC).
    const firstLevel = (values: ArrayLike<number>) =>
      new Date(bars[Array.from(values).findIndex(Number.isFinite)]!.time).toISOString();
    expect(firstLevel(utc)).toBe('2024-01-09T00:00:00.000Z');
    expect(firstLevel(tehran)).toBe('2024-01-08T21:00:00.000Z');
  });

  it('keeps the session out of calculator state, so realtime snapshots work', () => {
    const runner = new IndicatorRunner(
      defs.vwap as unknown as IndicatorDefinition,
      { anchor: 'day' },
      { session: nyse },
    );
    runner.reset(bars);
    const before = runner.result().values[0]![bars.length - 1];
    const last = bars[bars.length - 1]!;
    // The forming bar changes twice; the snapshot (a deep copy of state) must reproduce the session.
    runner.updateLast({ ...last, close: last.close + 5 });
    runner.updateLast(last);
    expect(runner.result().values[0]![bars.length - 1]).toBeCloseTo(before!, 12);
    expect(runner.context.session).toBe(nyse);
  });
});
