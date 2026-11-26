import { distanceToExtended, extendSegment, isFinitePoint } from '../geometry.js';
import { arrowHead, label, line, stroke } from '../render.js';
import type { DrawingToolDefinition } from '../types.js';
import { project } from './common.js';

function straightLine(
  type: string,
  name: string,
  extendLeft: boolean,
  extendRight: boolean,
): DrawingToolDefinition {
  return {
    type,
    name,
    category: 'lines',
    points: 2,
    defaultStyle: { extendLeft, extendRight },
    draw(ctx, d, view, state) {
      const [a, b] = project(d, view);
      if (!a || !b || !isFinitePoint(a) || !isFinitePoint(b)) return;
      const [s, e] = extendSegment(a, b, d.style.extendLeft, d.style.extendRight);
      stroke(ctx, d.style, state);
      line(ctx, s, e);
    },
    distance(d, view, x, y) {
      const [a, b] = project(d, view);
      return distanceToExtended({ x, y }, a!, b!, d.style.extendLeft, d.style.extendRight);
    },
  };
}

export const trendLine = straightLine('trend-line', 'Trend Line', false, false);
export const ray = straightLine('ray', 'Ray', false, true);
export const extendedLine = straightLine('extended-line', 'Extended Line', true, true);

export const arrow: DrawingToolDefinition = {
  type: 'arrow',
  name: 'Arrow',
  category: 'lines',
  points: 2,
  draw(ctx, d, view, state) {
    const [a, b] = project(d, view);
    stroke(ctx, d.style, state);
    line(ctx, a!, b!);
    arrowHead(ctx, a!, b!, 8 + d.style.lineWidth * 2);
  },
  distance(d, view, x, y) {
    const [a, b] = project(d, view);
    return distanceToExtended({ x, y }, a!, b!, false, false);
  },
};

export const horizontalLine: DrawingToolDefinition = {
  type: 'horizontal-line',
  name: 'Horizontal Line',
  category: 'lines',
  points: 1,
  handles: (d, view) => [{ x: view.width / 2, y: view.priceToY(d.points[0]!.price) }],
  draw(ctx, d, view, state) {
    const y = view.priceToY(d.points[0]!.price);
    stroke(ctx, d.style, state);
    line(ctx, { x: 0, y }, { x: view.width, y });
    if (d.style.showLabels) {
      label(ctx, view.formatPrice(d.points[0]!.price), view.width - 4, y - 3, {
        color: d.style.lineColor,
        fontSize: d.style.fontSize - 1,
        align: 'right',
        baseline: 'bottom',
      });
    }
  },
  distance: (d, view, _x, y) => Math.abs(y - view.priceToY(d.points[0]!.price)),
};

export const horizontalRay: DrawingToolDefinition = {
  type: 'horizontal-ray',
  name: 'Horizontal Ray',
  category: 'lines',
  points: 1,
  draw(ctx, d, view, state) {
    const [a] = project(d, view);
    stroke(ctx, d.style, state);
    line(ctx, a!, { x: view.width + 10, y: a!.y });
    if (d.style.showLabels) {
      label(ctx, view.formatPrice(d.points[0]!.price), a!.x + 4, a!.y - 3, {
        color: d.style.lineColor,
        fontSize: d.style.fontSize - 1,
        baseline: 'bottom',
      });
    }
  },
  distance(d, view, x, y) {
    const [a] = project(d, view);
    return x < a!.x ? Math.hypot(x - a!.x, y - a!.y) : Math.abs(y - a!.y);
  },
};

export const verticalLine: DrawingToolDefinition = {
  type: 'vertical-line',
  name: 'Vertical Line',
  category: 'lines',
  points: 1,
  handles: (d, view) => [{ x: view.timeToX(d.points[0]!.time), y: view.height / 2 }],
  draw(ctx, d, view, state) {
    const x = view.timeToX(d.points[0]!.time);
    stroke(ctx, d.style, state);
    line(ctx, { x, y: 0 }, { x, y: view.height });
  },
  distance: (d, view, x) => Math.abs(x - view.timeToX(d.points[0]!.time)),
};

export const lineTools = [
  trendLine,
  ray,
  extendedLine,
  arrow,
  horizontalLine,
  horizontalRay,
  verticalLine,
];
