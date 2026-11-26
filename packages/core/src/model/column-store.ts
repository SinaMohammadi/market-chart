import { indexOfSorted, lowerBound, upperBound } from '../utils/binary-search.js';
import { ChartError, isFiniteNumber } from '../utils/errors.js';

export const OHLC_FIELDS = ['open', 'high', 'low', 'close', 'volume'] as const;
export const VALUE_FIELDS = ['value'] as const;

export type OhlcField = (typeof OHLC_FIELDS)[number];
export type ValueField = (typeof VALUE_FIELDS)[number];

export type StoreRow<F extends string> = { readonly time: number; readonly color?: string } & {
  readonly [K in F]?: number;
};

export type UpsertResult =
  | { readonly kind: 'appended'; readonly index: number }
  | { readonly kind: 'replaced'; readonly index: number }
  | { readonly kind: 'inserted'; readonly index: number };

const MIN_CAPACITY = 64;

/**
 * Columnar, typed-array backed storage for time-ordered series data.
 *
 * - One `Float64Array` per field plus a time column; capacity grows geometrically, so realtime
 *   appends are amortised O(1) and do not allocate per bar.
 * - Times are strictly increasing; violations are rejected with a descriptive error.
 * - Per-point colours are stored in a sparse side array that is only allocated when used.
 *
 * The typed arrays returned by `times` / `column()` may be longer than `length`; read only [0, length).
 */
export class ColumnStore<F extends string> {
  readonly fields: readonly F[];
  private _times: Float64Array;
  private readonly _columns: Float64Array[];
  private _colors: (string | undefined)[] | null = null;
  private _length = 0;

  /** Fields that may be missing (`undefined` / `null`) in input; stored as NaN. */
  private readonly optional: ReadonlySet<string>;

  constructor(fields: readonly F[], optionalFields: readonly F[] = []) {
    this.fields = fields;
    this.optional = new Set(optionalFields);
    this._times = new Float64Array(MIN_CAPACITY);
    this._columns = fields.map(() => new Float64Array(MIN_CAPACITY));
  }

  get length(): number {
    return this._length;
  }

  get times(): Float64Array {
    return this._times;
  }

  get colors(): readonly (string | undefined)[] | null {
    return this._colors;
  }

  column(field: F): Float64Array {
    const index = this.fields.indexOf(field);
    if (index < 0) throw new ChartError(`unknown field "${field}"`);
    return this._columns[index]!;
  }

  columnAt(fieldIndex: number): Float64Array {
    return this._columns[fieldIndex]!;
  }

  firstTime(): number | undefined {
    return this._length > 0 ? this._times[0] : undefined;
  }

  lastTime(): number | undefined {
    return this._length > 0 ? this._times[this._length - 1] : undefined;
  }

  indexOfTime(time: number): number {
    return indexOfSorted(this._times, time, this._length);
  }

  /** Local index range [from, to] (inclusive) of points whose time lies in [fromTime, toTime]. */
  indexRange(fromTime: number, toTime: number): { from: number; to: number } | null {
    const from = lowerBound(this._times, fromTime, this._length);
    const to = upperBound(this._times, toTime, this._length) - 1;
    return from <= to ? { from, to } : null;
  }

  /** Replaces all data. Validates every row; on error the previous data is kept. */
  replace(rows: readonly StoreRow<F>[]): void {
    const n = rows.length;
    const capacity = Math.max(MIN_CAPACITY, n);
    const times = new Float64Array(capacity);
    const columns = this.fields.map(() => new Float64Array(capacity));
    let colors: (string | undefined)[] | null = null;
    let prev = -Infinity;
    for (let i = 0; i < n; i++) {
      const row = rows[i]!;
      const time = this.validateTime(row, i);
      if (time <= prev) {
        throw new ChartError(
          `data must be sorted by strictly increasing time; row ${i} (time=${time}) is not after row ${i - 1} (time=${prev})`,
        );
      }
      prev = time;
      times[i] = time;
      for (let f = 0; f < this.fields.length; f++) {
        columns[f]![i] = this.readField(row, this.fields[f]!, i);
      }
      if (row.color !== undefined) {
        colors ??= new Array<string | undefined>(n);
        colors[i] = String(row.color);
      }
    }
    this._times = times;
    for (let f = 0; f < columns.length; f++) this._columns[f] = columns[f]!;
    this._colors = colors;
    this._length = n;
  }

  /**
   * Replaces all data from columns, without an object per point. Same rules as `replace`: strictly
   * increasing finite times; required fields finite; optional fields may be missing or NaN. On error the
   * previous data is kept.
   */
  replaceColumns(
    times: ArrayLike<number>,
    fields: Readonly<Record<string, ArrayLike<number> | undefined>>,
    colors?: ArrayLike<string | undefined | null>,
  ): void {
    const n = times.length;
    for (const key of Object.keys(fields)) {
      if (!this.fields.includes(key as F))
        throw new ChartError(`unknown field "${key}" (expected ${this.fields.join(', ')})`);
    }
    const sources = this.fields.map((field) => {
      const source = fields[field];
      if (source === undefined || source === null) {
        if (!this.optional.has(field)) throw new ChartError(`missing required column "${field}"`);
        return null;
      }
      if (source.length !== n) {
        throw new ChartError(
          `column "${field}" has ${source.length} values but there are ${n} times`,
        );
      }
      return source;
    });
    if (colors && colors.length !== n)
      throw new ChartError(`colors has ${colors.length} values but there are ${n} times`);
    const capacity = Math.max(MIN_CAPACITY, n);
    const nextTimes = new Float64Array(capacity);
    const columns = this.fields.map(() => new Float64Array(capacity));
    let prev = -Infinity;
    for (let i = 0; i < n; i++) {
      const time = times[i]!;
      if (!isFiniteNumber(time))
        throw new ChartError(
          `time at index ${i} is invalid (${String(time)}); expected UTC milliseconds`,
        );
      if (time <= prev) {
        throw new ChartError(
          `times must be strictly increasing; index ${i} (time=${time}) is not after index ${i - 1} (time=${prev})`,
        );
      }
      prev = time;
      nextTimes[i] = time;
    }
    for (let f = 0; f < this.fields.length; f++) {
      const source = sources[f];
      const target = columns[f]!;
      if (!source) {
        target.fill(Number.NaN, 0, n);
        continue;
      }
      const optional = this.optional.has(this.fields[f]!);
      for (let i = 0; i < n; i++) {
        const value = source[i]!;
        if (value !== value) {
          if (!optional)
            throw new ChartError(
              `"${this.fields[f]}" at index ${i} is NaN; expected a finite number`,
            );
        } else if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw new ChartError(
            `"${this.fields[f]}" at index ${i} is invalid (${String(value)}); expected a finite number`,
          );
        }
        target[i] = value;
      }
    }
    let nextColors: (string | undefined)[] | null = null;
    if (colors) {
      for (let i = 0; i < n; i++) {
        const color = colors[i];
        if (color === undefined || color === null) continue;
        nextColors ??= new Array<string | undefined>(n);
        nextColors[i] = String(color);
      }
    }
    this._times = nextTimes;
    for (let f = 0; f < columns.length; f++) this._columns[f] = columns[f]!;
    this._colors = nextColors;
    this._length = n;
  }

  /** Appends, replaces (same time) or inserts (historical correction) a single row. */
  upsert(row: StoreRow<F>): UpsertResult {
    const time = this.validateTime(row, 0);
    const values = this.fields.map((field) => this.readField(row, field, 0));
    const last = this.lastTime();
    if (last === undefined || time > last) {
      this.ensureCapacity(this._length + 1);
      const index = this._length++;
      this.writeAt(index, time, values, row.color);
      return { kind: 'appended', index };
    }
    const existing = time === last ? this._length - 1 : this.indexOfTime(time);
    if (existing >= 0) {
      this.writeAt(existing, time, values, row.color);
      return { kind: 'replaced', index: existing };
    }
    const index = lowerBound(this._times, time, this._length);
    this.ensureCapacity(this._length + 1);
    this._times.copyWithin(index + 1, index, this._length);
    for (const column of this._columns) column.copyWithin(index + 1, index, this._length);
    if (this._colors) this._colors.splice(index, 0, undefined);
    this._length++;
    this.writeAt(index, time, values, row.color);
    return { kind: 'inserted', index };
  }

  /** Materialises row `index` as a plain object (allocates; not for hot paths). */
  rowAt(index: number): ({ time: number; color?: string } & Record<F, number>) | undefined {
    if (index < 0 || index >= this._length) return undefined;
    const row: Record<string, number | string> = { time: this._times[index]! };
    for (let f = 0; f < this.fields.length; f++) {
      const value = this._columns[f]![index]!;
      if (!Number.isNaN(value)) row[this.fields[f]!] = value;
    }
    const color = this._colors?.[index];
    if (color !== undefined) row['color'] = color;
    return row as { time: number; color?: string } & Record<F, number>;
  }

  clear(): void {
    this._length = 0;
    this._colors = null;
  }

  private writeAt(index: number, time: number, values: number[], color: string | undefined): void {
    this._times[index] = time;
    for (let f = 0; f < values.length; f++) this._columns[f]![index] = values[f]!;
    if (color !== undefined || this._colors) {
      this._colors ??= new Array<string | undefined>(this._length);
      if (this._colors.length < this._length) this._colors.length = this._length;
      this._colors[index] = color;
    }
  }

  private ensureCapacity(required: number): void {
    if (required <= this._times.length) return;
    const capacity = Math.max(required, this._times.length * 2);
    const grow = (source: Float64Array): Float64Array => {
      const next = new Float64Array(capacity);
      next.set(source.subarray(0, this._length));
      return next;
    };
    this._times = grow(this._times);
    for (let f = 0; f < this._columns.length; f++) this._columns[f] = grow(this._columns[f]!);
  }

  private validateTime(row: StoreRow<F>, index: number): number {
    if (row === null || typeof row !== 'object') {
      throw new ChartError(
        `row ${index} must be an object, got ${row === null ? 'null' : typeof row}`,
      );
    }
    const time = row.time;
    if (!isFiniteNumber(time)) {
      throw new ChartError(
        `row ${index} has an invalid time (${String(time)}); expected UTC milliseconds`,
      );
    }
    return time;
  }

  private readField(row: StoreRow<F>, field: F, index: number): number {
    const value = row[field] as unknown;
    if ((value === undefined || value === null) && this.optional.has(field)) return Number.NaN;
    if (!isFiniteNumber(value)) {
      throw new ChartError(
        `row ${index} has an invalid "${field}" (${String(value)}); expected a finite number`,
      );
    }
    return value;
  }
}
