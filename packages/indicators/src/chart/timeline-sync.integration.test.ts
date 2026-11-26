// @vitest-environment jsdom
/**
 * Indicator outputs are associated with the timestamps of the bars they were computed from, and stay
 * correct after realtime ticks, new bars, historical corrections, insertions and whitespace.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createChart } from '@market-chart/core';
import type { ChartApi, OhlcBar, SeriesApi } from '@market-chart/core';
import { MINUTE, generateBars, installCanvasMock } from '@market-chart/testing';
import { IndicatorManager } from './indicator-manager.js';
import type { IndicatorHandle } from './indicator-manager.js';
import { computeIndicator } from '../runner.js';
import type { Bar } from '../types.js';

let restore: () => void = () => undefined;
let container: HTMLDivElement;
let chart: ChartApi;
const bars = generateBars({ count: 120, interval: MINUTE, seed: 11 });

beforeEach(() => {
  restore = installCanvasMock();
  container = document.createElement('div');
  document.body.appendChild(container);
  chart = createChart(container, { autoSize: false, width: 700, height: 500 });
});

afterEach(() => {
  if (!chart.destroyed) chart.destroy();
  container.remove();
  restore();
});

const toBars = (data: readonly OhlcBar[]): Bar[] =>
  data.map((b) => ({ ...b, volume: b.volume ?? Number.NaN }));

/** Plotted (time → value) of one output, NaN where the output series has whitespace. */
function plotted(series: SeriesApi): Map<number, number> {
  const out = new Map<number, number>();
  for (const p of series.data() as { time: number; value?: number }[])
    out.set(p.time, p.value ?? Number.NaN);
  return out;
}

/** Every output equals a from-scratch computation over the source's current bars, at the same times. */
function expectMatchesFullRecompute(handle: IndicatorHandle, sourceBars: readonly Bar[]): void {
  const expected = computeIndicator(handle.definition, sourceBars, handle.params());
  handle.definition.outputs.forEach((output, o) => {
    const series = handle.series().get(output.id)!;
    const actual = plotted(series);
    expect(actual.size).toBe(expected.length);
    for (let i = 0; i < expected.length; i++) {
      const time = expected.times[i]!;
      const want = expected.values[o]![i]!;
      const got = actual.get(time);
      expect(got, `${output.id} at ${new Date(time).toISOString()}`).toBeDefined();
      if (Number.isNaN(want)) expect(Number.isNaN(got!)).toBe(true);
      else expect(got!).toBeCloseTo(want, 9);
    }
  });
}

describe('indicator synchronisation', () => {
  it('plots RSI, MACD, SMA and Bollinger at the timestamps of their source bars, with warm-up gaps', () => {
    const candles = chart.addSeries('candlestick');
    // A source with missing minutes: indicator outputs must follow the source times, not a dense grid.
    const gappy = bars.filter((_, i) => i % 5 !== 2);
    candles.setData(gappy);
    const other = chart.addSeries('line');
    other.setData(bars.map((b) => ({ time: b.time, value: b.close }))); // fills the gaps on the time axis
    const manager = new IndicatorManager(chart);
    for (const type of ['rsi', 'macd', 'sma', 'bollinger']) {
      const handle = manager.add(type, candles);
      expectMatchesFullRecompute(handle, toBars(gappy));
      const first = handle.series().values().next().value!;
      // No output point at a time the source does not have.
      for (const time of plotted(first).keys()) expect(candles.dataAt(time)).toBeDefined();
    }
    const rsi = manager.list()[0]!;
    // Warm-up: RSI 14 has no value on the first 14 source bars.
    expect(rsi.valuesAt(gappy[5]!.time)['rsi']).toBeNull();
    expect(rsi.valuesAt(gappy[30]!.time)['rsi']).not.toBeNull();
    // A time that only the other series has: no indicator value (never the neighbour's).
    expect(rsi.valuesAt(bars[32]!.time)['rsi']).toBeNull();
    chart.render();
  });

  it('recomputes after a historical correction of an older bar', () => {
    const candles = chart.addSeries('candlestick');
    candles.setData(bars);
    const manager = new IndicatorManager(chart);
    const sma = manager.add('sma', candles, { params: { length: 5 } });
    const rsi = manager.add('rsi', candles, { params: { length: 14 } });
    const corrected = { ...bars[100]!, close: bars[100]!.close * 1.2, high: bars[100]!.high * 1.2 };
    candles.update(corrected); // replaces bar 100 of 120: not the forming bar
    const now = toBars(candles.data() as OhlcBar[]);
    expect(now[100]!.close).toBe(corrected.close);
    expectMatchesFullRecompute(sma, now);
    expectMatchesFullRecompute(rsi, now);
  });

  it('re-runs only the tail for a correction of a recent bar (no full recomputation)', () => {
    const candles = chart.addSeries('candlestick');
    candles.setData(bars);
    const manager = new IndicatorManager(chart);
    const macd = manager.add('macd', candles);
    const bb = manager.add('bollinger', candles);
    const setData = [...macd.series().values(), ...bb.series().values()].map((s) =>
      vi.spyOn(s, 'setColumns'),
    );
    // The previous bar gets its final values after the forming bar started (a common feed pattern).
    const prev = bars[bars.length - 2]!;
    candles.update({ ...prev, close: prev.close - 2, low: Math.min(prev.low, prev.close - 2) });
    const older = bars[bars.length - 10]!;
    candles.update({
      ...older,
      close: older.close + 3,
      high: Math.max(older.high, older.close + 3),
    });
    for (const spy of setData) expect(spy).not.toHaveBeenCalled();
    const now = toBars(candles.data() as OhlcBar[]);
    expectMatchesFullRecompute(macd, now);
    expectMatchesFullRecompute(bb, now);
    // Realtime continues exactly after a rewrite.
    const last = bars[bars.length - 1]!;
    candles.update({ ...last, close: last.close + 1, high: Math.max(last.high, last.close + 1) });
    candles.update({ ...last, time: last.time + MINUTE });
    expectMatchesFullRecompute(macd, toBars(candles.data() as OhlcBar[]));
  });

  it('recomputes after a historical insertion and keeps realtime increments exact', () => {
    const candles = chart.addSeries('candlestick');
    candles.setData(bars.filter((_, i) => i !== 60));
    const manager = new IndicatorManager(chart);
    const ema = manager.add('ema', candles, { params: { length: 9 } });
    candles.update(bars[60]!); // late-arriving bar in the middle
    expectMatchesFullRecompute(ema, toBars(bars));
    // Then realtime: a tick on the last bar and a new bar.
    const last = bars[bars.length - 1]!;
    candles.update({ ...last, close: last.close + 1, high: Math.max(last.high, last.close + 1) });
    candles.update({ ...last, time: last.time + MINUTE });
    expectMatchesFullRecompute(ema, toBars(candles.data() as OhlcBar[]));
  });

  it('drops the value of a bar that became whitespace and follows whitespace appends', () => {
    const line = chart.addSeries('line');
    line.setData(bars.map((b) => ({ time: b.time, value: b.close })));
    const manager = new IndicatorManager(chart);
    const sma = manager.add('sma', line, { params: { length: 3 } });
    const lastTime = bars[bars.length - 1]!.time;
    const series = sma.series().get('ma')!;
    expect(plotted(series).get(lastTime)).not.toBeNaN();
    line.update({ time: lastTime }); // the last value is withdrawn
    const valueBars = (): Bar[] =>
      (line.data() as { time: number; value?: number }[])
        .filter((p) => p.value !== undefined)
        .map((p) => ({
          time: p.time,
          open: p.value!,
          high: p.value!,
          low: p.value!,
          close: p.value!,
          volume: Number.NaN,
        }));
    expect(plotted(series).has(lastTime)).toBe(false);
    expectMatchesFullRecompute(sma, valueBars());
    // Whitespace appended, then filled with a value, then a new value bar.
    line.update({ time: lastTime + MINUTE });
    line.update({ time: lastTime + MINUTE, value: 123 });
    line.update({ time: lastTime + 2 * MINUTE, value: 124 });
    expectMatchesFullRecompute(sma, valueBars());
  });

  it('reports displaced values plotted into the future at their plotted time', () => {
    const candles = chart.addSeries('candlestick');
    candles.setData(bars);
    const manager = new IndicatorManager(chart);
    const ichimoku = manager.add('ichimoku', candles);
    const spanA = ichimoku.series().get('spanA')!;
    const future = spanA.lastPoint()!.time;
    expect(future).toBeGreaterThan(bars[bars.length - 1]!.time);
    const value = (spanA.lastPoint() as { value?: number }).value!;
    expect(ichimoku.valuesAt(future)['spanA']).toBeCloseTo(value, 9);
  });
});
