import {
  distanceToExtended,
  distanceToPolyline,
  distanceToSegment,
  extendSegment,
} from '../geometry.js';
import { label, line, polyline, stroke, withAlpha } from '../render.js';
import type {
  Anchor,
  Drawing,
  DrawingDataAccess,
  DrawingToolDefinition,
  DrawingView,
  Point,
} from '../types.js';
import { project } from './common.js';

interface Fork {
  readonly median: [Point, Point];
  readonly upper: [Point, Point];
  readonly lower: [Point, Point];
}

/** Andrews (or Schiff) pitchfork geometry in pixels, before extension. */
function fork(d: Drawing, view: DrawingView, schiff: boolean): Fork | null {
  if (d.points.length < 3) return null;
  const [a, b, c] = project(d, view) as [Point, Point, Point];
  const start = schiff ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : a;
  const mid = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 };
  const dx = mid.x - start.x;
  const dy = mid.y - start.y;
  return {
    median: [start, mid],
    upper: [b, { x: b.x + dx, y: b.y + dy }],
    lower: [c, { x: c.x + dx, y: c.y + dy }],
  };
}

function pitchfork(type: string, name: string, schiff: boolean): DrawingToolDefinition {
  return {
    type,
    name,
    category: 'patterns',
    points: 3,
    defaultStyle: { fillColor: 'rgba(41, 98, 255, 0.08)' },
    draw(ctx, d, view, state) {
      const pts = project(d, view);
      const f = fork(d, view, schiff);
      stroke(ctx, d.style, state);
      if (!f) {
        polyline(ctx, pts);
        ctx.stroke();
        return;
      }
      const median = extendSegment(...f.median, false, true);
      const upper = extendSegment(...f.upper, false, true);
      const lower = extendSegment(...f.lower, false, true);
      if (d.style.fillColor !== 'transparent') {
        polyline(ctx, [upper[0], upper[1], lower[1], lower[0]], true);
        ctx.fillStyle = d.style.fillColor;
        ctx.fill();
      }
      line(ctx, ...median);
      line(ctx, ...upper);
      line(ctx, ...lower);
      stroke(
        ctx,
        { ...d.style, lineStyle: 'dashed', lineWidth: 1 },
        state,
        withAlpha(d.style.lineColor, 0.7),
      );
      line(ctx, pts[1]!, pts[2]!);
      if (schiff) line(ctx, pts[0]!, f.median[0]);
    },
    distance(d, view, x, y) {
      const f = fork(d, view, schiff);
      if (!f) return distanceToPolyline({ x, y }, project(d, view));
      const p = { x, y };
      return Math.min(
        distanceToExtended(p, ...f.median, false, true),
        distanceToExtended(p, ...f.upper, false, true),
        distanceToExtended(p, ...f.lower, false, true),
      );
    },
  };
}

export const pitchforkTool = pitchfork('pitchfork', 'Pitchfork', false);
export const schiffPitchfork = pitchfork('schiff-pitchfork', 'Schiff Pitchfork', true);

/** Least-squares fit of the source values between the two anchor times. */
export interface Regression {
  readonly slope: number;
  readonly intercept: number;
  readonly deviation: number;
  readonly from: number;
  readonly to: number;
}

export function linearRegression(
  logical: readonly number[],
  values: readonly number[],
): Regression | null {
  const n = logical.length;
  if (n < 2) return null;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += logical[i]!;
    sy += values[i]!;
    sxx += logical[i]! * logical[i]!;
    sxy += logical[i]! * values[i]!;
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  let sq = 0;
  for (let i = 0; i < n; i++) sq += (values[i]! - (intercept + slope * logical[i]!)) ** 2;
  return { slope, intercept, deviation: Math.sqrt(sq / n), from: logical[0]!, to: logical[n - 1]! };
}

function regressionLines(
  d: Drawing,
  view: DrawingView,
  r: Regression,
): { multiple: number; a: Point; b: Point }[] {
  const multiples = [
    0,
    ...d.style.levels.filter((l) => l.visible !== false).flatMap((l) => [l.value, -l.value]),
  ];
  return multiples.map((m) => ({
    multiple: m,
    a: {
      x: view.logicalToX(r.from),
      y: view.priceToY(r.intercept + r.slope * r.from + m * r.deviation),
    },
    b: {
      x: view.logicalToX(r.to),
      y: view.priceToY(r.intercept + r.slope * r.to + m * r.deviation),
    },
  }));
}

/** Linear regression of the source closes between the anchors, with ±N standard-deviation lines (levels). */
export const regressionChannel: DrawingToolDefinition<Regression | null> = {
  type: 'regression-channel',
  name: 'Regression Channel',
  category: 'patterns',
  points: 2,
  defaultStyle: { levels: [{ value: 2 }], fillColor: 'rgba(41, 98, 255, 0.08)' },
  compute(d: Drawing, data: DrawingDataAccess) {
    const [a, b] = d.points as [Anchor, Anchor];
    const { logical, value } = data.values(Math.min(a.time, b.time), Math.max(a.time, b.time));
    return linearRegression(logical, value);
  },
  draw(ctx, d, view, state, r) {
    const pts = project(d, view);
    if (!r) {
      stroke(ctx, { ...d.style, lineStyle: 'dashed' }, state);
      line(ctx, pts[0]!, pts[1]!);
      return;
    }
    const lines = regressionLines(d, view, r);
    const outer = lines.filter((l) => l.multiple !== 0);
    if (outer.length >= 2 && d.style.fillColor !== 'transparent') {
      const top = outer[0]!;
      const bottom = outer[1]!;
      const [t0, t1] = extendSegment(top.a, top.b, false, d.style.extendRight);
      const [b0, b1] = extendSegment(bottom.a, bottom.b, false, d.style.extendRight);
      polyline(ctx, [t0, t1, b1, b0], true);
      ctx.fillStyle = d.style.fillColor;
      ctx.fill();
    }
    for (const l of lines) {
      const [s, e] = extendSegment(l.a, l.b, false, d.style.extendRight);
      stroke(
        ctx,
        l.multiple === 0 ? d.style : { ...d.style, lineWidth: 1 },
        state,
        l.multiple === 0 ? undefined : withAlpha(d.style.lineColor, 0.8),
      );
      line(ctx, s, e);
    }
  },
  distance(d, view, x, y, r) {
    if (!r) return distanceToSegment({ x, y }, ...(project(d, view) as [Point, Point]));
    return Math.min(
      ...regressionLines(d, view, r).map((l) =>
        distanceToExtended({ x, y }, l.a, l.b, false, d.style.extendRight),
      ),
    );
  },
};

function wave(type: string, name: string, labels: readonly string[]): DrawingToolDefinition {
  return {
    type,
    name,
    category: 'patterns',
    points: labels.length,
    draw(ctx, d, view, state) {
      const pts = project(d, view);
      stroke(ctx, d.style, state);
      polyline(ctx, pts);
      ctx.stroke();
      if (!d.style.showLabels) return;
      pts.forEach((p, i) => {
        const prev = pts[i - 1] ?? pts[i + 1];
        const above = prev ? p.y <= prev.y : true;
        label(ctx, labels[i]!, p.x, above ? p.y - 6 : p.y + 6, {
          color: d.style.lineColor,
          fontSize: d.style.fontSize,
          align: 'center',
          baseline: above ? 'bottom' : 'top',
        });
      });
    },
    distance: (d, view, x, y) => distanceToPolyline({ x, y }, project(d, view)),
  };
}

export const elliottImpulse = wave('elliott-impulse', 'Elliott Impulse Wave (12345)', [
  '(0)',
  '(1)',
  '(2)',
  '(3)',
  '(4)',
  '(5)',
]);
export const elliottCorrection = wave('elliott-correction', 'Elliott Correction Wave (ABC)', [
  '(0)',
  '(A)',
  '(B)',
  '(C)',
]);

function cycleXs(d: Drawing, view: DrawingView): number[] {
  const [a, b] = d.points as [Anchor, Anchor];
  const l0 = view.timeToLogical(a.time);
  const period = Math.abs(view.timeToLogical(b.time) - l0);
  if (!(period >= 1)) return [view.timeToX(a.time)];
  const xs: number[] = [];
  for (let k = 0; k < 500; k++) {
    const x = view.logicalToX(l0 + k * period);
    if (x > view.width + 10) break;
    xs.push(x);
  }
  return xs;
}

/** Vertical lines repeating the interval between the two anchors. */
export const cyclicLines: DrawingToolDefinition = {
  type: 'cyclic-lines',
  name: 'Cyclic Lines',
  category: 'patterns',
  points: 2,
  defaultStyle: { lineWidth: 1 },
  draw(ctx, d, view, state) {
    stroke(ctx, d.style, state);
    for (const x of cycleXs(d, view)) line(ctx, { x, y: 0 }, { x, y: view.height });
  },
  distance: (d, view, x) => Math.min(...cycleXs(d, view).map((cx) => Math.abs(x - cx))),
};

export const patternTools = [
  pitchforkTool,
  schiffPitchfork,
  regressionChannel,
  elliottImpulse,
  elliottCorrection,
  cyclicLines,
];
