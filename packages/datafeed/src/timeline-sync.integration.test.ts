// @vitest-environment jsdom
/**
 * The controller's series is rarely alone on the chart: comparison symbols, indicators with displaced
 * outputs or other series give the shared timeline timestamps the controller's candles do not have.
 * History paging and trimming must be decided from the controller's own bars, by time.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChart } from '@market-chart/core';
import type { ChartApi } from '@market-chart/core';
import { installCanvasMock } from '@market-chart/testing';
import { DatafeedController, createStaticDatafeed } from './index.js';
import type { Candle, CandleUpdate, Datafeed, SymbolInfo } from './index.js';

const MIN = 60_000;
const T0 = Date.UTC(2024, 0, 1);

let restore: () => void = () => undefined;
let container: HTMLDivElement;
const charts: ChartApi[] = [];
const controllers: DatafeedController[] = [];

function make(): ChartApi {
  const chart = createChart(container, { autoSize: false, width: 600, height: 300 });
  charts.push(chart);
  return chart;
}

async function waitFor(check: () => boolean, ms = 3000): Promise<void> {
  const start = performance.now();
  while (!check()) {
    if (performance.now() - start > ms) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 5));
  }
}

const track = (c: DatafeedController): DatafeedController => (controllers.push(c), c);

beforeEach(() => {
  restore = installCanvasMock();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  for (const c of controllers.splice(0)) c.destroy();
  for (const chart of charts.splice(0)) if (!chart.destroyed) chart.destroy();
  container.remove();
  restore();
});

const candle = (i: number): Candle => ({
  time: T0 + i * MIN,
  open: 100 + i,
  high: 101 + i,
  low: 99 + i,
  close: 100.5 + i,
  volume: 10 + i,
});
const minuteBars = (from: number, to: number): Candle[] =>
  Array.from({ length: to - from }, (_, k) => candle(from + k));

const isContiguous = (times: readonly number[]): boolean =>
  times.every((t, i) => i === 0 || t - times[i - 1]! === MIN);

describe('DatafeedController with other series on the chart', () => {
  it('loads more history when its own first bar comes into view, even if other series start earlier', async () => {
    const chart = make();
    const series = chart.addSeries('candlestick');
    // A comparison series with 500 bars more history than what the controller loads first.
    const compare = chart.addSeries('line');
    compare.setData(minuteBars(400, 1000).map((c) => ({ time: c.time, value: c.close })));
    const feed = createStaticDatafeed({ ABC: { candles: minuteBars(0, 1000), timeframe: '1m' } });
    const c = track(
      new DatafeedController(chart, series, {
        datafeed: feed,
        symbol: 'ABC',
        interval: '1m',
        initialBars: 100,
        chunkBars: 100,
        now: () => T0 + 999 * MIN,
      }),
    );
    await waitFor(() => c.status === 'ready');
    expect(series.length()).toBe(100);
    chart.render();
    const ts = chart.timeScale();
    const first = ts.timeToLogical(series.data()[0]!.time)!;
    expect(first).toBe(500); // the comparison series' history comes first on the time axis
    ts.setVisibleLogicalRange({ from: first - 5, to: first + 40 });
    chart.render(); // emits visibleRangeChange
    await waitFor(() => series.length() > 100 && c.status === 'ready');
    expect(series.length()).toBe(200);
    expect(isContiguous(series.data().map((d) => d.time))).toBe(true);
  });

  it('does not trim bars that are on screen when other series start earlier', async () => {
    const chart = make();
    const series = chart.addSeries('candlestick');
    const compare = chart.addSeries('line');
    compare.setData(minuteBars(-300, 0).map((c) => ({ time: c.time, value: c.close })));
    const feed = createStaticDatafeed({ ABC: { candles: minuteBars(0, 100), timeframe: '1m' } });
    const trims: number[] = [];
    const c = track(
      new DatafeedController(chart, series, {
        datafeed: feed,
        symbol: 'ABC',
        interval: '1m',
        maxBars: 100,
        now: () => T0 + 99 * MIN,
      }),
    );
    c.on('historyTrimmed', ({ bars }) => trims.push(bars));
    await waitFor(() => c.status === 'ready');
    chart.render();
    // Looking at the controller's oldest bars (global logical 300…340).
    const ts = chart.timeScale();
    const first = ts.timeToLogical(series.data()[0]!.time)!;
    expect(first).toBe(300);
    ts.setVisibleLogicalRange({ from: first, to: first + 40 });
    chart.render();
    for (let i = 100; i < 115; i++)
      feed.push('ABC', { time: T0 + i * MIN, open: 1, high: 1, low: 1, close: 1 });
    expect(trims).toEqual([]);
    expect(series.length()).toBe(115);
    expect(series.data()[0]!.time).toBe(T0);
  });

  it('never leaves a gap when bars are trimmed while an older page is loading', async () => {
    const all = minuteBars(0, 1000);
    const pending: (() => void)[] = [];
    let listener: ((c: CandleUpdate) => void) | null = null;
    let deferHistory = false;
    const feed: Datafeed = {
      resolveSymbol: async (symbol: string): Promise<SymbolInfo> => ({ symbol }),
      getHistoricalData: (_s, _i, range) => {
        const page = all.filter((c) => c.time >= range.from && c.time <= range.to);
        if (!deferHistory) return Promise.resolve(page);
        return new Promise<Candle[]>((resolve) => pending.push(() => resolve(page)));
      },
      subscribe: (_s, _i, cb) => {
        listener = cb;
        return () => (listener = null);
      },
    };
    const chart = make();
    const series = chart.addSeries('candlestick');
    const c = track(
      new DatafeedController(chart, series, {
        datafeed: feed,
        symbol: 'ABC',
        interval: '1m',
        initialBars: 100,
        chunkBars: 100,
        maxBars: 100,
        now: () => T0 + 999 * MIN,
      }),
    );
    await waitFor(() => c.status === 'ready');
    chart.render();
    deferHistory = true;
    const loading = c.loadMore(); // page 800…899 requested, response held back
    // Meanwhile the user looks at the newest bars and realtime bars arrive: the oldest bars are trimmed.
    chart.timeScale().scrollToRealtime();
    chart.render();
    for (let i = 1000; i < 1010; i++) listener!(candle(i));
    expect(series.data()[0]!.time).toBe(T0 + 910 * MIN);
    pending.splice(0).forEach((resolve) => resolve());
    await loading;
    await waitFor(() => c.status === 'ready');
    const times = series.data().map((d) => d.time);
    expect(isContiguous(times)).toBe(true);
    expect(times.at(-1)).toBe(T0 + 1009 * MIN);
  });
});
