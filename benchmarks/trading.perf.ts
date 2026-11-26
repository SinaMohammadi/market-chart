// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createChart } from '@market-chart/core';
import type { ChartApi, OhlcBar } from '@market-chart/core';
import { MINUTE, generateBars, installCanvasMock } from '@market-chart/testing';
import { createTradingOverlay } from '@market-chart/trading';
import type { TradingOrder, TradingOverlay } from '@market-chart/trading';
import { percentile, record, timeMedian, writeReport } from './harness.js';

// Simulated objects only: the overlay never talks to a broker.
let restore: () => void = () => undefined;
let container: HTMLDivElement;
let data: OhlcBar[] = [];
let mid = 0;

beforeAll(() => {
  restore = installCanvasMock();
  container = document.createElement('div');
  document.body.appendChild(container);
  data = generateBars({
    count: 100_000,
    interval: MINUTE,
    startPrice: 30_000,
    volatility: 0.002,
    seed: 9,
  });
  mid = data[data.length - 1]!.close;
});

afterAll(() => {
  container.remove();
  restore();
  console.log(`\n${writeReport('trading')}`);
});

function make(): ChartApi {
  const chart = createChart(container, { autoSize: false, width: 1200, height: 600 });
  chart.addSeries('candlestick').setData(data);
  chart.timeScale().setVisibleLogicalRange({ from: 98_000, to: 100_000 });
  chart.render();
  return chart;
}

/** 1,000 orders spread over the visible prices (every one is drawn, with a label and an axis label). */
function orders(count: number, status: TradingOrder['status'] = 'working'): TradingOrder[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `o${i}`,
    side: i % 2 ? 'sell' : 'buy',
    type: i % 3 ? 'limit' : 'stop',
    price: mid * (0.97 + (0.06 * i) / count),
    quantity: 1 + (i % 7),
    status,
  }));
}

const tick = () => new Promise<void>((r) => queueMicrotask(r));

function pan(chart: ChartApi, frames: number): number[] {
  const ts = chart.timeScale();
  const out: number[] = [];
  for (let i = 0; i < frames; i++) {
    const t0 = performance.now();
    const r = ts.getVisibleLogicalRange()!;
    const shift = i % 2 ? -25 : 50;
    ts.setVisibleLogicalRange({ from: r.from + shift, to: r.to + shift });
    chart.render();
    out.push(performance.now() - t0);
  }
  return out;
}

describe('trading overlay', () => {
  it('loads 1,000 orders (validation, items, price lines, first frame)', async () => {
    const chart = make();
    const overlay = createTradingOverlay(chart);
    const list = orders(1000);
    const samples: number[] = [];
    for (let run = 0; run < 6; run++) {
      overlay.clear();
      await tick();
      chart.render();
      const t0 = performance.now();
      overlay.setOrders(list);
      overlay.items(); // applies the batch now
      chart.render();
      samples.push(performance.now() - t0);
    }
    const ms = record({
      group: 'Trading',
      name: 'setOrders(1,000) + first frame',
      value: percentile(samples.slice(1), 50),
      unit: 'ms',
      budget: '< 50 ms',
    });
    expect(overlay.items()).toHaveLength(1000);
    overlay.destroy();
    chart.destroy();
    expect(ms).toBeLessThan(50);
  });

  it('1,000 status changes in one task are batched into one rebuild', async () => {
    const chart = make();
    const overlay = createTradingOverlay(chart);
    overlay.setOrders(orders(1000));
    await tick();
    chart.render();
    let rebuilds = 0;
    overlay.on('change', () => rebuilds++);
    const statuses: TradingOrder['status'][] = ['partial', 'pending', 'working'];
    let round = 0;
    const ms = timeMedian(() => {
      const status = statuses[round++ % statuses.length]!;
      for (const o of orders(1000, status)) overlay.upsertOrder(o);
      overlay.items();
      chart.render();
    }, 7);
    record({
      group: 'Trading',
      name: '1,000 upsertOrder status changes + frame',
      value: ms,
      unit: 'ms',
      budget: '< 50 ms',
    });
    // One rebuild per batch (8 batches: warm-up + 7 runs).
    expect(rebuilds).toBe(8);
    overlay.destroy();
    chart.destroy();
    expect(ms).toBeLessThan(50);
  });

  it('panning with 1,000 order lines stays within the frame budget', async () => {
    const baselineChart = make();
    pan(baselineChart, 20);
    const baseline = percentile(pan(baselineChart, 120), 95);
    baselineChart.destroy();

    const chart = make();
    const overlay: TradingOverlay = createTradingOverlay(chart, {
      onModify: () => true,
      onCancel: () => undefined,
    });
    overlay.setOrders(orders(1000));
    overlay.setPositions([
      {
        id: 'p',
        side: 'buy',
        entryPrice: mid,
        quantity: 3,
        takeProfit: mid * 1.01,
        stopLoss: mid * 0.99,
      },
    ]);
    await tick();
    chart.render();
    pan(chart, 20);
    const frames = pan(chart, 120);
    record({
      group: 'Trading',
      name: 'pan frame p95, no overlay (baseline)',
      value: baseline,
      unit: 'ms',
    });
    record({
      group: 'Trading',
      name: 'pan frame p50, 1,000 orders',
      value: percentile(frames, 50),
      unit: 'ms',
    });
    const p95 = record({
      group: 'Trading',
      name: 'pan frame p95, 1,000 orders',
      value: percentile(frames, 95),
      unit: 'ms',
      budget: '< 16 ms',
    });
    overlay.destroy();
    chart.destroy();
    expect(p95).toBeLessThan(16);
  });

  it('hit-testing 1,000 objects on pointer movement', async () => {
    const chart = make();
    const overlay = createTradingOverlay(chart, { onModify: () => true });
    overlay.setOrders(orders(1000));
    await tick();
    chart.render();
    const n = 2_000;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) overlay.hitTest(0, (i * 7) % 1100, (i * 13) % 580);
    const us = record({
      group: 'Trading',
      name: 'hitTest (1,000 objects), per pointer move',
      value: ((performance.now() - t0) / n) * 1000,
      unit: 'µs',
      budget: '< 500 µs',
    });
    overlay.destroy();
    chart.destroy();
    expect(us).toBeLessThan(500);
  });
});
