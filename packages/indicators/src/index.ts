/**
 * `@market-chart/indicators` — incremental technical indicator engine.
 *
 * - Calculators are framework-free and chart-free (`computeIndicator`, `IndicatorRunner`).
 * - `IndicatorManager` plots them on a chart and keeps them in sync with the source series.
 * - Custom indicators: `defineIndicator({...})` + `registry.register(...)`.
 */
export type {
  Bar,
  FillSpec,
  HistogramColorMode,
  IndicatorCalculator,
  IndicatorCategory,
  IndicatorDefinition,
  InputSchema,
  InputSpec,
  LevelSpec,
  OutputKind,
  OutputSpec,
  ParamValue,
  Params,
  PriceSource,
} from './types.js';
export { IndicatorError, PRICE_SOURCES, calc, defineIndicator } from './types.js';
export { defaultParams, indicatorLabel, resolveParams } from './params.js';
export { IndicatorRunner, computeIndicator } from './runner.js';
export type { IndicatorResult } from './runner.js';
export { IndicatorRegistry, validateDefinition } from './registry.js';
export { createDefaultRegistry } from './builtins.js';
export { builtInIndicators } from './definitions/index.js';
export * as indicators from './definitions/index.js';
export {
  AtrState,
  Ema,
  Lag,
  MA_TYPES,
  MeanDeviation,
  Rma,
  RollingExtreme,
  RollingSum,
  RsiState,
  Sma,
  StdDev,
  Wma,
  createMa,
} from './primitives.js';
export type { MaType, Smoother } from './primitives.js';
export { price, trueRange, volumeOf } from './source.js';
export { cloneState } from './clone.js';
export {
  IndicatorManager,
  MAX_RESTORED_INDICATORS,
  getIndicatorManager,
} from './chart/indicator-manager.js';
export type {
  AddIndicatorOptions,
  IndicatorConfig,
  IndicatorHandle,
  IndicatorManagerEvents,
  IndicatorStyle,
  OutputStyle,
} from './chart/indicator-manager.js';
