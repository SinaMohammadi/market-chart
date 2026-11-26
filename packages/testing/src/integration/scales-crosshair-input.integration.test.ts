// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createChart } from '@market-chart/core';
import type { ChartApi, CrosshairMoveEvent } from '@market-chart/core';
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

function overlay(chart: ChartApi): HTMLElement {
  return chart.element().querySelector('canvas[data-layer="overlay"]')!;
}

/** Dispatches a pointer event at chart-relative CSS coordinates (MouseEvent where PointerEvent is missing). */
function pointerAt(chart: ChartApi, type: string, x: number, y: number): void {
  const el = overlay(chart);
  const rect = el.getBoundingClientRect();
  const init = {
    clientX: rect.left + x,
    clientY: rect.top + y,
    bubbles: true,
    button: 0,
    pointerId: 7,
    pointerType: 'mouse',
  };
  const Ctor = (globalThis as { PointerEvent?: typeof MouseEvent }).PointerEvent ?? MouseEvent;
  el.dispatchEvent(new Ctor(type, init));
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

const bars = generateBars({ count: 200, interval: DAY, seed: 11 });

describe('price scales', () => {
  it('shows the left axis only while a series uses it', () => {
    const chart = make();
    chart.addSeries('candlestick').setData(bars);
    chart.render();
    expect(chart.priceScale('left').width()).toBe(0);
    expect(chart.priceScale('right').width()).toBeGreaterThan(0);
    const line = chart.addSeries('line', { priceScaleId: 'left' });
    line.setData(barsToLine(bars).map((p) => ({ ...p, value: p.value * 1000 })));
    chart.render();
    const left = chart.priceScale('left').width();
    expect(left).toBeGreaterThan(0);
    expect(chart.timeScale().width()).toBe(600 - left - chart.priceScale('right').width());
    chart.removeSeries(line);
    chart.render();
    expect(chart.priceScale('left').width()).toBe(0);
  });

  it('maps series on the left scale independently of the right scale', () => {
    const chart = make();
    const right = chart.addSeries('line');
    const left = chart.addSeries('line', { priceScaleId: 'left' });
    right.setData([
      { time: 1, value: 1 },
      { time: 2, value: 2 },
    ]);
    left.setData([
      { time: 1, value: 1000 },
      { time: 2, value: 2000 },
    ]);
    chart.render();
    expect(right.priceToCoordinate(2)!).toBeCloseTo(left.priceToCoordinate(2000)!, 6);
  });

  it('uses a custom series formatter and can reset it', () => {
    const chart = make();
    const series = chart.addSeries('line');
    series.setData(barsToLine(bars));
    const formatter = vi.fn((price: number) => `$${price.toFixed(1)}`);
    series.setPriceFormatter(formatter);
    chart.render();
    expect(formatter).toHaveBeenCalled();
    const calls = formatter.mock.calls.length;
    series.setPriceFormatter(null);
    chart.render();
    expect(formatter.mock.calls.length).toBe(calls);
    expect(() => series.setPriceFormatter('nope' as unknown as null)).toThrow(/function or null/);
  });
});

describe('crosshair API', () => {
  it('positions the crosshair by time and price and reports source api', () => {
    const chart = make();
    const series = chart.addSeries('candlestick');
    series.setData(bars);
    chart.render();
    const events: CrosshairMoveEvent[] = [];
    chart.on('crosshairMove', (e) => events.push(e));
    const target = bars[150]!;
    chart.setCrosshairPosition(target.time + 1000, target.close);
    chart.render();
    const event = events[events.length - 1]!;
    expect(event.source).toBe('api');
    expect(event.time).toBe(target.time);
    expect(event.seriesData.get(series)).toEqual(series.dataAt(target.time));
    expect(event.price!).toBeCloseTo(target.close, 6);
    chart.setCrosshairPosition(target.time);
    chart.render();
    expect(events[events.length - 1]!.price).toBeNull();
    expect(() => chart.setCrosshairPosition(Number.NaN)).toThrow(/finite/);
  });

  it('reports pointer-driven moves with source pointer', () => {
    const chart = make();
    chart.addSeries('line').setData(barsToLine(bars));
    chart.render();
    const events: CrosshairMoveEvent[] = [];
    chart.on('crosshairMove', (e) => events.push(e));
    pointerAt(chart, 'pointermove', 200, 100);
    chart.render();
    expect(events[events.length - 1]!.source).toBe('pointer');
  });
});

describe('input', () => {
  it('resizes panes by dragging the separator', () => {
    const chart = make();
    chart.addSeries('line').setData(barsToLine(bars));
    chart.addSeries('line', { pane: 1 }).setData(barsToLine(bars));
    chart.render();
    const [top, bottom] = chart.panes();
    const before = [top!.height(), bottom!.height()];
    const onResize = vi.fn();
    chart.on('paneResize', onResize);
    const y = before[0]! + 0.5;
    pointerAt(chart, 'pointerdown', 200, y);
    pointerAt(chart, 'pointermove', 200, y - 60);
    pointerAt(chart, 'pointerup', 200, y - 60);
    chart.render();
    expect(top!.height()).toBe(before[0]! - 60);
    expect(bottom!.height()).toBe(before[1]! + 60);
    expect(onResize).toHaveBeenCalled();
  });

  it('is focusable and navigates with the keyboard', () => {
    const chart = make();
    chart.addSeries('line').setData(barsToLine(bars));
    chart.render();
    const el = overlay(chart);
    expect(el.getAttribute('tabindex')).toBe('0');
    expect(el.getAttribute('aria-label')).toBe('Financial chart');
    const before = chart.timeScale().getVisibleLogicalRange()!;
    el.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    const after = chart.timeScale().getVisibleLogicalRange()!;
    expect(after.to).toBeCloseTo(before.to - 10, 6);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(chart.timeScale().getVisibleLogicalRange()!.from).toBeCloseTo(-0.5, 6);
    chart.applyOptions({ interaction: { keyboard: false }, ariaLabel: 'BTC chart' });
    expect(el.hasAttribute('tabindex')).toBe(false);
    expect(el.getAttribute('aria-label')).toBe('BTC chart');
  });
});
