import { describe, expect, it } from 'vitest';
import { ColumnStore, VALUE_FIELDS } from '../model/column-store.js';
import { Timeline } from '../model/timeline.js';
import { niceStep } from './nice-number.js';
import { PriceScale, defaultPriceScaleOptions } from './price-scale.js';
import type { PriceScaleOptions } from './price-scale.js';
import { TimeScale, defaultTimeScaleOptions } from './time-scale.js';
import type { TimeScaleOptions } from './time-scale.js';

function timelineOf(count: number): { timeline: Timeline; store: ColumnStore<'value'> } {
  const store = new ColumnStore(VALUE_FIELDS);
  store.replace(Array.from({ length: count }, (_, i) => ({ time: i * 1000, value: i })));
  const timeline = new Timeline();
  timeline.rebuild([store]);
  return { timeline, store };
}

function timeScale(count: number, options: Partial<TimeScaleOptions> = {}, width = 1000) {
  const { timeline, store } = timelineOf(count);
  let changes = 0;
  const scale = new TimeScale(
    timeline,
    { ...defaultTimeScaleOptions, ...options },
    () => changes++,
  );
  scale.setWidth(width);
  return { scale, timeline, store, changes: () => changes };
}

describe('TimeScale', () => {
  it('places the last bar rightOffset bars from the right edge', () => {
    const { scale } = timeScale(100, { barSpacing: 10, rightOffset: 5 });
    expect(scale.indexToX(99)).toBe(1000 - 5.5 * 10);
  });

  it('indexToX and xToLogical are inverse', () => {
    const { scale } = timeScale(100, { barSpacing: 7 });
    for (const i of [0, 12.5, 50, 99])
      expect(scale.xToLogical(scale.indexToX(i))).toBeCloseTo(i, 9);
  });

  it('zoom keeps the logical index under the anchor fixed', () => {
    const { scale } = timeScale(500, { barSpacing: 8 });
    const anchorX = 400;
    const before = scale.xToLogical(anchorX);
    scale.zoom(anchorX, 1.5);
    expect(scale.barSpacing).toBeCloseTo(12, 9);
    expect(scale.xToLogical(anchorX)).toBeCloseTo(before, 9);
  });

  it('clamps bar spacing', () => {
    const { scale } = timeScale(100, { minBarSpacing: 2, maxBarSpacing: 20 });
    scale.setBarSpacing(1000);
    expect(scale.barSpacing).toBe(20);
    scale.setBarSpacing(0.1);
    expect(scale.barSpacing).toBe(2);
  });

  it('fitContent shows all bars plus the right offset', () => {
    const { scale } = timeScale(95, { rightOffset: 5 });
    scale.fitContent();
    expect(scale.barSpacing).toBeCloseTo(10, 9);
    const range = scale.visibleLogicalRange();
    expect(range.from).toBeCloseTo(-0.5, 9);
  });

  it('defers fitContent until the width is known', () => {
    const { timeline } = timelineOf(50);
    const scale = new TimeScale(timeline, defaultTimeScaleOptions, () => undefined);
    scale.fitContent();
    expect(scale.hasPendingView).toBe(true);
    scale.setWidth(550);
    expect(scale.applyPendingView()).toBe(true);
    expect(scale.barSpacing).toBeCloseTo(10, 9);
    expect(scale.applyPendingView()).toBe(false);
  });

  it('setVisibleLogicalRange round-trips', () => {
    const { scale } = timeScale(1000);
    scale.setVisibleLogicalRange({ from: 100, to: 300 });
    const range = scale.visibleLogicalRange();
    expect(range.from).toBeCloseTo(100, 9);
    expect(range.to).toBeCloseTo(300, 9);
    expect(scale.visibleIndexRange()).toEqual({ from: 100, to: 300 });
  });

  it('prevents scrolling the data out of view', () => {
    const { scale } = timeScale(100, { barSpacing: 10 });
    scale.scrollBy(1e9);
    expect(scale.visibleLogicalRange().to).toBeGreaterThanOrEqual(1);
    scale.scrollBy(-1e9);
    expect(scale.visibleLogicalRange().from).toBeLessThanOrEqual(99);
  });

  it('fixRightEdge keeps the last bar at the edge', () => {
    const { scale } = timeScale(100, { fixRightEdge: true, rightOffset: 0 });
    scale.scrollBy(-500);
    expect(scale.rightOffset).toBeLessThanOrEqual(0);
  });

  it('follows new bars when the last bar is visible', () => {
    const { scale, timeline, store } = timeScale(100, { rightOffset: 3 });
    const prevLast = timeline.lastIndex;
    store.upsert({ time: 100_000, value: 1 });
    timeline.appendFrom(store);
    scale.handleTimelineChange(prevLast);
    expect(scale.rightOffset).toBe(3);
  });

  it('keeps history in place when the last bar is not visible', () => {
    const { scale, timeline, store } = timeScale(1000, { barSpacing: 10 });
    scale.scrollBy(2000);
    const before = scale.visibleLogicalRange();
    const prevLast = timeline.lastIndex;
    store.upsert({ time: 1_000_000, value: 1 });
    timeline.appendFrom(store);
    scale.handleTimelineChange(prevLast);
    const after = scale.visibleLogicalRange();
    expect(after.from).toBeCloseTo(before.from, 9);
    expect(after.to).toBeCloseTo(before.to, 9);
  });

  it('notifies on changes', () => {
    const { scale, changes } = timeScale(100);
    const start = changes();
    scale.scrollBy(10);
    scale.zoom(100, 2);
    expect(changes()).toBe(start + 2);
  });
});

function priceScale(options: Partial<PriceScaleOptions> = {}, height = 100): PriceScale {
  const scale = new PriceScale('right', {
    ...defaultPriceScaleOptions,
    scaleMargins: { top: 0, bottom: 0 },
    ...options,
  });
  scale.setHeight(height);
  return scale;
}

describe('PriceScale', () => {
  it('maps prices linearly in normal mode', () => {
    const scale = priceScale();
    scale.setAutoscaleRange(0, 100);
    expect(scale.priceToCoordinate(100)).toBe(0);
    expect(scale.priceToCoordinate(0)).toBe(100);
    expect(scale.priceToCoordinate(25)).toBe(75);
    expect(scale.coordinateToPrice(75)).toBeCloseTo(25, 9);
  });

  it('applies margins', () => {
    const scale = priceScale({ scaleMargins: { top: 0.1, bottom: 0.2 } });
    scale.setAutoscaleRange(0, 100);
    expect(scale.priceToCoordinate(100)).toBeCloseTo(10, 9);
    expect(scale.priceToCoordinate(0)).toBeCloseTo(80, 9);
  });

  it('inverts', () => {
    const scale = priceScale({ invertScale: true });
    scale.setAutoscaleRange(0, 100);
    expect(scale.priceToCoordinate(100)).toBe(100);
    expect(scale.coordinateToPrice(100)).toBeCloseTo(100, 9);
  });

  it('expands a flat range', () => {
    const scale = priceScale();
    scale.setAutoscaleRange(50, 50);
    expect(scale.priceToCoordinate(50)).toBeCloseTo(50, 9);
  });

  it('logarithmic mode spaces decades evenly', () => {
    const scale = priceScale({ mode: 'logarithmic' });
    scale.setAutoscaleRange(1, 100);
    expect(scale.priceToCoordinate(10)).toBeCloseTo(50, 9);
    expect(scale.coordinateToPrice(50)).toBeCloseTo(10, 9);
  });

  it('percentage mode is relative to the base value', () => {
    const scale = priceScale({ mode: 'percentage' });
    scale.setBase(200);
    expect(scale.transform(220)).toBeCloseTo(10, 9);
    expect(scale.untransform(-50)).toBeCloseTo(100, 9);
    expect(Number.isNaN(priceScale({ mode: 'percentage' }).transform(1))).toBe(true);
  });

  it('indexed mode maps the base to 100', () => {
    const scale = priceScale({ mode: 'indexed' });
    scale.setBase(50);
    expect(scale.transform(50)).toBe(100);
    expect(scale.transform(75)).toBe(150);
  });

  it('autoscale is ignored once manual scaling is active', () => {
    const scale = priceScale({ autoScale: false });
    scale.setAutoscaleRange(0, 100);
    scale.setAutoscaleRange(0, 1000);
    expect(scale.priceToCoordinate(100)).toBe(0);
  });

  it('scaleBy and shiftBy', () => {
    const scale = priceScale();
    scale.setAutoscaleRange(0, 100);
    scale.scaleBy(2);
    expect(scale.coordinateToPrice(0)).toBeCloseTo(150, 9);
    expect(scale.coordinateToPrice(100)).toBeCloseTo(-50, 9);
    scale.shiftBy(10);
    expect(scale.coordinateToPrice(0)).toBeCloseTo(170, 9);
  });

  it('produces nice, ordered ticks', () => {
    const scale = priceScale({}, 400);
    scale.setAutoscaleRange(100, 200);
    const ticks = scale.ticks(40);
    expect(ticks.length).toBeGreaterThan(3);
    const step = ticks[1]!.value - ticks[0]!.value;
    expect(
      [1, 2, 2.5, 5].some((n) => Math.abs(step / 10 ** Math.floor(Math.log10(step)) - n) < 1e-9),
    ).toBe(true);
    for (let i = 1; i < ticks.length; i++) expect(ticks[i]!.y).toBeLessThan(ticks[i - 1]!.y);
  });

  it('respects a minimum tick step', () => {
    const scale = priceScale({}, 1000);
    scale.setAutoscaleRange(1, 1.0001);
    const ticks = scale.ticks(30, 0.01);
    expect(ticks.length).toBeLessThanOrEqual(2);
  });
});

describe('niceStep', () => {
  it('rounds up to 1/2/2.5/5 × 10^n', () => {
    expect(niceStep(0.7)).toBe(1);
    expect(niceStep(1.3)).toBe(2);
    expect(niceStep(2.2)).toBe(2.5);
    expect(niceStep(3)).toBe(5);
    expect(niceStep(7)).toBe(10);
    expect(niceStep(0.03)).toBeCloseTo(0.05, 12);
  });
});
