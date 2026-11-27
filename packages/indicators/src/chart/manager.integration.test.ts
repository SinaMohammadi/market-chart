// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createChart, createTradingSession } from '@market-chart/core';
import type { ChartApi, OhlcBar, SeriesApi } from '@market-chart/core';
import { HOUR, generateBars, installCanvasMock } from '@market-chart/testing';
import { IndicatorManager, getIndicatorManager } from './indicator-manager.js';
import { computeIndicator } from '../runner.js';
import { rsi } from '../definitions/momentum.js';
import type { Bar, IndicatorDefinition } from '../types.js';

let restore: () => void = () => undefined;
let container: HTMLDivElement;
let chart: ChartApi;
let candles: SeriesApi<'candlestick'>;
const bars = generateBars({ count: 300, interval: HOUR, seed: 5 });
const toBars = (data: readonly OhlcBar[]): Bar[] =>
  data.map((b) => ({ ...b, volume: b.volume ?? Number.NaN }));

beforeEach(() => {
  restore = installCanvasMock();
  container = document.createElement('div');
  document.body.appendChild(container);
  chart = createChart(container, { autoSize: false, width: 700, height: 500 });
  candles = chart.addSeries('candlestick');
  candles.setData(bars);
});

afterEach(() => {
  if (!chart.destroyed) chart.destroy();
  container.remove();
  restore();
});

function lastValue(series: SeriesApi): number | undefined {
  const point = series.lastPoint() as { value?: number } | undefined;
  return point?.value;
}

describe('IndicatorManager', () => {
  it('adds a pane indicator with its own pane and level lines', () => {
    const manager = new IndicatorManager(chart);
    const handle = manager.add('rsi', candles, { params: { length: 14 } });
    expect(chart.panes()).toHaveLength(2);
    const rsiSeries = handle.series().get('rsi')!;
    expect(rsiSeries.options().pane).toBe(1);
    expect(rsiSeries.priceLines().map((l) => l.options().price)).toEqual([70, 50, 30]);
    const expected = computeIndicator(rsi as unknown as IndicatorDefinition, toBars(bars), {
      length: 14,
    });
    expect(lastValue(rsiSeries)).toBeCloseTo(expected.values[0]![bars.length - 1]!, 9);
    expect(handle.label()).toBe('RSI 14 close');
    chart.render();
  });

  it('overlays on the source pane and installs a fill layer', () => {
    const manager = new IndicatorManager(chart);
    const bb = manager.add('bollinger', candles);
    expect(chart.panes()).toHaveLength(1);
    expect([...bb.series().values()].every((s) => s.options().pane === 0)).toBe(true);
    expect(chart.hasPlugin(`market-chart/indicator-fills/${bb.id}`)).toBe(true);
    chart.render();
    bb.remove();
    expect(chart.hasPlugin(`market-chart/indicator-fills/${bb.id}`)).toBe(false);
    expect(chart.series()).toHaveLength(1);
  });

  it('updates incrementally on ticks and new bars, matching a full recomputation', () => {
    const manager = new IndicatorManager(chart);
    const handle = manager.add('macd', candles);
    const macdSeries = handle.series().get('macd')!;
    const setData = vi.spyOn(macdSeries, 'setData');
    const last = bars[bars.length - 1]!;
    candles.update({
      ...last,
      close: last.close * 1.01,
      high: Math.max(last.high, last.close * 1.01),
    });
    const next: OhlcBar = {
      time: last.time + HOUR,
      open: last.close,
      high: last.close * 1.02,
      low: last.close * 0.99,
      close: last.close * 1.015,
      volume: 10,
    };
    candles.update(next);
    expect(setData).toHaveBeenCalledTimes(0);
    const expected = computeIndicator(handle.definition, toBars(candles.data()));
    const index = handle.definition.outputs.findIndex((o) => o.id === 'macd');
    expect(lastValue(macdSeries)).toBeCloseTo(expected.values[index]![candles.length() - 1]!, 9);
    expect(handle.result().length).toBe(candles.length());
  });

  it('recomputes when params change and validates them', () => {
    const manager = new IndicatorManager(chart);
    const handle = manager.add('sma', candles, { params: { length: 10 } });
    handle.setParams({ length: 50 });
    const series = handle.series().get('ma')!;
    const firstValue = series
      .data()
      .findIndex((p) => typeof (p as { value?: number }).value === 'number');
    expect(firstValue).toBe(49);
    expect(() => handle.setParams({ length: -1 })).toThrow(/>= 1/);
    expect(() => manager.add('nope', candles)).toThrow(/unknown indicator/);
  });

  it('collapses the pane when a middle pane indicator is removed', () => {
    const manager = new IndicatorManager(chart);
    const a = manager.add('rsi', candles);
    const b = manager.add('macd', candles);
    expect(chart.panes()).toHaveLength(3);
    a.remove();
    expect(chart.panes()).toHaveLength(2);
    expect(b.series().get('macd')!.options().pane).toBe(1);
    chart.render();
  });

  it('plots Ichimoku leading spans into the future', () => {
    const manager = new IndicatorManager(chart);
    const ichimoku = manager.add('ichimoku', candles);
    const spanA = ichimoku.series().get('spanA')!;
    const lastBarTime = bars[bars.length - 1]!.time;
    expect(spanA.lastPoint()!.time).toBe(lastBarTime + 25 * HOUR);
    const lagging = ichimoku.series().get('lagging')!;
    expect(lagging.lastPoint()!.time).toBe(bars[bars.length - 26]!.time);
    candles.update({ ...bars[bars.length - 1]!, time: lastBarTime + HOUR });
    expect(spanA.lastPoint()!.time).toBe(lastBarTime + 26 * HOUR);
  });

  it('serialises and restores, skipping invalid configs', () => {
    const manager = new IndicatorManager(chart);
    manager.add('ema', candles, {
      params: { length: 34 },
      style: { outputs: { ma: { color: '#ff0000' } } },
    });
    manager.add('rsi', candles, { visible: false });
    const saved = JSON.parse(JSON.stringify(manager.serialize()));
    manager.clear();
    expect(chart.series()).toHaveLength(1);
    const errors = vi.fn();
    manager.on('error', errors);
    const restored = manager.restore(
      [
        ...saved,
        {
          id: 'bad',
          type: 'rsi',
          params: { length: 'x' },
          style: {},
          visible: true,
          sourceSeriesId: candles.id,
        },
      ],
      (id) => chart.series().find((s) => s.id === id),
    );
    expect(restored).toHaveLength(2);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(restored[0]!.params()).toEqual({ length: 34, source: 'close' });
    expect(restored[0]!.series().get('ma')!.options()).toMatchObject({ color: '#ff0000' });
    expect(restored[1]!.visible()).toBe(false);
  });

  it('recomputes session-based indicators when the session changes', () => {
    const manager = new IndicatorManager(chart);
    const vwapHandle = manager.add('vwap', candles);
    const rsiHandle = manager.add('rsi', candles);
    const before = Array.from(vwapHandle.result().values[0]!.slice(0, bars.length));
    const rsiBefore = Array.from(rsiHandle.result().values[0]!.slice(0, bars.length));
    const changed = vi.fn();
    manager.on('changed', changed);
    const session = createTradingSession({ hours: '24x7', timeZone: 'Asia/Tokyo' });
    manager.setSession(session);
    expect(manager.session()).toBe(session);
    expect(changed).toHaveBeenCalledTimes(2);
    // VWAP now restarts at Tokyo midnight; RSI has no periods and is unchanged.
    expect(Array.from(vwapHandle.result().values[0]!.slice(0, bars.length))).not.toEqual(before);
    expect(Array.from(rsiHandle.result().values[0]!.slice(0, bars.length))).toEqual(rsiBefore);
    // Indicators added later use it too, and null goes back to UTC days.
    const later = manager.add('vwap', candles);
    expect(Array.from(later.result().values[0]!.slice(0, bars.length))).toEqual(
      Array.from(vwapHandle.result().values[0]!.slice(0, bars.length)),
    );
    manager.setSession(null);
    expect(Array.from(vwapHandle.result().values[0]!.slice(0, bars.length))).toEqual(before);
    // Realtime updates keep working with the session (calculator snapshots are deep copies).
    manager.setSession(session);
    const last = bars[bars.length - 1]!;
    candles.update({ ...last, close: last.close + 1 });
    expect(Number.isFinite(vwapHandle.result().values[0]![bars.length - 1]!)).toBe(true);
  });

  it('saves and restores the pane an indicator was moved to', () => {
    const manager = new IndicatorManager(chart);
    const ema = manager.add('ema', candles, { id: 'ema' });
    const rsiHandle = manager.add('rsi', candles, { id: 'rsi' });
    const macd = manager.add('macd', candles, { id: 'macd' });
    // EMA moved into RSI's pane, MACD into a pane of its own below, then RSI's pane joined by MACD.
    ema.moveToPane(1);
    macd.moveToPane(rsiHandle.pane());
    expect([ema.pane(), rsiHandle.pane(), macd.pane()]).toEqual([1, 1, 1]);
    const saved = JSON.parse(JSON.stringify(manager.serialize())) as ReturnType<
      IndicatorManager['serialize']
    >;
    expect(saved.map((c) => c.pane)).toEqual([1, undefined, 1]);
    manager.clear();
    expect(chart.panes()).toHaveLength(1);
    const errors = vi.fn();
    manager.on('error', errors);
    const restored = manager.restore(saved, (id) => chart.series().find((s) => s.id === id));
    expect(restored.map((h) => h.pane())).toEqual([1, 1, 1]);
    expect(chart.panes()).toHaveLength(2);
    expect(errors).not.toHaveBeenCalled();
    // Still saved after the restore.
    expect(manager.serialize().map((c) => c.pane)).toEqual([1, undefined, 1]);
    // An index past the last pane opens a new pane; an invalid one is reported and ignored.
    manager.clear();
    const again = manager.restore(
      [
        { ...saved[0]!, pane: 5 },
        { ...saved[2]!, pane: -1 as number },
      ],
      (id) => chart.series().find((s) => s.id === id),
    );
    // MACD takes pane 1 when added; EMA's index 5 does not exist, so it gets a new pane after it.
    expect(again[0]!.pane()).toBe(2);
    expect(again[1]!.pane()).toBe(1);
    expect(errors).toHaveBeenCalledOnce();
  });

  it('caps how many indicators a stored list restores and rejects hostile styles (security)', () => {
    const manager = new IndicatorManager(chart);
    const errors = vi.fn();
    manager.on('error', errors);
    const config = (i: number) => ({
      id: `sma${i}`,
      type: 'sma',
      params: {},
      style: {},
      visible: true,
      sourceSeriesId: candles.id,
    });
    const restored = manager.restore(
      Array.from({ length: 12 }, (_, i) => config(i)),
      (id) => chart.series().find((s) => s.id === id),
      { max: 5 },
    );
    expect(restored).toHaveLength(5);
    expect(errors).toHaveBeenCalledTimes(1);
    errors.mockClear();
    const hostile = manager.restore(
      [
        { ...config(90), style: { outputs: { ma: { color: 'x'.repeat(10_000) } } } },
        { ...config(91), style: { outputs: { ma: { color: { toString: () => 'red' } } } } },
        { ...config(92), style: { outputs: { ma: null } } },
      ] as never,
      (id) => chart.series().find((s) => s.id === id),
    );
    expect(hostile).toHaveLength(0);
    expect(errors).toHaveBeenCalledTimes(3);
  });

  it('follows the source: removal and destroy clean up', () => {
    const manager = getIndicatorManager(chart);
    expect(getIndicatorManager(chart)).toBe(manager);
    const handle = manager.add('atr', candles);
    chart.removeSeries(candles);
    expect(handle.removed).toBe(true);
    expect(chart.series()).toHaveLength(0);
    chart.destroy();
    expect(() => manager.add('atr', candles)).toThrow(/destroyed/);
  });

  it('chains an indicator on another indicator output', () => {
    const manager = new IndicatorManager(chart);
    const base = manager.add('rsi', candles);
    const smoothed = manager.add('sma', base.series().get('rsi')!, { params: { length: 5 } });
    expect(smoothed.series().get('ma')!.options().pane).toBe(
      base.series().get('rsi')!.options().pane,
    );
    const last = bars[bars.length - 1]!;
    candles.update({ ...last, time: last.time + HOUR });
    expect(smoothed.result().length).toBe(
      base.result().length -
        base.result().values[0]!.slice(0, base.result().length).filter(Number.isNaN).length,
    );
  });
});
