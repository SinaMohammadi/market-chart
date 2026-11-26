import type { ColumnStore } from '../model/column-store.js';
import type { PriceScale } from '../scales/price-scale.js';
import type { TimeScale } from '../scales/time-scale.js';

/**
 * Everything a series painter needs. The context's origin is the pane's top-left corner and
 * units are **bitmap pixels** (CSS px × pixelRatio). Painters read typed arrays directly and must
 * not allocate per bar.
 */
export interface SeriesPaintContext {
  readonly ctx: CanvasRenderingContext2D;
  readonly pixelRatio: number;
  /** Pane size in bitmap pixels. */
  readonly width: number;
  readonly height: number;
  readonly timeScale: TimeScale;
  readonly priceScale: PriceScale;
  readonly store: ColumnStore<string>;
  /** Local → global index mapping (read [0, store.length)). */
  readonly mapping: Int32Array;
  /** Inclusive local index range to paint (already padded by one bar each side). */
  readonly from: number;
  readonly to: number;
}

/** Bitmap x of bar centre for local index `i`. */
export function bitmapX(c: SeriesPaintContext, i: number): number {
  return Math.round(c.timeScale.indexToX(c.mapping[i]!) * c.pixelRatio);
}

/** Bitmap y for a raw price. */
export function bitmapY(c: SeriesPaintContext, price: number): number {
  return Math.round(c.priceScale.priceToCoordinate(price) * c.pixelRatio);
}
