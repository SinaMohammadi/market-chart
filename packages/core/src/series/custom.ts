import type { ColumnStore } from '../model/column-store.js';
import { OHLC_FIELDS, VALUE_FIELDS } from '../model/column-store.js';
import type { CustomSeriesOptions } from '../options/series-options.js';
import type { PriceRange, SeriesDefinition } from './definitions.js';
import type { SeriesPaintContext } from './paint-context.js';

/** Read-only access to a custom series' data (local indices). */
export interface CustomSeriesData {
  readonly length: number;
  time(index: number): number;
  /** For `value` series, open/high/low/close all return the value. NaN for whitespace. */
  open(index: number): number;
  high(index: number): number;
  low(index: number): number;
  close(index: number): number;
  /** NaN when the data has no volume. */
  volume(index: number): number;
  value(index: number): number;
  /** Per-point colour override, if any. */
  color(index: number): string | undefined;
  /** Local index of an exact time, or -1. */
  indexOfTime(time: number): number;
}

/** Everything a custom painter needs. Coordinates are bitmap pixels relative to the pane. */
export interface CustomSeriesPaintContext {
  readonly ctx: CanvasRenderingContext2D;
  readonly pixelRatio: number;
  /** Pane size in bitmap pixels. */
  readonly width: number;
  readonly height: number;
  /** Distance between bar centres in CSS px. */
  readonly barSpacing: number;
  readonly data: CustomSeriesData;
  /** Visible local index range (inclusive, padded by one point each side). */
  readonly from: number;
  readonly to: number;
  /** Bitmap x of point `index`'s bar centre. */
  x(index: number): number;
  /** Bitmap y of a price on the series' scale. */
  y(price: number): number;
  readonly options: Readonly<CustomSeriesOptions>;
}

/**
 * A plugin-provided chart type. The data store is either OHLC (`kind: 'ohlc'`, accepts `OhlcBar`) or
 * single-value (`kind: 'value'`, accepts `LinePoint` / whitespace). Renderers that need richer data
 * (footprints, order books) keep it themselves, keyed by time, and use the store as the envelope that drives
 * the time axis, auto-scaling and crosshair values.
 */
export interface CustomSeriesView {
  readonly kind: 'ohlc' | 'value';
  paint(context: CustomSeriesPaintContext): void;
  /** Price extremes over local [from, to]; default: low/high (ohlc) or value range. */
  autoscale?(data: CustomSeriesData, from: number, to: number): PriceRange | null;
  /** Colour of point `index` (last-value label, price line). */
  color?(data: CustomSeriesData, index: number, options: Readonly<CustomSeriesOptions>): string;
}

export function customDataView(
  store: ColumnStore<string>,
  kind: 'ohlc' | 'value',
): CustomSeriesData {
  const times = store.times;
  const cols =
    kind === 'ohlc'
      ? [0, 1, 2, 3].map((i) => store.columnAt(i))
      : [0, 0, 0, 0].map(() => store.columnAt(0));
  const volume = kind === 'ohlc' ? store.columnAt(4) : null;
  return {
    length: store.length,
    time: (i) => times[i]!,
    open: (i) => cols[0]![i]!,
    high: (i) => cols[1]![i]!,
    low: (i) => cols[2]![i]!,
    close: (i) => cols[3]![i]!,
    volume: (i) => (volume ? volume[i]! : Number.NaN),
    value: (i) => cols[3]![i]!,
    color: (i) => store.colors?.[i],
    indexOfTime: (t) => store.indexOfTime(t),
  };
}

/** Wraps a custom view into an internal series definition. */
export function createCustomDefinition(view: CustomSeriesView): SeriesDefinition<'custom'> {
  const ohlc = view.kind === 'ohlc';
  return {
    type: 'custom',
    fields: ohlc ? OHLC_FIELDS : VALUE_FIELDS,
    optionalFields: ohlc ? ['volume'] : ['value'],
    valueField: ohlc ? 3 : 0,
    paint(c: SeriesPaintContext, options) {
      const pr = c.pixelRatio;
      view.paint({
        ctx: c.ctx,
        pixelRatio: pr,
        width: c.width,
        height: c.height,
        barSpacing: c.timeScale.barSpacing,
        data: customDataView(c.store, view.kind),
        from: c.from,
        to: c.to,
        x: (i) => c.timeScale.indexToX(c.mapping[i]!) * pr,
        y: (price) => c.priceScale.priceToCoordinate(price) * pr,
        options,
      });
    },
    autoscale(store, from, to) {
      const data = customDataView(store, view.kind);
      if (view.autoscale) return view.autoscale(data, from, to);
      let min = Infinity;
      let max = -Infinity;
      for (let i = from; i <= to; i++) {
        const lo = data.low(i);
        const hi = data.high(i);
        if (lo < min) min = lo;
        if (hi > max) max = hi;
      }
      return min <= max ? { min, max } : null;
    },
    colorAt(store, index, options) {
      const data = customDataView(store, view.kind);
      if (view.color) return view.color(data, index, options);
      const override = data.color(index);
      if (override) return override;
      if (!ohlc) return options.color;
      return data.close(index) >= data.open(index) ? options.upColor : options.downColor;
    },
  };
}
