import { describe, expect, it } from 'vitest';
import { ColumnStore, VALUE_FIELDS } from '../model/column-store.js';
import { Timeline } from '../model/timeline.js';
import { contrastText, parseColor } from '../render/color.js';
import { computeLayout, resizePanes } from './layout.js';
import { layoutLabels } from '../render/label-layout.js';
import { logicalToTime, timeToLogical } from './time-conversion.js';

describe('computeLayout', () => {
  it('splits panes by stretch factor and reserves axes', () => {
    const layout = computeLayout({ width: 800, height: 600 }, [3, 1], 0, 60, 28, 1);
    expect(layout.paneWidth).toBe(740);
    expect(layout.timeAxis).toEqual({ x: 0, y: 572, width: 740, height: 28 });
    const [a, b] = layout.panes;
    expect(a!.height + b!.height + 1).toBe(572);
    expect(a!.height).toBe(Math.round(571 * 0.75));
    expect(b!.y).toBe(a!.height + 1);
  });

  it('never produces negative sizes', () => {
    const layout = computeLayout({ width: 20, height: 10 }, [1], 60, 60, 28, 1);
    expect(layout.paneWidth).toBe(0);
    expect(layout.leftAxisWidth + layout.rightAxisWidth).toBeLessThanOrEqual(20);
    expect(layout.panes[0]!.height).toBe(0);
  });

  it('offsets panes and the time axis by the left axis', () => {
    const layout = computeLayout({ width: 800, height: 400 }, [1], 50, 60, 28, 1);
    expect(layout.paneLeft).toBe(50);
    expect(layout.paneWidth).toBe(690);
    expect(layout.panes[0]).toEqual({ x: 50, y: 0, width: 690, height: 372 });
    expect(layout.timeAxis.x).toBe(50);
  });
});

describe('resizePanes', () => {
  it('moves height between neighbours only', () => {
    expect(resizePanes([300, 100, 100], 0, -50, 30)).toEqual([250, 150, 100]);
    expect(resizePanes([300, 100, 100], 1, 20, 30)).toEqual([300, 120, 80]);
  });
  it('respects the minimum height', () => {
    expect(resizePanes([300, 100], 0, 500, 30)).toEqual([370, 30]);
    expect(resizePanes([300, 100], 0, -500, 30)).toEqual([30, 370]);
  });
  it('ignores invalid separators', () => {
    expect(resizePanes([100, 100], 1, 10, 30)).toEqual([100, 100]);
  });
});

describe('layoutLabels', () => {
  const label = (y: number, text = String(y)) => ({ y, text, background: '#000', color: '#fff' });
  it('keeps non-overlapping labels in place', () => {
    const placed = layoutLabels([label(50), label(10)], 10, 200);
    expect(placed.map((l) => l.top)).toEqual([5, 45]);
  });
  it('pushes overlapping labels apart', () => {
    const placed = layoutLabels([label(50), label(52), label(54)], 10, 200, 1);
    for (let i = 1; i < placed.length; i++)
      expect(placed[i]!.top - placed[i - 1]!.top).toBeGreaterThanOrEqual(11);
    expect(placed[0]!.top).toBe(45);
  });
  it('stacks short runs even when thinning, and counts every label once', () => {
    const placed = layoutLabels([label(50), label(52), label(54)], 10, 200, 1, { thin: true });
    expect(placed.map((l) => l.count)).toEqual([1, 1, 1]);
  });
  it('thins hundreds of labels in a small range to one per label height, keeping priorities', () => {
    // 300 lines between y=100 and y=130 (e.g. an order book), and the series' last value among them.
    const many = Array.from({ length: 300 }, (_, i) => label(100 + i * 0.1, `o${i}`));
    const last = { ...label(115, 'last'), priority: 1 };
    const placed = layoutLabels([...many, last], 16, 400, 1, { thin: true });
    expect(placed.length).toBeLessThanOrEqual(3);
    expect(placed.some((l) => l.text === 'last')).toBe(true);
    expect(placed.reduce((n, l) => n + l.count, 0)).toBe(301);
    // Kept labels stay next to their prices instead of spreading over the axis.
    for (const l of placed) expect(Math.abs(l.top + 8 - l.y)).toBeLessThanOrEqual(24);
    for (let i = 1; i < placed.length; i++)
      expect(placed[i]!.top - placed[i - 1]!.top).toBeGreaterThanOrEqual(17);
  });
  it('drops the least important labels when they cannot all fit the pane', () => {
    // 20 well-spaced labels, room for 5.
    const spread = Array.from({ length: 20 }, (_, i) => ({
      ...label(i * 20),
      priority: i === 13 ? 5 : 0,
    }));
    const placed = layoutLabels(spread, 10, 54, 1, { thin: true });
    expect(placed).toHaveLength(5);
    expect(placed.some((l) => l.priority === 5)).toBe(true);
    expect(placed.reduce((n, l) => n + l.count, 0)).toBe(20);
    expect(placed[0]!.top).toBeGreaterThanOrEqual(0);
    expect(placed[placed.length - 1]!.top + 10).toBeLessThanOrEqual(54);
    // Without `thin` every label is kept (stacked), as before.
    expect(layoutLabels(spread, 10, 54, 1)).toHaveLength(20);
  });
  it('pushes the stack back inside the bottom edge', () => {
    const placed = layoutLabels([label(98), label(99)], 10, 100, 0);
    expect(placed[1]!.top + 10).toBeLessThanOrEqual(100);
    expect(placed[1]!.top - placed[0]!.top).toBeGreaterThanOrEqual(10);
  });
});

describe('time conversion', () => {
  const store = new ColumnStore(VALUE_FIELDS);
  store.replace([100, 200, 400].map((time) => ({ time, value: 1 })));
  const timeline = new Timeline();
  timeline.rebuild([store]);

  it('exact, interpolated and extrapolated times', () => {
    expect(timeToLogical(timeline, 200)).toBe(1);
    expect(timeToLogical(timeline, 300)).toBe(1.5);
    expect(timeToLogical(timeline, 0)).toBe(-1);
    expect(timeToLogical(timeline, 600)).toBe(3);
  });

  it('round-trips', () => {
    for (const t of [50, 100, 150, 333, 800])
      expect(logicalToTime(timeline, timeToLogical(timeline, t)!)).toBeCloseTo(t, 9);
  });

  it('returns null without data', () => {
    expect(timeToLogical(new Timeline(), 1)).toBeNull();
  });
});

describe('color helpers', () => {
  it('parses hex and rgb', () => {
    expect(parseColor('#fff')).toEqual([255, 255, 255]);
    expect(parseColor('#26a69a')).toEqual([38, 166, 154]);
    expect(parseColor('rgba(1, 2, 3, 0.5)')).toEqual([1, 2, 3]);
    expect(parseColor('hsl(0 0% 0%)')).toBeNull();
  });
  it('picks a readable text colour', () => {
    expect(contrastText('#ffffff')).not.toBe('#ffffff');
    expect(contrastText('#000000')).toBe('#ffffff');
  });
});
