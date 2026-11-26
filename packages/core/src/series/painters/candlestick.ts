import type { CandlestickSeriesOptions } from '../../options/series-options.js';
import type { SeriesPaintContext } from '../paint-context.js';
import { bitmapX, bitmapY } from '../paint-context.js';

export function candleBodyWidth(barSpacingBitmap: number, wickWidth: number): number {
  let width = Math.max(1, Math.floor(barSpacingBitmap * 0.8));
  // Keep body and wick parity equal so the wick is exactly centred.
  if (width > wickWidth && (width - wickWidth) % 2 !== 0) width--;
  return width;
}

export function paintCandlesticks(c: SeriesPaintContext, o: CandlestickSeriesOptions): void {
  const { ctx, store, pixelRatio: pr } = c;
  const open = store.columnAt(0);
  const high = store.columnAt(1);
  const low = store.columnAt(2);
  const close = store.columnAt(3);
  const colors = store.colors;
  const spacing = c.timeScale.barSpacing * pr;
  const wickWidth = Math.max(1, Math.floor(pr));
  const bodyWidth = candleBodyWidth(spacing, wickWidth);
  const borderWidth = Math.max(1, Math.floor(pr));
  let currentFill = '';
  const fill = (color: string): void => {
    if (color !== currentFill) {
      ctx.fillStyle = color;
      currentFill = color;
    }
  };

  if (o.wickVisible) {
    for (let i = c.from; i <= c.to; i++) {
      const up = close[i]! >= open[i]!;
      fill(colors?.[i] ?? (up ? (o.wickUpColor ?? o.upColor) : (o.wickDownColor ?? o.downColor)));
      const x = bitmapX(c, i);
      const top = bitmapY(c, high[i]!);
      const bottom = bitmapY(c, low[i]!);
      ctx.fillRect(
        x - Math.floor(wickWidth / 2),
        Math.min(top, bottom),
        wickWidth,
        Math.max(1, Math.abs(bottom - top)),
      );
    }
  }

  const drawBorder = o.borderVisible && bodyWidth > borderWidth * 2;
  for (let i = c.from; i <= c.to; i++) {
    const up = close[i]! >= open[i]!;
    const x = bitmapX(c, i);
    const yOpen = bitmapY(c, open[i]!);
    const yClose = bitmapY(c, close[i]!);
    const top = Math.min(yOpen, yClose);
    const height = Math.max(1, Math.abs(yClose - yOpen));
    const left = x - Math.floor(bodyWidth / 2);
    const bodyColor = colors?.[i] ?? (up ? o.upColor : o.downColor);
    if (!drawBorder) {
      fill(bodyColor);
      ctx.fillRect(left, top, bodyWidth, height);
      continue;
    }
    const borderColor =
      colors?.[i] ?? (up ? (o.borderUpColor ?? o.upColor) : (o.borderDownColor ?? o.downColor));
    if (height <= borderWidth * 2) {
      fill(borderColor);
      ctx.fillRect(left, top, bodyWidth, height);
      continue;
    }
    if (bodyColor !== borderColor) {
      fill(bodyColor);
      ctx.fillRect(
        left + borderWidth,
        top + borderWidth,
        bodyWidth - borderWidth * 2,
        height - borderWidth * 2,
      );
    }
    fill(borderColor);
    if (bodyColor === borderColor) {
      ctx.fillRect(left, top, bodyWidth, height);
    } else {
      ctx.fillRect(left, top, bodyWidth, borderWidth);
      ctx.fillRect(left, top + height - borderWidth, bodyWidth, borderWidth);
      ctx.fillRect(left, top + borderWidth, borderWidth, height - borderWidth * 2);
      ctx.fillRect(
        left + bodyWidth - borderWidth,
        top + borderWidth,
        borderWidth,
        height - borderWidth * 2,
      );
    }
  }
}
