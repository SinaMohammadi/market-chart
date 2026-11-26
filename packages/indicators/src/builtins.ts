import { builtInIndicators } from './definitions/index.js';
import { IndicatorRegistry } from './registry.js';

/** A new registry containing every built-in indicator. Add custom ones with `register()`. */
export function createDefaultRegistry(): IndicatorRegistry {
  const registry = new IndicatorRegistry();
  for (const definition of builtInIndicators) registry.register(definition);
  return registry;
}
