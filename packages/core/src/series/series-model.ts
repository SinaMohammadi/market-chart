import { ColumnStore } from '../model/column-store.js';
import type { StoreRow, UpsertResult } from '../model/column-store.js';
import type { Timeline } from '../model/timeline.js';
import type { SeriesColumnsInput, SeriesData, SeriesType } from '../model/types.js';
import { createPriceFormatter } from '../format/price-format.js';
import type { PriceFormatterFn } from '../format/price-format.js';
import type { SeriesOptions, SeriesOptionsInput } from '../options/series-options.js';
import { defaultSeriesOptions } from '../options/series-options.js';
import type { ChartTheme } from '../theme/themes.js';
import { deepMerge } from '../utils/merge.js';
import type { PriceRange, SeriesDefinition } from './definitions.js';
import { getSeriesDefinition } from './definitions.js';
import type { PriceLineEntry } from './price-line.js';

/** Internal series state. Not exposed to users or plugins; the public surface is `SeriesApi`. */
export class SeriesModel<T extends SeriesType = SeriesType> {
  readonly id: string;
  readonly type: T;
  readonly definition: SeriesDefinition<T>;
  readonly store: ColumnStore<string>;
  private _input: SeriesOptionsInput<T>;
  private _options: SeriesOptions<T>;
  private _formatter: PriceFormatterFn;
  private _customFormatter: PriceFormatterFn | null = null;
  /** Horizontal lines attached to this series (see `SeriesApi.createPriceLine`). */
  readonly priceLines: PriceLineEntry[] = [];

  constructor(
    id: string,
    type: T,
    input: SeriesOptionsInput<T>,
    theme: ChartTheme,
    definition?: SeriesDefinition<T>,
  ) {
    this.id = id;
    this.type = type;
    this.definition = definition ?? getSeriesDefinition(type);
    this.store = new ColumnStore(this.definition.fields, this.definition.optionalFields);
    this._input = input;
    this._options = deepMerge(defaultSeriesOptions(type, theme), input);
    this._formatter = createPriceFormatter(this._options.priceFormat);
  }

  get options(): SeriesOptions<T> {
    return this._options;
  }

  /** Custom formatter if set, otherwise the one derived from `priceFormat`. */
  get formatter(): PriceFormatterFn {
    return this._customFormatter ?? this._formatter;
  }

  /** Non-serialisable override for price labels of this series. Null restores `priceFormat`. */
  setCustomFormatter(formatter: PriceFormatterFn | null): void {
    if (formatter !== null && typeof formatter !== 'function') {
      throw new Error('[market-chart] setPriceFormatter expects a function or null');
    }
    this._customFormatter = formatter;
  }

  /** Options explicitly set by the user (theme-independent). */
  get inputOptions(): SeriesOptionsInput<T> {
    return this._input;
  }

  applyOptions(patch: SeriesOptionsInput<T>, theme: ChartTheme): void {
    // Merging two partials: the result is still a partial of the same options type.
    this._input = deepMerge(this._input as SeriesOptions<T>, patch) as SeriesOptionsInput<T>;
    this.resolve(theme);
  }

  /** Re-derives options after a theme change; user-set colours are preserved. */
  resolve(theme: ChartTheme): void {
    this._options = deepMerge(defaultSeriesOptions(this.type, theme), this._input);
    this._formatter = createPriceFormatter(this._options.priceFormat);
  }

  setData(data: readonly SeriesData<T>[]): void {
    if (!Array.isArray(data)) throw new Error('[market-chart] setData expects an array');
    this.store.replace(data as unknown as readonly StoreRow<string>[]);
  }

  setColumns(columns: SeriesColumnsInput): void {
    if (!columns || typeof columns !== 'object' || !columns.times || !columns.fields) {
      throw new Error('[market-chart] setColumns expects { times, fields }');
    }
    this.store.replaceColumns(columns.times, columns.fields, columns.colors);
  }

  update(point: SeriesData<T>): UpsertResult {
    return this.store.upsert(point as unknown as StoreRow<string>);
  }

  dataAt(index: number): SeriesData<T> | undefined {
    return this.store.rowAt(index) as SeriesData<T> | undefined;
  }

  valueAt(index: number): number {
    return this.store.columnAt(this.definition.valueField)[index]!;
  }

  /** Index of the last point with a finite value (skips trailing whitespace), or -1. */
  lastValueIndex(): number {
    const values = this.store.columnAt(this.definition.valueField);
    for (let i = this.store.length - 1; i >= 0; i--) if (Number.isFinite(values[i]!)) return i;
    return -1;
  }

  /** First finite value in local [from, to], or null. */
  firstValueIn(from: number, to: number): number | null {
    const values = this.store.columnAt(this.definition.valueField);
    for (let i = from; i <= to; i++) if (Number.isFinite(values[i]!)) return values[i]!;
    return null;
  }

  colorAt(index: number): string {
    return this.definition.colorAt(this.store, index, this._options);
  }

  /** Local index range for global [from, to], padded by `pad` points each side. */
  localRange(
    timeline: Timeline,
    globalFrom: number,
    globalTo: number,
    pad = 0,
  ): { from: number; to: number } | null {
    const fromTime = timeline.timeAt(globalFrom);
    const toTime = timeline.timeAt(globalTo);
    if (fromTime === undefined || toTime === undefined) return null;
    const range = this.store.indexRange(fromTime, toTime);
    if (!range) {
      if (pad === 0 || this.store.length === 0) return null;
      // No point inside the window: a line may still cross it between neighbours.
      const after = this.store.indexRange(fromTime, Infinity);
      const index = after ? after.from : this.store.length;
      const from = Math.max(0, index - pad);
      const to = Math.min(this.store.length - 1, index + pad - 1);
      return from <= to ? { from, to } : null;
    }
    return {
      from: Math.max(0, range.from - pad),
      to: Math.min(this.store.length - 1, range.to + pad),
    };
  }

  autoscale(from: number, to: number): PriceRange | null {
    return this.definition.autoscale(this.store, from, to, this._options);
  }
}
