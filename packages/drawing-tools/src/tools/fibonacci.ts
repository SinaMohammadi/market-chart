import { distance, distanceToExtended, distanceToSegment, extendSegment } from '../geometry.js';
import { label, line, polyline, stroke, withAlpha } from '../render.js';
import type {
  Anchor,
  Drawing,
  DrawingToolDefinition,
  DrawingView,
  LevelStyle,
  Point,
} from '../types.js';
import {
  EXTENSION_LEVELS,
  FIB_COLORS,
  RETRACEMENT_LEVELS,
  levelsOf,
  project,
  ratioText,
  visibleLevels,
} from './common.js';
import { channelLine } from './shapes.js';

interface HorizontalLevel {
  readonly level: LevelStyle;
  readonly price: number;
  readonly y: number;
}

/** Horizontal level lines between x0 and x1 with fills between neighbours and labels. */
function drawHorizontalLevels(
  ctx: CanvasRenderingContext2D,
  d: Drawing,
  view: DrawingView,
  levels: readonly HorizontalLevel[],
  x0: number,
  x1: number,
): void {
  const right = d.style.extendRight ? view.width : x1;
  const left = d.style.extendLeft ? 0 : x0;
  const sorted = [...levels].sort((a, b) => a.y - b.y);
  for (let i = 1; i < sorted.length; i++) {
    ctx.fillStyle = withAlpha(sorted[i]!.level.color ?? d.style.lineColor, 0.1);
    ctx.fillRect(left, sorted[i - 1]!.y, right - left, sorted[i]!.y - sorted[i - 1]!.y);
  }
  for (const { level, price, y } of levels) {
    const color = level.color ?? d.style.lineColor;
    stroke(ctx, d.style, undefined, color);
    line(ctx, { x: left, y }, { x: right, y });
    if (d.style.showLabels) {
      label(
        ctx,
        `${ratioText(level.value)} (${view.formatPrice(price)})`,
        Math.max(left, 0) + 2,
        y - 2,
        {
          color,
          fontSize: d.style.fontSize - 2,
          baseline: 'bottom',
        },
      );
    }
  }
}

function horizontalDistance(
  levels: readonly HorizontalLevel[],
  d: Drawing,
  view: DrawingView,
  x0: number,
  x1: number,
  x: number,
  y: number,
): number {
  const right = d.style.extendRight ? view.width : x1;
  const left = d.style.extendLeft ? 0 : x0;
  let best = Infinity;
  for (const l of levels)
    best = Math.min(best, distanceToSegment({ x, y }, { x: left, y: l.y }, { x: right, y: l.y }));
  return best;
}

function retracementLevels(d: Drawing, view: DrawingView): HorizontalLevel[] {
  const [a, b] = d.points as [Anchor, Anchor];
  return visibleLevels(d.style.levels).map((level) => {
    const price = b.price + (a.price - b.price) * level.value;
    return { level, price, y: view.priceToY(price) };
  });
}

/** Level 0 is at the second anchor and level 1 at the first (drag from swing start to swing end). */
export const fibRetracement: DrawingToolDefinition = {
  type: 'fib-retracement',
  name: 'Fibonacci Retracement',
  category: 'fibonacci',
  points: 2,
  defaultStyle: { lineWidth: 1, levels: RETRACEMENT_LEVELS },
  draw(ctx, d, view, state) {
    const [a, b] = project(d, view) as [Point, Point];
    drawHorizontalLevels(
      ctx,
      d,
      view,
      retracementLevels(d, view),
      Math.min(a.x, b.x),
      Math.max(a.x, b.x),
    );
    stroke(ctx, { ...d.style, lineStyle: 'dashed' }, state, withAlpha(d.style.lineColor, 0.6));
    line(ctx, a, b);
  },
  distance(d, view, x, y) {
    const [a, b] = project(d, view) as [Point, Point];
    return Math.min(
      horizontalDistance(
        retracementLevels(d, view),
        d,
        view,
        Math.min(a.x, b.x),
        Math.max(a.x, b.x),
        x,
        y,
      ),
      distanceToSegment({ x, y }, a, b),
    );
  },
};

function extensionLevels(d: Drawing, view: DrawingView): HorizontalLevel[] {
  const [a, b, c] = d.points as [Anchor, Anchor, Anchor];
  return visibleLevels(d.style.levels).map((level) => {
    const price = c.price + (b.price - a.price) * level.value;
    return { level, price, y: view.priceToY(price) };
  });
}

/** Trend-based extension: levels project the A→B move from C. */
export const fibExtension: DrawingToolDefinition = {
  type: 'fib-extension',
  name: 'Trend-Based Fibonacci Extension',
  category: 'fibonacci',
  points: 3,
  defaultStyle: { lineWidth: 1, levels: EXTENSION_LEVELS },
  draw(ctx, d, view, state) {
    const pts = project(d, view);
    if (d.points.length === 3) {
      const [, b, c] = pts as [Point, Point, Point];
      const x0 = Math.min(b.x, c.x);
      drawHorizontalLevels(
        ctx,
        d,
        view,
        extensionLevels(d, view),
        x0,
        Math.max(b.x, c.x) + Math.abs(c.x - b.x),
      );
    }
    stroke(ctx, { ...d.style, lineStyle: 'dashed' }, state, withAlpha(d.style.lineColor, 0.6));
    polyline(ctx, pts);
    ctx.stroke();
  },
  distance(d, view, x, y) {
    const pts = project(d, view) as [Point, Point, Point];
    const [, b, c] = pts;
    const x0 = Math.min(b.x, c.x);
    return Math.min(
      horizontalDistance(
        extensionLevels(d, view),
        d,
        view,
        x0,
        Math.max(b.x, c.x) + Math.abs(c.x - b.x),
        x,
        y,
      ),
      distanceToSegment({ x, y }, pts[0], b),
      distanceToSegment({ x, y }, b, c),
    );
  },
};

function fanRays(d: Drawing, view: DrawingView): { level: LevelStyle; from: Point; to: Point }[] {
  const [a, b] = project(d, view) as [Point, Point];
  return visibleLevels(d.style.levels).map((level) => ({
    level,
    from: a,
    to: { x: b.x, y: b.y + (a.y - b.y) * level.value },
  }));
}

export const fibFan: DrawingToolDefinition = {
  type: 'fib-fan',
  name: 'Fibonacci Fan',
  category: 'fibonacci',
  points: 2,
  defaultStyle: { lineWidth: 1, levels: levelsOf([0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]) },
  draw(ctx, d, view, state) {
    for (const { level, from, to } of fanRays(d, view)) {
      const [s, e] = extendSegment(from, to, false, true);
      stroke(ctx, d.style, state, level.color);
      line(ctx, s, e);
      if (d.style.showLabels)
        label(ctx, ratioText(level.value), to.x + 3, to.y, {
          color: level.color ?? d.style.lineColor,
          fontSize: d.style.fontSize - 2,
          baseline: 'middle',
        });
    }
  },
  distance(d, view, x, y) {
    return Math.min(
      ...fanRays(d, view).map((r) => distanceToExtended({ x, y }, r.from, r.to, false, true)),
    );
  },
};

export const fibChannel: DrawingToolDefinition = {
  type: 'fib-channel',
  name: 'Fibonacci Channel',
  category: 'fibonacci',
  points: 3,
  defaultStyle: { lineWidth: 1, levels: levelsOf([0, 0.382, 0.618, 1, 1.618]), extendRight: true },
  draw(ctx, d, view, state) {
    if (d.points.length < 3) {
      const [a, b] = project(d, view) as [Point, Point];
      stroke(ctx, d.style, state);
      line(ctx, a, b);
      return;
    }
    for (const level of visibleLevels(d.style.levels)) {
      const [s, e] = extendSegment(
        ...channelLine(d, view, level.value),
        d.style.extendLeft,
        d.style.extendRight,
      );
      stroke(ctx, d.style, state, level.color);
      line(ctx, s, e);
      if (d.style.showLabels)
        label(
          ctx,
          ratioText(level.value),
          channelLine(d, view, level.value)[0].x - 4,
          channelLine(d, view, level.value)[0].y,
          {
            color: level.color ?? d.style.lineColor,
            fontSize: d.style.fontSize - 2,
            align: 'right',
            baseline: 'middle',
          },
        );
    }
  },
  distance(d, view, x, y) {
    if (d.points.length < 3) return Infinity;
    return Math.min(
      ...visibleLevels(d.style.levels).map((level) =>
        distanceToExtended(
          { x, y },
          ...channelLine(d, view, level.value),
          d.style.extendLeft,
          d.style.extendRight,
        ),
      ),
    );
  },
};

const FIB_SEQUENCE = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233];

function timeZoneXs(d: Drawing, view: DrawingView): { n: number; x: number }[] {
  const [a, b] = d.points as [Anchor, Anchor];
  const l0 = view.timeToLogical(a.time);
  const step = view.timeToLogical(b.time) - l0;
  if (!(Math.abs(step) >= 0.5)) return [{ n: 0, x: view.timeToX(a.time) }];
  return FIB_SEQUENCE.map((n) => ({ n, x: view.logicalToX(l0 + n * step) })).filter(
    (z) => z.x > -50 && z.x < view.width + 50,
  );
}

export const fibTimeZones: DrawingToolDefinition = {
  type: 'fib-time-zones',
  name: 'Fibonacci Time Zones',
  category: 'fibonacci',
  points: 2,
  draw(ctx, d, view, state) {
    timeZoneXs(d, view).forEach(({ n, x }, i) => {
      const color = FIB_COLORS[i % FIB_COLORS.length]!;
      stroke(ctx, { ...d.style, lineWidth: 1 }, state, color);
      line(ctx, { x, y: 0 }, { x, y: view.height });
      if (d.style.showLabels)
        label(ctx, String(n), x + 3, 4, { color, fontSize: d.style.fontSize - 2 });
    });
  },
  distance: (d, view, x) => Math.min(...timeZoneXs(d, view).map((z) => Math.abs(x - z.x))),
};

function arcRadii(d: Drawing, view: DrawingView): { level: LevelStyle; r: number }[] {
  const [a, b] = project(d, view) as [Point, Point];
  const base = distance(a, b);
  return visibleLevels(d.style.levels)
    .filter((l) => l.value > 0)
    .map((level) => ({ level, r: base * level.value }));
}

/** Arcs centred on the second anchor, opening towards the first. */
export const fibArcs: DrawingToolDefinition = {
  type: 'fib-arcs',
  name: 'Fibonacci Arcs',
  category: 'fibonacci',
  points: 2,
  defaultStyle: { lineWidth: 1, levels: levelsOf([0.236, 0.382, 0.5, 0.618, 0.786, 1]) },
  draw(ctx, d, view, state) {
    const [a, b] = project(d, view) as [Point, Point];
    const down = a.y > b.y;
    for (const { level, r } of arcRadii(d, view)) {
      stroke(ctx, d.style, state, level.color);
      ctx.beginPath();
      ctx.arc(b.x, b.y, r, down ? 0 : Math.PI, down ? Math.PI : Math.PI * 2);
      ctx.stroke();
      if (d.style.showLabels)
        label(ctx, ratioText(level.value), b.x + 3, b.y + (down ? r : -r), {
          color: level.color ?? d.style.lineColor,
          fontSize: d.style.fontSize - 2,
          baseline: down ? 'bottom' : 'top',
        });
    }
    stroke(ctx, { ...d.style, lineStyle: 'dashed' }, state, withAlpha(d.style.lineColor, 0.6));
    line(ctx, a, b);
  },
  distance(d, view, x, y) {
    const [a, b] = project(d, view) as [Point, Point];
    const down = a.y > b.y;
    const onSide = down ? y >= b.y : y <= b.y;
    const radial = distance({ x, y }, b);
    const arcs = onSide
      ? Math.min(...arcRadii(d, view).map(({ r }) => Math.abs(radial - r)))
      : Infinity;
    return Math.min(arcs, distanceToSegment({ x, y }, a, b));
  },
};

/** Arcs between two rays from the first anchor; radii scale with the distance to the second anchor. */
export const fibWedge: DrawingToolDefinition = {
  type: 'fib-wedge',
  name: 'Fibonacci Wedge',
  category: 'fibonacci',
  points: 3,
  defaultStyle: { lineWidth: 1, levels: levelsOf([0.236, 0.382, 0.5, 0.618, 0.786, 1]) },
  draw(ctx, d, view, state) {
    const pts = project(d, view);
    const [c, p1, p2] = pts as [Point, Point, Point | undefined];
    stroke(ctx, d.style, state);
    line(ctx, c, p1);
    if (!p2) return;
    line(ctx, c, p2);
    const r0 = distance(c, p1);
    const a1 = Math.atan2(p1.y - c.y, p1.x - c.x);
    const a2 = Math.atan2(p2.y - c.y, p2.x - c.x);
    let sweep = a2 - a1;
    while (sweep > Math.PI) sweep -= Math.PI * 2;
    while (sweep < -Math.PI) sweep += Math.PI * 2;
    for (const level of visibleLevels(d.style.levels)) {
      stroke(ctx, d.style, state, level.color);
      ctx.beginPath();
      ctx.arc(c.x, c.y, r0 * level.value, a1, a1 + sweep, sweep < 0);
      ctx.stroke();
    }
  },
  distance(d, view, x, y) {
    const pts = project(d, view);
    const [c, p1, p2] = pts as [Point, Point, Point | undefined];
    const rays = Math.min(
      distanceToSegment({ x, y }, c, p1),
      p2 ? distanceToSegment({ x, y }, c, p2) : Infinity,
    );
    if (!p2) return rays;
    const radial = distance({ x, y }, c);
    const r0 = distance(c, p1);
    return Math.min(
      rays,
      ...visibleLevels(d.style.levels).map((l) => Math.abs(radial - r0 * l.value) + 0),
    );
  },
};

export const fibonacciTools = [
  fibRetracement,
  fibExtension,
  fibFan,
  fibChannel,
  fibTimeZones,
  fibArcs,
  fibWedge,
];
