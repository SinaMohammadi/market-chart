import type { Point } from './types.js';

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Distance from p to segment a–b. */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Endpoints of the line through a and b, optionally extended past a and/or b far enough to leave any
 * reasonable viewport (the canvas clips the rest).
 */
export function extendSegment(
  a: Point,
  b: Point,
  extendLeft: boolean,
  extendRight: boolean,
): [Point, Point] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return [a, b];
  const k = 100_000 / len;
  return [
    extendLeft ? { x: a.x - dx * k, y: a.y - dy * k } : a,
    extendRight ? { x: b.x + dx * k, y: b.y + dy * k } : b,
  ];
}

export function distanceToExtended(
  p: Point,
  a: Point,
  b: Point,
  extendLeft: boolean,
  extendRight: boolean,
): number {
  const [s, e] = extendSegment(a, b, extendLeft, extendRight);
  return distanceToSegment(p, s, e);
}

export function distanceToPolyline(p: Point, points: readonly Point[]): number {
  let best = Infinity;
  for (let i = 1; i < points.length; i++)
    best = Math.min(best, distanceToSegment(p, points[i - 1]!, points[i]!));
  return points.length === 1 ? distance(p, points[0]!) : best;
}

export interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export function boxOf(a: Point, b: Point): Box {
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    right: Math.max(a.x, b.x),
    bottom: Math.max(a.y, b.y),
  };
}

export function inBox(p: Point, box: Box): boolean {
  return p.x >= box.left && p.x <= box.right && p.y >= box.top && p.y <= box.bottom;
}

/** Distance to the box outline; 0 inside when `filled`. */
export function distanceToBox(p: Point, box: Box, filled: boolean): number {
  if (inBox(p, box)) {
    if (filled) return 0;
    return Math.min(p.x - box.left, box.right - p.x, p.y - box.top, box.bottom - p.y);
  }
  const dx = Math.max(box.left - p.x, 0, p.x - box.right);
  const dy = Math.max(box.top - p.y, 0, p.y - box.bottom);
  return Math.hypot(dx, dy);
}

/** Approximate distance to an axis-aligned ellipse outline; 0 inside when `filled`. */
export function distanceToEllipse(
  p: Point,
  center: Point,
  rx: number,
  ry: number,
  filled: boolean,
): number {
  if (rx <= 0 || ry <= 0) return distance(p, center);
  const nx = (p.x - center.x) / rx;
  const ny = (p.y - center.y) / ry;
  const r = Math.hypot(nx, ny);
  if (r <= 1 && filled) return 0;
  return Math.abs(r - 1) * Math.min(rx, ry);
}

/** y on the line a–b at x (a.x !== b.x), or a.y for vertical lines. */
export function yOnLine(a: Point, b: Point, x: number): number {
  if (b.x === a.x) return a.y;
  return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export const isFinitePoint = (p: Point): boolean => Number.isFinite(p.x) && Number.isFinite(p.y);
