import { EventEmitter, createTradingSession, resolveSessionTimeZone } from '@market-chart/core';
import type {
  ChartApi,
  ContextMenuEvent,
  ThemeInput,
  TimeZone,
  TradingSession,
  Unsubscribe,
} from '@market-chart/core';
import { I18n } from '@market-chart/i18n';
import type { TranslationValues } from '@market-chart/i18n';
import { builtInActions } from './builtins/index.js';
import { headerLayout, placeActions, reorderPlacements, sidebarLayout } from './layout.js';
import type { HeaderLayout, ToolbarGroup, ToolbarItem, ToolbarLocation } from './layout.js';
import { legendData } from './legend.js';
import type { LegendData } from './legend.js';
import { PriceMarkers } from './markers.js';
import { ContextMenuController, buildEntries, resolveTarget } from './menu.js';
import type { MenuEntry } from './menu.js';
import { UiPreferencesStore } from './preferences.js';
import type { UiPreferences } from './preferences.js';
import { ActionRegistry, UiError } from './registry.js';
import { SectionList } from './extensions.js';
import type {
  ChartUiFeature,
  ContextMenuInterceptor,
  KeyHandler,
  ObjectTreeSection,
  SettingsSection,
  TargetResolver,
} from './extensions.js';
import type { SymbolSearch } from './symbols.js';
import type { PriceActions } from './price-actions.js';
import type { OrderTicket } from './order-ticket.js';
import type {
  ActionContext,
  ActionLocation,
  ChartUiCapabilities,
  ContextTarget,
  ContextTargetKind,
  HeaderSection,
  PriceContext,
  UiAction,
  UiActionDefinition,
} from './types.js';
import { formatShortcut, matchShortcut } from './util.js';
import type { KeyLike } from './util.js';

export interface ChartUiOptions {
  /** Translations; created (English, or the preference) when omitted. */
  readonly i18n?: I18n;
  readonly capabilities?: ChartUiCapabilities;
  readonly preferences?: UiPreferencesStore;
  /** Register the built-in actions (default true); pass ids to leave some out. */
  readonly builtins?: boolean | { readonly exclude?: readonly string[] };
  /** Open the context menu on right-click / keyboard / long-press (default true). */
  readonly contextMenu?: boolean;
  /** Long-press on touch opens the context menu instead of the touch crosshair (default true). */
  readonly touchContextMenu?: boolean;
  /** Keep the chart's axis locale and direction in step with the language (default true). */
  readonly syncChartLocale?: boolean;
  /** Language when the user has not chosen one (default: the i18n instance's). */
  readonly defaultLocale?: string;
  /**
   * Optional features, e.g. `[symbolSearch(), priceActions(), orderTicket()]`. Nothing of a feature runs (or is
   * bundled) unless it is listed here or installed later with `ui.use`.
   */
  readonly features?: readonly ChartUiFeature[];
  /**
   * The application's time zone, offered as a session time-zone choice ("Application") in the settings,
   * e.g. the zone of the user's account.
   */
  readonly applicationTimeZone?: TimeZone;
}

let continuousUtc: TradingSession | null = null;
/** A 24x7 session in UTC, re-read in another zone when the user picks one for a continuous market. */
function continuousSession(): TradingSession {
  return (continuousUtc ??= createTradingSession({ hours: '24x7' }));
}

/** Slots filled by the optional features (see `ChartUi.symbols`, `priceActions`, `orderTicket`). */
interface FeatureSlots {
  symbols: SymbolSearch | null;
  priceActions: PriceActions | null;
  orderTicket: OrderTicket | null;
}

export interface ChartUiEvents {
  /** Something shown by toolbars changed (actions, preferences, language, chart state). */
  change: { readonly version: number };
  /** A user-facing message (copied, exported, errors). */
  notify: { readonly message: string; readonly kind: 'info' | 'error' };
  execute: { readonly actionId: string; readonly location: ActionContext['location'] };
}

/**
 * The interface layer of one chart: action registry, context menu, header/sidebar layout, shortcuts and user
 * preferences. Framework independent and DOM-free except where an action needs the DOM when it runs
 * (clipboard, downloads, fullscreen). UI frameworks render it; the React components in `@market-chart/ui/react`
 * are one renderer.
 */
export class ChartUi {
  readonly chart: ChartApi;
  readonly i18n: I18n;
  readonly registry = new ActionRegistry();
  readonly menu = new ContextMenuController();
  readonly preferences: UiPreferencesStore;
  /** Visible high/low, previous close and last-price switches (see `UiPreferences.markers`). */
  readonly markers: PriceMarkers;
  private _capabilities: ChartUiCapabilities;
  private readonly emitter = new EventEmitter<ChartUiEvents>();
  private readonly offs: Unsubscribe[] = [];
  private readonly ownsPreferences: boolean;
  private readonly defaultLocale: string;
  private readonly options: ChartUiOptions;
  private sessionCache: {
    readonly source: TradingSession;
    readonly zone: TimeZone;
    readonly result: TradingSession | null;
  } | null = null;
  /** The session last given to the indicators (undefined: none yet). */
  private appliedSession: TradingSession | null | undefined = undefined;
  private _version = 0;
  private destroyed = false;
  private capabilityOffs: Unsubscribe[] = [];
  private readonly slots: FeatureSlots = { symbols: null, priceActions: null, orderTicket: null };
  private readonly features = new Map<string, () => void>();
  private readonly resolvers: TargetResolver[] = [];
  private readonly interceptors: ContextMenuInterceptor[] = [];
  private readonly keyHandlers: KeyHandler[] = [];
  private priceResolver: ((target: ContextTarget) => PriceContext | null) | null = null;
  private readonly settingsSections = new SectionList<SettingsSection>(() => this.bump());
  private readonly treeSections = new SectionList<ObjectTreeSection>(() => this.bump());

  /** Extra settings categories (e.g. "Trading"), shown after the built-in ones. */
  readonly settings: {
    register(section: SettingsSection): Unsubscribe;
    sections(): readonly SettingsSection[];
  } = {
    register: (section) => this.settingsSections.register(section),
    sections: () => this.settingsSections.list(),
  };

  /** Extra object-tree sections (e.g. orders and positions), shown after the built-in ones. */
  readonly objectTree: {
    register(section: ObjectTreeSection): Unsubscribe;
    sections(): readonly ObjectTreeSection[];
  } = {
    register: (section) => this.treeSections.register(section),
    sections: () => this.treeSections.list(),
  };

  /**
   * Context-menu targets for objects the engine does not know (orders, alerts…). Resolvers run before the
   * built-in resolution, most recent first; interceptors may handle a request instead of the menu.
   */
  readonly targets: {
    register(resolver: TargetResolver): Unsubscribe;
    intercept(interceptor: ContextMenuInterceptor): Unsubscribe;
    resolve(event: ContextMenuEvent): ContextTarget;
  } = {
    register: (resolver) => addTo(this.resolvers, resolver, true),
    intercept: (interceptor) => addTo(this.interceptors, interceptor, true),
    resolve: (event) => this.resolveTargetOf(event),
  };

  /** `ui.contextMenu.register(…)`: the context-menu facade over the shared registry. */
  readonly contextMenu: {
    register(definition: UiActionDefinition): Unsubscribe;
    unregister(id: string): boolean;
    getActions(target?: ContextTargetKind): UiAction[];
    setEnabled(id: string, enabled: boolean): void;
    /** Hides an action from context menus (a user preference; persisted). */
    setHidden(id: string, hidden: boolean): void;
    isHidden(id: string): boolean;
    open(input: {
      x: number;
      y: number;
      target?: ContextTarget | null;
      event?: ContextMenuEvent;
    }): void;
    close(): void;
    entriesFor(target: ContextTarget): MenuEntry[];
  };

  /** `ui.actions.register(…)`: header and sidebar actions (same registry). */
  readonly actions: {
    register(
      definition: UiActionDefinition,
      options?: { replace?: boolean; owner?: string },
    ): Unsubscribe;
    unregister(id: string): boolean;
    unregisterOwner(owner: string): number;
    get(id: string): UiAction | undefined;
    list(location?: ActionLocation): UiAction[];
    override(id: string, patch: Partial<Omit<UiActionDefinition, 'id'>>): void;
    restore(id: string): void;
    setEnabled(id: string, enabled: boolean): void;
    execute(id: string, location?: ActionContext['location']): Promise<void>;
  };

  constructor(chart: ChartApi, options: ChartUiOptions = {}) {
    this.chart = chart;
    this.options = options;
    this._capabilities = options.capabilities ?? {};
    this.ownsPreferences = !options.preferences;
    this.preferences = options.preferences ?? new UiPreferencesStore();
    this.i18n = options.i18n ?? new I18n();
    this.defaultLocale = options.defaultLocale ?? this.i18n.locale;

    if (options.builtins !== false) {
      const exclude = new Set(
        typeof options.builtins === 'object' ? (options.builtins.exclude ?? []) : [],
      );
      for (const definition of builtInActions())
        if (!exclude.has(definition.id)) this.registry.register(definition, { owner: 'builtin' });
    }

    const bump = (): void => this.bump();
    this.offs.push(
      this.registry.on('change', bump),
      this.preferences.on('change', ({ preferences }) => {
        this.applyPreferences(preferences);
        bump();
      }),
      this.i18n.on('change', () => {
        this.applyChartLocale();
        bump();
      }),
      chart.on('optionsChanged', bump),
      chart.on('seriesAdded', bump),
      chart.on('seriesRemoved', bump),
      this.menu.on('error', ({ error, actionId }) => this.reportError(error, actionId)),
      this.menu.on('execute', ({ actionId }) =>
        this.emitter.emit('execute', { actionId, location: 'contextMenu' }),
      ),
    );
    if (options.contextMenu !== false) {
      this.offs.push(chart.on('contextMenu', (event) => this.onContextMenu(event)));
      if (options.touchContextMenu !== false)
        chart.applyOptions({ interaction: { touchContextMenu: true } });
    }
    this.watchCapabilities();
    this.applyPreferences(this.preferences.get());
    this.markers = new PriceMarkers(this);
    // The session follows the preference, the chart's time zone (for "chart") and the symbol.
    this.offs.push(
      this.preferences.on('change', () => this.syncSession()),
      chart.on('optionsChanged', () => this.syncSession()),
    );
    this.syncSession();

    const registry = this.registry;
    this.contextMenu = {
      register: (definition) => registry.register({ locations: ['contextMenu'], ...definition }),
      unregister: (id) => registry.unregister(id),
      getActions: (target) =>
        registry.list({ location: 'contextMenu', ...(target ? { target } : {}) }),
      setEnabled: (id, enabled) => registry.setEnabled(id, enabled),
      setHidden: (id, hidden) => {
        const current = new Set(this.preferences.get().contextMenu.hidden);
        if (hidden) current.add(id);
        else current.delete(id);
        this.preferences.update({ contextMenu: { hidden: [...current] } });
      },
      isHidden: (id) => this.preferences.get().contextMenu.hidden.includes(id),
      open: ({ x, y, target, event }) => {
        const resolved = target ?? (event ? this.resolveTargetOf(event) : null);
        if (!resolved)
          throw new UiError('contextMenu.open() needs a target or a core contextMenu event');
        this.showMenu(x, y, resolved, event?.source ?? 'api');
      },
      close: () => this.menu.close(),
      entriesFor: (target) => this.entriesFor(target),
    };
    this.actions = {
      register: (definition, opts) => registry.register(definition, opts),
      unregister: (id) => registry.unregister(id),
      unregisterOwner: (owner) => registry.unregisterOwner(owner),
      get: (id) => registry.get(id),
      list: (location) => registry.list(location ? { location } : {}),
      override: (id, patch) => registry.override(id, patch),
      restore: (id) => registry.restore(id),
      setEnabled: (id, enabled) => registry.setEnabled(id, enabled),
      execute: (id, location = 'api') => this.execute(id, location),
    };
    for (const feature of options.features ?? []) this.use(feature);
  }

  // ───────────────────────── features ─────────────────────────

  /** Installs an optional feature (once per id). Returns its removal. */
  use(feature: ChartUiFeature): Unsubscribe {
    if (this.features.has(feature.id))
      throw new UiError(`feature "${feature.id}" is already installed`);
    const cleanup = feature.install(this) ?? (() => undefined);
    this.features.set(feature.id, cleanup);
    this.bump();
    return () => this.removeFeature(feature.id);
  }

  removeFeature(id: string): boolean {
    const cleanup = this.features.get(id);
    if (!cleanup) return false;
    this.features.delete(id);
    try {
      cleanup();
    } finally {
      this.bump();
    }
    return true;
  }

  hasFeature(id: string): boolean {
    return this.features.has(id);
  }

  /** Symbol search controller, when the `symbolSearch()` feature is installed (`ui.symbols.open()`). */
  get symbols(): SymbolSearch | null {
    return this.slots.symbols;
  }

  /** Price actions, when the `priceActions()` feature is installed. */
  get priceActions(): PriceActions | null {
    return this.slots.priceActions;
  }

  /** Order ticket, when the `orderTicket()` feature is installed. */
  get orderTicket(): OrderTicket | null {
    return this.slots.orderTicket;
  }

  /**
   * Used by features to publish their controller, keyboard handler and price resolution. Returns the removal.
   * Applications use `use(feature)` instead.
   */
  provide(input: {
    readonly symbols?: SymbolSearch;
    readonly priceActions?: PriceActions;
    readonly orderTicket?: OrderTicket;
    readonly keyHandler?: KeyHandler;
    readonly priceContext?: (target: ContextTarget) => PriceContext | null;
  }): Unsubscribe {
    const offs: Unsubscribe[] = [];
    for (const slot of ['symbols', 'priceActions', 'orderTicket'] as const) {
      const value = input[slot];
      if (!value) continue;
      if (this.slots[slot]) throw new UiError(`"${slot}" is already provided`);
      (this.slots as unknown as Record<string, unknown>)[slot] = value;
      offs.push(() => {
        if (this.slots[slot] === value)
          (this.slots as unknown as Record<string, unknown>)[slot] = null;
      });
    }
    if (input.keyHandler) offs.push(addTo(this.keyHandlers, input.keyHandler, false));
    if (input.priceContext) {
      const resolver = input.priceContext;
      this.priceResolver = resolver;
      offs.push(() => {
        if (this.priceResolver === resolver) this.priceResolver = null;
      });
    }
    this.bump();
    return () => {
      for (const off of offs.splice(0)) off();
      this.bump();
    };
  }

  /** The application time zone (`ChartUiOptions.applicationTimeZone`), or null. */
  get applicationTimeZone(): TimeZone | null {
    return this.options.applicationTimeZone ?? null;
  }

  /**
   * The trading session in the time zone the user chose (preference `sessionTimeZone`): the symbol's
   * session (`capabilities.session`) as is for `exchange`, otherwise re-read in the chart's, this
   * computer's or the application's zone. A continuous market without a session gets a 24x7 session in
   * that zone, so its days start at that zone's midnight. Null means UTC days.
   */
  session(): TradingSession | null {
    let base: TradingSession | null = null;
    try {
      base = this._capabilities.session?.value() ?? null;
    } catch (error) {
      this.reportError(error, 'session');
    }
    const choice = this.preferences.get().sessionTimeZone;
    if (choice === 'exchange') return base;
    const zone = resolveSessionTimeZone(choice, {
      exchange: base?.timeZone ?? null,
      chart: this.chart.options().localization.timeZone,
      application: this.options.applicationTimeZone ?? null,
    });
    const source = base ?? continuousSession();
    const cached = this.sessionCache;
    // Same object for the same inputs, so indicators are not recomputed for nothing.
    if (cached && cached.source === source && cached.zone === zone) return cached.result;
    let result: TradingSession | null;
    try {
      result = source.withTimeZone(zone);
    } catch (error) {
      this.reportError(error, 'session');
      result = base;
    }
    this.sessionCache = { source, zone, result };
    return result;
  }

  private syncSession(): void {
    if (this.destroyed) return;
    // Leave an application's own `indicators.setSession` alone until the UI has a say: a session
    // capability, or a time zone other than the exchange's.
    if (
      this.appliedSession === undefined &&
      !this._capabilities.session &&
      this.preferences.get().sessionTimeZone === 'exchange'
    )
      return;
    const session = this.session();
    if (session === this.appliedSession) return;
    this.appliedSession = session;
    const indicators = this._capabilities.indicators as
      { setSession?(session: TradingSession | null): void } | undefined;
    try {
      indicators?.setSession?.(session);
    } catch (error) {
      this.reportError(error, 'session');
    }
    this.bump();
  }

  get capabilities(): ChartUiCapabilities {
    return this._capabilities;
  }

  /** Increases whenever toolbar-visible state changes (for `useSyncExternalStore`). */
  get version(): number {
    return this._version;
  }

  get direction(): 'ltr' | 'rtl' {
    return this.i18n.direction;
  }

  on<K extends keyof ChartUiEvents>(
    event: K,
    listener: (payload: ChartUiEvents[K]) => void,
  ): Unsubscribe {
    return this.emitter.on(event, listener);
  }

  /** Adds or replaces capabilities (e.g. once a datafeed or the settings dialog is ready). */
  setCapabilities(patch: Partial<ChartUiCapabilities>): void {
    this._capabilities = { ...this._capabilities, ...patch };
    this.watchCapabilities();
    // New indicators or a new session source: apply the current session to them.
    if (patch.indicators || patch.session) {
      this.appliedSession = undefined;
      this.syncSession();
    }
    // The main series is the first one that is not an indicator output, so it may change with capabilities.
    if (patch.indicators) this.markers.update();
    this.bump();
  }

  /**
   * The context actions receive. With a target that has a price (and the `priceActions()` feature), `price`
   * is resolved from it; pass `price` to set it explicitly (the "+" button and price shortcuts do).
   */
  context(
    target: ContextTarget | null = null,
    location: ActionContext['location'] = 'api',
    price?: PriceContext | null,
  ): ActionContext {
    let resolved = price ?? null;
    if (price === undefined && target && target.price !== null && this.priceResolver) {
      try {
        resolved = this.priceResolver(target);
      } catch {
        resolved = null;
      }
    }
    return {
      ui: this,
      chart: this.chart,
      i18n: this.i18n,
      t: this.i18n.t.bind(this.i18n),
      capabilities: this._capabilities,
      target,
      location,
      price: resolved,
    };
  }

  /** Translates a key, or interpolates literal text. */
  translate(label: string, values?: TranslationValues): string {
    if (this.i18n.has(label) || this.i18n.has(label, this.i18n.fallbackLocale))
      return this.i18n.t(label, values);
    if (!values) return label;
    return label.replace(/\{(\w+)\}/g, (m, k: string) =>
      values[k] === undefined ? m : String(values[k]),
    );
  }

  label(action: UiAction, context: ActionContext = this.context()): string {
    if (typeof action.label === 'function') return action.label(context);
    // `{price}` in any label is the price the user pointed at (price actions).
    const values = context.price
      ? { price: context.price.formatted, ...action.labelValues?.(context) }
      : action.labelValues?.(context);
    return this.translate(action.label, values);
  }

  description(action: UiAction): string | undefined {
    return action.description ? this.translate(action.description) : undefined;
  }

  /** Effective shortcut (user override, `null` = none) formatted for the platform, or undefined. */
  shortcut(action: UiAction): string | undefined {
    const raw = this.rawShortcut(action);
    return raw ? formatShortcut(raw) : undefined;
  }

  rawShortcut(action: UiAction): string | undefined {
    const custom = this.preferences.get().shortcuts[action.id];
    if (custom === null) return undefined;
    return custom ?? action.shortcut;
  }

  /** Capabilities present and `isVisible` true. */
  isAvailable(action: UiAction, context: ActionContext = this.context()): boolean {
    if (action.requires?.some((name) => this._capabilities[name] === undefined)) return false;
    try {
      return action.isVisible ? action.isVisible(context) : true;
    } catch {
      return false;
    }
  }

  isEnabled(action: UiAction, context: ActionContext = this.context()): boolean {
    if (!this.registry.isEnabledFlag(action.id)) return false;
    try {
      return action.isEnabled ? action.isEnabled(context) : true;
    } catch {
      return false;
    }
  }

  isActive(action: UiAction, context: ActionContext = this.context()): boolean {
    try {
      return action.isActive ? action.isActive(context) : false;
    } catch {
      return false;
    }
  }

  // ───────────────────────── toolbars ─────────────────────────

  /** Every header/sidebar action with its placement (including hidden ones; for settings UIs). */
  placements(): ToolbarItem[] {
    const context = this.context();
    return placeActions(
      this.registry.list().filter((a) => this.isAvailable(a, context)),
      this.preferences.get(),
    );
  }

  header(): HeaderLayout {
    return headerLayout(this.placements());
  }

  sidebar(): ToolbarGroup[] {
    return sidebarLayout(this.placements());
  }

  setActionVisible(id: string, visible: boolean): void {
    const actions = {
      ...this.preferences.get().actions,
      [id]: { ...this.preferences.get().actions[id], visible },
    };
    this.preferences.update({ actions });
  }

  /** Moves an action to a header section or the sidebar, at `index` among that container's items. */
  moveAction(
    id: string,
    to: { location: ToolbarLocation; section?: HeaderSection; group?: string; index?: number },
  ): void {
    const item = this.placements().find((i) => i.action.id === id);
    if (!item) throw new UiError(`unknown toolbar action "${id}"`);
    if (!item.movable.includes(to.location))
      throw new UiError(`action "${id}" cannot be placed in the ${to.location}`);
    const section = to.section ?? item.section;
    const container = this.placements().filter((i) =>
      to.location === 'header'
        ? i.location === 'header' && i.section === section
        : i.location === 'sidebar',
    );
    const index = to.index ?? container.length;
    const extra = {
      location: to.location,
      ...(to.location === 'header' ? { section } : {}),
      ...(to.group ? { group: to.group } : {}),
    };
    this.preferences.update({
      actions: reorderPlacements(
        this.preferences.get().actions,
        container.map((i) => i.action.id),
        id,
        index,
        extra,
      ),
    });
  }

  /** Moves an action one place up/down (start/end) within its container. */
  shiftAction(id: string, delta: -1 | 1): void {
    const items = this.placements();
    const item = items.find((i) => i.action.id === id);
    if (!item) throw new UiError(`unknown toolbar action "${id}"`);
    const container = items.filter(
      (i) =>
        i.location === item.location && (item.location === 'sidebar' || i.section === item.section),
    );
    const index = container.indexOf(item);
    this.moveAction(id, {
      location: item.location,
      section: item.section,
      index: Math.max(0, index + delta),
    });
  }

  // ───────────────────────── execution ─────────────────────────

  async execute(
    id: string,
    location: ActionContext['location'] = 'api',
    target: ContextTarget | null = null,
    price?: PriceContext | null,
  ): Promise<void> {
    const action = this.registry.get(id);
    if (!action) throw new UiError(`unknown action "${id}"`);
    const context = this.context(target, location, price);
    if (!this.isAvailable(action, context) || !this.isEnabled(action, context)) return;
    if (!action.run) throw new UiError(`action "${id}" has no run(); open its menu instead`);
    try {
      await action.run(context);
      this.emitter.emit('execute', { actionId: id, location });
    } catch (error) {
      this.reportError(error, id);
    }
  }

  /** Runs the action bound to a key combination. Returns true when one matched. */
  handleKeyDown(event: KeyLike): boolean {
    if (this.menu.state.open) return this.menu.handleKey(event.key);
    for (const action of this.registry.list()) {
      // Price actions need a price: the price-actions feature runs their shortcuts at the crosshair price.
      if (action.priceAction) continue;
      const shortcut = this.rawShortcut(action);
      if (!shortcut || !action.run || !matchShortcut(shortcut, event)) continue;
      const context = this.context(null, 'shortcut');
      if (!this.isAvailable(action, context) || !this.isEnabled(action, context)) continue;
      void this.execute(action.id, 'shortcut');
      return true;
    }
    for (const handler of this.keyHandlers) {
      try {
        if (handler(event)) return true;
      } catch (error) {
        this.reportError(error, 'keyboard');
      }
    }
    return false;
  }

  /** Listens for shortcuts on an element (the chart element by default). */
  bindKeyboard(element: HTMLElement = this.chart.element()): Unsubscribe {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)))
        return;
      if (this.handleKeyDown(event)) event.preventDefault();
    };
    element.addEventListener('keydown', onKey);
    return () => element.removeEventListener('keydown', onKey);
  }

  notify(message: string, kind: 'info' | 'error' = 'info'): void {
    if (this._capabilities.notify) this._capabilities.notify(message);
    this.emitter.emit('notify', { message, kind });
  }

  /** Legend values at a bar time (the hovered bar) or, with null, at the last bar. */
  legend(time: number | null = null): LegendData {
    return legendData(this, time);
  }

  openSettings(category?: string): void {
    this._capabilities.openSettings?.(category);
  }

  destroy(): void {
    if (this.destroyed) return;
    for (const id of [...this.features.keys()].reverse()) {
      try {
        this.removeFeature(id);
      } catch (error) {
        console.error(`[market-chart/ui] feature "${id}" failed to uninstall`, error);
      }
    }
    this.destroyed = true;
    this.settingsSections.clear();
    this.treeSections.clear();
    for (const off of this.offs.splice(0)) off();
    for (const off of this.capabilityOffs.splice(0)) off();
    this.menu.destroy();
    this.markers.destroy();
    if (this.ownsPreferences) this.preferences.destroy();
    this.emitter.clear();
  }

  /** Menu entries of toolbar actions (overflow "More" menu, sidebar flyouts), in the given order. */
  toolbarEntries(actions: readonly UiAction[], location: 'header' | 'sidebar'): MenuEntry[] {
    const ordered = actions.map((action, i) => ({ ...action, category: undefined, order: i }));
    return buildEntries(ordered, this.menuEnvironment(this.context(null, location)));
  }

  /** Menu entries of any actions in a given context (the price-action menu uses this). */
  menuEntries(actions: readonly UiAction[], context: ActionContext): MenuEntry[] {
    return buildEntries(actions, this.menuEnvironment(context));
  }

  /** The dropdown of one toolbar action (its submenu or select options). */
  actionMenuEntries(id: string, location: 'header' | 'sidebar'): MenuEntry[] {
    const action = this.registry.get(id);
    if (!action) return [];
    const [entry] = buildEntries(
      [{ ...action, run: undefined }],
      this.menuEnvironment(this.context(null, location)),
    );
    return entry?.type === 'item' && entry.children ? [...entry.children] : [];
  }

  /** Opens the shared menu with any entries (toolbar dropdowns use the same renderer as context menus). */
  openEntries(
    entries: readonly MenuEntry[],
    x: number,
    y: number,
    source: 'mouse' | 'touch' | 'keyboard' | 'api' = 'api',
  ): void {
    this.menu.show({ x, y, target: null, entries, direction: this.i18n.direction, source });
  }

  // ───────────────────────── internals ─────────────────────────

  private menuEnvironment(context: ActionContext) {
    return {
      context,
      translate: (label: string, values?: TranslationValues) => this.translate(label, values),
      isAvailable: (a: UiAction, c: ActionContext) => this.isAvailable(a, c),
      isEnabled: (a: UiAction, c: ActionContext) => this.isEnabled(a, c),
      shortcutOf: (a: UiAction) => this.shortcut(a),
      labelOf: (a: UiAction, c: ActionContext) => this.label(a, c),
      confirmOf: (a: UiAction, c: ActionContext) => {
        if (!a.confirm) return null;
        const message = typeof a.confirm === 'function' ? a.confirm(c) : this.translate(a.confirm);
        return message || null;
      },
    };
  }

  private entriesFor(target: ContextTarget): MenuEntry[] {
    const hidden = new Set(this.preferences.get().contextMenu.hidden);
    const actions = this.registry
      .list({ location: 'contextMenu', target: target.kind })
      .filter((a) => !hidden.has(a.id));
    return buildEntries(actions, this.menuEnvironment(this.context(target, 'contextMenu')));
  }

  private showMenu(
    x: number,
    y: number,
    target: ContextTarget,
    source: 'mouse' | 'touch' | 'keyboard' | 'api',
  ): void {
    const entries = this.entriesFor(target);
    this.menu.show({ x, y, target, entries, direction: this.i18n.direction, source });
  }

  private onContextMenu(event: ContextMenuEvent): void {
    if (event.defaultPrevented) return;
    event.preventDefault();
    const target = this.resolveTargetOf(event);
    for (const interceptor of this.interceptors) {
      try {
        if (interceptor(event, target)) return;
      } catch (error) {
        this.reportError(error, 'contextMenu');
      }
    }
    // Right-clicking a drawing selects it, so drawing actions apply to what the user sees highlighted.
    if (
      target.drawing &&
      this._capabilities.drawings &&
      !this._capabilities.drawings.selection().includes(target.drawing.id)
    ) {
      this._capabilities.drawings.select([target.drawing.id]);
    }
    this.showMenu(event.clientX, event.clientY, target, event.source);
  }

  private resolveTargetOf(event: ContextMenuEvent): ContextTarget {
    for (const resolver of this.resolvers) {
      try {
        const target = resolver(event);
        if (target) return target;
      } catch (error) {
        this.reportError(error, 'contextMenu');
      }
    }
    return resolveTarget(event, this._capabilities);
  }

  private applyPreferences(p: UiPreferences): void {
    const locale = p.locale ?? this.defaultLocale;
    if (this.i18n.resolve(locale) && this.i18n.resolve(locale) !== this.i18n.locale)
      this.i18n.setLocale(locale);
    this.i18n.setDirection(p.direction);
    this.i18n.setNumerals(p.numerals);
    if (p.theme && this.chart.options().theme !== p.theme && !this.chart.destroyed) {
      try {
        this.chart.setTheme(p.theme as ThemeInput);
      } catch (error) {
        this.reportError(error, 'theme');
      }
    }
    this.applyChartLocale();
  }

  private applyChartLocale(): void {
    if (this.options.syncChartLocale === false || this.chart.destroyed) return;
    const localizeNumbers = this.preferences.get().localDigits && this.i18n.numerals === 'native';
    const current = this.chart.options().localization;
    if (
      current.locale !== this.i18n.formatLocale ||
      current.direction !== this.i18n.direction ||
      current.localizeNumbers !== localizeNumbers
    ) {
      this.chart.applyOptions({
        localization: {
          locale: this.i18n.formatLocale,
          direction: this.i18n.direction,
          localizeNumbers,
        },
      });
    }
  }

  /** Toolbar states depend on drawing/indicator managers: re-render when they change. */
  private watchCapabilities(): void {
    for (const off of this.capabilityOffs.splice(0)) off();
    const bump = (): void => this.bump();
    const { drawings, indicators, session } = this._capabilities;
    if (session?.subscribe) this.capabilityOffs.push(session.subscribe(() => this.syncSession()));
    if (drawings) {
      this.capabilityOffs.push(
        drawings.on('toolChange', bump),
        drawings.on('historyChange', bump),
        drawings.on('magnetChange', bump),
        drawings.on('selectionChange', bump),
        drawings.on('change', bump),
      );
    }
    if (indicators)
      this.capabilityOffs.push(
        indicators.on('added', bump),
        indicators.on('removed', bump),
        indicators.on('changed', bump),
      );
  }

  private reportError(error: unknown, actionId: string): void {
    console.error(`[market-chart/ui] action "${actionId}" failed`, error);
    this.notify(error instanceof Error ? error.message : String(error), 'error');
  }

  private bump(): void {
    if (this.destroyed) return;
    this._version++;
    this.emitter.emit('change', { version: this._version });
  }
}

/** Adds `item` to `list` (at the front when `first`) and returns its removal. */
function addTo<T>(list: T[], item: T, first: boolean): Unsubscribe {
  if (first) list.unshift(item);
  else list.push(item);
  return () => {
    const index = list.indexOf(item);
    if (index >= 0) list.splice(index, 1);
  };
}

export function createChartUi(chart: ChartApi, options?: ChartUiOptions): ChartUi {
  return new ChartUi(chart, options);
}
