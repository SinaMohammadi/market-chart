// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChart, createTradingSession } from '@market-chart/core';
import type { ChartApi } from '@market-chart/core';
import { installCanvasMock } from '@market-chart/testing';
import { createStaticDatafeed, DatafeedController, fillMissingCandles } from './index.js';
import type { Candle } from './index.js';

const HOUR = 3_600_000;
const HALF = HOUR / 2;
const DAY = 86_400_000;
const bar = (time: number, close = 1): Candle => ({
  time,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1,
});
const iso = (t: number) => new Date(t).toISOString();

let restore: () => void = () => undefined;
const cleanups: (() => void)[] = [];
beforeEach(() => {
  restore = installCanvasMock();
});
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
  restore();
});

function chart(): ChartApi {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const c = createChart(el, { autoSize: false, width: 600, height: 300 });
  cleanups.push(() => {
    c.destroy();
    el.remove();
  });
  return c;
}

async function waitFor(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(check()).toBe(true);
}

describe('gap filling with a trading session', () => {
  const nyse = createTradingSession({
    hours: '0930-1600:12345',
    timeZone: 'America/New_York',
    holidays: ['2024-01-15'],
  });

  it('fills only trading hours for intraday bars', () => {
    // Friday 20:00 UTC (15:00 New York) to Monday 15:00 UTC (10:00 New York), hourly.
    const filled = fillMissingCandles(
      [bar(Date.parse('2024-01-05T20:00:00Z')), bar(Date.parse('2024-01-08T15:00:00Z'))],
      '1h',
      undefined,
      nyse,
    );
    // 21:00 UTC Friday (16:00 New York) is the close; Monday 14:00 UTC (09:00) is before the open.
    expect(filled.map((c) => iso(c.time))).toEqual([
      '2024-01-05T20:00:00.000Z',
      '2024-01-08T15:00:00.000Z',
    ]);
    // Without a session every hour of the weekend is filled.
    expect(
      fillMissingCandles(
        [bar(Date.parse('2024-01-05T20:00:00Z')), bar(Date.parse('2024-01-08T15:00:00Z'))],
        '1h',
      ),
    ).toHaveLength(68);
  });

  it('fills only trading days for daily bars (weekends and holidays stay empty)', () => {
    const filled = fillMissingCandles(
      [bar(Date.parse('2024-01-11T00:00:00Z')), bar(Date.parse('2024-01-17T00:00:00Z'))],
      '1D',
      undefined,
      nyse,
    );
    expect(filled.map((c) => iso(c.time).slice(0, 10))).toEqual([
      '2024-01-11',
      '2024-01-12',
      '2024-01-16',
      '2024-01-17',
    ]);
  });
});

describe('DatafeedController session', () => {
  it("builds the session from the symbol's hours and time zone and fills gaps with it", async () => {
    const monday = Date.parse('2024-01-08T14:30:00Z');
    const candles = [bar(monday, 1), bar(monday + 6 * HOUR, 2), bar(monday + DAY, 3)];
    // 30-minute bars: the 09:30 open is on the bar grid (hourly bars follow the UTC hour grid).
    const feed = createStaticDatafeed({
      XYZ: {
        candles,
        timeframe: '30m',
        info: { symbol: 'XYZ', session: '0930-1600:12345', timezone: 'America/New_York' },
      },
    });
    const c = chart();
    const series = c.addSeries('candlestick');
    const seen: unknown[] = [];
    const controller = new DatafeedController(c, series, {
      datafeed: feed,
      symbol: 'XYZ',
      interval: '30m',
      fillGaps: true,
      now: () => monday + DAY + HOUR,
    });
    cleanups.unshift(() => controller.destroy());
    controller.on('sessionChange', ({ session }) => seen.push(session));
    await waitFor(() => controller.status === 'ready');
    const session = controller.session!;
    expect(session.timeZone).toBe('America/New_York');
    expect(seen).toEqual([session]);
    // 14:30-20:30 UTC on Monday is filled (13 bars), the night is not, then Tuesday 14:30.
    expect(controller.data().map((x) => iso(x.time))).toEqual([
      ...Array.from({ length: 13 }, (_, i) => iso(monday + i * HALF)),
      iso(monday + DAY),
    ]);
  });

  it('treats 24x7 as continuous, accepts an explicit session and reports invalid hours', async () => {
    const t0 = Date.parse('2024-01-08T00:00:00Z');
    const feed = createStaticDatafeed({
      C: { candles: [bar(t0)], timeframe: '1h', info: { symbol: 'C', session: '24x7' } },
      BAD: { candles: [bar(t0)], timeframe: '1h', info: { symbol: 'BAD', session: 'noon' } },
    });
    const c = chart();
    const errors: unknown[] = [];
    const make = (symbol: string, session?: ReturnType<typeof createTradingSession> | null) => {
      const controller = new DatafeedController(c, c.addSeries('candlestick'), {
        datafeed: feed,
        symbol,
        interval: '1h',
        now: () => t0 + HOUR,
        ...(session !== undefined ? { session } : {}),
      });
      cleanups.unshift(() => controller.destroy());
      controller.on('error', ({ error }) => errors.push(error));
      return controller;
    };
    const continuous = make('C');
    const bad = make('BAD');
    const tokyo = createTradingSession({ hours: '0900-1500:12345', timeZone: 'Asia/Tokyo' });
    const explicit = make('BAD', tokyo);
    await waitFor(() => [continuous, bad, explicit].every((x) => x.status === 'ready'));
    expect(continuous.session).toBeNull();
    expect(bad.session).toBeNull();
    expect(errors.some((e) => /trading session/.test(String(e)))).toBe(true);
    expect(explicit.session).toBe(tokyo);
  });
});
