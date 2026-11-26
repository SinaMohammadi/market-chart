/** Saved state of one chart. Plain JSON; validated whenever it is read. */
export interface SerializedChartState {
  readonly version: number;
  /** Incremented on every successful save; used to detect concurrent edits. */
  readonly revision: number;
  readonly savedAt: number;
  readonly name?: string;
  readonly symbol?: string;
  readonly interval?: string;
  /** Chart options (theme, scales, crosshair, grid, localization…). Re-validated by the chart when applied. */
  readonly options?: Readonly<Record<string, unknown>>;
  /** Visible time range (UTC ms). */
  readonly view?: { readonly from: number; readonly to: number } | null;
  /** State of registered providers, by key (e.g. `indicators`, `drawings`). */
  readonly extensions: Readonly<Record<string, unknown>>;
}

export interface Watchlist {
  readonly id: string;
  readonly name: string;
  readonly symbols: readonly string[];
}

/** A named set of charts with their layout, watchlists and preferences. */
export interface WorkspaceState {
  readonly version: number;
  readonly revision: number;
  readonly savedAt: number;
  readonly id: string;
  readonly name: string;
  /** Layout preset (`'1'`, `'2h'`, `'4'`…) or a custom grid. */
  readonly layout:
    | string
    | { readonly columns: number; readonly rows: number; readonly areas?: readonly string[] };
  readonly charts: readonly SerializedChartState[];
  readonly activeChart: number;
  readonly watchlists: readonly Watchlist[];
  readonly preferences: Readonly<Record<string, unknown>>;
}

export interface ChartLayoutMetadata {
  readonly id: string;
  readonly name: string;
  readonly updatedAt: number;
  readonly revision: number;
}

/** Anything persisted carries a revision and an optional name. */
export interface Versioned {
  readonly revision: number;
  readonly savedAt: number;
  readonly name?: string;
}

/**
 * Storage backend. `save` must reject with `StorageConflictError` when the stored revision is not older than
 * the one being saved (somebody else saved in between).
 */
export interface StorageAdapter<T extends Versioned> {
  save(id: string, state: T): Promise<void>;
  load(id: string): Promise<T | null>;
  delete(id: string): Promise<void>;
  list(): Promise<ChartLayoutMetadata[]>;
}

export type ChartStorageAdapter = StorageAdapter<SerializedChartState>;
export type WorkspaceStorageAdapter = StorageAdapter<WorkspaceState>;

export class PersistenceError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(`[market-chart/persistence] ${message}`);
    this.name = 'PersistenceError';
  }
}

/** Raised by `save` when the stored state is newer than expected. Carries the stored state. */
export class StorageConflictError<T = unknown> extends PersistenceError {
  constructor(readonly remote: T | null) {
    super('the stored state changed since it was loaded (revision conflict)');
    this.name = 'StorageConflictError';
  }
}

/** Raised when the browser storage quota is exceeded. */
export class StorageQuotaError extends PersistenceError {
  constructor(cause?: unknown) {
    super('storage quota exceeded', cause);
    this.name = 'StorageQuotaError';
  }
}
