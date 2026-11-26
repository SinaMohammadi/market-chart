// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChart } from '@market-chart/core';
import type { ChartApi } from '@market-chart/core';
import { installCanvasMock } from '@market-chart/testing';
import { DatafeedController, createStaticDatafeed, createSyntheticDatafeed } from './index.js';
import type { Candle, DatafeedStatus } from './index.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = Date.UTC(2024, 0, 1);
const NOW = Date.UTC(2024, 5, 3, 12, 30);

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

const minuteBars = (count: number, skip: readonly number[] = []): Candle[] =>
  Array.from({ length: count }, (_, i) => i)
    .filter((i) => !skip.includes(i))
    .map((i) => ({
      time: T0 + i * MIN,
      open: 100 + i,
      high: 101 + i,
      low: 99 + i,
      close: 100.5 + i,
      volume: 10 + i,
    }));

describe('DatafeedController', () => {
  it('loads history, applies the symbol format and feeds volume', async () => {
    const chart = make();
    const series = chart.addSeries('candlestick');
    const volume = chart.addSeries('histogram');
    const feed = createSyntheticDatafeed({ now: () => NOW });
    const statuses: DatafeedStatus[] = [];
    const c = track(
      new DatafeedController(chart, series, {
        datafeed: feed,
        symbol: 'SYN:EURUSD',
        interval: '1h',
        initialBars: 120,
        volumeSeries: volume,
        now: () => NOW,
      }),
    );
    c.on('status', ({ status }) => statuses.push(status));
    await waitFor(() => c.status === 'ready');
    expect(series.length()).toBeGreaterThan(70); // weekends are skipped
    expect(series.length()).toBeLessThanOrEqual(120);
    expect(volume.length()).toBe(series.length());
    expect((series.options() as { priceFormat: { precision: number } }).priceFormat.precision).toBe(
      5,
    );
    expect(c.symbolInfo?.symbol).toBe('SYN:EURUSD');
    expect(statuses).toEqual(['ready']);
  });

  it('loads older pages when scrolled to the start and stops at the history start', async () => {
    const chart = make();
    const series = chart.addSeries('candlestick');
    const feed = createSyntheticDatafeed({
      now: () => NOW,
      symbols: [{ symbol: 'X', startPrice: 50, historyStart: NOW - 500 * HOUR }],
    });
    const c = track(
      new DatafeedController(chart, series, {
        datafeed: feed,
        symbol: 'X',
        interval: '1h',
        initialBars: 100,
        chunkBars: 200,
        now: () => NOW,
      }),
    );
    await waitFor(() => c.status === 'ready');
    expect(series.length()).toBe(100);
    const last = series.data()[series.length() - 1]!;
    chart.render();
    chart.timeScale().setVisibleLogicalRange({ from: 0, to: 60 });
    chart.render(); // emits visibleRangeChange (normally on the next animation frame)
    await waitFor(() => series.length() >= 300 && c.status === 'ready');
    // Older bars are prepended; the newest data is untouched.
    expect(series.data()[series.length() - 1]).toEqual(last);
    for (let i = 0; i < 10 && series.length() < 500; i++) {
      await waitFor(() => c.status === 'ready');
      await c.loadMore();
    }
    // 500 hourly bars between historyStart and now.
    expect(series.length()).toBe(500);
    expect(await c.loadMore()).toBe(0);
    const times = series.data().map((d) => d.time);
    expect(times.every((t, i) => i === 0 || t > times[i - 1]!)).toBe(true);
  });

  it('applies realtime bars, forming-bar updates and corrections without losing early updates', async () => {
    const chart = make();
    const series = chart.addSeries('candlestick');
    const feed = createStaticDatafeed({ ABC: { candles: minuteBars(50), timeframe: '1m' } });
    let historyRequested = false;
    const slow = {
      ...feed,
      async getHistoricalData(...args: Parameters<typeof feed.getHistoricalData>) {
        historyRequested = true;
        await new Promise((r) => setTimeout(r, 30));
        return feed.getHistoricalData(...args);
      },
    };
    const c = track(
      new DatafeedController(chart, series, {
        datafeed: slow,
        symbol: 'ABC',
        interval: '1m',
        now: () => T0 + 49 * MIN,
      }),
    );
    // Pushed after subscribing but before history arrives: buffered, then applied on top of it.
    await waitFor(() => historyRequested);
    feed.push('ABC', { time: T0 + 50 * MIN, open: 1, high: 2, low: 0.5, close: 1.5 });
    expect(series.length()).toBe(0);
    await waitFor(() => c.status === 'ready');
    expect(series.length()).toBe(51);
    feed.push('ABC', { time: T0 + 50 * MIN, open: 1, high: 3, low: 0.5, close: 2.5 });
    expect(series.dataAt(T0 + 50 * MIN)).toMatchObject({ close: 2.5, high: 3 });
    feed.push('ABC', { time: T0 + 10 * MIN, open: 7, high: 8, low: 6, close: 7.5 });
    expect(series.dataAt(T0 + 10 * MIN)).toMatchObject({ close: 7.5 });
    expect(series.length()).toBe(51);
    feed.push('ABC', { time: T0 + 51 * MIN, open: 2, high: 2, low: 2, close: 2 });
    expect(series.length()).toBe(52);
    expect(c.data()).toHaveLength(52);
  });

  it('stops by itself when its chart is destroyed first (no updates to a destroyed chart)', async () => {
    const chart = make();
    const series = chart.addSeries('candlestick');
    const feed = createStaticDatafeed({ ABC: { candles: minuteBars(50), timeframe: '1m' } });
    const c = track(
      new DatafeedController(chart, series, {
        datafeed: feed,
        symbol: 'ABC',
        interval: '1m',
        now: () => T0 + 49 * MIN,
      }),
    );
    await waitFor(() => c.status === 'ready');
    // e.g. React: the chart's layout-effect cleanup runs before the datafeed's passive-effect cleanup.
    chart.destroy();
    expect(() =>
      feed.push('ABC', { time: T0 + 50 * MIN, open: 1, high: 2, low: 0.5, close: 1.5 }),
    ).not.toThrow();
    // The controller unsubscribed: further ticks are not delivered at all.
    expect(() =>
      feed.push('ABC', { time: T0 + 51 * MIN, open: 1, high: 2, low: 0.5, close: 1.5 }),
    ).not.toThrow();
    expect(await c.loadMore()).toBe(0);

    // Destroyed while history is still loading: the response is dropped.
    const chart2 = make();
    const series2 = chart2.addSeries('candlestick');
    let release: () => void = () => undefined;
    const slow = {
      ...feed,
      async getHistoricalData(...args: Parameters<typeof feed.getHistoricalData>) {
        await new Promise<void>((r) => (release = r));
        return feed.getHistoricalData(...args);
      },
    };
    const c2 = track(
      new DatafeedController(chart2, series2, {
        datafeed: slow,
        symbol: 'ABC',
        interval: '1m',
        now: () => T0 + 49 * MIN,
      }),
    );
    await waitFor(() => c2.status === 'loading');
    await new Promise((r) => setTimeout(r, 10));
    chart2.destroy();
    release();
    await new Promise((r) => setTimeout(r, 10));
    expect(c2.status).toBe('loading');
  });

  it('starts at the end of datasets that do not reach the present', async () => {
    const chart = make();
    const series = chart.addSeries('candlestick');
    const feed = createStaticDatafeed({ OLD: { candles: minuteBars(500), timeframe: '1m' } });
    const c = track(
      new DatafeedController(chart, series, {
        datafeed: feed,
        symbol: 'OLD',
        interval: '1m',
        initialBars: 100,
      }),
    );
    await waitFor(() => c.status === 'ready');
    expect(series.length()).toBe(100);
    expect(series.data()[99]!.time).toBe(T0 + 499 * MIN);
    expect(await c.loadMore()).toBe(300);
  });

  it('keeps at most maxBars in memory during realtime, unless old bars are on screen', async () => {
    const chart = make();
    const series = chart.addSeries('candlestick');
    const feed = createStaticDatafeed({ ABC: { candles: minuteBars(100), timeframe: '1m' } });
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
    for (let i = 100; i < 110; i++)
      feed.push('ABC', { time: T0 + i * MIN, open: 1, high: 1, low: 1, close: 1 });
    expect(trims).toEqual([10]);
    expect(series.length()).toBe(100);
    expect(series.data()[0]!.time).toBe(T0 + 10 * MIN);
    // Looking at the oldest bars: nothing is dropped.
    chart.timeScale().setVisibleLogicalRange({ from: 0, to: 50 });
    chart.render();
    for (let i = 110; i < 125; i++)
      feed.push('ABC', { time: T0 + i * MIN, open: 1, high: 1, low: 1, close: 1 });
    expect(trims).toEqual([10]);
    expect(series.length()).toBe(115);
  });

  it('fills missing bars when asked to', async () => {
    const chart = make();
    const series = chart.addSeries('line');
    const feed = createStaticDatafeed({
      ABC: { candles: minuteBars(20, [5, 6, 7]), timeframe: '1m' },
    });
    const c = track(
      new DatafeedController(chart, series, {
        datafeed: feed,
        symbol: 'ABC',
        interval: '1m',
        fillGaps: true,
        now: () => T0 + 19 * MIN,
      }),
    );
    await waitFor(() => c.status === 'ready');
    expect(series.length()).toBe(20);
    expect(series.dataAt(T0 + 6 * MIN)).toMatchObject({ value: 104.5 });
    feed.push('ABC', { time: T0 + 22 * MIN, open: 1, high: 1, low: 1, close: 1 });
    expect(series.length()).toBe(23);
  });

  it('switches symbol and interval, ignoring late responses', async () => {
    const chart = make();
    const series = chart.addSeries('candlestick');
    const feed = createSyntheticDatafeed({ now: () => NOW, latencyMs: 15 });
    const c = track(
      new DatafeedController(chart, series, {
        datafeed: feed,
        symbol: 'SYN:BTCUSD',
        interval: '1h',
        initialBars: 50,
        now: () => NOW,
      }),
    );
    void c.setSymbol('SYN:ETHUSD', '15m');
    await c.setSymbol('SYN:ACME', '1D');
    await waitFor(() => c.status === 'ready');
    expect(c.symbol).toBe('SYN:ACME');
    expect(c.interval).toBe('1D');
    const last = series.data()[series.length() - 1] as Candle;
    expect(last.close).toBe(feed.priceAt('SYN:ACME', NOW));
    expect(series.data().every((d) => d.time % 86_400_000 === 0)).toBe(true);
  });

  it('reports errors for unknown symbols', async () => {
    const chart = make();
    const series = chart.addSeries('candlestick');
    const feed = createSyntheticDatafeed({ now: () => NOW });
    const errors: unknown[] = [];
    const c = track(
      new DatafeedController(chart, series, { datafeed: feed, symbol: 'NOPE', interval: '1h' }),
    );
    c.on('error', ({ error }) => errors.push(error));
    await waitFor(() => c.status === 'error');
    expect(String((errors[0] as Error).message)).toMatch(/unknown symbol/);
    expect(series.length()).toBe(0);
  });
});
