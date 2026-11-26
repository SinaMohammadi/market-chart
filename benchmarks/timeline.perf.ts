// @vitest-environment jsdom
/**
 * Timeline synchronisation costs: realtime appends with several series that do not share timestamps,
 * historical corrections and insertions, history pages, data-derived drawings during realtime, and the
 * memory of the timeline mappings. Results go to benchmarks/results/timeline.{md,json}.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createChart } from '@market-chart/core';
import type { ChartApi, OhlcBar } from '@market-chart/core';
import { DrawingManager } from '@market-chart/drawing-tools';
import { IndicatorManager } from '@market-chart/indicators';
import { MINUTE, generateBars, installCanvasMock } from '@market-chart/testing';
import { record, retainedBytes, timeMedian, writeReport } from './harness.js';

const N = 1_000_000;
let data: OhlcBar[] = [];
let restore: () => void = () => undefined;
let container: HTMLDivElement;

function make(): ChartApi {
  return createChart(container, { autoSize: false, width: 1200, height: 600 });
}

/** Volume with every 7th bar missing: its mapping is not the identity, so it exercises the general path. */
function sparseVolume(bars: readonly OhlcBar[]) {
  const kept = bars.filter((_, i) => i % 7 !== 3);
  return { times: kept.map((b) => b.time), fields: { value: kept.map((b) => b.volume ?? 0) } };
}

beforeAll(() => {
  restore = installCanvasMock();
  container = document.createElement('div');
  document.body.appendChild(container);
  data = generateBars({
    count: N,
    interval: MINUTE,
    startPrice: 30_000,
    volatility: 0.002,
    seed: 7,
  });
});

afterAll(() => {
  container.remove();
  restore();
  console.log(`\n${writeReport('timeline')}`);
});

function nextBar(prev: OhlcBar, i: number): OhlcBar {
  const price = prev.close * (1 + Math.sin(i) * 0.0005);
  return {
    time: prev.time + MINUTE,
    open: prev.close,
    high: Math.max(prev.close, price),
    low: Math.min(prev.close, price),
    close: price,
  };
}

describe('realtime with series on different timestamps', () => {
  it('candles + sparse volume + line ahead, 1M bars', () => {
    const chart = make();
    const candles = chart.addSeries('candlestick');
    const volume = chart.addSeries('histogram', { pane: 1 });
    candles.setData(data);
    volume.setColumns(sparseVolume(data));
    chart.render();
    const updates = 50_000;
    let last = data[data.length - 1]!;
    const t0 = performance.now();
    for (let i = 0; i < updates; i++) {
      if (i % 10 === 0) {
        last = nextBar(last, i);
        candles.update(last);
        volume.update({ time: last.time, value: i });
      } else {
        last = { ...last, close: last.close * (1 + Math.cos(i) * 1e-4) };
        candles.update(last);
      }
      if (i % 10 === 9) chart.render();
    }
    const perSecond = updates / ((performance.now() - t0) / 1000);
    record({
      group: 'Realtime',
      name: 'updates/s, 1M candles + sparse volume (10 ticks per bar, frame every 10 updates)',
      value: perSecond,
      unit: 'updates/s',
      budget: '> 10,000',
    });
    chart.destroy();
    expect(perSecond).toBeGreaterThan(10_000);
  });
});

describe('historical changes on 1M bars', () => {
  it('correction of an older bar with SMA + RSI attached', () => {
    const chart = make();
    const candles = chart.addSeries('candlestick');
    candles.setData(data);
    const manager = new IndicatorManager(chart);
    manager.add('sma', candles);
    manager.add('rsi', candles);
    chart.render();
    let k = 0;
    const ms = timeMedian(() => {
      const bar = data[N - 500 + (k++ % 100)]!;
      candles.update({ ...bar, close: bar.close + 0.01 });
    }, 5);
    record({
      group: 'Historical',
      name: 'correct an older bar (replace, 500 bars back), 1M candles + SMA + RSI',
      value: ms,
      unit: 'ms',
      budget: '< 3,000 ms',
    });
    // The common feed pattern: the previous bar gets its final values after the next bar opened.
    const recent = timeMedian(() => {
      const bar = data[N - 2]!;
      candles.update({ ...bar, close: bar.close + 0.01 * (k++ % 7) });
    }, 50);
    record({
      group: 'Historical',
      name: 'correct the previous bar (within the 16-bar rewind window), same chart',
      value: recent,
      unit: 'ms',
      budget: '< 5 ms',
    });
    expect(recent).toBeLessThan(5);
    manager.destroy();
    chart.destroy();
    expect(ms).toBeLessThan(3000);
  });

  it('insert a missing bar (new timestamp) with candles + volume', () => {
    const chart = make();
    const candles = chart.addSeries('candlestick');
    const volume = chart.addSeries('histogram', { pane: 1 });
    const holes = new Set(Array.from({ length: 20 }, (_, i) => N - 1000 - i * 10));
    const withHoles = data.filter((_, i) => !holes.has(i));
    candles.setData(withHoles);
    volume.setData(withHoles.map((b) => ({ time: b.time, value: b.volume ?? 0 })));
    chart.render();
    const queue = [...holes];
    const samples: number[] = [];
    const volumeSamples: number[] = [];
    for (const index of queue) {
      const bar = data[index]!;
      let t0 = performance.now();
      candles.update(bar);
      samples.push(performance.now() - t0);
      t0 = performance.now();
      volume.update({ time: bar.time, value: bar.volume ?? 0 }); // the time now exists in the timeline
      volumeSamples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    volumeSamples.sort((a, b) => a - b);
    record({
      group: 'Historical',
      name: 'insert a missing bar into candles (new timeline time), 1M bars, 2 series, median',
      value: samples[samples.length >> 1]!,
      unit: 'ms',
      budget: '< 100 ms',
    });
    record({
      group: 'Historical',
      name: 'then insert the same time into volume (time already in timeline), median',
      value: volumeSamples[volumeSamples.length >> 1]!,
      unit: 'ms',
      budget: '< 100 ms',
    });
    chart.destroy();
    expect(samples[samples.length >> 1]!).toBeLessThan(100);
  });

  it('prepend a 1,000-bar history page (setData) with candles + sparse volume', () => {
    const chart = make();
    const candles = chart.addSeries('candlestick');
    const volume = chart.addSeries('histogram', { pane: 1 });
    const page = 1000;
    const recent = data.slice(page);
    candles.setData(recent);
    volume.setColumns(sparseVolume(recent));
    chart.render();
    chart.timeScale().setVisibleLogicalRange({ from: 10, to: 300 });
    chart.render();
    const ms = timeMedian(() => {
      candles.setData(recent);
      candles.setData(data);
    }, 3);
    record({
      group: 'Historical',
      name: 'setData recent then setData with a prepended page, 1M bars (pair)',
      value: ms,
      unit: 'ms',
      budget: '< 1,000 ms',
    });
    chart.destroy();
    expect(ms).toBeLessThan(1000);
  });
});

describe('data-derived drawings during realtime', () => {
  it('regression channel on 1M candles, ticks with a frame every 10 updates', () => {
    const chart = make();
    const candles = chart.addSeries('candlestick');
    candles.setData(data);
    const drawings = new DrawingManager(chart);
    drawings.add({
      type: 'regression-channel',
      points: [
        { time: data[N - 400]!.time, price: 0 },
        { time: data[N - 1]!.time, price: 0 },
      ],
    });
    chart.render();
    const updates = 2_000;
    let last = data[N - 1]!;
    const t0 = performance.now();
    for (let i = 0; i < updates; i++) {
      last = { ...last, close: last.close * (1 + Math.cos(i) * 1e-4) };
      candles.update(last);
      if (i % 10 === 9) chart.render();
    }
    const perSecond = updates / ((performance.now() - t0) / 1000);
    record({
      group: 'Drawings',
      name: 'updates/s, 1M candles + regression channel (frame every 10 updates)',
      value: perSecond,
      unit: 'updates/s',
    });
    drawings.destroy();
    chart.destroy();
  });
});

describe('memory', () => {
  it('timeline + mappings for 1M candles + sparse volume', () => {
    const before = retainedBytes();
    const chart = make();
    const candles = chart.addSeries('candlestick');
    const volume = chart.addSeries('histogram', { pane: 1 });
    candles.setData(data);
    volume.setColumns(sparseVolume(data));
    chart.render();
    const after = retainedBytes();
    record({
      group: 'Memory',
      name: 'engine memory per bar, 1M candles + sparse volume (after GC)',
      value: (after - before) / N,
      unit: 'bytes',
      budget: '< 200 bytes',
    });
    chart.destroy();
    expect((after - before) / N).toBeLessThan(200);
  });
});
