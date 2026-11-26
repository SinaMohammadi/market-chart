import {
  boxOf,
  distance,
  distanceToBox,
  distanceToEllipse,
  distanceToExtended,
  extendSegment,
} from '../geometry.js';
import { fillBox, line, polyline, stroke, withAlpha } from '../render.js';
import type { Anchor, Drawing, DrawingToolDefinition, DrawingView, Point } from '../types.js';
import { project } from './common.js';

const filled = (color: string): boolean => color !== 'transparent';

export const rectangle: DrawingToolDefinition = {
  type: 'rectangle',
  name: 'Rectangle',
  category: 'shapes',
  points: 2,
  defaultStyle: { fillColor: 'rgba(41, 98, 255, 0.15)' },
  draw(ctx, d, view, state) {
    const [a, b] = project(d, view);
    const box = boxOf(a!, b!);
    fillBox(ctx, box, d.style.fillColor);
    stroke(ctx, d.style, state);
    ctx.strokeRect(box.left, box.top, box.right - box.left, box.bottom - box.top);
  },
  distance(d, view, x, y) {
    const [a, b] = project(d, view);
    return distanceToBox({ x, y }, boxOf(a!, b!), filled(d.style.fillColor));
  },
};

export const circle: DrawingToolDefinition = {
  type: 'circle',
  name: 'Circle',
  category: 'shapes',
  points: 2,
  defaultStyle: { fillColor: 'rgba(41, 98, 255, 0.15)' },
  draw(ctx, d, view, state) {
    const [c, edge] = project(d, view);
    const r = distance(c!, edge!);
    ctx.beginPath();
    ctx.arc(c!.x, c!.y, r, 0, Math.PI * 2);
    if (filled(d.style.fillColor)) {
      ctx.fillStyle = d.style.fillColor;
      ctx.fill();
    }
    stroke(ctx, d.style, state);
    ctx.stroke();
  },
  distance(d, view, x, y) {
    const [c, edge] = project(d, view);
    const r = distance(c!, edge!);
    return distanceToEllipse({ x, y }, c!, r, r, filled(d.style.fillColor));
  },
};

export const ellipse: DrawingToolDefinition = {
  type: 'ellipse',
  name: 'Ellipse',
  category: 'shapes',
  points: 2,
  defaultStyle: { fillColor: 'rgba(41, 98, 255, 0.15)' },
  draw(ctx, d, view, state) {
    const [a, b] = project(d, view);
    const box = boxOf(a!, b!);
    ctx.beginPath();
    ctx.ellipse(
      (box.left + box.right) / 2,
      (box.top + box.bottom) / 2,
      (box.right - box.left) / 2,
      (box.bottom - box.top) / 2,
      0,
      0,
      Math.PI * 2,
    );
    if (filled(d.style.fillColor)) {
      ctx.fillStyle = d.style.fillColor;
      ctx.fill();
    }
    stroke(ctx, d.style, state);
    ctx.stroke();
  },
  distance(d, view, x, y) {
    const [a, b] = project(d, view);
    const box = boxOf(a!, b!);
    return distanceToEllipse(
      { x, y },
      { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 },
      (box.right - box.left) / 2,
      (box.bottom - box.top) / 2,
      filled(d.style.fillColor),
    );
  },
};

/** Price offset of the third anchor from the base line p0–p1 (in price units, measured at its time). */
export function channelOffset(points: readonly Anchor[], view: DrawingView): number {
  const [a, b, c] = points;
  if (!a || !b || !c) return 0;
  const la = view.timeToLogical(a.time);
  const lb = view.timeToLogical(b.time);
  const lc = view.timeToLogical(c.time);
  const priceOnBase = lb === la ? a.price : a.price + ((b.price - a.price) * (lc - la)) / (lb - la);
  return c.price - priceOnBase;
}

/** The two channel lines in pixels: base and the line shifted by `factor × offset`. */
export function channelLine(d: Drawing, view: DrawingView, factor: number): [Point, Point] {
  const offset = channelOffset(d.points, view) * factor;
  const [a, b] = d.points;
  return [
    { x: view.timeToX(a!.time), y: view.priceToY(a!.price + offset) },
    { x: view.timeToX(b!.time), y: view.priceToY(b!.price + offset) },
  ];
}

export const parallelChannel: DrawingToolDefinition = {
  type: 'parallel-channel',
  name: 'Parallel Channel',
  category: 'shapes',
  points: 3,
  defaultStyle: { fillColor: 'rgba(41, 98, 255, 0.12)' },
  handles(d, view) {
    const [a, b] = channelLine(d, view, 0);
    const [c, e] = channelLine(d, view, 1);
    return [a, b, { x: (c.x + e.x) / 2, y: (c.y + e.y) / 2 }];
  },
  draw(ctx, d, view, state) {
    if (d.points.length < 3) {
      // While placing: show the base line.
      const [a, b] = project(d, view);
      stroke(ctx, d.style, state);
      line(ctx, a!, b!);
      return;
    }
    const ext = (p: [Point, Point]) =>
      extendSegment(p[0], p[1], d.style.extendLeft, d.style.extendRight);
    const base = ext(channelLine(d, view, 0));
    const other = ext(channelLine(d, view, 1));
    if (filled(d.style.fillColor)) {
      polyline(ctx, [base[0], base[1], other[1], other[0]], true);
      ctx.fillStyle = d.style.fillColor;
      ctx.fill();
    }
    stroke(ctx, d.style, state);
    line(ctx, base[0], base[1]);
    line(ctx, other[0], other[1]);
    const mid = ext(channelLine(d, view, 0.5));
    stroke(
      ctx,
      { ...d.style, lineWidth: 1, lineStyle: 'dashed' },
      undefined,
      withAlpha(d.style.lineColor, 0.7),
    );
    line(ctx, mid[0], mid[1]);
  },
  distance(d, view, x, y) {
    if (d.points.length < 3) return Infinity;
    const p = { x, y };
    const [a, b] = channelLine(d, view, 0);
    const [c, e] = channelLine(d, view, 1);
    const edge = Math.min(
      distanceToExtended(p, a, b, d.style.extendLeft, d.style.extendRight),
      distanceToExtended(p, c, e, d.style.extendLeft, d.style.extendRight),
    );
    if (!filled(d.style.fillColor)) return edge;
    // Inside the band between the two lines?
    const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x);
    const y1 = a.y + t * (b.y - a.y);
    const y2 = c.y + t * (e.y - c.y);
    const within = (d.style.extendLeft || t >= 0) && (d.style.extendRight || t <= 1);
    return within && y >= Math.min(y1, y2) && y <= Math.max(y1, y2) ? 0 : edge;
  },
};

export const shapeTools = [rectangle, circle, ellipse, parallelChannel];
