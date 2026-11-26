// @vitest-environment jsdom
/**
 * A saved view is a time range. Restoring it must resolve logical positions against the data present when
 * it is applied — never re-apply logical indices computed against an earlier version of the timeline.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChart } from '@market-chart/core';
import type { ChartApi } from '@market-chart/core';
import { HOUR, generateBars, installCanvasMock } from '@market-chart/testing';
import { ChartPersistence, createMemoryStorage } from './index.js';

let restore: () => void = () => undefined;
let container: HTMLDivElement;
const charts: ChartApi[] = [];
const bars = generateBars({ count: 200, interval: HOUR, seed: 6 });
const older = generateBars({ count: 50, interval: HOUR, start: bars[0]!.time - 50 * HOUR });

function make(): ChartApi {
  const chart = createChart(container, { autoSize: false, width: 600, height: 300 });
  charts.push(chart);
  return chart;
}

beforeEach(() => {
  restore = installCanvasMock();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  for (const chart of charts.splice(0)) if (!chart.destroyed) chart.destroy();
  container.remove();
  restore();
});

describe('view restoration and the timeline', () => {
  it('keeps the restored time range when history is inserted before the first frame', async () => {
    const storage = createMemoryStorage();
    const a = make();
    a.addSeries('candlestick').setData(bars);
    a.render();
    a.timeScale().setVisibleRange({ from: bars[50]!.time, to: bars[120]!.time });
    a.render();
    const pa = new ChartPersistence({
      chart: a,
      storage,
      id: 'v',
      crossTab: false,
      autoSave: false,
    });
    await pa.save();
    const savedRange = a.timeScale().getVisibleRange();

    const b = make();
    const candles = b.addSeries('candlestick');
    const pb = new ChartPersistence({
      chart: b,
      storage,
      id: 'v',
      crossTab: false,
      autoSave: false,
    });
    expect(await pb.load()).toBe(true);
    candles.setData(bars);
    await Promise.resolve(); // the stored range is applied a microtask after data arrives
    // Older history arrives (e.g. a history page) before the next frame: logical indices shift by 50.
    candles.setData([...older, ...bars]);
    b.render();
    b.render();
    expect(b.timeScale().getVisibleRange()).toEqual(savedRange);
    expect(b.timeScale().timeToLogical(bars[50]!.time)).toBe(100);
    pa.destroy();
    pb.destroy();
  });
});
