// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createChart } from '@market-chart/core';
import { DatafeedController, createStaticDatafeed } from '@market-chart/datafeed';
import { MINUTE, generateBars, installCanvasMock } from '@market-chart/testing';
import { record, writeReport } from './harness.js';

let restore: () => void = () => undefined;
let container: HTMLDivElement;

beforeAll(() => {
  restore = installCanvasMock();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterAll(() => {
  container.remove();
  restore();
  console.log(`\n${writeReport('datafeed')}`);
});

async function until(check: () => boolean): Promise<void> {
  while (!check()) await new Promise((r) => setTimeout(r, 5));
}

describe('datafeed controller', () => {
  it('loads 1M bars and streams forming-bar ticks', async () => {
    const bars = generateBars({ count: 1_000_000, interval: MINUTE, startPrice: 30_000, seed: 3 });
    const last = bars[bars.length - 1]!;
    const feed = createStaticDatafeed({ BIG: { candles: bars, timeframe: '1m' } });
    const chart = createChart(container, { autoSize: false, width: 1200, height: 600 });
    const series = chart.addSeries('candlestick');
    const volume = chart.addSeries('histogram', { priceScaleId: 'volume' });
    const t0 = performance.now();
    const controller = new DatafeedController(chart, series, {
      datafeed: feed,
      symbol: 'BIG',
      interval: '1m',
      initialBars: 1_000_000,
      volumeSeries: volume,
      now: () => last.time,
    });
    await until(() => controller.status === 'ready');
    const load = record({
      group: 'Datafeed',
      name: 'normalise + load 1M candles and volume through DatafeedController',
      value: performance.now() - t0,
      unit: 'ms',
      budget: '< 5,000 ms',
    });
    const ticks = 20_000;
    let close = last.close;
    const t1 = performance.now();
    for (let i = 0; i < ticks; i++) {
      close *= 1 + Math.sin(i) * 0.0002;
      feed.push('BIG', {
        ...last,
        high: Math.max(last.high, close),
        low: Math.min(last.low, close),
        close,
      });
      if (i % 10 === 9) chart.render();
    }
    const rate = record({
      group: 'Datafeed',
      name: 'forming-bar ticks/s through datafeed → controller → series (1M bars loaded)',
      value: ticks / ((performance.now() - t1) / 1000),
      unit: 'ticks/s',
      budget: '> 5,000',
    });
    controller.destroy();
    chart.destroy();
    expect(load).toBeLessThan(5_000);
    expect(rate).toBeGreaterThan(5_000);
  });
});
