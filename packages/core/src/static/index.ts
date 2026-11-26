/**
 * `@market-chart/core/static` — DOM-free helpers safe for server rendering.
 * Must never import the interactive engine.
 */
export { lineGeometry, candleGeometry, valueRange, downsampleLine } from './geometry.js';
export type {
  CandleGeometry,
  LineGeometry,
  StaticPadding,
  StaticViewport,
  ValueRange,
} from './geometry.js';
export type { LinePoint, OhlcBar, Time } from '../model/types.js';
export { createPriceFormatter } from '../format/price-format.js';
export type { PriceFormat, PriceFormatterFn } from '../format/price-format.js';
export { darkTheme, lightTheme, resolveTheme } from '../theme/themes.js';
export type { ChartTheme, ThemeInput } from '../theme/themes.js';
