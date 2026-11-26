// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChart, createChartSync } from '@market-chart/core';
import type { ChartApi, CrosshairMoveEvent, CustomSeriesPaintContext } from '@market-chart/core';
import { installCanvasMock } from '../canvas-mock.js';
import { HOUR, generateBars } from '../synthetic.js';

let restore: () => void = () => undefined;
let container: HTMLDivElement;
const charts: ChartApi[] = [];

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

const bars = generateBars({ count: 300, interval: HOUR, seed: 2 });

describe('custom series', () => {
  it('paints through the view and auto-scales from the OHLC envelope', () => {
    const chart = make();
    const calls: { from: number; to: number; barSpacing: number }[] = [];
    const series = chart.addCustomSeries(
      {
        kind: 'ohlc',
        paint(c: CustomSeriesPaintContext) {
          calls.push({ from: c.from, to: c.to, barSpacing: c.barSpacing });
          for (let i = c.from; i <= c.to; i++) {
            expect(Number.isFinite(c.x(i))).toBe(true);
            expect(Number.isFinite(c.y(c.data.close(i)))).toBe(true);
          }
        },
      },
      { params: { mode: 'test' } },
    );
    series.setData(bars);
    chart.render();
    expect(calls.length).toBeGreaterThan(0);
    expect(series.options().params).toEqual({ mode: 'test' });
    expect(series.priceToCoordinate(bars[bars.length - 1]!.close)).not.toBeNull();
    expect(() => chart.addSeries('custom')).toThrow(/addCustomSeries/);
    expect(() => chart.addCustomSeries({ kind: 'nope' } as never)).toThrow(/kind/);
  });

  it('supports value-kind views with whitespace', () => {
    const chart = make();
    const series = chart.addCustomSeries({ kind: 'value', paint: () => undefined });
    series.setData([{ time: 1, value: 1 }, { time: 2 }, { time: 3, value: 3 }]);
    chart.render();
    expect(series.dataAt(2)).toEqual({ time: 2 });
  });
});

describe('createChartSync', () => {
  it('aligns visible time ranges between charts with different data', () => {
    const a = make();
    const b = make();
    a.addSeries('candlestick').setData(bars);
    // b has every other bar only, so logical indices differ but times align.
    b.addSeries('line').setData(
      bars.filter((_, i) => i % 2 === 0).map((x) => ({ time: x.time, value: x.close })),
    );
    a.render();
    b.render();
    const sync = createChartSync();
    sync.add(a);
    sync.add(b);
    a.timeScale().setVisibleLogicalRange({ from: 100, to: 200 });
    for (let i = 0; i < 4; i++) {
      a.render();
      b.render();
    }
    const ra = a.timeScale().getVisibleRange()!;
    const rb = b.timeScale().getVisibleRange()!;
    expect(Math.abs(ra.from - rb.from)).toBeLessThanOrEqual(2 * HOUR);
    expect(Math.abs(ra.to - rb.to)).toBeLessThanOrEqual(2 * HOUR);
    sync.destroy();
  });

  it('mirrors pointer crosshairs without loops', () => {
    const a = make();
    const b = make();
    a.addSeries('candlestick').setData(bars);
    b.addSeries('candlestick').setData(bars);
    a.render();
    b.render();
    const sync = createChartSync({ timeRange: false });
    sync.add(a);
    sync.add(b);
    const events: CrosshairMoveEvent[] = [];
    b.on('crosshairMove', (e) => events.push(e));
    const overlay = a.element().querySelector('canvas[data-layer="overlay"]')!;
    const rect = overlay.getBoundingClientRect();
    overlay.dispatchEvent(
      new MouseEvent('pointermove', {
        clientX: rect.left + 300,
        clientY: rect.top + 100,
        bubbles: true,
      }),
    );
    a.render();
    b.render();
    const last = events[events.length - 1]!;
    expect(last.source).toBe('api');
    expect(last.time).not.toBeNull();
    sync.remove(b);
    expect(sync.charts()).toHaveLength(1);
  });
});
