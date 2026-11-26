import {
  boxOf,
  distanceToBox,
  distanceToExtended,
  distanceToSegment,
  extendSegment,
} from '../geometry.js';
import { fillBox, label, line, stroke } from '../render.js';
import type { Drawing, DrawingToolDefinition, DrawingView, Point } from '../types.js';
import { FIB_COLORS, levelsOf, project, ratioText, visibleLevels } from './common.js';

/** Price/time ratios of the Gann fan relative to the 1×1 line (defined by the two anchors). */
const GANN_RATIOS: readonly [string, number][] = [
  ['1×8', 1 / 8],
  ['1×4', 1 / 4],
  ['1×3', 1 / 3],
  ['1×2', 1 / 2],
  ['1×1', 1],
  ['2×1', 2],
  ['3×1', 3],
  ['4×1', 4],
  ['8×1', 8],
];

function fanLines(
  d: Drawing,
  view: DrawingView,
): { name: string; color: string; from: Point; to: Point }[] {
  const [a, b] = project(d, view) as [Point, Point];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return GANN_RATIOS.map(([name, ratio], i) => ({
    name,
    color: FIB_COLORS[(i + 1) % FIB_COLORS.length]!,
    from: a,
    to: { x: a.x + dx, y: a.y + dy * ratio },
  }));
}

export const gannFan: DrawingToolDefinition = {
  type: 'gann-fan',
  name: 'Gann Fan',
  category: 'gann',
  points: 2,
  defaultStyle: { lineWidth: 1 },
  draw(ctx, d, view, state) {
    for (const { name, color, from, to } of fanLines(d, view)) {
      const [s, e] = extendSegment(from, to, false, true);
      stroke(ctx, d.style, state, color);
      line(ctx, s, e);
      if (d.style.showLabels)
        label(ctx, name, to.x + 3, to.y, {
          color,
          fontSize: d.style.fontSize - 2,
          baseline: 'middle',
        });
    }
  },
  distance(d, view, x, y) {
    return Math.min(
      ...fanLines(d, view).map((l) => distanceToExtended({ x, y }, l.from, l.to, false, true)),
    );
  },
};

/** Rectangle with time and price subdivisions at the given levels, plus both diagonals. */
export const gannBox: DrawingToolDefinition = {
  type: 'gann-box',
  name: 'Gann Box',
  category: 'gann',
  points: 2,
  defaultStyle: {
    lineWidth: 1,
    fillColor: 'rgba(41, 98, 255, 0.06)',
    levels: levelsOf([0, 0.25, 0.382, 0.5, 0.618, 0.75, 1]),
  },
  draw(ctx, d, view, state) {
    const [a, b] = project(d, view) as [Point, Point];
    const box = boxOf(a, b);
    fillBox(ctx, box, d.style.fillColor);
    for (const level of visibleLevels(d.style.levels)) {
      const x = a.x + (b.x - a.x) * level.value;
      const y = a.y + (b.y - a.y) * level.value;
      stroke(ctx, { ...d.style, lineWidth: 1 }, state, level.color);
      line(ctx, { x, y: box.top }, { x, y: box.bottom });
      line(ctx, { x: box.left, y }, { x: box.right, y });
      if (d.style.showLabels) {
        label(ctx, ratioText(level.value), x, box.bottom + 2, {
          color: level.color ?? d.style.lineColor,
          fontSize: d.style.fontSize - 3,
          align: 'center',
        });
        label(ctx, ratioText(level.value), box.left - 3, y, {
          color: level.color ?? d.style.lineColor,
          fontSize: d.style.fontSize - 3,
          align: 'right',
          baseline: 'middle',
        });
      }
    }
    stroke(ctx, d.style, state);
    line(ctx, a, b);
    line(ctx, { x: a.x, y: b.y }, { x: b.x, y: a.y });
  },
  distance(d, view, x, y) {
    const [a, b] = project(d, view) as [Point, Point];
    return Math.min(distanceToBox({ x, y }, boxOf(a, b), false), distanceToSegment({ x, y }, a, b));
  },
};

export const gannTools = [gannFan, gannBox];
