/**
 * `@market-chart/charts` — advanced chart types, profiles and order flow for `@market-chart/core`.
 * Transforms and computations are pure functions; renderers plug into `chart.addCustomSeries`.
 */
export type { FootprintBar, FootprintLevel, OrderBookSnapshot, PriceTick, Trade } from './types.js';
export { ChartsError } from './types.js';
export {
  averageTrueRange,
  heikinAshi,
  kagi,
  lineBreak,
  pointAndFigure,
  rangeBars,
  renko,
  spread,
  tickBars,
} from './transforms.js';
export type {
  BoxSize,
  KagiColumn,
  KagiOptions,
  PointFigureColumn,
  PointFigureOptions,
  RenkoOptions,
} from './transforms.js';
export {
  addFootprintSeries,
  addHeatmapSeries,
  addHollowCandleSeries,
  addKagiSeries,
  addPointFigureSeries,
  addVolumeCandleSeries,
  footprintView,
  heatColor,
  heatmapEnvelope,
  heatmapView,
  hollowCandlesView,
  kagiEnvelope,
  kagiView,
  pointFigureEnvelope,
  pointFigureView,
  volumeCandlesView,
} from './renderers.js';
export type {
  DerivedSeries,
  FootprintView,
  HeatmapView,
  KagiView,
  PointFigureView,
} from './renderers.js';
export { computeMarketProfile, computeVolumeProfile, sessions, valueArea } from './profiles.js';
export type {
  MarketProfileOptions,
  ProfileRow,
  TpoRow,
  TpoSession,
  VolumeProfile,
  VolumeProfileOptions,
} from './profiles.js';
export { addMarketProfile, addVolumeProfile } from './profile-layers.js';
export type {
  MarketProfileLayerOptions,
  ProfileHandle,
  VolumeProfileLayerOptions,
} from './profile-layers.js';
export { aggregateFootprint, cumulativeVolumeDelta, deltaHistogram } from './orderflow.js';
export type { FootprintOptions } from './orderflow.js';
