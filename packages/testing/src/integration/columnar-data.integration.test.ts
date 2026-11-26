// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChart } from '@market-chart/core';
import type { ChartApi } from '@market-chart/core';
import { installCanvasMock } from '../canvas-mock.js';
import { HOUR, generateBars } from '../synthetic.js';

let restore: () => void = () => undefined;
let container: HTMLDivElement;
let chart: ChartApi;

beforeEach(() => {
  restore = installCanvasMock();
  container = document.createElement('div');
  document.body.appendChild(container);
  chart = createChart(container, { autoSize: false, width: 600, height: 300 });
});

afterEach(() => {
  if (!chart.destroyed) chart.destroy();
  container.remove();
  restore();
});

const bars = generateBars({ count: 500, interval: HOUR, seed: 4 });

describe('columnar data API', () => {
  it('columns() returns independent copies of the stored data', () => {
    const series = chart.addSeries('candlestick');
    series.setData(bars);
    const columns = series.columns();
    expect(columns.length).toBe(500);
    expect(columns.times[10]).toBe(bars[10]!.time);
    expect(columns.fields['close']![10]).toBe(bars[10]!.close);
    columns.fields['close']![10] = -1;
    expect(series.dataAt(bars[10]!.time)).toMatchObject({ close: bars[10]!.close });
  });

  it('setColumns() matches setData() and emits dataChanged', () => {
    const a = chart.addSeries('candlestick');
    const b = chart.addSeries('candlestick');
    a.setData(bars);
    const kinds: string[] = [];
    chart.on('dataChanged', (e) => e.series === b && kinds.push(e.kind));
    b.setColumns(a.columns());
    expect(b.data()).toEqual(a.data());
    expect(kinds).toEqual(['set']);
    chart.render();
    expect(chart.timeScale().getVisibleLogicalRange()).not.toBeNull();
  });

  it('setColumns() supports whitespace and per-point colours on value series', () => {
    const histogram = chart.addSeries('histogram');
    histogram.setColumns({
      times: [1, 2, 3],
      fields: { value: [1, Number.NaN, -1] },
      colors: ['green', undefined, 'red'],
    });
    expect(histogram.data()).toEqual([
      { time: 1, value: 1, color: 'green' },
      { time: 2 },
      { time: 3, value: -1, color: 'red' },
    ]);
    expect(() => histogram.setColumns({ times: [1], fields: {} } as never)).not.toThrow(); // value is optional
    expect(() => histogram.setColumns(null as never)).toThrow(/setColumns expects/);
  });

  it('series sharing the time axis stay aligned through updates', () => {
    const candles = chart.addSeries('candlestick');
    const line = chart.addSeries('line');
    candles.setData(bars);
    line.setColumns({
      times: candles.columns().times,
      fields: { value: candles.columns().fields['close']! },
    });
    const next = { ...bars[499]!, time: bars[499]!.time + HOUR };
    candles.update(next);
    line.update({ time: next.time, value: next.close });
    chart.render();
    const last = chart.timeScale().timeToCoordinate(next.time);
    expect(last).not.toBeNull();
    expect(line.length()).toBe(501);
    expect(chart.timeScale().timeToLogical(next.time)).toBe(500);
  });
});
