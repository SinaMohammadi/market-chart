/**
 * `@market-chart/persistence` — chart and workspace persistence. Nothing here touches browser storage at
 * import time; adapters resolve `localStorage`, `indexedDB`, `fetch`… when first used.
 */
export type {
  ChartLayoutMetadata,
  ChartStorageAdapter,
  SerializedChartState,
  StorageAdapter,
  Versioned,
  Watchlist,
  WorkspaceState,
  WorkspaceStorageAdapter,
} from './types.js';
export { PersistenceError, StorageConflictError, StorageQuotaError } from './types.js';
export {
  CHART_STATE_VERSION,
  MAX_JSON_BYTES,
  WORKSPACE_VERSION,
  parseJson,
  sanitizeJson,
  validateChartState,
  validateLayoutMetadata,
  validateWorkspace,
} from './schema.js';
export {
  createIndexedDbStorage,
  createLocalStorage,
  createMemoryStorage,
  createRestStorage,
  createSessionStorage,
  createWebStorage,
} from './adapters.js';
export type {
  AdapterOptions,
  IndexedDbOptions,
  RestStorageOptions,
  WebStorageLike,
  WebStorageOptions,
} from './adapters.js';
export { ChartPersistence } from './chart-persistence.js';
export type {
  ChannelLike,
  ChartPersistenceEvents,
  ChartPersistenceOptions,
  ConflictStrategy,
  PersistenceTimers,
  SaveStatus,
  StateProvider,
} from './chart-persistence.js';
export {
  defaultSeriesResolver,
  drawingsProvider,
  indicatorsProvider,
  valueProvider,
} from './providers.js';
export type { DrawingManagerLike, IndicatorManagerLike } from './providers.js';
export {
  WorkspaceStore,
  removeWatchlist,
  setWorkspaceChart,
  upsertWatchlist,
} from './workspaces.js';
export type { WorkspaceStoreOptions } from './workspaces.js';
