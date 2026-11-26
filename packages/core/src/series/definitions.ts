import type { ColumnStore } from '../model/column-store.js';
import { OHLC_FIELDS, VALUE_FIELDS } from '../model/column-store.js';
import type { SeriesType } from '../model/types.js';
import type { SeriesOptions, SeriesOptionsMap } from '../options/series-options.js';
import type { SeriesPaintContext } from './paint-context.js';
import { paintBars } from './painters/bar.js';
import { paintCandlesticks } from './painters/candlestick.js';
import { paintHistogram } from './painters/histogram.js';
import { paintArea, paintBaseline, paintLine } from './painters/line.js';

export interface PriceRange {
  min: number;
  max: number;
}

/**
 * Describes how a series type stores, scales, paints and reports its data.
 * Built-in types implement it directly; plugin chart types use `chart.addCustomSeries(view)` instead.
 */
export interface SeriesDefinition<T extends SeriesType> {
  readonly type: T;
  readonly fields: readonly string[];
  /** Fields that may be omitted (stored as NaN): `volume` for OHLC, `value` (whitespace) for value series. */
  readonly optionalFields: readonly string[];
  /** Index of the field used as "the" value (close / value) for labels, magnet and base values. */
  readonly valueField: number;
  paint(context: SeriesPaintContext, options: SeriesOptions<T>): void;
  /** Data extremes over local [from, to], or null when empty. */
  autoscale(
    store: ColumnStore<string>,
    from: number,
    to: number,
    options: SeriesOptions<T>,
  ): PriceRange | null;
  /** Colour representing point `index` (last-value label, legends). */
  colorAt(store: ColumnStore<string>, index: number, options: SeriesOptions<T>): string;
}

function ohlcRange(store: ColumnStore<string>, from: number, to: number): PriceRange | null {
  const high = store.columnAt(1);
  const low = store.columnAt(2);
  let min = Infinity;
  let max = -Infinity;
  for (let i = from; i <= to; i++) {
    if (low[i]! < min) min = low[i]!;
    if (high[i]! > max) max = high[i]!;
  }
  return min <= max ? { min, max } : null;
}

function valueRange(
  store: ColumnStore<string>,
  from: number,
  to: number,
  include?: number,
): PriceRange | null {
  const values = store.columnAt(0);
  let min = include ?? Infinity;
  let max = include ?? -Infinity;
  for (let i = from; i <= to; i++) {
    const v = values[i]!;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return min <= max ? { min, max } : null;
}

function ohlcColor(
  store: ColumnStore<string>,
  index: number,
  o: { upColor: string; downColor: string },
): string {
  const override = store.colors?.[index];
  if (override) return override;
  return store.columnAt(3)[index]! >= store.columnAt(0)[index]! ? o.upColor : o.downColor;
}

type BuiltInType = Exclude<SeriesType, 'custom'>;
type DefinitionMap = { [K in BuiltInType]: SeriesDefinition<K> };

const definitions: DefinitionMap = {
  candlestick: {
    type: 'candlestick',
    fields: OHLC_FIELDS,
    optionalFields: ['volume'],
    valueField: 3,
    paint: paintCandlesticks,
    autoscale: ohlcRange,
    colorAt: ohlcColor,
  },
  bar: {
    type: 'bar',
    fields: OHLC_FIELDS,
    optionalFields: ['volume'],
    valueField: 3,
    paint: paintBars,
    autoscale: ohlcRange,
    colorAt: ohlcColor,
  },
  line: {
    type: 'line',
    fields: VALUE_FIELDS,
    optionalFields: ['value'],
    valueField: 0,
    paint: paintLine,
    autoscale: (store, from, to) => valueRange(store, from, to),
    colorAt: (_store, _index, o) => o.color,
  },
  area: {
    type: 'area',
    fields: VALUE_FIELDS,
    optionalFields: ['value'],
    valueField: 0,
    paint: paintArea,
    autoscale: (store, from, to) => valueRange(store, from, to),
    colorAt: (_store, _index, o) => o.lineColor,
  },
  baseline: {
    type: 'baseline',
    fields: VALUE_FIELDS,
    optionalFields: ['value'],
    valueField: 0,
    paint: paintBaseline,
    autoscale: (store, from, to) => valueRange(store, from, to),
    colorAt: (store, index, o) =>
      store.columnAt(0)[index]! >= o.baseValue ? o.topLineColor : o.bottomLineColor,
  },
  histogram: {
    type: 'histogram',
    fields: VALUE_FIELDS,
    optionalFields: ['value'],
    valueField: 0,
    paint: paintHistogram,
    autoscale: (store, from, to, o) => valueRange(store, from, to, o.base),
    colorAt: (store, index, o) => store.colors?.[index] ?? o.color,
  },
};

export function getSeriesDefinition<T extends SeriesType>(type: T): SeriesDefinition<T> {
  if (type === 'custom') {
    throw new Error(
      '[market-chart] custom series are created with chart.addCustomSeries(view, options)',
    );
  }
  const definition = (definitions as Partial<Record<SeriesType, unknown>>)[type];
  if (!definition) {
    throw new Error(
      `[market-chart] unknown series type "${String(type)}". Known types: ${Object.keys(definitions).join(', ')}`,
    );
  }
  return definition as SeriesDefinition<T>;
}

/** Built-in series types (custom series are added with `addCustomSeries`). */
export const seriesTypes = Object.keys(definitions) as SeriesType[];

export type { SeriesOptionsMap };
