import type { LineStyle } from '@market-chart/core';
import type { Box } from './geometry.js';
import type { DrawState, DrawingStyle, Point } from './types.js';

const DASH: Record<LineStyle, number[]> = { solid: [], dashed: [6, 4], dotted: [2, 3] };

export function stroke(
  ctx: CanvasRenderingContext2D,
  style: Pick<DrawingStyle, 'lineColor' | 'lineWidth' | 'lineStyle'>,
  state?: DrawState,
  color?: string,
): void {
  ctx.strokeStyle = color ?? style.lineColor;
  ctx.lineWidth = style.lineWidth + (state?.hovered && !state.selected ? 1 : 0);
  ctx.setLineDash(DASH[style.lineStyle] ?? []);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

export function line(ctx: CanvasRenderingContext2D, a: Point, b: Point): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

export function polyline(
  ctx: CanvasRenderingContext2D,
  points: readonly Point[],
  close = false,
): void {
  if (!points.length) return;
  ctx.beginPath();
  ctx.moveTo(points[0]!.x, points[0]!.y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i]!.x, points[i]!.y);
  if (close) ctx.closePath();
}

export function fillBox(ctx: CanvasRenderingContext2D, box: Box, color: string): void {
  if (color === 'transparent') return;
  ctx.fillStyle = color;
  ctx.fillRect(box.left, box.top, box.right - box.left, box.bottom - box.top);
}

export function arrowHead(
  ctx: CanvasRenderingContext2D,
  from: Point,
  to: Point,
  size: number,
): void {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(
    to.x - size * Math.cos(angle - Math.PI / 7),
    to.y - size * Math.sin(angle - Math.PI / 7),
  );
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(
    to.x - size * Math.cos(angle + Math.PI / 7),
    to.y - size * Math.sin(angle + Math.PI / 7),
  );
  ctx.stroke();
}

export interface LabelOptions {
  readonly color: string;
  readonly fontSize: number;
  readonly align?: CanvasTextAlign;
  readonly baseline?: CanvasTextBaseline;
  readonly background?: string;
  readonly padding?: number;
}

/** Draws text (multi-line with `\n`); returns its box. */
export function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  o: LabelOptions,
): Box {
  const lines = text.split('\n');
  ctx.font = `${o.fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;
  const width = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const lineHeight = Math.round(o.fontSize * 1.3);
  const height = lineHeight * lines.length;
  const pad = o.padding ?? (o.background ? 4 : 0);
  const align = o.align ?? 'left';
  const baseline = o.baseline ?? 'top';
  const left = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
  const top = baseline === 'middle' ? y - height / 2 : baseline === 'bottom' ? y - height : y;
  const box = {
    left: left - pad,
    top: top - pad,
    right: left + width + pad,
    bottom: top + height + pad,
  };
  if (o.background && o.background !== 'transparent') {
    ctx.fillStyle = o.background;
    ctx.beginPath();
    ctx.roundRect?.(box.left, box.top, box.right - box.left, box.bottom - box.top, 3);
    if (!ctx.roundRect) ctx.rect(box.left, box.top, box.right - box.left, box.bottom - box.top);
    ctx.fill();
  }
  ctx.fillStyle = o.color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, left, top + i * lineHeight));
  return box;
}

/** Estimated text box without a canvas (for hit testing). */
export function estimateTextBox(
  text: string,
  x: number,
  y: number,
  fontSize: number,
  padding = 4,
): Box {
  const lines = text.split('\n');
  const width = Math.max(...lines.map((l) => l.length)) * fontSize * 0.6;
  const height = Math.round(fontSize * 1.3) * lines.length;
  return {
    left: x - padding,
    top: y - padding,
    right: x + width + padding,
    bottom: y + height + padding,
  };
}

/** Colour with an alpha channel (hex `#rrggbb` / `#rgb` only; other formats are returned unchanged). */
export function withAlpha(color: string, alpha: number): string {
  const hex = color.trim();
  if (!hex.startsWith('#')) return color;
  const full =
    hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex.slice(0, 7);
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${full}${a}`;
}
