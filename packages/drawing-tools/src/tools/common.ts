import type { Anchor, Drawing, DrawingView, LevelStyle, Point } from '../types.js';

/** Anchors projected to pane pixels. */
export function project(drawing: Drawing, view: DrawingView): Point[] {
  return drawing.points.map((p) => ({ x: view.timeToX(p.time), y: view.priceToY(p.price) }));
}

export function anchorAt(view: DrawingView, x: number, y: number): Anchor {
  return { time: view.xToTime(x), price: view.yToPrice(y) };
}

/** Levels that are not explicitly hidden. */
export function visibleLevels(levels: readonly LevelStyle[]): LevelStyle[] {
  return levels.filter((l) => l.visible !== false);
}

export const FIB_COLORS = [
  '#787b86',
  '#f23645',
  '#ff9800',
  '#4caf50',
  '#089981',
  '#00bcd4',
  '#787b86',
  '#2962ff',
  '#f23645',
  '#9c27b0',
  '#e91e63',
];

export function levelsOf(values: readonly number[]): LevelStyle[] {
  return values.map((value, i) => ({ value, color: FIB_COLORS[i % FIB_COLORS.length]! }));
}

export const RETRACEMENT_LEVELS = levelsOf([
  0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618,
]).map((l) => (l.value > 1 ? { ...l, visible: false } : l));

export const EXTENSION_LEVELS = levelsOf([0, 0.382, 0.618, 1, 1.272, 1.618, 2, 2.618]);

/** Formats a level ratio for labels (0.618, 1, 1.618…). */
export function ratioText(value: number): string {
  return String(Number(value.toFixed(3)));
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Human-readable duration such as `3d 4h`, `45m`. */
export function formatDuration(ms: number): string {
  const sign = ms < 0 ? '−' : '';
  let rest = Math.abs(ms);
  const days = Math.floor(rest / DAY);
  rest -= days * DAY;
  const hours = Math.floor(rest / HOUR);
  rest -= hours * HOUR;
  const minutes = Math.round(rest / MINUTE);
  const parts = [
    days ? `${days}d` : '',
    hours ? `${hours}h` : '',
    minutes ? `${minutes}m` : '',
  ].filter(Boolean);
  return sign + (parts.length ? parts.slice(0, 2).join(' ') : '0m');
}
