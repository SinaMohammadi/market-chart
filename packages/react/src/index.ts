/**
 * `@market-chart/react` — React bindings for `@market-chart/core`.
 *
 * This entry is a client module (the build adds `"use client"`). For server-rendered,
 * non-interactive charts import `StaticChart` from `@market-chart/react/ssr`.
 */
export { Chart } from './chart.js';
export type {
  ChartDataConnection,
  ChartDataRequest,
  ChartDataSource,
  ChartProps,
} from './chart.js';
export { ChartProvider } from './provider.js';
export { I18nContext, useDirection, useI18n, useLocale, useTranslation } from './i18n.js';
export type { TranslationApi } from './i18n.js';
export { ProgressiveChart } from './progressive-chart.js';
export type { ProgressiveActivation, ProgressiveChartProps } from './progressive-chart.js';
export { ChartLayout, layoutCellCount, layoutPresets, useLayoutCell } from './layout.js';
export type { ChartLayoutProps, LayoutCellState, LayoutGrid, LayoutPreset } from './layout.js';
export type { ChartProviderProps } from './provider.js';
export {
  AreaSeries,
  BarSeries,
  BaselineSeries,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  Series,
  useSeries,
} from './series.js';
export type { SeriesProps } from './series.js';
export { useChart, useChartEvent, useChartState, useCrosshair } from './hooks.js';
export type { ChartViewState } from './hooks.js';
export { applySeriesData } from './data-diff.js';

export type {
  ChartApi,
  ChartEventMap,
  ChartEventName,
  ChartFormatters,
  ChartOptions,
  ChartOptionsInput,
  ChartPlugin,
  ChartTheme,
  CrosshairMoveEvent,
  LinePoint,
  OhlcBar,
  SeriesApi,
  SeriesData,
  SeriesOptionsInput,
  SeriesType,
  ThemeInput,
  VisibleRangeChangeEvent,
} from '@market-chart/core';
