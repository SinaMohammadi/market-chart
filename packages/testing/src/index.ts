/**
 * `@market-chart/testing` — deterministic **synthetic** market data for demos, tests and benchmarks.
 * None of the generated data is real or exchange-verified.
 */
export { createRandom, gaussian } from './random.js';
export {
  DAY,
  HOUR,
  MINUTE,
  TickSimulator,
  barsToLine,
  barsToVolume,
  generateAsset,
  generateBars,
  syntheticAssets,
} from './synthetic.js';
export type { RandomWalkOptions, SyntheticAsset } from './synthetic.js';
export {
  clearDrawnTexts,
  createFakeContext,
  drawnTexts,
  installCanvasMock,
} from './canvas-mock.js';
export type { DrawnText } from './canvas-mock.js';
export { generateOrderBooks, generateTrades } from './orderflow.js';
export type { SyntheticOrderBook, SyntheticTrade } from './orderflow.js';
