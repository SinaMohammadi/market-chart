// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createChart } from '@market-chart/core';
import type { ChartApi, OhlcBar, SeriesApi } from '@market-chart/core';
import { IndicatorManager } from '@market-chart/indicators';
import { MINUTE, generateBars, installCanvasMock } from '@market-chart/testing';
import { percentile, record, retainedBytes, timeMedian, writeReport } from './harness.js';

const SIZES = [100_000, 500_000, 1_000_000] as const;
const datasets = new Map<number, OhlcBar[]>();
let restore: () => void = () => undefined;
let container: HTMLDivElement;

function make(): ChartApi {
  return createChart(container, { autoSize: false, width: 1200, height: 600 });
}

function bars(count: number): OhlcBar[] {
  let data = datasets.get(count);
  if (!data) {
    data = generateBars({
      count,
      interval: MINUTE,
      startPrice: 30_000,
      volatility: 0.002,
      seed: 7,
    });
    datasets.set(count, data);
  }
  return data;
}

const volumeOf = (data: readonly OhlcBar[]) =>
  data.map((b) => ({ time: b.time, value: b.volume ?? 0 }));

beforeAll(() => {
  restore = installCanvasMock();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterAll(() => {
  container.remove();
  restore();
  console.log(`\n${writeReport('core')}`);
});

describe('loading data', () => {
  for (const n of SIZES) {
    it(`setData ${n.toLocaleString()} candles`, () => {
      const data = bars(n);
      const chart = make();
      const series = chart.addSeries('candlestick');
      const ms = record({
        group: 'Load',
        name: `setData, ${n.toLocaleString()} candles`,
        value: timeMedian(() => series.setData(data), 3),
        unit: 'ms',
        budget: `< ${n / 250} ms`,
      });
      const frames: number[] = [];
      for (let i = 0; i < 3; i++) {
        series.setData(data);
        const t0 = performance.now();
        chart.render();
        frames.push(performance.now() - t0);
      }
      const first = record({
        group: 'Load',
        name: `first frame after setData, ${n.toLocaleString()} candles`,
        value: percentile(frames, 50),
        unit: 'ms',
        budget: '< 200 ms',
      });
      chart.destroy();
      expect(ms).toBeLessThan(n / 250); // 1M candles in < 4 s even on slow CI machines
      expect(first).toBeLessThan(200);
    });
  }

  it('retained memory per candle', () => {
    const n = 1_000_000;
    const data = bars(n);
    const chart = make();
    const before = retainedBytes();
    chart.addSeries('candlestick').setData(data);
    chart.render();
    const perBar = record({
      group: 'Memory',
      name: 'engine memory per candle (1M candles, after GC)',
      value: (retainedBytes() - before) / n,
      unit: 'bytes',
      budget: '< 120 bytes',
    });
    const manager = new IndicatorManager(chart);
    for (const type of ['sma', 'ema', 'bollinger', 'rsi']) manager.add(type, chart.series()[0]!);
    chart.render();
    const withIndicators = record({
      group: 'Memory',
      name: 'same with SMA, EMA, Bollinger, RSI attached (6 output series), per candle',
      value: (retainedBytes() - before) / n,
      unit: 'bytes',
      budget: '< 400 bytes',
    });
    manager.destroy();
    chart.destroy();
    expect(perBar).toBeLessThan(120);
    expect(withIndicators).toBeLessThan(400);
  });
});

describe('rendering', () => {
  it('frame time at different zoom levels (1M candles)', () => {
    const chart = make();
    const series = chart.addSeries('candlestick');
    series.setData(bars(1_000_000));
    chart.render();
    const ts = chart.timeScale();
    const views = [
      ['200 bars visible', 200],
      ['2,000 bars visible', 2_000],
      ['fully zoomed out', 1_000_000],
    ] as const;
    for (const [label, count] of views) {
      const last = series.length() - 1;
      ts.setVisibleLogicalRange({ from: last - count, to: last });
      chart.render();
      const ms = record({
        group: 'Render',
        name: `full frame, ${label}`,
        value: timeMedian(() => {
          // A tiny scroll invalidates the whole frame (scales, series, axes, labels).
          const r = ts.getVisibleLogicalRange()!;
          ts.setVisibleLogicalRange({ from: r.from + 0.001, to: r.to + 0.001 });
          chart.render();
        }, 9),
        unit: 'ms',
        budget: '< 16 ms',
      });
      expect(ms).toBeLessThan(16);
    }
    chart.destroy();
  });

  it('panning (1M candles, 2,000 visible, 120 frames)', () => {
    const chart = make();
    const series = chart.addSeries('candlestick');
    series.setData(bars(1_000_000));
    chart.addSeries('histogram', { priceScaleId: 'volume' }).setData(volumeOf(bars(1_000_000)));
    const ts = chart.timeScale();
    ts.setVisibleLogicalRange({ from: 500_000, to: 502_000 });
    chart.render();
    const frames: number[] = [];
    for (let i = 0; i < 120; i++) {
      const t0 = performance.now();
      const r = ts.getVisibleLogicalRange()!;
      const shift = i % 2 ? -25 : 50;
      ts.setVisibleLogicalRange({ from: r.from + shift, to: r.to + shift });
      chart.render();
      frames.push(performance.now() - t0);
    }
    record({
      group: 'Render',
      name: 'pan frame p50 (candles + volume)',
      value: percentile(frames, 50),
      unit: 'ms',
    });
    const p95 = record({
      group: 'Render',
      name: 'pan frame p95 (candles + volume)',
      value: percentile(frames, 95),
      unit: 'ms',
      budget: '< 16 ms',
    });
    chart.destroy();
    expect(p95).toBeLessThan(16);
  });
});

describe('several series and indicators', () => {
  it('candles + volume + 4 indicators on 1M bars', () => {
    const data = bars(1_000_000);
    const chart = make();
    const candles = chart.addSeries('candlestick');
    const volume = chart.addSeries('histogram', { priceScaleId: 'volume' });
    candles.setData(data);
    volume.setData(volumeOf(data));
    const manager = new IndicatorManager(chart);
    let t0 = performance.now();
    manager.add('sma', candles, { params: { length: 50 } });
    manager.add('ema', candles, { params: { length: 20 } });
    manager.add('bollinger', candles);
    manager.add('rsi', candles);
    const add = record({
      group: 'Indicators',
      name: 'add SMA, EMA, Bollinger, RSI to 1M candles',
      value: performance.now() - t0,
      unit: 'ms',
      budget: '< 4,000 ms',
    });
    chart.render();
    const shifted = data.map((b) => ({ ...b, time: b.time + MINUTE }));
    const volumes = [volumeOf(data), volumeOf(shifted)];
    const samples: number[] = [];
    for (let i = 0; i < 4; i++) {
      const next = i % 2 ? data : shifted;
      t0 = performance.now();
      candles.setData(next);
      volume.setData(volumes[(i + 1) % 2]!);
      chart.render();
      samples.push(performance.now() - t0);
    }
    record({
      group: 'Indicators',
      name: 'first replace of 1M candles + volume with 4 indicators attached (includes JIT warm-up and a major GC)',
      value: samples[0]!,
      unit: 'ms',
    });
    const reload = record({
      group: 'Indicators',
      name: 'replace 1M candles + volume with 4 indicators attached, steady state (median)',
      value: percentile(samples.slice(1), 50),
      unit: 'ms',
      budget: '< 3,000 ms',
    });
    manager.destroy();
    chart.destroy();
    expect(add).toBeLessThan(4_000);
    expect(reload).toBeLessThan(3_000);
  });
});

describe('realtime', () => {
  function stream(
    chart: ChartApi,
    candles: SeriesApi<'candlestick'>,
    updates: number,
    ticksPerBar: number,
  ): number {
    let last = candles.lastPoint() as OhlcBar;
    const t0 = performance.now();
    for (let i = 0; i < updates; i++) {
      const newBar = i % ticksPerBar === 0;
      const price = last.close * (1 + Math.sin(i) * 0.0005);
      last = newBar
        ? {
            time: last.time + MINUTE,
            open: last.close,
            high: Math.max(last.close, price),
            low: Math.min(last.close, price),
            close: price,
          }
        : {
            ...last,
            high: Math.max(last.high, price),
            low: Math.min(last.low, price),
            close: price,
          };
      candles.update(last);
      if (i % 10 === 9) chart.render(); // a frame every 10 updates, as with ~600 updates/s at 60 fps
    }
    return performance.now() - t0;
  }

  it('sustained updates on 1M candles, plain and with 4 indicators', () => {
    const chart = make();
    const candles = chart.addSeries('candlestick');
    candles.setData(bars(1_000_000));
    chart.render();
    const updates = 50_000;
    const plain = record({
      group: 'Realtime',
      name: 'updates/s, 1M candles (10 ticks per bar, frame every 10 updates)',
      value: updates / (stream(chart, candles, updates, 10) / 1000),
      unit: 'updates/s',
      budget: '> 10,000',
    });
    const manager = new IndicatorManager(chart);
    for (const type of ['sma', 'ema', 'bollinger', 'rsi']) manager.add(type, candles);
    chart.render();
    const withIndicators = record({
      group: 'Realtime',
      name: 'updates/s, same with SMA, EMA, Bollinger, RSI (incremental)',
      value: updates / (stream(chart, candles, updates, 10) / 1000),
      unit: 'updates/s',
      budget: '> 3,000',
    });
    manager.destroy();
    chart.destroy();
    expect(plain).toBeGreaterThan(10_000);
    expect(withIndicators).toBeGreaterThan(3_000);
  });

  it('memory stays flat while updating the forming bar', () => {
    const chart = make();
    const candles = chart.addSeries('candlestick');
    candles.setData(bars(100_000));
    chart.render();
    stream(chart, candles, 20_000, 1_000_000); // warm up: one forming bar, no new bars
    const before = retainedBytes();
    stream(chart, candles, 200_000, 1_000_000);
    const growth = record({
      group: 'Memory',
      name: 'heap growth after 200,000 forming-bar updates',
      value: (retainedBytes() - before) / 1024,
      unit: 'KB',
      budget: '< 512 KB',
    });
    chart.destroy();
    expect(growth).toBeLessThan(512);
  });
});

describe('lifecycle', () => {
  it('creating and destroying charts does not leak', () => {
    const data = bars(100_000).slice(0, 20_000);
    const cycle = () => {
      const chart = make();
      const candles = chart.addSeries('candlestick');
      candles.setData(data);
      const manager = new IndicatorManager(chart);
      manager.add('rsi', candles);
      chart.on('crosshairMove', () => undefined);
      chart.render();
      manager.destroy();
      chart.destroy();
    };
    for (let i = 0; i < 20; i++) cycle(); // warm up caches and JIT
    const before = retainedBytes();
    for (let i = 0; i < 200; i++) cycle();
    const growth = record({
      group: 'Memory',
      name: 'heap growth after 200 create/destroy cycles (20K candles + RSI each)',
      value: (retainedBytes() - before) / 1024,
      unit: 'KB',
      budget: '< 2,048 KB',
    });
    expect(container.childElementCount).toBe(0);
    expect(growth).toBeLessThan(2_048);
  });
});
