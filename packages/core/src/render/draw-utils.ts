import type { LineStyle } from '../options/chart-options.js';

const DASHES: Record<LineStyle, readonly number[]> = {
  solid: [],
  dashed: [4, 4],
  dotted: [1, 2],
};

export function applyLineStyle(
  ctx: CanvasRenderingContext2D,
  style: LineStyle,
  scale: number,
): void {
  const pattern = DASHES[style] ?? DASHES.solid;
  ctx.setLineDash(pattern.length ? pattern.map((v) => v * scale) : []);
}

/** Crisp horizontal line of `width` bitmap pixels centred on bitmap row `y`. */
export function horizontalLine(
  ctx: CanvasRenderingContext2D,
  y: number,
  x0: number,
  x1: number,
  width: number,
): void {
  const top = Math.round(y - width / 2);
  ctx.fillRect(Math.round(x0), top, Math.round(x1 - x0), width);
}

export function verticalLine(
  ctx: CanvasRenderingContext2D,
  x: number,
  y0: number,
  y1: number,
  width: number,
): void {
  const left = Math.round(x - width / 2);
  ctx.fillRect(left, Math.round(y0), width, Math.round(y1 - y0));
}

/** Dashed/dotted horizontal line drawn with fillRect segments (crisp at any DPR). */
export function styledHorizontalLine(
  ctx: CanvasRenderingContext2D,
  y: number,
  x0: number,
  x1: number,
  width: number,
  style: LineStyle,
  scale: number,
): void {
  if (style === 'solid') return horizontalLine(ctx, y, x0, x1, width);
  const [on, off] = (DASHES[style] as [number, number]).map((v) =>
    Math.max(1, Math.round(v * scale)),
  ) as [number, number];
  const top = Math.round(y - width / 2);
  for (let x = Math.round(x0); x < x1; x += on + off)
    ctx.fillRect(x, top, Math.min(on, x1 - x), width);
}

export function styledVerticalLine(
  ctx: CanvasRenderingContext2D,
  x: number,
  y0: number,
  y1: number,
  width: number,
  style: LineStyle,
  scale: number,
): void {
  if (style === 'solid') return verticalLine(ctx, x, y0, y1, width);
  const [on, off] = (DASHES[style] as [number, number]).map((v) =>
    Math.max(1, Math.round(v * scale)),
  ) as [number, number];
  const left = Math.round(x - width / 2);
  for (let y = Math.round(y0); y < y1; y += on + off)
    ctx.fillRect(left, y, width, Math.min(on, y1 - y));
}

/** Caches `measureText` widths per font. Bounded to avoid unbounded growth with changing labels. */
export class TextWidthCache {
  private readonly cache = new Map<string, number>();
  private font = '';

  measure(ctx: CanvasRenderingContext2D, font: string, text: string): number {
    if (font !== this.font) {
      this.cache.clear();
      this.font = font;
    }
    let width = this.cache.get(text);
    if (width === undefined) {
      ctx.font = font;
      width = ctx.measureText(text).width;
      if (this.cache.size > 2000) this.cache.clear();
      this.cache.set(text, width);
    }
    return width;
  }
}

export function fontString(size: number, family: string, weight = ''): string {
  return `${weight ? `${weight} ` : ''}${size}px ${family}`;
}
