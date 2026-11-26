import type { HistogramSeriesOptions } from '../../options/series-options.js';
import type { SeriesPaintContext } from '../paint-context.js';
import { bitmapX, bitmapY } from '../paint-context.js';

export function paintHistogram(c: SeriesPaintContext, o: HistogramSeriesOptions): void {
  const { ctx, store, pixelRatio: pr } = c;
  const values = store.columnAt(0);
  const colors = store.colors;
  const spacing = c.timeScale.barSpacing * pr;
  // Leave a 1px gap between columns once there is room for it.
  const width =
    spacing >= 3 ? Math.max(1, Math.floor(spacing * 0.8)) : Math.max(1, Math.ceil(spacing));
  const half = Math.floor(width / 2);
  const baseY = bitmapY(c, o.base);
  let current = '';
  for (let i = c.from; i <= c.to; i++) {
    if (!Number.isFinite(values[i]!)) continue;
    const color = colors?.[i] ?? o.color;
    if (color !== current) {
      ctx.fillStyle = color;
      current = color;
    }
    const x = bitmapX(c, i);
    const y = bitmapY(c, values[i]!);
    ctx.fillRect(x - half, Math.min(y, baseY), width, Math.max(1, Math.abs(baseY - y)));
  }
}
