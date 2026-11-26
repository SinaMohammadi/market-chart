/**
 * `@market-chart/core` — framework-independent financial charting engine.
 *
 * Importing this module has no side effects and touches no browser globals;
 * the DOM is only used once `createChart()` is called.
 */
export { createChart } from './chart/chart.js';
export type {
  ChartApi,
  ChartEventMap,
  ChartEventName,
  ContextMenuEvent,
  ContextMenuSeriesHit,
  CrosshairMoveEvent,
  DataChangedEvent,
  DataUpdateKind,
  PaneApi,
  PriceScaleApi,
  SeriesApi,
  SeriesColumns,
  TimeScaleApi,
  VisibleRangeChangeEvent,
} from './chart/api.js';

export { hasValue } from './model/types.js';
export type {
  HistogramPoint,
  WhitespacePoint,
  LinePoint,
  LogicalRange,
  OhlcBar,
  Point,
  Rect,
  SeriesColumnsInput,
  SeriesData,
  SeriesDataMap,
  SeriesType,
  Size,
  Time,
  TimeRange,
  Unsubscribe,
} from './model/types.js';

export { defaultChartOptions } from './options/chart-options.js';
export type {
  ChartFormatters,
  ChartOptions,
  ChartOptionsInput,
  CrosshairLineOptions,
  CrosshairMode,
  GridLineOptions,
  InteractionOptions,
  LineStyle,
} from './options/chart-options.js';
export { defaultSeriesOptions } from './options/series-options.js';
export type {
  AreaSeriesOptions,
  BarSeriesOptions,
  BaselineSeriesOptions,
  BaseSeriesOptions,
  CandlestickSeriesOptions,
  CustomSeriesOptions,
  HistogramSeriesOptions,
  LineSeriesOptions,
  LineType,
  SeriesOptions,
  SeriesOptionsInput,
  SeriesOptionsMap,
} from './options/series-options.js';
export { seriesTypes } from './series/definitions.js';
export { defaultPriceLineOptions } from './series/price-line.js';
export type { PriceLineApi, PriceLineOptions } from './series/price-line.js';

export { defaultPriceScaleOptions } from './scales/price-scale.js';
export type { PriceScaleMode, PriceScaleOptions, ScaleMargins } from './scales/price-scale.js';
export { defaultTimeScaleOptions } from './scales/time-scale.js';
export type { TimeScaleOptions } from './scales/time-scale.js';

export { builtInThemes, createTheme, darkTheme, lightTheme, resolveTheme } from './theme/themes.js';
export type { BuiltInThemeName, ChartTheme, ThemeInput } from './theme/themes.js';

export {
  createPriceFormatter,
  priceTickSize,
  roundToTick,
  safePrecision,
} from './format/price-format.js';
export { safeText } from './utils/text.js';
export { axisLocale, createDigitLocalizer } from './format/localize.js';
export type { PriceFormat, PriceFormatterFn } from './format/price-format.js';
export type { TimeZone } from './time/zoned-clock.js';

export type {
  ChartInputHandler,
  ChartKeyEvent,
  ChartPointerEvent,
  ChartRegion,
} from './interaction/input-handler.js';
export type {
  ChartPlugin,
  ChartPluginContext,
  PaneLayer,
  PaneLayerCoordinates,
  PaneLayerDrawContext,
  PaneLayerZOrder,
} from './plugins/plugin.js';

export { layoutLabels } from './render/label-layout.js';
export { EventEmitter } from './events/emitter.js';
export { CORE_VERSION, satisfiesVersion } from './version.js';
export { createChartSync } from './sync/chart-sync.js';
export type { ChartSync, ChartSyncOptions } from './sync/chart-sync.js';
export type {
  CustomSeriesData,
  CustomSeriesPaintContext,
  CustomSeriesView,
} from './series/custom.js';
export { ChartError } from './utils/errors.js';
export {
  ResponseTooLargeError,
  buildUrl,
  readJsonLimited,
  readTextLimited,
  redactUrl,
} from './utils/net.js';
export type { ResponseLike, UrlParamValue } from './utils/net.js';
export type { DeepPartial } from './utils/merge.js';
