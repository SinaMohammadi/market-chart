import { describe, expect, it } from 'vitest';
import { createFakeContext } from '@market-chart/testing';
import {
  distanceToEllipse,
  distanceToExtended,
  distanceToSegment,
  extendSegment,
} from './geometry.js';
import { DrawingHistory } from './history.js';
import { createDefaultToolRegistry, DrawingToolRegistry } from './registry.js';
import { migrateSnapshot, validateDrawing } from './serialization.js';
import { baseStyle, resolveStyle, sanitizeStyle } from './style.js';
import { builtInTools } from './tools/index.js';
import { fibRetracement } from './tools/fibonacci.js';
import { longPosition } from './tools/measure.js';
import { linearRegression } from './tools/patterns.js';
import { channelOffset } from './tools/shapes.js';
import type {
  Anchor,
  Drawing,
  DrawingDataAccess,
  DrawingToolDefinition,
  DrawingView,
} from './types.js';

/** Linear test view: 1 bar per second of time, x = 10 px per bar, y = 400 − price. */
const view: DrawingView = {
  width: 800,
  height: 400,
  barSpacing: 10,
  timeToX: (t) => (t / 1000) * 10,
  xToTime: (x) => (x / 10) * 1000,
  priceToY: (p) => 400 - p,
  yToPrice: (y) => 400 - y,
  timeToLogical: (t) => t / 1000,
  logicalToTime: (l) => l * 1000,
  logicalToX: (l) => l * 10,
  formatPrice: (p) => p.toFixed(2),
};

const anchor = (bar: number, price: number): Anchor => ({ time: bar * 1000, price });

function drawingOf(
  tool: DrawingToolDefinition,
  points: Anchor[],
  extra: Partial<Drawing> = {},
): Drawing {
  return {
    id: 'd1',
    type: tool.type,
    seriesId: 's1',
    points,
    style: resolveStyle(tool),
    text: tool.defaultText ?? 'note',
    locked: false,
    visible: true,
    zIndex: 1,
    groupId: null,
    ...extra,
  };
}

/** Distinct, non-degenerate anchors for any tool. */
function samplePoints(tool: DrawingToolDefinition): Anchor[] {
  const base = [
    anchor(10, 100),
    anchor(30, 200),
    anchor(45, 140),
    anchor(55, 230),
    anchor(62, 180),
    anchor(75, 260),
  ];
  return tool.seed?.(base[0]!, view) ?? base.slice(0, tool.points);
}

const data: DrawingDataAccess = {
  values: (from, to) => {
    const logical: number[] = [];
    const value: number[] = [];
    for (let i = 0; i <= 100; i++) {
      if (i * 1000 < from || i * 1000 > to) continue;
      logical.push(i);
      value.push(100 + 2 * i + (i % 2 ? 1 : -1));
    }
    return { logical, value };
  },
};

describe('geometry', () => {
  it('measures distances to segments, rays and ellipses', () => {
    expect(distanceToSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    expect(distanceToSegment({ x: 15, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    expect(
      distanceToExtended({ x: 1000, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }, false, true),
    ).toBeCloseTo(0, 6);
    const [s, e] = extendSegment({ x: 0, y: 0 }, { x: 1, y: 1 }, true, false);
    expect(s.x).toBeLessThan(-1000);
    expect(e).toEqual({ x: 1, y: 1 });
    expect(distanceToEllipse({ x: 0, y: 0 }, { x: 0, y: 0 }, 10, 5, true)).toBe(0);
    expect(distanceToEllipse({ x: 10, y: 0 }, { x: 0, y: 0 }, 10, 5, false)).toBeCloseTo(0, 6);
  });
});

describe('built-in tools', () => {
  it('registers 35 tools with unique types', () => {
    const registry = createDefaultToolRegistry();
    expect(registry.list()).toHaveLength(35);
    expect(new Set(builtInTools.map((t) => t.type)).size).toBe(35);
  });

  for (const tool of builtInTools) {
    it(`${tool.type}: draws without errors and is hit at its own anchors`, () => {
      const d = drawingOf(tool, samplePoints(tool));
      const derived = tool.compute?.(d, data);
      const ctx = createFakeContext({} as HTMLCanvasElement);
      tool.draw(ctx, d, view, { selected: true, hovered: true }, derived);
      // Partial anchors (while placing) must not throw either; seeded tools are always complete.
      if (tool.points > 1 && !tool.seed) {
        tool.draw(
          ctx,
          { ...d, points: d.points.slice(0, 2) },
          view,
          { selected: false, hovered: false },
          undefined,
        );
      }
      const handles =
        tool.handles?.(d, view) ??
        d.points.map((p) => ({ x: view.timeToX(p.time), y: view.priceToY(p.price) }));
      // Points that lie on the shape: anchors for most tools, plus shape-specific ones where anchors are not on it.
      const onShape = [...handles];
      if (tool.type === 'ellipse') {
        const [a, b] = handles as [{ x: number; y: number }, { x: number; y: number }];
        onShape.push({ x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) });
      }
      if (tool.type === 'regression-channel') {
        const r = derived as { from: number; slope: number; intercept: number };
        onShape.push({
          x: view.logicalToX(r.from),
          y: view.priceToY(r.intercept + r.slope * r.from),
        });
      }
      const hits = onShape.map((h) => tool.distance(d, view, h.x, h.y, derived));
      expect(Math.min(...hits)).toBeLessThan(8);
      expect(tool.distance(d, view, -5000, -5000, derived)).toBeGreaterThan(20);
    });
  }
});

describe('tool semantics', () => {
  it('fib retracement: level 0 at the second anchor, 1 at the first', () => {
    const d = drawingOf(fibRetracement, [anchor(0, 100), anchor(10, 200)]);
    const y382 = view.priceToY(200 + (100 - 200) * 0.382);
    expect(fibRetracement.distance(d, view, 50, y382, undefined)).toBeLessThan(1);
  });

  it('long position: one click creates entry, target above and stop below', () => {
    const points = longPosition.seed!(anchor(10, 150), view);
    expect(points).toHaveLength(3);
    expect(points[1]!.price).toBeGreaterThan(150);
    expect(points[2]!.price).toBeLessThan(150);
    expect(points[1]!.time).toBe(points[2]!.time);
    const moved = longPosition.moveHandle!(points, 3, anchor(50, 999), view);
    expect(moved[1]!.time).toBe(50_000);
    expect(moved[2]!.time).toBe(50_000);
    expect(moved[1]!.price).toBe(points[1]!.price);
  });

  it('parallel channel offset is measured from the base line', () => {
    expect(channelOffset([anchor(0, 100), anchor(10, 200), anchor(5, 180)], view)).toBeCloseTo(
      30,
      9,
    );
  });

  it('linear regression fits slope, intercept and deviation', () => {
    const r = linearRegression([0, 1, 2, 3], [1, 3, 5, 7])!;
    expect(r.slope).toBeCloseTo(2, 12);
    expect(r.intercept).toBeCloseTo(1, 12);
    expect(r.deviation).toBeCloseTo(0, 12);
    expect(linearRegression([1], [1])).toBeNull();
  });
});

describe('style, validation and serialization', () => {
  it('sanitizes styles and rejects invalid values', () => {
    expect(sanitizeStyle({ lineWidth: 3, bogus: 1 })).toEqual({ lineWidth: 3 });
    expect(() => sanitizeStyle({ lineWidth: 0 })).toThrow(/lineWidth/);
    expect(() => sanitizeStyle({ lineStyle: 'wavy' })).toThrow(/lineStyle/);
    expect(() => sanitizeStyle({ levels: [{ value: 'x' }] })).toThrow(/levels/);
    expect(resolveStyle(fibRetracement).levels.length).toBeGreaterThan(5);
    expect(resolveStyle(fibRetracement, { lineColor: '#f00' }).lineColor).toBe('#f00');
    expect(baseStyle.lineStyle).toBe('solid');
  });

  it('validates stored drawings', () => {
    const registry = createDefaultToolRegistry();
    const good = {
      id: 'a',
      type: 'trend-line',
      seriesId: 's',
      points: [anchor(1, 1), anchor(2, 2)],
      style: {},
      zIndex: 1,
    };
    expect(validateDrawing(good, registry).type).toBe('trend-line');
    expect(() => validateDrawing({ ...good, points: [anchor(1, 1)] }, registry)).toThrow(
      /exactly 2/,
    );
    expect(() => validateDrawing({ ...good, type: 'nope' }, registry)).toThrow(
      /unknown drawing tool/,
    );
    expect(() => validateDrawing({ ...good, id: '<script>' }, registry)).toThrow(/id/);
    expect(() =>
      validateDrawing({ ...good, points: [anchor(1, Number.NaN), anchor(2, 2)] }, registry),
    ).toThrow(/finite/);
    const polluted = JSON.parse(
      '{"id":"b","type":"trend-line","seriesId":"s","points":[{"time":1,"price":1},{"time":2,"price":2}],"__proto__":{"x":1}}',
    );
    expect(Object.keys(validateDrawing(polluted, registry))).not.toContain('__proto__');
  });

  it('migrates and guards snapshot versions', () => {
    expect(migrateSnapshot({ drawings: [] }).version).toBe(1);
    expect(() => migrateSnapshot({ version: 99, drawings: [] })).toThrow(/newer/);
    expect(() => migrateSnapshot({ version: 1 })).toThrow(/array/);
  });

  it('rejects broken custom tools', () => {
    const registry = new DrawingToolRegistry();
    expect(() => registry.register({ ...fibRetracement, type: 'Bad Type' })).toThrow(
      /invalid tool type/,
    );
    expect(() => registry.register({ ...fibRetracement, points: 0 })).toThrow(/points/);
    registry.register(fibRetracement);
    expect(() => registry.register(fibRetracement)).toThrow(/already registered/);
  });
});

describe('history', () => {
  const a = drawingOf(fibRetracement, [anchor(0, 1), anchor(1, 2)]);
  const b = { ...a, text: 'changed' };

  it('undoes and redoes change sets', () => {
    const h = new DrawingHistory();
    h.push([{ id: 'd1', before: null, after: a }]);
    h.push([{ id: 'd1', before: a, after: b }]);
    expect(h.undo()).toEqual([{ id: 'd1', before: b, after: a }]);
    expect(h.canRedo).toBe(true);
    expect(h.redo()).toEqual([{ id: 'd1', before: a, after: b }]);
    h.undo();
    h.push([{ id: 'd1', before: a, after: { ...a, locked: true } }]);
    expect(h.canRedo).toBe(false);
  });

  it('ignores no-op changes and respects its limit', () => {
    const h = new DrawingHistory(2);
    h.push([{ id: 'd1', before: a, after: a }]);
    expect(h.canUndo).toBe(false);
    h.push([{ id: 'x', before: null, after: a }]);
    h.push([{ id: 'y', before: null, after: a }]);
    h.push([{ id: 'z', before: null, after: a }]);
    expect(h.undo()![0]!.id).toBe('z');
    expect(h.undo()![0]!.id).toBe('y');
    expect(h.undo()).toBeNull();
  });
});
