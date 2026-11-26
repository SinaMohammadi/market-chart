/**
 * `@market-chart/react/ssr` — server-safe entry. Imports only `react` and `@market-chart/core/static`;
 * never the interactive engine or browser APIs.
 */
export { StaticChart } from './static-chart.js';
export type {
  StaticCandleChartProps,
  StaticChartProps,
  StaticLineChartProps,
} from './static-chart.js';
