import { describe, expect, it } from 'vitest';
import { candleGeometry, downsampleLine, lineGeometry, valueRange } from './geometry.js';

describe('static geometry', () => {
  const points = [
    { time: 1, value: 10 },
    { time: 2, value: 20 },
    { time: 3, value: 15 },
  ];

  it('builds deterministic line and area paths', () => {
    const g = lineGeometry(points, { width: 100, height: 50, padding: { top: 0, bottom: 0 } });
    expect(g.line).toBe('M0 50L50 0L100 25');
    expect(g.area).toBe('M0 50L50 0L100 25L100 50L0 50Z');
    expect(g.last).toEqual({ x: 100, y: 25, value: 15 });
    expect(lineGeometry(points, { width: 100, height: 50 })).toEqual(
      lineGeometry(points, { width: 100, height: 50 }),
    );
  });

  it('skips invalid points and handles empty input', () => {
    expect(lineGeometry([], { width: 10, height: 10 }).line).toBe('');
    const g = lineGeometry([{ time: 1, value: Number.NaN }, ...points], { width: 100, height: 50 });
    expect(g.line.startsWith('M0')).toBe(true);
  });

  it('builds candles', () => {
    const { candles } = candleGeometry(
      [
        { time: 1, open: 10, high: 12, low: 9, close: 11 },
        { time: 2, open: 11, high: 11.5, low: 8, close: 9 },
      ],
      { width: 100, height: 40, padding: { top: 0, bottom: 0 } },
    );
    expect(candles).toHaveLength(2);
    expect(candles[0]!.up).toBe(true);
    expect(candles[1]!.up).toBe(false);
    expect(candles[0]!.x).toBe(25);
    expect(candles[0]!.wickTop).toBe(0);
    expect(candles[1]!.wickBottom).toBe(40);
  });

  it('valueRange pads flat data', () => {
    expect(valueRange([5, 5])).toEqual({ min: 4.95, max: 5.05 });
    expect(valueRange([])).toBeNull();
  });

  it('downsampleLine keeps endpoints and extremes', () => {
    const many = Array.from({ length: 1000 }, (_, i) => ({
      time: i,
      value: i === 500 ? 1e6 : Math.sin(i),
    }));
    const reduced = downsampleLine(many, 100);
    expect(reduced.length).toBeLessThanOrEqual(100);
    expect(reduced[0]).toBe(many[0]);
    expect(reduced[reduced.length - 1]).toBe(many[999]);
    expect(reduced.some((p) => p.value === 1e6)).toBe(true);
  });
});
