// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChart } from '@market-chart/core';
import type { ChartApi } from '@market-chart/core';
import {
  generateBars,
  generateOrderBooks,
  generateTrades,
  installCanvasMock,
} from '@market-chart/testing';
import { aggregateFootprint } from './orderflow.js';
import { addMarketProfile, addVolumeProfile } from './profile-layers.js';
import {
  addFootprintSeries,
  addHeatmapSeries,
  addHollowCandleSeries,
  addKagiSeries,
  addPointFigureSeries,
  addVolumeCandleSeries,
} from './renderers.js';
import type { Trade } from './types.js';

const MINUTE = 60_000;
let restore: () => void = () => undefined;
let container: HTMLDivElement;
let chart: ChartApi;
const bars = generateBars({
  count: 600,
  interval: 5 * MINUTE,
  startPrice: 100,
  volatility: 0.004,
  seed: 6,
  baseVolume: 200,
});
const errors: unknown[] = [];

beforeEach(() => {
  restore = installCanvasMock();
  container = document.createElement('div');
  document.body.appendChild(container);
  chart = createChart(container, { autoSize: false, width: 800, height: 500 });
  errors.length = 0;
  chart.on('error', (e) => errors.push(e.error));
});

afterEach(() => {
  if (!chart.destroyed) chart.destroy();
  container.remove();
  restore();
});

describe('custom chart types on a real chart', () => {
  it('renders hollow and volume candles', () => {
    addHollowCandleSeries(chart).setData(bars);
    addVolumeCandleSeries(chart, { pane: 1 }).setData(bars);
    chart.render();
    expect(chart.series()).toHaveLength(2);
    expect(errors).toEqual([]);
  });

  it('renders Kagi and Point & Figure from bars', () => {
    const k = addKagiSeries(chart, { reversal: 0.01, mode: 'percent' });
    k.setData(bars);
    const pf = addPointFigureSeries(chart, { boxSize: { atr: 14 }, reversal: 3 }, { pane: 1 });
    pf.setData(bars);
    chart.timeScale().fitContent();
    chart.render();
    expect(k.series.length()).toBeGreaterThan(3);
    expect(pf.series.length()).toBeGreaterThan(3);
    expect(errors).toEqual([]);
  });

  it('renders footprints in detailed and compact mode, and a heatmap', () => {
    const trades = generateTrades(bars.slice(-60), {
      interval: 5 * MINUTE,
      tradesPerBar: 40,
      tickSize: 0.01,
    }) as Trade[];
    const fp = addFootprintSeries(chart, { tickSize: 0.05 });
    fp.setData(aggregateFootprint(trades, { interval: 5 * MINUTE, tickSize: 0.05 }));
    chart.render();
    chart.timeScale().setVisibleLogicalRange({ from: 50, to: 59 }); // wide bars → bid × ask text
    chart.render();
    const books = generateOrderBooks(
      bars.slice(-100).map((b) => ({ time: b.time, price: b.close })),
      { tickSize: 0.05, levels: 30 },
    );
    const heat = addHeatmapSeries(chart, { priceStep: 0.05 }, { pane: 1 });
    heat.setData(books);
    chart.render();
    expect(heat.series.length()).toBe(100);
    expect(errors).toEqual([]);
  });

  it('draws visible, fixed and session volume profiles and a market profile', () => {
    const candles = chart.addSeries('candlestick');
    candles.setData(bars);
    chart.timeScale().setVisibleLogicalRange({ from: 300, to: 599 });
    const visible = addVolumeProfile(chart, candles, { mode: 'visible', rows: 40 });
    const fixed = addVolumeProfile(chart, candles, {
      mode: 'fixed',
      from: bars[350]!.time,
      to: bars[450]!.time,
      rows: 20,
    });
    const session = addVolumeProfile(chart, candles, { mode: 'session', rows: 20 });
    const tpo = addMarketProfile(chart, candles, { periodMinutes: 30 });
    chart.render();
    expect(visible.profiles()).toHaveLength(1);
    expect(fixed.profiles()[0]!.from).toBe(bars[350]!.time);
    expect(session.profiles().length).toBeGreaterThanOrEqual(1);
    expect(tpo.profiles().length).toBeGreaterThanOrEqual(1);
    visible.update({ placement: 'left' });
    visible.remove();
    tpo.remove();
    expect(chart.hasPlugin('market-chart/volume-profile/1')).toBe(false);
    expect(() => addVolumeProfile(chart, candles, { mode: 'fixed' })).toThrow(/from and to/);
    expect(errors).toEqual([]);
  });
});
