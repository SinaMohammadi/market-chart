// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChart, createTradingSession } from '@market-chart/core';
import type { ChartApi } from '@market-chart/core';
import { installCanvasMock } from '../canvas-mock.js';

const DAY = 86_400_000;

/** Weekday daily bars from Monday 2024-01-01 (no weekends), `count` trading days. */
function weekdays(count: number): number[] {
  const out: number[] = [];
  for (let t = Date.UTC(2024, 0, 1); out.length < count; t += DAY) {
    const weekday = new Date(t).getUTCDay();
    if (weekday !== 0 && weekday !== 6) out.push(t);
  }
  return out;
}

describe('calendar axis on a chart', () => {
  let restore: () => void = () => undefined;
  let chart: ChartApi;
  let container: HTMLDivElement;
  beforeEach(() => {
    restore = installCanvasMock();
    container = document.createElement('div');
    document.body.appendChild(container);
    chart = createChart(container, { autoSize: false, width: 800, height: 300 });
  });
  afterEach(() => {
    chart.destroy();
    container.remove();
    restore();
  });

  it('spaces bars by time when on, and keeps the view on the same dates when toggled', () => {
    const times = weekdays(40);
    const series = chart.addSeries('line');
    series.setData(times.map((time, i) => ({ time, value: 100 + i })));
    chart.render();
    const ts = chart.timeScale();
    const gap = (a: number, b: number) =>
      ts.timeToCoordinate(times[b]!)! - ts.timeToCoordinate(times[a]!)!;
    // Index axis: Friday → Monday is one bar, like Monday → Tuesday.
    expect(gap(4, 5)).toBeCloseTo(gap(5, 6), 6);
    const visibleBefore = ts.getVisibleRange()!;
    ts.applyOptions({ calendar: true });
    chart.render();
    expect(ts.calendarStep()).toBe(DAY);
    // Calendar axis: the weekend takes two more slots.
    expect(gap(4, 5)).toBeCloseTo(3 * gap(5, 6), 6);
    // The latest bar stays at the same place on the right.
    expect(ts.getVisibleRange()!.to).toBe(visibleBefore.to);
    // Realtime: a bar after the weekend extends the axis by the weekend too.
    const next = times[times.length - 1]! + 3 * DAY;
    series.update({ time: next, value: 1 });
    expect(ts.timeToLogical(next)! - ts.timeToLogical(times[times.length - 1]!)!).toBe(3);
    expect(() => ts.applyOptions({ calendarStep: -1 })).toThrow(/calendarStep/);
    expect(() => ts.applyOptions({ calendarMaxGapBars: 1.5 })).toThrow(/calendarMaxGapBars/);
  });

  it('accepts a trading session for breaks and shading, and rejects other values', () => {
    const session = createTradingSession({
      hours: '0930-1600:12345',
      timeZone: 'America/New_York',
    });
    chart.timeScale().setSession(session);
    expect(chart.timeScale().session()).toBe(session);
    expect(() => chart.timeScale().setSession({} as never)).toThrow(/TradingSession/);
    chart.timeScale().setSession(null);
    expect(chart.timeScale().session()).toBeNull();
  });
});
