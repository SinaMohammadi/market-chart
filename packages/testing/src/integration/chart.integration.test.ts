// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChartError, createChart } from '@market-chart/core';
import type { ChartApi, CrosshairMoveEvent, PaneLayerDrawContext } from '@market-chart/core';
import { installCanvasMock } from '../canvas-mock.js';
import { DAY, barsToLine, generateBars } from '../synthetic.js';

let restore: () => void = () => undefined;
let container: HTMLDivElement;
const charts: ChartApi[] = [];

function make(options: Parameters<typeof createChart>[1] = {}): ChartApi {
  const chart = createChart(container, { autoSize: false, width: 600, height: 400, ...options });
  charts.push(chart);
  return chart;
}

beforeEach(() => {
  restore = installCanvasMock();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  for (const chart of charts.splice(0)) chart.destroy();
  container.remove();
  restore();
});

const bars = generateBars({ count: 300, interval: DAY, seed: 7 });

describe('chart integration', () => {
  it('mounts two canvases and emits ready after the first frame', () => {
    const chart = make();
    const ready = vi.fn();
    chart.on('ready', ready);
    chart.addSeries('candlestick').setData(bars);
    chart.render();
    expect(chart.element().querySelectorAll('canvas')).toHaveLength(2);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(chart.size()).toEqual({ width: 600, height: 400 });
  });

  it('round-trips series data and realtime updates', () => {
    const chart = make();
    const series = chart.addSeries('candlestick');
    series.setData(bars);
    expect(series.length()).toBe(300);
    expect(series.dataAt(bars[10]!.time)).toEqual(bars[10]);
    const last = bars[bars.length - 1]!;
    series.update({ ...last, close: last.close + 1, high: Math.max(last.high, last.close + 1) });
    expect(series.length()).toBe(300);
    series.update({ time: last.time + DAY, open: 1, high: 2, low: 0.5, close: 1.5 });
    expect(series.length()).toBe(301);
    expect(series.lastPoint()!.close).toBe(1.5);
  });

  it('rejects invalid input with ChartError and keeps state', () => {
    const chart = make();
    const series = chart.addSeries('line');
    series.setData([{ time: 1, value: 1 }]);
    expect(() =>
      series.setData([
        { time: 2, value: 1 },
        { time: 1, value: 1 },
      ]),
    ).toThrow(ChartError);
    expect(series.length()).toBe(1);
    expect(() => chart.addSeries('line', { pane: -1 })).toThrow(/pane/);
    expect(() => chart.applyOptions({ layout: { fontSize: -1 } })).toThrow(/fontSize/);
    expect(() => createChart(null as unknown as HTMLElement)).toThrow(/DOM element/);
  });

  it('emits visible range changes and supports logical ranges', () => {
    const chart = make();
    chart.addSeries('line').setData(barsToLine(bars));
    const onRange = vi.fn();
    chart.on('visibleRangeChange', onRange);
    chart.timeScale().setVisibleLogicalRange({ from: 100, to: 200 });
    chart.render();
    expect(onRange).toHaveBeenCalled();
    const range = chart.timeScale().getVisibleLogicalRange()!;
    expect(range.from).toBeCloseTo(100, 6);
    expect(range.to).toBeCloseTo(200, 6);
    const visible = chart.timeScale().getVisibleRange()!;
    expect(visible.from).toBe(bars[100]!.time);
  });

  it('reports crosshair data for every series at the hovered bar', () => {
    const chart = make();
    const candles = chart.addSeries('candlestick');
    const line = chart.addSeries('line', { pane: 1 });
    candles.setData(bars);
    line.setData(barsToLine(bars));
    chart.render();
    const events: CrosshairMoveEvent[] = [];
    chart.on('crosshairMove', (e) => events.push(e));
    const overlay = chart.element().querySelector('canvas[data-layer="overlay"]')!;
    const rect = overlay.getBoundingClientRect();
    overlay.dispatchEvent(
      new MouseEvent('pointermove', {
        clientX: rect.left + 200,
        clientY: rect.top + 100,
        bubbles: true,
      }),
    );
    chart.render();
    const event = events[events.length - 1]!;
    expect(event.time).not.toBeNull();
    expect(event.pane).toBe(0);
    expect(event.seriesData.get(candles)).toEqual(candles.dataAt(event.time!));
    expect(event.seriesData.get(line)).toEqual({
      time: event.time,
      value: candles.dataAt(event.time!)!.close,
    });
    chart.clearCrosshair();
    chart.render();
    expect(events[events.length - 1]!.time).toBeNull();
  });

  it('creates panes on demand and collapses empty ones', () => {
    const chart = make();
    chart.addSeries('line').setData(barsToLine(bars));
    const skipped = chart.addSeries('line', { pane: 2 });
    // There is nothing in pane 1, so the series moves up into it.
    expect(chart.panes()).toHaveLength(2);
    expect(skipped.options().pane).toBe(1);
    const middle = chart.addSeries('line', { pane: 1 });
    const bottom = chart.addSeries('line', { pane: 2 });
    expect(chart.panes()).toHaveLength(3);
    chart.removeSeries(middle);
    chart.removeSeries(skipped);
    // Pane 1 became empty and collapsed; the bottom series moved up.
    expect(chart.panes()).toHaveLength(2);
    expect(bottom.options().pane).toBe(1);
    chart.removeSeries(bottom);
    expect(chart.panes()).toHaveLength(1);
    expect(() => bottom.setData([])).toThrow(/removed/);
  });

  it('applies themes while keeping user colours', () => {
    const chart = make({ theme: 'dark' });
    const custom = chart.addSeries('line', { color: '#123456' });
    const themed = chart.addSeries('candlestick');
    const darkUp = themed.options().upColor;
    chart.setTheme('light');
    expect(custom.options().color).toBe('#123456');
    expect(themed.options().upColor).not.toBe(darkUp);
    expect(chart.theme().name).toBe('light');
  });

  it('runs plugin layers with coordinate helpers and cleans them up', () => {
    const chart = make();
    chart.addSeries('line').setData(barsToLine(bars));
    const draws: PaneLayerDrawContext[] = [];
    chart.use({
      id: 'probe',
      version: '1.0.0',
      install: (ctx) => {
        ctx.addPaneLayer({ zOrder: 'above', draw: (c) => draws.push(c) });
      },
    });
    chart.render();
    expect(draws.length).toBeGreaterThan(0);
    const c = draws[draws.length - 1]!;
    const x = c.timeToX(bars[250]!.time)!;
    expect(c.xToTime(x)).toBeCloseTo(bars[250]!.time, 0);
    const y = c.priceToY(bars[250]!.close)!;
    expect(c.yToPrice(y)).toBeCloseTo(bars[250]!.close, 6);
    chart.removePlugin('probe');
    const count = draws.length;
    chart.render();
    expect(draws.length).toBe(count);
  });

  it('keeps independent state per chart', () => {
    const a = make();
    const b = make();
    expect(a.id).not.toBe(b.id);
    a.addSeries('line').setData([{ time: 1, value: 1 }]);
    expect(b.series()).toHaveLength(0);
  });

  it('cleans up on destroy', () => {
    const chart = make();
    const root = chart.element();
    const onDestroy = vi.fn();
    chart.on('destroy', onDestroy);
    chart.destroy();
    expect(onDestroy).toHaveBeenCalledTimes(1);
    expect(root.isConnected).toBe(false);
    expect(chart.destroyed).toBe(true);
    expect(() => chart.addSeries('line')).toThrow(/destroyed/);
    chart.destroy();
  });
});
