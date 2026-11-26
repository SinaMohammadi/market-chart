import type { BarSeriesOptions } from '../../options/series-options.js';
import type { SeriesPaintContext } from '../paint-context.js';
import { bitmapX, bitmapY } from '../paint-context.js';

export function paintBars(c: SeriesPaintContext, o: BarSeriesOptions): void {
  const { ctx, store, pixelRatio: pr } = c;
  const open = store.columnAt(0);
  const high = store.columnAt(1);
  const low = store.columnAt(2);
  const close = store.columnAt(3);
  const colors = store.colors;
  const spacing = c.timeScale.barSpacing * pr;
  const lineWidth = o.thinBars
    ? Math.max(1, Math.floor(pr))
    : Math.max(1, Math.floor(spacing * 0.2));
  const tick = Math.max(0, Math.floor(spacing * 0.4) - Math.floor(lineWidth / 2));
  const half = Math.floor(lineWidth / 2);
  let current = '';
  for (let i = c.from; i <= c.to; i++) {
    const color = colors?.[i] ?? (close[i]! >= open[i]! ? o.upColor : o.downColor);
    if (color !== current) {
      ctx.fillStyle = color;
      current = color;
    }
    const x = bitmapX(c, i);
    const top = bitmapY(c, high[i]!);
    const bottom = bitmapY(c, low[i]!);
    ctx.fillRect(x - half, Math.min(top, bottom), lineWidth, Math.max(1, Math.abs(bottom - top)));
    if (tick <= 0) continue;
    const yClose = bitmapY(c, close[i]!);
    ctx.fillRect(x - half + lineWidth, yClose - half, tick, lineWidth);
    if (o.openVisible) {
      const yOpen = bitmapY(c, open[i]!);
      ctx.fillRect(x - half - tick, yOpen - half, tick, lineWidth);
    }
  }
}
