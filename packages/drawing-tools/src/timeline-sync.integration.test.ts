// @vitest-environment jsdom
/**
 * Drawings are anchored to (time, price). Inserting history — in the drawing's own series or in any other
 * series of the chart — shifts logical indices, and drawings must stay on their market timestamps.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChart } from '@market-chart/core';
import type { ChartApi, SeriesApi } from '@market-chart/core';
import { HOUR, generateBars, installCanvasMock } from '@market-chart/testing';
import { DrawingManager } from './manager.js';
import { createDefaultToolRegistry } from './registry.js';
import { linearRegression, regressionChannel } from './tools/patterns.js';
import type { Regression } from './tools/patterns.js';
import type { DrawingToolDefinition, DrawingView } from './types.js';

let restore: () => void = () => undefined;
let container: HTMLDivElement;
let chart: ChartApi;
let candles: SeriesApi<'candlestick'>;
const bars = generateBars({ count: 200, interval: HOUR, seed: 9 });
const older = generateBars({ count: 100, interval: HOUR, start: bars[0]!.time - 100 * HOUR });

beforeEach(() => {
  restore = installCanvasMock();
  container = document.createElement('div');
  document.body.appendChild(container);
  chart = createChart(container, { autoSize: false, width: 800, height: 500 });
  candles = chart.addSeries('candlestick');
  candles.setData(bars);
  chart.timeScale().setVisibleLogicalRange({ from: 100, to: 199 });
  chart.render();
});

afterEach(() => {
  if (!chart.destroyed) chart.destroy();
  container.remove();
  restore();
});

/** Records what each drawing was drawn with on the last frame. */
function recordingRegistry() {
  const frames: { derived: Regression | null; view: DrawingView; points: number[] }[] = [];
  const registry = createDefaultToolRegistry();
  const probe: DrawingToolDefinition<Regression | null> = {
    ...regressionChannel,
    type: 'probe-regression',
    draw(_ctx, d, view, _state, derived) {
      frames.push({
        derived: derived ?? null,
        view,
        points: d.points.map((p) => view.timeToX(p.time)),
      });
    },
  };
  registry.register(probe);
  return { registry, frames };
}

describe('drawing anchors and the shared timeline', () => {
  it('keeps trend line and Fibonacci anchors on their timestamps after history is prepended', () => {
    const manager = new DrawingManager(chart);
    const ts = chart.timeScale();
    const trend = manager.add({
      type: 'trend-line',
      points: [
        { time: bars[120]!.time, price: bars[120]!.close },
        { time: bars[150]!.time + HOUR / 2, price: bars[150]!.close }, // between two bars
      ],
    });
    const fib = manager.add({
      type: 'fib-retracement',
      points: [
        { time: bars[130]!.time, price: 1 },
        { time: bars[140]!.time, price: 2 },
      ],
    });
    const xBefore = trend.points.map((p) => ts.timeToCoordinate(p.time));
    candles.setData([...older, ...bars]);
    chart.render();
    // Stored anchors are unchanged; they map to the same bars (new logical indices, same screen x).
    expect(manager.get(trend.id)!.points).toEqual(trend.points);
    expect(manager.get(fib.id)!.points).toEqual(fib.points);
    expect(ts.timeToLogical(bars[120]!.time)).toBe(220);
    expect(ts.timeToLogical(bars[150]!.time + HOUR / 2)).toBeCloseTo(250.5, 9);
    expect(trend.points.map((p) => ts.timeToCoordinate(p.time))).toEqual(xBefore);
    expect(manager.serialize().drawings.find((d) => d.id === trend.id)!.points).toEqual(
      trend.points,
    );
  });

  it('recomputes data-derived drawings when another series shifts the timeline', () => {
    const { registry, frames } = recordingRegistry();
    const manager = new DrawingManager(chart, { registry });
    manager.add({
      type: 'probe-regression',
      seriesId: candles.id,
      points: [
        { time: bars[110]!.time, price: 0 },
        { time: bars[180]!.time, price: 0 },
      ],
    });
    chart.render();
    const ts = chart.timeScale();
    const expected = (): Regression =>
      linearRegression(
        bars.slice(110, 181).map((b) => ts.timeToLogical(b.time)!),
        bars.slice(110, 181).map((b) => b.close),
      )!;
    expect(frames.at(-1)!.derived!.from).toBeCloseTo(expected().from, 9);

    // A comparison series with older history: every candle's logical index moves by 100.
    const compare = chart.addSeries('line');
    compare.setData(older.map((b) => ({ time: b.time, value: b.close })));
    chart.render();
    const derived = frames.at(-1)!.derived!;
    expect(ts.timeToLogical(bars[110]!.time)).toBe(210);
    expect(derived.from).toBeCloseTo(expected().from, 9);
    expect(derived.to).toBeCloseTo(expected().to, 9);
    expect(derived.intercept).toBeCloseTo(expected().intercept, 6);

    // And when that series is removed again.
    chart.removeSeries(compare);
    chart.render();
    expect(frames.at(-1)!.derived!.from).toBeCloseTo(expected().from, 9);
  });
});
