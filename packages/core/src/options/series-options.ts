import type { PriceFormat } from '../format/price-format.js';
import type { SeriesType } from '../model/types.js';
import type { ChartTheme } from '../theme/themes.js';
import type { DeepPartial } from '../utils/merge.js';
import type { LineStyle } from './chart-options.js';

export interface BaseSeriesOptions {
  /** Shown in legends and events. */
  title: string;
  visible: boolean;
  /** Pane index; panes are created on demand. */
  pane: number;
  /** `'right'` is the pane's visible axis; any other id creates an overlay scale without an axis. */
  priceScaleId: string;
  priceFormat: PriceFormat;
  /** Label with the latest value on the price axis. */
  lastValueVisible: boolean;
  /** Horizontal line at the latest value. */
  priceLineVisible: boolean;
  /** `null` uses the series colour. */
  priceLineColor: string | null;
  priceLineWidth: number;
  priceLineStyle: LineStyle;
  /** Include this series when auto-scaling its price scale. */
  autoscale: boolean;
}

export interface CandlestickSeriesOptions extends BaseSeriesOptions {
  upColor: string;
  downColor: string;
  wickVisible: boolean;
  borderVisible: boolean;
  /** `null` uses the body colour. */
  wickUpColor: string | null;
  wickDownColor: string | null;
  borderUpColor: string | null;
  borderDownColor: string | null;
}

export interface BarSeriesOptions extends BaseSeriesOptions {
  upColor: string;
  downColor: string;
  openVisible: boolean;
  thinBars: boolean;
}

export type LineType = 'simple' | 'step';

export interface LineSeriesOptions extends BaseSeriesOptions {
  color: string;
  lineWidth: number;
  lineStyle: LineStyle;
  lineType: LineType;
  /** Draw the connecting line. Turn off together with `pointMarkersVisible` for a dot plot (e.g. Parabolic SAR). */
  lineVisible: boolean;
  /** Draw a dot at every point. */
  pointMarkersVisible: boolean;
  /** Dot radius in CSS px; `null` derives it from the line width. */
  pointMarkersRadius: number | null;
}

export interface AreaSeriesOptions extends BaseSeriesOptions {
  lineColor: string;
  topColor: string;
  bottomColor: string;
  lineWidth: number;
  lineStyle: LineStyle;
  lineType: LineType;
}

export interface BaselineSeriesOptions extends BaseSeriesOptions {
  /** Price separating the top and bottom areas. */
  baseValue: number;
  topLineColor: string;
  topFillColor: string;
  bottomLineColor: string;
  bottomFillColor: string;
  lineWidth: number;
  lineStyle: LineStyle;
}

export interface HistogramSeriesOptions extends BaseSeriesOptions {
  color: string;
  /** Value the columns grow from. */
  base: number;
}

/** Options of a plugin-defined series. `params` carries renderer-specific settings (plain JSON). */
export interface CustomSeriesOptions extends BaseSeriesOptions {
  color: string;
  upColor: string;
  downColor: string;
  params: Readonly<Record<string, unknown>>;
}

export interface SeriesOptionsMap {
  candlestick: CandlestickSeriesOptions;
  bar: BarSeriesOptions;
  line: LineSeriesOptions;
  area: AreaSeriesOptions;
  baseline: BaselineSeriesOptions;
  histogram: HistogramSeriesOptions;
  custom: CustomSeriesOptions;
}

export type SeriesOptions<T extends SeriesType> = SeriesOptionsMap[T];
export type SeriesOptionsInput<T extends SeriesType> = DeepPartial<SeriesOptionsMap[T]>;

const baseDefaults: BaseSeriesOptions = {
  title: '',
  visible: true,
  pane: 0,
  priceScaleId: 'right',
  priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
  lastValueVisible: true,
  priceLineVisible: true,
  priceLineColor: null,
  priceLineWidth: 1,
  priceLineStyle: 'dashed',
  autoscale: true,
};

/** Default options for a series type, with colours taken from the theme. */
export function defaultSeriesOptions<T extends SeriesType>(
  type: T,
  theme: ChartTheme,
): SeriesOptions<T> {
  const map: { [K in SeriesType]: () => SeriesOptionsMap[K] } = {
    candlestick: () => ({
      ...baseDefaults,
      upColor: theme.upColor,
      downColor: theme.downColor,
      wickVisible: true,
      borderVisible: true,
      wickUpColor: null,
      wickDownColor: null,
      borderUpColor: null,
      borderDownColor: null,
    }),
    bar: () => ({
      ...baseDefaults,
      upColor: theme.upColor,
      downColor: theme.downColor,
      openVisible: true,
      thinBars: true,
    }),
    line: () => ({
      ...baseDefaults,
      color: theme.lineColor,
      lineWidth: 2,
      lineStyle: 'solid',
      lineType: 'simple',
      lineVisible: true,
      pointMarkersVisible: false,
      pointMarkersRadius: null,
    }),
    area: () => ({
      ...baseDefaults,
      lineColor: theme.lineColor,
      topColor: theme.areaTopColor,
      bottomColor: theme.areaBottomColor,
      lineWidth: 2,
      lineStyle: 'solid',
      lineType: 'simple',
    }),
    baseline: () => ({
      ...baseDefaults,
      baseValue: 0,
      topLineColor: theme.baselineTopLineColor,
      topFillColor: theme.baselineTopFillColor,
      bottomLineColor: theme.baselineBottomLineColor,
      bottomFillColor: theme.baselineBottomFillColor,
      lineWidth: 2,
      lineStyle: 'solid',
    }),
    histogram: () => ({
      ...baseDefaults,
      color: theme.histogramColor,
      base: 0,
      priceLineVisible: false,
    }),
    custom: () => ({
      ...baseDefaults,
      color: theme.lineColor,
      upColor: theme.upColor,
      downColor: theme.downColor,
      params: {},
    }),
  };
  const factory = map[type] as (() => SeriesOptions<T>) | undefined;
  if (!factory) throw new Error(`[market-chart] unknown series type "${String(type)}"`);
  return factory();
}
