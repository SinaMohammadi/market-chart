/**
 * `@market-chart/drawing-tools` — interactive drawings for `@market-chart/core`.
 */
export type {
  Anchor,
  Drawing,
  DrawingDataAccess,
  DrawingStyle,
  DrawingToolCategory,
  DrawingToolDefinition,
  DrawingView,
  DrawState,
  LevelStyle,
  Point,
} from './types.js';
export { DrawingError, defineTool } from './types.js';
export { DrawingManager, MAX_LOADED_DRAWINGS, getDrawingManager } from './manager.js';
export type {
  DrawingInput,
  DrawingManagerEvents,
  DrawingManagerOptions,
  DrawingPatch,
  MagnetMode,
} from './manager.js';
export { DrawingToolRegistry, createDefaultToolRegistry } from './registry.js';
export { DRAWINGS_SCHEMA_VERSION, migrateSnapshot, validateDrawing } from './serialization.js';
export type { DrawingsSnapshot } from './serialization.js';
export { DrawingHistory } from './history.js';
export type { DrawingChange } from './history.js';
export { baseStyle, resolveStyle, sanitizeStyle } from './style.js';
export * as geometry from './geometry.js';
export * as render from './render.js';
export { builtInTools } from './tools/index.js';
export * as tools from './tools/index.js';
export { linearRegression } from './tools/patterns.js';
