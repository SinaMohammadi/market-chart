import { parseJson, validateWorkspace, WORKSPACE_VERSION } from './schema.js';
import type {
  ChartLayoutMetadata,
  SerializedChartState,
  Watchlist,
  WorkspaceState,
  WorkspaceStorageAdapter,
} from './types.js';
import { PersistenceError } from './types.js';

export interface WorkspaceStoreOptions {
  readonly now?: () => number;
  readonly idFactory?: () => string;
}

let workspaceCounter = 0;

/** Several named workspaces (layout, charts, watchlists, preferences) in one storage adapter. */
export class WorkspaceStore {
  private readonly now: () => number;
  private readonly makeId: () => string;

  constructor(
    private readonly storage: WorkspaceStorageAdapter,
    options: WorkspaceStoreOptions = {},
  ) {
    this.now = options.now ?? (() => Date.now());
    this.makeId =
      options.idFactory ??
      (() => `ws-${this.now().toString(36)}-${(++workspaceCounter).toString(36)}`);
  }

  list(): Promise<ChartLayoutMetadata[]> {
    return this.storage.list();
  }

  get(id: string): Promise<WorkspaceState | null> {
    return this.storage.load(id);
  }

  async create(
    name: string,
    partial: Partial<Omit<WorkspaceState, 'version' | 'revision' | 'savedAt' | 'id' | 'name'>> = {},
  ): Promise<WorkspaceState> {
    const workspace = validateWorkspace({
      version: WORKSPACE_VERSION,
      revision: 1,
      savedAt: this.now(),
      id: this.makeId(),
      name,
      layout: '1',
      charts: [],
      activeChart: 0,
      watchlists: [],
      preferences: {},
      ...partial,
    });
    await this.storage.save(workspace.id, workspace);
    return workspace;
  }

  /** Saves the next revision (conflicts propagate as `StorageConflictError`). */
  async save(workspace: WorkspaceState): Promise<WorkspaceState> {
    const next = validateWorkspace({
      ...workspace,
      revision: workspace.revision + 1,
      savedAt: this.now(),
    });
    await this.storage.save(next.id, next);
    return next;
  }

  async rename(id: string, name: string): Promise<WorkspaceState> {
    return this.save({ ...(await this.require(id)), name });
  }

  async duplicate(id: string, name?: string): Promise<WorkspaceState> {
    const source = await this.require(id);
    const { id: _id, revision: _r, savedAt: _s, version: _v, name: sourceName, ...rest } = source;
    return this.create(name ?? `${sourceName} (copy)`, rest);
  }

  delete(id: string): Promise<void> {
    return this.storage.delete(id);
  }

  async exportJson(id: string): Promise<string> {
    return JSON.stringify(await this.require(id), null, 2);
  }

  /** Imports exported JSON as a new workspace (fresh id and revision); everything is validated. */
  async importJson(text: string): Promise<WorkspaceState> {
    const parsed = validateWorkspace(parseJson(text));
    const { id: _id, revision: _r, savedAt: _s, version: _v, name, ...rest } = parsed;
    return this.create(name, rest);
  }

  private async require(id: string): Promise<WorkspaceState> {
    const workspace = await this.storage.load(id);
    if (!workspace) throw new PersistenceError(`workspace "${id}" not found`);
    return workspace;
  }
}

/** Returns a copy of `workspace` with the watchlist added or replaced (by id). */
export function upsertWatchlist(workspace: WorkspaceState, watchlist: Watchlist): WorkspaceState {
  const others = workspace.watchlists.filter((w) => w.id !== watchlist.id);
  return validateWorkspace({ ...workspace, watchlists: [...others, watchlist] });
}

export function removeWatchlist(workspace: WorkspaceState, id: string): WorkspaceState {
  return { ...workspace, watchlists: workspace.watchlists.filter((w) => w.id !== id) };
}

/** Returns a copy with chart `index` replaced (or appended). */
export function setWorkspaceChart(
  workspace: WorkspaceState,
  index: number,
  chart: SerializedChartState,
): WorkspaceState {
  const charts = [...workspace.charts];
  charts[Math.min(index, charts.length)] = chart;
  return validateWorkspace({ ...workspace, charts });
}
