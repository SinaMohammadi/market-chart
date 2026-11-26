/**
 * Timestamps are UTC milliseconds since the Unix epoch (the unit of `Date.now()`).
 */
export type Time = number;

export interface OhlcBar {
  readonly time: Time;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume?: number;
  /** Optional per-bar colour override (body / bar colour). */
  readonly color?: string;
}

export interface LinePoint {
  readonly time: Time;
  readonly value: number;
  /** Optional per-point colour override. Used by histogram; ignored by line/area/baseline. */
  readonly color?: string;
}

export type HistogramPoint = LinePoint;

/**
 * A time without a value. Value-based series (line, area, baseline, histogram) accept it to create a gap:
 * lines break, areas close, histograms skip the bar. The time still takes a slot on the time axis.
 */
export interface WhitespacePoint {
  readonly time: Time;
}

/** Data shape accepted by each series type. Keys are the series type discriminator. */
export interface SeriesDataMap {
  candlestick: OhlcBar;
  bar: OhlcBar;
  line: LinePoint | WhitespacePoint;
  area: LinePoint | WhitespacePoint;
  baseline: LinePoint | WhitespacePoint;
  histogram: HistogramPoint | WhitespacePoint;
  /** Plugin-defined chart type (see `ChartApi.addCustomSeries`): OHLC or value data, depending on its view. */
  custom: OhlcBar | LinePoint | WhitespacePoint;
}

/** True when `point` carries a value (is not whitespace). */
export function hasValue(point: LinePoint | WhitespacePoint): point is LinePoint {
  return (
    typeof (point as LinePoint).value === 'number' && Number.isFinite((point as LinePoint).value)
  );
}

export type SeriesType = keyof SeriesDataMap;
export type SeriesData<T extends SeriesType> = SeriesDataMap[T];

/** Inclusive range of logical bar indices. Fractional values are allowed. */
export interface LogicalRange {
  readonly from: number;
  readonly to: number;
}

export interface TimeRange {
  readonly from: Time;
  readonly to: Time;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type Unsubscribe = () => void;

/** Column input for `SeriesApi.setColumns`: typed arrays or plain number arrays of equal length. */
export interface SeriesColumnsInput {
  /** UTC ms, strictly increasing. */
  readonly times: ArrayLike<number>;
  /** One array per field (`open`/`high`/`low`/`close`/`volume` or `value`). NaN or a missing optional field = no value. */
  readonly fields: Readonly<Record<string, ArrayLike<number> | undefined>>;
  /** Optional per-point colours (series types that support them). */
  readonly colors?: ArrayLike<string | undefined | null>;
}
