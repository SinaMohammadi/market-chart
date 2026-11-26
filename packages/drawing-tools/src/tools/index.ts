import type { DrawingToolDefinition } from '../types.js';
import { annotationTools } from './annotations.js';
import { fibonacciTools } from './fibonacci.js';
import { gannTools } from './gann.js';
import { lineTools } from './lines.js';
import { measureTools } from './measure.js';
import { patternTools } from './patterns.js';
import { shapeTools } from './shapes.js';

export * from './annotations.js';
export * from './fibonacci.js';
export * from './gann.js';
export * from './lines.js';
export * from './measure.js';
export * from './patterns.js';
export * from './shapes.js';
export { formatDuration } from './common.js';

/** All built-in tools in toolbar order. */
export const builtInTools: readonly DrawingToolDefinition[] = [
  ...lineTools,
  ...shapeTools,
  ...annotationTools,
  ...measureTools,
  ...fibonacciTools,
  ...gannTools,
  ...patternTools,
] as readonly DrawingToolDefinition[];
