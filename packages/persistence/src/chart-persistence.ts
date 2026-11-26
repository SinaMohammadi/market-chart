import { EventEmitter } from '@market-chart/core';
import type { ChartApi, ChartOptions, SeriesApi, Unsubscribe } from '@market-chart/core';
import { CHART_STATE_VERSION, parseJson, sanitizeJson, validateChartState } from './schema.js';
import type { ChartStorageAdapter, SerializedChartState } from './types.js';
import { PersistenceError, StorageConflictError } from './types.js';

/** Captures and restores one part of the state (indicators, drawings, app data…). */
export interface StateProvider {
  capture(): unknown;
  restore(data: unknown): void | Promise<void>;
  /** Notifies of changes, so autosave can run. */
  subscribe?(onChange: () => void): Unsubscribe;
}

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict';

/**
 * What to do when the stored state changed since it was loaded:
 * `overwrite` saves anyway, `reload` discards local changes and applies the stored state, `fail` stops and
 * reports (`conflict` status), or a function that merges both into the state to save.
 */
export type ConflictStrategy =
  | 'overwrite'
  | 'reload'
  | 'fail'
  | ((local: SerializedChartState, remote: SerializedChartState) => SerializedChartState);

export interface PersistenceTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** BroadcastChannel surface (injectable for tests). */
export interface ChannelLike {
  postMessage(message: unknown): void;
  close(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
}

export interface ChartPersistenceOptions {
  readonly chart: ChartApi;
  readonly storage: ChartStorageAdapter;
  readonly id: string;
  readonly name?: string;
  /** Save automatically after changes (default true). */
  readonly autoSave?: boolean;
  /** Quiet period before an automatic save, in ms (default 1000). */
  readonly debounceMs?: number;
  readonly providers?: Readonly<Record<string, StateProvider>>;
  readonly conflict?: ConflictStrategy;
  /** Reload in other tabs after a save (default true where BroadcastChannel exists). */
  readonly crossTab?: boolean;
  readonly channel?: (name: string) => ChannelLike | null;
  /** Current symbol/interval to store (e.g. from a datafeed controller). */
  readonly getContext?: () => { symbol?: string; interval?: string };
  readonly timers?: PersistenceTimers;
  readonly now?: () => number;
}

export interface ChartPersistenceEvents {
  status: { readonly status: SaveStatus };
  saved: { readonly state: SerializedChartState };
  loaded: { readonly state: SerializedChartState };
  conflict: { readonly local: SerializedChartState; readonly remote: SerializedChartState | null };
  remoteChange: { readonly revision: number };
  error: { readonly error: unknown };
}

/** Chart option groups that are persisted (sizes and other host-specific settings are not). */
const OPTION_KEYS: readonly (keyof ChartOptions)[] = [
  'theme',
  'layout',
  'grid',
  'crosshair',
  'timeScale',
  'rightPriceScale',
  'leftPriceScale',
  'localization',
  'interaction',
];

let instances = 0;

/** JSON with object keys sorted, so equal states compare equal whatever order their keys were built in. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Content of a state without its revision metadata, for change detection. */
function comparable(state: SerializedChartState): string {
  const { revision: _r, savedAt: _s, ...rest } = state;
  return canonical(rest);
}

/**
 * Saves and restores a chart: options, visible range, symbol/interval and provider state (indicators,
 * drawings…). Autosave is debounced and skipped when nothing changed; status changes are reported as events;
 * concurrent edits are resolved by the conflict strategy; other tabs are told to reload after a save.
 * Nothing touches storage until `load()` or a save runs.
 */
export class ChartPersistence {
  readonly id: string;
  private readonly options: ChartPersistenceOptions;
  private readonly emitter = new EventEmitter<ChartPersistenceEvents>();
  private readonly timers: PersistenceTimers;
  private readonly offs: Unsubscribe[] = [];
  private readonly instanceId = `p${++instances}-${Math.random().toString(36).slice(2, 8)}`;
  private _status: SaveStatus = 'idle';
  private revision = 0;
  private lastSaved = '';
  private debounceHandle: unknown = null;
  private applying = false;
  private saving: Promise<void> | null = null;
  private channel: ChannelLike | null = null;
  private destroyed = false;
  private pendingView: Unsubscribe | null = null;

  constructor(options: ChartPersistenceOptions) {
    if (!options?.chart || !options.storage)
      throw new PersistenceError('chart and storage are required');
    if (typeof options.id !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(options.id))
      throw new PersistenceError('invalid id');
    this.id = options.id;
    this.options = options;
    this.timers = options.timers ?? {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    };
    const chart = options.chart;
    const dirty = (): void => this.markDirty();
    this.offs.push(
      chart.on('optionsChanged', dirty),
      chart.on('visibleRangeChange', dirty),
      chart.on('paneResize', dirty),
      chart.on('priceScaleChange', dirty),
      chart.on('destroy', () => this.destroy()),
    );
    for (const provider of Object.values(options.providers ?? {})) {
      const off = provider.subscribe?.(dirty);
      if (off) this.offs.push(off);
    }
    if (options.crossTab !== false) {
      const make =
        options.channel ??
        ((name: string): ChannelLike | null => {
          const BC = (globalThis as { BroadcastChannel?: new (name: string) => ChannelLike })
            .BroadcastChannel;
          return BC ? new BC(name) : null;
        });
      this.channel = make(`market-chart:${options.id}`);
      if (this.channel) this.channel.onmessage = (event) => this.onRemote(event.data);
    }
  }

  get status(): SaveStatus {
    return this._status;
  }

  get currentRevision(): number {
    return this.revision;
  }

  on<K extends keyof ChartPersistenceEvents>(
    event: K,
    listener: (payload: ChartPersistenceEvents[K]) => void,
  ): Unsubscribe {
    return this.emitter.on(event, listener);
  }

  /** Current state as plain JSON (not saved). */
  capture(): SerializedChartState {
    const chart = this.options.chart;
    const options = chart.options();
    const picked: Record<string, unknown> = {};
    for (const key of OPTION_KEYS) picked[key] = options[key];
    const extensions: Record<string, unknown> = {};
    for (const [key, provider] of Object.entries(this.options.providers ?? {})) {
      extensions[key] = sanitizeJson(provider.capture(), `extensions.${key}`);
    }
    const context = this.options.getContext?.() ?? {};
    const view = this.captureView();
    return {
      version: CHART_STATE_VERSION,
      revision: this.revision,
      savedAt: this.options.now?.() ?? Date.now(),
      ...(this.options.name !== undefined ? { name: this.options.name } : {}),
      ...(context.symbol !== undefined ? { symbol: context.symbol } : {}),
      ...(context.interval !== undefined ? { interval: context.interval } : {}),
      // Functions (formatters) and undefined values are not data: drop them instead of failing.
      options: sanitizeJson(JSON.parse(JSON.stringify(picked)) as unknown) as Record<
        string,
        unknown
      >,
      view,
      extensions,
    };
  }

  /**
   * Applies a (validated) state: chart options, provider state, then the visible range — immediately when
   * the chart has data, otherwise as soon as data arrives.
   */
  async apply(input: unknown): Promise<SerializedChartState> {
    const state = validateChartState(input);
    const chart = this.options.chart;
    this.applying = true;
    try {
      if (state.options) {
        // Only the persisted option groups: a stored or imported state must not set the chart's size,
        // `autoSize` or any other host setting (`width: 1e9` would try to allocate a gigantic canvas).
        const allowed: Record<string, unknown> = {};
        for (const key of OPTION_KEYS)
          if (Object.prototype.hasOwnProperty.call(state.options, key))
            allowed[key] = state.options[key];
        try {
          chart.applyOptions(allowed as never);
        } catch (error) {
          this.emitter.emit('error', {
            error: new PersistenceError('stored chart options were rejected', error),
          });
        }
      }
      for (const [key, provider] of Object.entries(this.options.providers ?? {})) {
        if (!(key in state.extensions)) continue;
        try {
          await provider.restore(state.extensions[key]);
        } catch (error) {
          this.emitter.emit('error', {
            error: new PersistenceError(`could not restore "${key}"`, error),
          });
        }
      }
      if (state.view) this.restoreView(state.view);
    } finally {
      this.applying = false;
    }
    return state;
  }

  /** Loads and applies the stored state. Resolves false when nothing is stored. */
  async load(): Promise<boolean> {
    this.assertAlive();
    try {
      const state = await this.options.storage.load(this.id);
      if (!state) {
        // Nothing stored yet: the current state is the baseline for change detection.
        this.lastSaved = comparable(this.capture());
        return false;
      }
      await this.apply(state);
      this.revision = state.revision;
      // The stored state is the baseline: indicators and the view may settle a frame later, and saving
      // the same content again would only bump the revision (and wake other tabs).
      this.lastSaved = comparable(state);
      this.cancelDebounce();
      this.setStatus('saved');
      this.emitter.emit('loaded', { state });
      return true;
    } catch (error) {
      this.setStatus('error');
      this.emitter.emit('error', { error });
      return false;
    }
  }

  /** Marks the state as changed; schedules an automatic save when enabled. */
  markDirty(): void {
    if (this.destroyed || this.applying) return;
    if (this._status !== 'conflict') this.setStatus('dirty');
    if (this.options.autoSave === false) return;
    this.cancelDebounce();
    this.debounceHandle = this.timers.setTimeout(() => {
      this.debounceHandle = null;
      void this.save();
    }, this.options.debounceMs ?? 1000);
  }

  /** Saves now (skipped when nothing changed since the last save/load). */
  async save(): Promise<void> {
    this.assertAlive();
    this.cancelDebounce();
    if (this.saving) await this.saving;
    this.saving = this.doSave();
    try {
      await this.saving;
    } finally {
      this.saving = null;
    }
  }

  /** Current state as pretty JSON, for download or sharing. */
  exportJson(): string {
    return JSON.stringify(this.capture(), null, 2);
  }

  /** Validates and applies JSON exported earlier, then saves it as the next revision. */
  async importJson(text: string): Promise<SerializedChartState> {
    const state = await this.apply(parseJson(text));
    this.markDirty();
    return state;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelDebounce();
    this.pendingView?.();
    this.pendingView = null;
    for (const off of this.offs.splice(0)) off();
    this.channel?.close();
    this.channel = null;
    this.emitter.clear();
  }

  private async doSave(): Promise<void> {
    let state = { ...this.capture(), revision: this.revision + 1 };
    if (comparable(state) === this.lastSaved && this._status !== 'conflict') {
      this.setStatus('saved');
      return;
    }
    this.setStatus('saving');
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.options.storage.save(this.id, state);
        this.revision = state.revision;
        this.lastSaved = comparable(state);
        this.setStatus('saved');
        this.emitter.emit('saved', { state });
        this.channel?.postMessage({
          type: 'saved',
          id: this.id,
          revision: state.revision,
          origin: this.instanceId,
        });
        return;
      } catch (error) {
        if (!(error instanceof StorageConflictError)) {
          this.setStatus('error');
          this.emitter.emit('error', { error });
          return;
        }
        const remote = error.remote ? validateChartState(error.remote) : null;
        const strategy = this.options.conflict ?? 'fail';
        if (strategy === 'fail' || !remote) {
          this.setStatus('conflict');
          this.emitter.emit('conflict', { local: state, remote });
          return;
        }
        if (strategy === 'reload') {
          await this.apply(remote);
          this.revision = remote.revision;
          this.lastSaved = comparable(remote);
          this.setStatus('saved');
          this.emitter.emit('loaded', { state: remote });
          return;
        }
        const base = strategy === 'overwrite' ? state : validateChartState(strategy(state, remote));
        state = { ...base, revision: remote.revision + 1 };
      }
    }
    this.setStatus('conflict');
  }

  private onRemote(message: unknown): void {
    // Any script of the origin can post on the channel: accept only the exact message shape.
    if (!message || typeof message !== 'object' || Array.isArray(message)) return;
    const m = message as { type?: unknown; id?: unknown; revision?: unknown; origin?: unknown };
    if (
      m.type !== 'saved' ||
      m.id !== this.id ||
      typeof m.origin !== 'string' ||
      m.origin === this.instanceId ||
      typeof m.revision !== 'number' ||
      !Number.isSafeInteger(m.revision) ||
      m.revision < 0
    )
      return;
    if (m.revision <= this.revision) return;
    this.emitter.emit('remoteChange', { revision: m.revision });
    // Keep real local edits (the next save resolves the conflict); events that changed nothing do not count.
    if (this._status === 'saving' || this._status === 'conflict') return;
    if (this._status === 'dirty' && comparable(this.capture()) !== this.lastSaved) return;
    void this.load();
  }

  /**
   * Exact view edges as times: the centres of the first and last fully requested bars, interpolated (and
   * extrapolated into the empty space right of the data). `getVisibleRange()` rounds outward to partially
   * visible bars, so saving it and restoring it would widen the view a little every time.
   */
  private captureView(): { from: number; to: number } | null {
    const ts = this.options.chart.timeScale();
    const logical = ts.getVisibleLogicalRange();
    if (!logical) return null;
    const a = ts.logicalToTime(logical.from + 0.5);
    const b = ts.logicalToTime(logical.to - 0.5);
    if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b)) return null;
    return { from: Math.round(Math.min(a, b)), to: Math.round(Math.max(a, b)) };
  }

  private restoreView(view: { from: number; to: number }): void {
    const chart = this.options.chart;
    /** The saved times as a logical range on the timeline as it is now (indices shift with new history). */
    const resolve = (): { from: number; to: number } | null => {
      const ts = chart.timeScale();
      const from = ts.timeToLogical(view.from);
      const to = ts.timeToLogical(view.to);
      return from === null || to === null ? null : { from: from - 0.5, to: to + 0.5 };
    };
    const apply = (): boolean => {
      if (!chart.series().some((s: SeriesApi) => s.length() > 0)) return false;
      const ts = chart.timeScale();
      const range = resolve();
      if (!range) return false;
      ts.setVisibleLogicalRange(range);
      // The first frame after new data can widen the price axis, which narrows the pane while keeping the
      // right edge — so the left edge drifts. Re-apply once on that frame (no user input can come in between).
      // Resolved again from the times: data inserted before that frame (a history page) shifts indices.
      const settle = chart.on('visibleRangeChange', (e) => {
        settle();
        const target = resolve();
        if (this.destroyed || !target) return;
        const drift = Math.abs(e.logical.from - target.from) + Math.abs(e.logical.to - target.to);
        if (drift > 1e-6) ts.setVisibleLogicalRange(target);
      });
      this.offs.push(settle);
      return true;
    };
    this.pendingView?.();
    this.pendingView = null;
    if (apply()) return;
    // Wait for data. The range is applied a microtask later so that code which loads data and then
    // positions the chart itself (e.g. `scrollToRealtime()` in a datafeed controller) does not override it.
    let scheduled = false;
    const off = chart.on('dataChanged', () => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        if (this.destroyed || this.pendingView !== off) return;
        if (apply()) {
          off();
          this.pendingView = null;
        }
      });
    });
    this.pendingView = off;
  }

  private cancelDebounce(): void {
    if (this.debounceHandle !== null) this.timers.clearTimeout(this.debounceHandle);
    this.debounceHandle = null;
  }

  private setStatus(status: SaveStatus): void {
    if (this._status === status) return;
    this._status = status;
    this.emitter.emit('status', { status });
  }

  private assertAlive(): void {
    if (this.destroyed) throw new PersistenceError('persistence has been destroyed');
  }
}
