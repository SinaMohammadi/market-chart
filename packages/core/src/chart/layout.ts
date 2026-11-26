import type { Rect, Size } from '../model/types.js';

export interface ChartLayout {
  readonly width: number;
  readonly height: number;
  /** x of the pane area's left edge (equals the left axis width). */
  readonly paneLeft: number;
  /** Width of the pane area (excludes both price axes). */
  readonly paneWidth: number;
  readonly leftAxisWidth: number;
  readonly rightAxisWidth: number;
  readonly timeAxisHeight: number;
  /** Pane rectangles in chart coordinates (x = paneLeft). */
  readonly panes: readonly Rect[];
  readonly timeAxis: Rect;
  readonly separatorHeight: number;
}

/**
 * Pure layout computation. Pane heights are distributed by stretch factor and rounded to whole pixels;
 * the last pane absorbs rounding so the total always matches.
 */
export function computeLayout(
  size: Size,
  stretchFactors: readonly number[],
  leftAxisWidth: number,
  rightAxisWidth: number,
  timeAxisHeight: number,
  separatorHeight: number,
): ChartLayout {
  const width = Math.max(0, Math.floor(size.width));
  const height = Math.max(0, Math.floor(size.height));
  const right = Math.min(Math.max(0, rightAxisWidth), width);
  const left = Math.min(Math.max(0, leftAxisWidth), width - right);
  const paneWidth = Math.max(0, width - left - right);
  const axisHeight = Math.min(timeAxisHeight, height);
  const count = Math.max(1, stretchFactors.length);
  const available = Math.max(0, height - axisHeight - separatorHeight * (count - 1));
  const total = stretchFactors.reduce((sum, f) => sum + Math.max(0, f), 0) || count;
  const panes: Rect[] = [];
  let y = 0;
  let used = 0;
  for (let i = 0; i < count; i++) {
    const factor = Math.max(0, stretchFactors[i] ?? 1);
    const h = i === count - 1 ? available - used : Math.round((available * factor) / total);
    panes.push({ x: left, y, width: paneWidth, height: Math.max(0, h) });
    used += h;
    y += h + separatorHeight;
  }
  return {
    width,
    height,
    paneLeft: left,
    paneWidth,
    leftAxisWidth: left,
    rightAxisWidth: right,
    timeAxisHeight: axisHeight,
    panes,
    timeAxis: { x: left, y: height - axisHeight, width: paneWidth, height: axisHeight },
    separatorHeight,
  };
}

/**
 * New stretch factors after dragging the separator below pane `index` by `dy` px.
 * Factors are expressed in pixels so the two neighbours change size and every other pane keeps its height.
 */
export function resizePanes(
  heights: readonly number[],
  index: number,
  dy: number,
  minHeight: number,
): number[] {
  const next = heights.map((h) => Math.max(0, h));
  if (index < 0 || index >= next.length - 1) return next;
  const a = next[index]!;
  const b = next[index + 1]!;
  const total = a + b;
  const min = Math.min(minHeight, total / 2);
  const newA = Math.min(Math.max(a + dy, min), total - min);
  next[index] = newA;
  next[index + 1] = total - newA;
  return next;
}
