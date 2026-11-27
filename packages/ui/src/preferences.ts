import type { SessionTimeZoneChoice } from '@market-chart/core';
import { EventEmitter } from '@market-chart/core';
import type { Unsubscribe } from '@market-chart/core';
import {
  PersistenceError,
  StorageConflictError,
  createMemoryStorage,
  parseJson,
  sanitizeJson,
} from '@market-chart/persistence';
import type { StateProvider, StorageAdapter } from '@market-chart/persistence';
import type { HeaderSection } from './types.js';
import { safeText } from './util.js';

export const UI_PREFERENCES_VERSION = 3;

/** A user's placement of one action (only what differs from the action's defaults). */
export interface ActionPlacement {
  readonly visible?: boolean;
  readonly location?: 'header' | 'sidebar';
  readonly section?: HeaderSection;
  readonly group?: string;
  readonly order?: number;
}

export type Density = 'compact' | 'comfortable';
export type SidebarPosition = 'start' | 'end';
export type SidebarMode = 'expanded' | 'collapsed' | 'floating' | 'hidden';

/** Values the chart legend can show. */
export type LegendField =
  | 'date'
  | 'time'
  | 'timestamp'
  | 'open'
  | 'high'
  | 'low'
  | 'close'
  | 'change'
  | 'volume'
  | 'indicators';

export const LEGEND_FIELDS: readonly LegendField[] = [
  'date',
  'time',
  'timestamp',
  'open',
  'high',
  'low',
  'close',
  'change',
  'volume',
  'indicators',
];

export interface LegendPreferences {
  readonly visible: boolean;
  readonly fields: Readonly<Record<LegendField, boolean>>;
}

/** Price markers drawn on the chart through the engine's price-line API. */
export type MarkerField =
  'highLow' | 'previousClose' | 'lastPriceLine' | 'lastValueLabel' | 'indicatorLabels';

export const MARKER_FIELDS: readonly MarkerField[] = [
  'highLow',
  'previousClose',
  'lastPriceLine',
  'lastValueLabel',
  'indicatorLabels',
];

/**
 * `highLow`: lines and axis labels at the highest high and lowest low of the visible bars. `previousClose`: a
 * line at the previous bar's close. The other three switch the main series' last-price line and axis label and
 * the indicators' axis labels.
 */
export type MarkerPreferences = Readonly<Record<MarkerField, boolean>>;

const DEFAULT_MARKERS: MarkerPreferences = {
  highLow: false,
  previousClose: false,
  lastPriceLine: true,
  lastValueLabel: true,
  indicatorLabels: true,
};

/** How users pick a symbol (see the `symbolSearch()` feature). */
export type SymbolSelectorMode = 'dropdown' | 'modal' | 'both' | 'custom' | 'none';

export const SYMBOL_SELECTOR_MODES: readonly SymbolSelectorMode[] = [
  'dropdown',
  'modal',
  'both',
  'custom',
  'none',
];

export interface SymbolPreferences {
  /** null: the application's default mode. */
  readonly mode: SymbolSelectorMode | null;
  readonly favorites: readonly string[];
  /** Most recent first. */
  readonly recent: readonly string[];
}

/** Price actions and order entry (`priceActions()` and `orderTicket()` features). */
export interface TradePreferences {
  /** Ask before an order is sent. Only honoured when the application allows skipping confirmation. */
  readonly confirmOrders: boolean;
  /** The "+" button next to the crosshair price label. */
  readonly axisButton: boolean;
}

/** Most favourites and recent symbols kept. */
export const MAX_FAVORITE_SYMBOLS = 200;
export const MAX_RECENT_SYMBOLS = 50;
/** Largest stored size of one extension's preferences (JSON characters). */
export const MAX_EXTENSION_PREFERENCES_SIZE = 16_384;

const DEFAULT_SYMBOLS: SymbolPreferences = { mode: null, favorites: [], recent: [] };
const DEFAULT_TRADE: TradePreferences = { confirmOrders: true, axisButton: true };

const DEFAULT_LEGEND: LegendPreferences = {
  visible: true,
  fields: {
    date: true,
    time: true,
    timestamp: false,
    open: true,
    high: true,
    low: true,
    close: true,
    change: true,
    volume: true,
    indicators: true,
  },
};

/** Interface preferences: language, direction, toolbars, action placement, context menu, shortcuts. */
export interface UiPreferences {
  readonly version: number;
  readonly revision: number;
  readonly savedAt: number;
  /** Language code, or null for the application default. */
  readonly locale: string | null;
  readonly direction: 'auto' | 'ltr' | 'rtl';
  readonly numerals: 'native' | 'latn';
  /** Locale digits on the chart axes. */
  readonly localDigits: boolean;
  /**
   * Time zone of trading sessions (when days start for VWAP, pivots and profiles): the exchange's, the
   * chart's, this computer's or the application's (see `ChartUiOptions.applicationTimeZone`).
   */
  readonly sessionTimeZone: SessionTimeZoneChoice;
  readonly theme: string | null;
  readonly density: Density;
  readonly header: { readonly visible: boolean };
  /** `start`/`end` of the reading direction: left/right in LTR, right/left in RTL. */
  readonly sidebar: { readonly position: SidebarPosition; readonly mode: SidebarMode };
  readonly actions: Readonly<Record<string, ActionPlacement>>;
  readonly contextMenu: { readonly hidden: readonly string[] };
  /** Custom shortcuts (`null` removes the default one). */
  readonly shortcuts: Readonly<Record<string, string | null>>;
  /** Legend over the chart: hovered bar's date, time, timestamp, OHLC, change, volume and indicator values. */
  readonly legend: LegendPreferences;
  readonly markers: MarkerPreferences;
  /** Symbol selector mode, favourite and recent symbols (version 3). */
  readonly symbols: SymbolPreferences;
  /** Price actions and order confirmation (version 3). */
  readonly trade: TradePreferences;
  /**
   * Preferences of other packages by namespace (e.g. `trading` for `@market-chart/trading`). Each namespace is
   * plain JSON, validated by the package that owns it and bounded in size (version 3).
   */
  readonly extensions: Readonly<Record<string, unknown>>;
}

export type UiPreferencesPatch = Partial<
  Omit<
    UiPreferences,
    | 'version'
    | 'revision'
    | 'savedAt'
    | 'header'
    | 'sidebar'
    | 'contextMenu'
    | 'legend'
    | 'markers'
    | 'symbols'
    | 'trade'
    | 'extensions'
  >
> & {
  readonly header?: Partial<UiPreferences['header']>;
  readonly sidebar?: Partial<UiPreferences['sidebar']>;
  readonly contextMenu?: Partial<UiPreferences['contextMenu']>;
  readonly legend?: {
    readonly visible?: boolean;
    readonly fields?: Partial<Record<LegendField, boolean>>;
  };
  readonly markers?: Partial<MarkerPreferences>;
  readonly symbols?: Partial<SymbolPreferences>;
  readonly trade?: Partial<TradePreferences>;
  /** Merged by namespace; an `undefined` value removes that namespace. */
  readonly extensions?: Readonly<Record<string, unknown>>;
};

export function defaultUiPreferences(overrides: UiPreferencesPatch = {}): UiPreferences {
  return mergePreferences(
    {
      version: UI_PREFERENCES_VERSION,
      revision: 0,
      savedAt: 0,
      locale: null,
      direction: 'auto',
      numerals: 'native',
      localDigits: false,
      sessionTimeZone: 'exchange',
      theme: null,
      density: 'comfortable',
      header: { visible: true },
      sidebar: { position: 'start', mode: 'expanded' },
      actions: {},
      contextMenu: { hidden: [] },
      shortcuts: {},
      legend: DEFAULT_LEGEND,
      markers: DEFAULT_MARKERS,
      symbols: DEFAULT_SYMBOLS,
      trade: DEFAULT_TRADE,
      extensions: {},
    },
    overrides,
  );
}

export function mergePreferences(base: UiPreferences, patch: UiPreferencesPatch): UiPreferences {
  return {
    ...base,
    ...patch,
    header: { ...base.header, ...patch.header },
    sidebar: { ...base.sidebar, ...patch.sidebar },
    contextMenu: { ...base.contextMenu, ...patch.contextMenu },
    actions: patch.actions ?? base.actions,
    shortcuts: patch.shortcuts ?? base.shortcuts,
    legend: {
      visible: patch.legend?.visible ?? base.legend.visible,
      fields: { ...base.legend.fields, ...patch.legend?.fields },
    },
    markers: { ...base.markers, ...patch.markers },
    symbols: { ...base.symbols, ...patch.symbols },
    trade: { ...base.trade, ...patch.trade },
    extensions: mergeExtensions(base.extensions, patch.extensions),
  } as UiPreferences;
}

function mergeExtensions(
  base: Readonly<Record<string, unknown>>,
  patch: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> {
  if (!patch) return base;
  const merged: Record<string, unknown> = { ...base, ...patch };
  return Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== undefined));
}

const ID = /^[A-Za-z0-9_.:-]{1,120}$/;
/** Most action placements, shortcuts and hidden menu entries kept from stored preferences. */
export const MAX_PREFERENCE_ENTRIES = 500;
const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

/** Version N → N + 1 steps; version 0 is how preferences looked before versioning (flat `hidden` list). */
const MIGRATIONS: Record<number, (input: Record<string, unknown>) => Record<string, unknown>> = {
  0: (p) => ({
    ...p,
    version: 1,
    contextMenu: { hidden: Array.isArray(p['hiddenMenuActions']) ? p['hiddenMenuActions'] : [] },
  }),
  // Version 2 added the legend and price markers; older preferences get the defaults.
  1: (p) => ({ ...p, version: 2, legend: DEFAULT_LEGEND, markers: DEFAULT_MARKERS }),
  // Version 3 added symbol, trade and extension preferences; older preferences get the defaults.
  2: (p) => ({ ...p, version: 3, symbols: DEFAULT_SYMBOLS, trade: DEFAULT_TRADE, extensions: {} }),
};

/**
 * Validates untrusted preferences (storage, imports, workspaces): plain data only (via the persistence
 * package's sanitiser), migrated to the current version, unknown or invalid entries dropped, defaults filled in.
 */
export function validateUiPreferences(input: unknown): UiPreferences {
  let p = sanitizeJson(input) as Record<string, unknown>;
  if (!p || typeof p !== 'object' || Array.isArray(p))
    throw new PersistenceError('preferences must be an object');
  let version = typeof p['version'] === 'number' ? p['version'] : 0;
  if (!Number.isInteger(version) || version < 0)
    throw new PersistenceError('preferences have an invalid version');
  if (version > UI_PREFERENCES_VERSION) {
    throw new PersistenceError(
      `preferences version ${version} is newer than supported (${UI_PREFERENCES_VERSION})`,
    );
  }
  while (version < UI_PREFERENCES_VERSION) {
    p = MIGRATIONS[version]!(p);
    version = p['version'] as number;
  }
  const d = defaultUiPreferences();
  const obj = (v: unknown): Record<string, unknown> =>
    v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const header = obj(p['header']);
  const sidebar = obj(p['sidebar']);
  const actions: Record<string, ActionPlacement> = {};
  // Bounded: a tampered store must not create thousands of entries the UI then walks on every render.
  for (const [id, raw] of Object.entries(obj(p['actions'])).slice(0, MAX_PREFERENCE_ENTRIES)) {
    if (!ID.test(id)) continue;
    const a = obj(raw);
    const placement: { -readonly [K in keyof ActionPlacement]: ActionPlacement[K] } = {};
    if (typeof a['visible'] === 'boolean') placement.visible = a['visible'];
    if (a['location'] === 'header' || a['location'] === 'sidebar')
      placement.location = a['location'];
    if (a['section'] === 'left' || a['section'] === 'center' || a['section'] === 'right')
      placement.section = a['section'];
    if (typeof a['group'] === 'string' && ID.test(a['group'])) placement.group = a['group'];
    if (typeof a['order'] === 'number' && Number.isFinite(a['order'])) placement.order = a['order'];
    actions[id] = placement;
  }
  const shortcuts: Record<string, string | null> = {};
  for (const [id, value] of Object.entries(obj(p['shortcuts'])).slice(0, MAX_PREFERENCE_ENTRIES)) {
    if (ID.test(id) && (value === null || (typeof value === 'string' && value.length <= 40)))
      shortcuts[id] = value as string | null;
  }
  const hidden = Array.isArray(obj(p['contextMenu'])['hidden'])
    ? (obj(p['contextMenu'])['hidden'] as unknown[]).filter(
        (id): id is string => typeof id === 'string' && ID.test(id),
      )
    : [];
  const legend = obj(p['legend']);
  const legendFields = obj(legend['fields']);
  const fields = { ...d.legend.fields };
  for (const field of LEGEND_FIELDS)
    if (typeof legendFields[field] === 'boolean') fields[field] = legendFields[field];
  const markersIn = obj(p['markers']);
  const markers = { ...d.markers };
  for (const field of MARKER_FIELDS)
    if (typeof markersIn[field] === 'boolean') markers[field] = markersIn[field];
  const symbolsIn = obj(p['symbols']);
  const symbolList = (v: unknown, max: number): string[] =>
    Array.isArray(v) ? [...new Set(v.filter(isStoredSymbol))].slice(0, max) : [];
  const tradeIn = obj(p['trade']);
  const extensions: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj(p['extensions'])).slice(0, 50)) {
    if (!ID.test(key) || value === undefined) continue;
    // Plain JSON already (sanitised above); bounded so one package cannot bloat everyone's preferences.
    if (JSON.stringify(value).length <= MAX_EXTENSION_PREFERENCES_SIZE) extensions[key] = value;
  }
  const revision = p['revision'];
  return {
    version: UI_PREFERENCES_VERSION,
    revision:
      typeof revision === 'number' && Number.isInteger(revision) && revision >= 0 ? revision : 0,
    savedAt: typeof p['savedAt'] === 'number' ? p['savedAt'] : 0,
    locale:
      typeof p['locale'] === 'string' &&
      p['locale'].length <= 35 &&
      /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(p['locale'])
        ? p['locale']
        : null,
    direction: oneOf(p['direction'], ['auto', 'ltr', 'rtl'] as const, d.direction),
    numerals: oneOf(p['numerals'], ['native', 'latn'] as const, d.numerals),
    localDigits: typeof p['localDigits'] === 'boolean' ? p['localDigits'] : d.localDigits,
    sessionTimeZone: oneOf(
      p['sessionTimeZone'],
      ['exchange', 'chart', 'local', 'application'] as const,
      d.sessionTimeZone,
    ),
    theme: typeof p['theme'] === 'string' && p['theme'].length <= 40 ? p['theme'] : null,
    density: oneOf(p['density'], ['compact', 'comfortable'] as const, d.density),
    header: { visible: typeof header['visible'] === 'boolean' ? header['visible'] : true },
    sidebar: {
      position: oneOf(sidebar['position'], ['start', 'end'] as const, d.sidebar.position),
      mode: oneOf(
        sidebar['mode'],
        ['expanded', 'collapsed', 'floating', 'hidden'] as const,
        d.sidebar.mode,
      ),
    },
    actions,
    contextMenu: { hidden: [...new Set(hidden)].slice(0, MAX_PREFERENCE_ENTRIES) },
    shortcuts,
    legend: {
      visible: typeof legend['visible'] === 'boolean' ? legend['visible'] : d.legend.visible,
      fields,
    },
    markers,
    symbols: {
      mode: SYMBOL_SELECTOR_MODES.includes(symbolsIn['mode'] as SymbolSelectorMode)
        ? (symbolsIn['mode'] as SymbolSelectorMode)
        : null,
      favorites: symbolList(symbolsIn['favorites'], MAX_FAVORITE_SYMBOLS),
      recent: symbolList(symbolsIn['recent'], MAX_RECENT_SYMBOLS),
    },
    trade: {
      confirmOrders:
        typeof tradeIn['confirmOrders'] === 'boolean'
          ? tradeIn['confirmOrders']
          : d.trade.confirmOrders,
      axisButton:
        typeof tradeIn['axisButton'] === 'boolean' ? tradeIn['axisButton'] : d.trade.axisButton,
    },
    extensions,
  };
}

/** A symbol as stored in preferences: 1–64 characters, no control or bidi-control characters. */
export function isStoredSymbol(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 64 &&
    safeText(value, 64) === value
  );
}

export type PreferencesStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export interface UiPreferencesStoreOptions {
  /** Any persistence adapter (memory, localStorage, IndexedDB, REST…). Default: memory. */
  readonly storage?: StorageAdapter<UiPreferences>;
  readonly id?: string;
  /** Application defaults (e.g. sidebar on the right, compact density). */
  readonly defaults?: UiPreferencesPatch;
  readonly autoSave?: boolean;
  readonly debounceMs?: number;
  readonly now?: () => number;
}

export interface UiPreferencesEvents {
  change: { readonly preferences: UiPreferences };
  status: { readonly status: PreferencesStatus };
  error: { readonly error: unknown };
}

/**
 * The user's interface preferences, saved through a persistence `StorageAdapter`. Changes are applied at once
 * and saved after a quiet period; imports and stored data are validated and migrated.
 */
export class UiPreferencesStore {
  readonly id: string;
  private readonly storage: StorageAdapter<UiPreferences>;
  private readonly defaults: UiPreferences;
  private readonly emitter = new EventEmitter<UiPreferencesEvents>();
  private readonly options: UiPreferencesStoreOptions;
  private current: UiPreferences;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private _status: PreferencesStatus = 'idle';
  private saving: Promise<void> | null = null;

  constructor(options: UiPreferencesStoreOptions = {}) {
    this.options = options;
    this.id = options.id ?? 'ui-preferences';
    this.storage =
      options.storage ?? createMemoryStorage<UiPreferences>({ validate: validateUiPreferences });
    this.defaults = defaultUiPreferences(options.defaults);
    this.current = this.defaults;
  }

  get(): UiPreferences {
    return this.current;
  }

  get status(): PreferencesStatus {
    return this._status;
  }

  getDefaults(): UiPreferences {
    return this.defaults;
  }

  on<K extends keyof UiPreferencesEvents>(
    event: K,
    listener: (payload: UiPreferencesEvents[K]) => void,
  ): Unsubscribe {
    return this.emitter.on(event, listener);
  }

  /** Applies a change (validated), notifies listeners and schedules a save. */
  update(
    patch: UiPreferencesPatch | ((current: UiPreferences) => UiPreferencesPatch),
  ): UiPreferences {
    const next = typeof patch === 'function' ? patch(this.current) : patch;
    return this.replace(mergePreferences(this.current, next));
  }

  /** Replaces all preferences (e.g. from a workspace), keeping the stored revision. */
  replace(preferences: unknown): UiPreferences {
    const validated = validateUiPreferences({
      ...(preferences as object),
      revision: this.current.revision,
      savedAt: this.current.savedAt,
    });
    if (JSON.stringify(validated) === JSON.stringify(this.current)) return this.current;
    this.current = validated;
    this.emitter.emit('change', { preferences: validated });
    this.markDirty();
    return validated;
  }

  /** Restores the application defaults (optionally keeping some fields, e.g. the language). */
  reset(keep: readonly (keyof UiPreferencesPatch)[] = []): UiPreferences {
    const kept: Record<string, unknown> = {};
    for (const key of keep) kept[key] = this.current[key];
    return this.replace(mergePreferences(this.defaults, kept as UiPreferencesPatch));
  }

  /** Loads stored preferences; resolves false when nothing is stored. Invalid data is reported, not applied. */
  async load(): Promise<boolean> {
    try {
      const stored = await this.storage.load(this.id);
      if (!stored) return false;
      this.cancelTimer();
      this.current = validateUiPreferences(stored);
      this.emitter.emit('change', { preferences: this.current });
      this.setStatus('saved');
      return true;
    } catch (error) {
      this.setStatus('error');
      this.emitter.emit('error', { error });
      return false;
    }
  }

  async save(): Promise<void> {
    this.cancelTimer();
    if (this.saving) await this.saving;
    this.saving = this.doSave();
    try {
      await this.saving;
    } finally {
      this.saving = null;
    }
  }

  exportJson(): string {
    const { revision: _r, savedAt: _s, ...rest } = this.current;
    return JSON.stringify(rest, null, 2);
  }

  /** Validates and applies exported preferences. Throws a `PersistenceError` with the reason when invalid. */
  importJson(text: string): UiPreferences {
    return this.replace(validateUiPreferences(parseJson(text)));
  }

  destroy(): void {
    this.cancelTimer();
    this.emitter.clear();
  }

  private async doSave(): Promise<void> {
    this.setStatus('saving');
    for (let attempt = 0; attempt < 3; attempt++) {
      const next: UiPreferences = {
        ...this.current,
        revision: this.current.revision + 1,
        savedAt: this.options.now?.() ?? Date.now(),
      };
      try {
        await this.storage.save(this.id, next);
        this.current = { ...this.current, revision: next.revision, savedAt: next.savedAt };
        this.setStatus('saved');
        return;
      } catch (error) {
        // Preferences are personal: the latest local change wins over another tab's older save.
        if (error instanceof StorageConflictError) {
          const remote = error.remote as UiPreferences | null;
          this.current = {
            ...this.current,
            revision: Math.max(remote?.revision ?? 0, this.current.revision),
          };
          continue;
        }
        this.setStatus('error');
        this.emitter.emit('error', { error });
        return;
      }
    }
    this.setStatus('error');
  }

  private markDirty(): void {
    this.setStatus('dirty');
    if (this.options.autoSave === false) return;
    this.cancelTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.save();
    }, this.options.debounceMs ?? 400);
  }

  private cancelTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private setStatus(status: PreferencesStatus): void {
    if (status === this._status) return;
    this._status = status;
    this.emitter.emit('status', { status });
  }
}

/**
 * Stores interface preferences inside a chart layout or workspace (`ChartPersistence` providers, workspace
 * `preferences`), for workspace-specific language, toolbars and menus.
 */
export function uiPreferencesProvider(store: UiPreferencesStore): StateProvider {
  return {
    capture: () => {
      const { revision: _r, savedAt: _s, ...rest } = store.get();
      return rest;
    },
    restore: (data) => {
      store.replace(validateUiPreferences(data));
    },
    subscribe: (onChange) => store.on('change', onChange),
  };
}
