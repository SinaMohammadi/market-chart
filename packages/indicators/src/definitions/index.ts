import type { IndicatorDefinition } from '../types.js';
import { advancedIndicators } from './advanced.js';
import { momentumIndicators } from './momentum.js';
import { trendIndicators } from './trend.js';
import { volatilityIndicators } from './volatility.js';
import { volumeIndicators } from './volume.js';

export * from './advanced.js';
export * from './momentum.js';
export * from './trend.js';
export * from './volatility.js';
export * from './volume.js';

/** Every built-in definition, in display order. */
export const builtInIndicators: readonly IndicatorDefinition[] = [
  ...trendIndicators,
  ...momentumIndicators,
  ...volatilityIndicators,
  ...volumeIndicators,
  ...advancedIndicators,
] as unknown as readonly IndicatorDefinition[];
