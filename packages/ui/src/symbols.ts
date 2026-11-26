import { EventEmitter } from '@market-chart/core';
import type { Unsubscribe } from '@market-chart/core';
import type { ChartUi } from './chart-ui.js';
import type { ChartUiFeature } from './extensions.js';
import { iconNames } from './icons.js';
import { foldText } from './menu.js';
import { MAX_FAVORITE_SYMBOLS, SYMBOL_SELECTOR_MODES, isStoredSymbol } from './preferences.js';
import type { SymbolSelectorMode } from './preferences.js';
import type { SymbolItem, SymbolSource } from './types.js';
import { matchShortcut, safeText } from './util.js';
import type { KeyLike } from './util.js';

/** Group tab ids added by the library. */
export const ALL_SYMBOLS = 'all';
export const FAVORITE_SYMBOLS = 'favorites';
export const RECENT_SYMBOLS = 'recent';

export interface SymbolSearchOptions {
  /** Application default (users can change it in settings). Default `dropdown`. */
  readonly mode?: SymbolSelectorMode;
  /** Modes users may choose in settings (default: `dropdown`, `modal`, `both`). Empty: no setting. */
  readonly modes?: readonly SymbolSelectorMode[];
  /** Opens the search (default `Mod+K`; null for none). */
  readonly shortcut?: string | null;
  /** Typing a letter or digit on the focused chart opens the search with it (default true). */
  readonly typeToSearch?: boolean;
  /** Most results shown and asked from `search` (default 100). */
  readonly limit?: number;
  /** Quiet period before `search` is called (default 200 ms; local lists filter at once). */
  readonly debounceMs?: number;
  /** Result order (default: exact symbol, symbol prefix, name prefix, other matches; then list order). */
  readonly sort?: (a: SymbolItem, b: SymbolItem, query: string) => number;
  /** Order of the source's group tabs (ids); unlisted groups follow in source order. */
  readonly groupOrder?: readonly string[];
  /** Favorites (star) and its tab (default true). */
  readonly favorites?: boolean;
  /** Recent symbols tab (default true). */
  readonly recent?: boolean;
  /** Recent symbols kept (default 10, at most 50). */
  readonly maxRecent?: number;
  /** Injectable timers (tests). */
  readonly timers?: {
    setTimeout(fn: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
  };
}

export type SymbolSearchStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface SymbolSearchState {
  readonly open: boolean;
  /** `compare` adds the chosen symbol as a comparison (`compare.add`) instead of switching. */
  readonly purpose: 'select' | 'compare';
  /**
   * Which interface shows it: the header dropdown, the search dialog, or the application's own (custom mode,
   * `useSymbolSearch`).
   */
  readonly surface: 'dropdown' | 'modal' | 'custom';
  readonly query: string;
  /** Selected tab: `all`, `favorites`, `recent` or a source group id. */
  readonly group: string;
  readonly status: SymbolSearchStatus;
  readonly results: readonly SymbolItem[];
  /** Plain-text error message of the last failed search. */
  readonly error: string | null;
  /** Highlighted result (keyboard), or -1. */
  readonly active: number;
}

export interface SymbolSearchEvents {
  change: { readonly state: SymbolSearchState };
  select: { readonly item: SymbolItem; readonly purpose: 'select' | 'compare' };
}

const CLOSED: SymbolSearchState = {
  open: false,
  purpose: 'select',
  surface: 'modal',
  query: '',
  group: ALL_SYMBOLS,
  status: 'idle',
  results: [],
  error: null,
  active: -1,
};

const LETTER_OR_DIGIT = /^[\p{L}\p{N}]$/u;
const ICON_URL = /^(https?:\/\/|data:image\/(png|gif|jpeg|webp);)/i;

/**
 * Validates one item from the application or a server: plain text fields are cleaned and bounded, unknown
 * icons and invalid symbols are dropped. Returns null for unusable entries.
 */
export function normalizeSymbolItem(input: unknown): SymbolItem | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  if (!isStoredSymbol(raw['symbol'])) return null;
  const text = (key: string, max: number): string | undefined => {
    const value = raw[key];
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;
    return safeText(value, max) || undefined;
  };
  const icon = typeof raw['icon'] === 'string' ? raw['icon'] : undefined;
  const validIcon =
    icon && (ICON_URL.test(icon) ? icon.length <= 100_000 : iconNames().includes(icon))
      ? icon
      : undefined;
  const item: Record<string, unknown> = { symbol: raw['symbol'] };
  const name = text('name', 120);
  const description = text('description', 200);
  const exchange = text('exchange', 40);
  const type = text('type', 40);
  const group = text('group', 60);
  const badge = text('badge', 16);
  if (name) item['name'] = name;
  if (description) item['description'] = description;
  if (exchange) item['exchange'] = exchange;
  if (type) item['type'] = type;
  if (group) item['group'] = group;
  if (badge) item['badge'] = badge;
  if (validIcon) item['icon'] = validIcon;
  if (raw['disabled'] === true) item['disabled'] = true;
  if ('meta' in raw) item['meta'] = raw['meta'];
  return item as unknown as SymbolItem;
}

/** Relevance of an item for a folded query (lower is better; Infinity = no match). */
export function symbolRank(item: SymbolItem, foldedQuery: string): number {
  if (!foldedQuery) return 0;
  const symbol = foldText(item.symbol);
  if (symbol === foldedQuery) return 0;
  if (symbol.startsWith(foldedQuery)) return 1;
  const name = foldText(item.name ?? '');
  if (name.startsWith(foldedQuery)) return 2;
  if (symbol.includes(foldedQuery) || name.includes(foldedQuery)) return 3;
  const rest = foldText(`${item.description ?? ''} ${item.exchange ?? ''} ${item.type ?? ''}`);
  return rest.includes(foldedQuery) ? 4 : Number.POSITIVE_INFINITY;
}

/** Filters and ranks a local list (stable within a rank). */
export function filterSymbols(
  items: readonly SymbolItem[],
  query: string,
  limit: number,
  group?: string,
): SymbolItem[] {
  const q = foldText(query.trim());
  const ranked: { item: SymbolItem; rank: number; index: number }[] = [];
  items.forEach((item, index) => {
    if (group && item.group !== group) return;
    const rank = symbolRank(item, q);
    if (rank !== Number.POSITIVE_INFINITY) ranked.push({ item, rank, index });
  });
  ranked.sort((a, b) => a.rank - b.rank || a.index - b.index);
  return ranked.slice(0, limit).map((r) => r.item);
}

/** The application's symbol source: `symbols`, or the simple `symbol` capability adapted to one. */
export function symbolSourceOf(ui: ChartUi): SymbolSource | null {
  const { symbols, symbol } = ui.capabilities;
  if (symbols) return symbols;
  if (!symbol) return null;
  return {
    value: () => symbol.value(),
    set: (value) => symbol.set(value),
    list: () =>
      (symbol.options?.() ?? [{ value: symbol.value(), label: symbol.value() }]).map((c) => ({
        symbol: c.value,
        name: ui.translate(c.label, c.labelValues),
      })),
  };
}

/**
 * Headless symbol search: query with debounce, group tabs, favorites and recent symbols (saved in the user's
 * preferences), cancellable async search (stale requests are aborted and their answers ignored), keyboard
 * navigation, selection and compare mode. The React dialog, the header dropdown and `useSymbolSearch` all
 * render this state.
 */
export class SymbolSearch {
  readonly options: Readonly<SymbolSearchOptions>;
  private readonly ui: ChartUi;
  private readonly emitter = new EventEmitter<SymbolSearchEvents>();
  private _state: SymbolSearchState = CLOSED;
  private timer: unknown = null;
  private controller: AbortController | null = null;
  private generation = 0;
  /** Items seen in lists and results, so favourites and recents show names. Bounded. */
  private readonly known = new Map<string, SymbolItem>();
  private destroyed = false;

  constructor(ui: ChartUi, options: SymbolSearchOptions = {}) {
    this.ui = ui;
    this.options = options;
  }

  get state(): SymbolSearchState {
    return this._state;
  }

  on<K extends keyof SymbolSearchEvents>(
    event: K,
    listener: (payload: SymbolSearchEvents[K]) => void,
  ): Unsubscribe {
    return this.emitter.on(event, listener);
  }

  source(): SymbolSource | null {
    return symbolSourceOf(this.ui);
  }

  /** The current symbol, or null without a source. */
  current(): string | null {
    try {
      return this.source()?.value() ?? null;
    } catch {
      return null;
    }
  }

  /** Item of the current symbol (from the list or earlier results), or a bare item. */
  currentItem(): SymbolItem | null {
    const symbol = this.current();
    return symbol === null ? null : this.itemOf(symbol);
  }

  /** Effective selector mode: the user's choice, or the application default. */
  mode(): SymbolSelectorMode {
    return this.ui.preferences.get().symbols.mode ?? this.options.mode ?? 'dropdown';
  }

  setMode(mode: SymbolSelectorMode | null): void {
    if (mode !== null && !SYMBOL_SELECTOR_MODES.includes(mode)) return;
    this.ui.preferences.update({ symbols: { mode } });
  }

  limit(): number {
    const limit = this.options.limit ?? 100;
    return Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 10_000) : 100;
  }

  /** Tabs: All, Favorites, Recent (when enabled) and the source's groups in `groupOrder`. */
  groups(): readonly { readonly id: string; readonly label: string }[] {
    const t = this.ui.i18n.t.bind(this.ui.i18n);
    const own = [...(this.source()?.groups ?? [])].filter(
      (g) =>
        g &&
        typeof g.id === 'string' &&
        ![ALL_SYMBOLS, FAVORITE_SYMBOLS, RECENT_SYMBOLS].includes(g.id),
    );
    const order = this.options.groupOrder ?? [];
    own.sort((a, b) => {
      const ia = order.indexOf(a.id);
      const ib = order.indexOf(b.id);
      return (ia < 0 ? order.length : ia) - (ib < 0 ? order.length : ib);
    });
    return [
      { id: ALL_SYMBOLS, label: t('symbols.all') },
      ...(this.options.favorites !== false
        ? [{ id: FAVORITE_SYMBOLS, label: t('symbols.favorites') }]
        : []),
      ...(this.options.recent !== false
        ? [{ id: RECENT_SYMBOLS, label: t('symbols.recent') }]
        : []),
      ...own.map((g) => ({ id: g.id, label: safeText(g.label, 40) })),
    ];
  }

  favorites(): readonly string[] {
    return this.ui.preferences.get().symbols.favorites;
  }

  recent(): readonly string[] {
    return this.ui.preferences.get().symbols.recent;
  }

  isFavorite(symbol: string): boolean {
    return this.favorites().includes(symbol);
  }

  toggleFavorite(symbol: string): void {
    if (this.options.favorites === false || !isStoredSymbol(symbol)) return;
    const current = this.favorites();
    const favorites = current.includes(symbol)
      ? current.filter((s) => s !== symbol)
      : [...current, symbol].slice(-MAX_FAVORITE_SYMBOLS);
    this.ui.preferences.update({ symbols: { favorites } });
    if (this._state.open && this._state.group === FAVORITE_SYMBOLS) this.refresh();
  }

  /** Opens the search (optionally with a query, a tab, or in compare mode). */
  open(
    input: {
      query?: string;
      group?: string;
      purpose?: 'select' | 'compare';
      surface?: 'dropdown' | 'modal' | 'custom';
    } = {},
  ): void {
    if (this.destroyed || !this.source()) return;
    const purpose =
      input.purpose === 'compare' && this.ui.capabilities.compare?.add ? 'compare' : 'select';
    const group =
      input.group && this.groups().some((g) => g.id === input.group) ? input.group : ALL_SYMBOLS;
    const mode = this.mode();
    const surface =
      input.surface ??
      (mode === 'custom'
        ? 'custom'
        : mode === 'dropdown' && purpose === 'select'
          ? 'dropdown'
          : 'modal');
    this.set({
      ...CLOSED,
      open: true,
      purpose,
      surface,
      group,
      query: safeText(input.query ?? '', 100),
    });
    this.refresh(true);
  }

  close(): void {
    this.cancel();
    if (this._state.open) this.set(CLOSED);
  }

  setQuery(query: string): void {
    if (!this._state.open) return;
    const next = safeText(query, 100);
    if (next === this._state.query && query.length <= 100) return;
    this.set({ ...this._state, query: next });
    this.refresh();
  }

  /** Runs the current search again (after an error). */
  retry(): void {
    if (this._state.open) this.refresh(true);
  }

  setGroup(group: string): void {
    if (!this._state.open || group === this._state.group) return;
    if (!this.groups().some((g) => g.id === group)) return;
    this.set({ ...this._state, group, active: -1 });
    this.refresh(true);
  }

  setActive(index: number): void {
    const results = this._state.results;
    const next = index < 0 || index >= results.length ? -1 : index;
    if (next !== this._state.active) this.set({ ...this._state, active: next });
  }

  /** Keyboard navigation of the results. Returns true when the key was used. */
  handleKey(event: Pick<KeyLike, 'key'> & Partial<KeyLike>): boolean {
    const s = this._state;
    if (!s.open) return false;
    const n = s.results.length;
    const move = (from: number, delta: number): number => {
      if (!n) return -1;
      let index = from;
      for (let i = 0; i < n; i++) {
        index = Math.min(n - 1, Math.max(0, index + delta));
        if (!s.results[index]?.disabled) return index;
        if ((delta > 0 && index === n - 1) || (delta < 0 && index === 0)) break;
      }
      return s.active;
    };
    switch (event.key) {
      case 'ArrowDown':
        this.setActive(move(s.active, 1));
        return true;
      case 'ArrowUp':
        this.setActive(s.active <= 0 ? move(0, 0) : move(s.active, -1));
        return true;
      case 'PageDown':
        this.setActive(move(s.active, 10));
        return true;
      case 'PageUp':
        this.setActive(move(Math.max(0, s.active), -10));
        return true;
      case 'Home':
        if (event.ctrlKey || event.metaKey) {
          this.setActive(move(-1, 1));
          return true;
        }
        return false;
      case 'End':
        if (event.ctrlKey || event.metaKey) {
          this.setActive(move(n, -1));
          return true;
        }
        return false;
      case 'Enter': {
        const item = s.results[s.active] ?? (n === 1 ? s.results[0] : undefined);
        if (item) void this.select(item);
        return true;
      }
      case 'Escape':
        this.close();
        return true;
      default:
        return false;
    }
  }

  /** Switches to (or, in compare mode, adds) the item, records it as recent and closes. */
  async select(item: SymbolItem): Promise<void> {
    if (item.disabled || !isStoredSymbol(item.symbol)) return;
    const purpose = this._state.purpose;
    this.remember(item);
    this.close();
    try {
      if (purpose === 'compare') await this.ui.capabilities.compare?.add?.(item);
      else this.source()?.set(item.symbol, item);
      if (this.options.recent !== false) {
        const max = Math.min(50, Math.max(1, this.options.maxRecent ?? 10));
        const recent = [item.symbol, ...this.recent().filter((s) => s !== item.symbol)].slice(
          0,
          max,
        );
        this.ui.preferences.update({ symbols: { recent } });
      }
      this.emitter.emit('select', { item, purpose });
    } catch (error) {
      this.ui.notify(error instanceof Error ? error.message : String(error), 'error');
    }
  }

  /** Keyboard handler installed by the feature: the shortcut, and type-to-search on the chart. */
  handleChartKey(event: KeyLike): boolean {
    if (this._state.open || this.mode() === 'none' || !this.source()) return false;
    const shortcut = this.options.shortcut === undefined ? 'Mod+K' : this.options.shortcut;
    if (shortcut && matchShortcut(shortcut, event)) {
      this.open();
      return true;
    }
    if (
      this.options.typeToSearch !== false &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      LETTER_OR_DIGIT.test(event.key)
    ) {
      this.open({ query: event.key });
      return true;
    }
    return false;
  }

  destroy(): void {
    this.destroyed = true;
    this.cancel();
    this._state = CLOSED;
    this.emitter.clear();
  }

  // ───────────────────────── internals ─────────────────────────

  private itemOf(symbol: string): SymbolItem {
    const known = this.known.get(symbol);
    if (known) return known;
    for (const item of this.localList()) if (item.symbol === symbol) return item;
    return { symbol };
  }

  private remember(item: SymbolItem): void {
    if (this.known.size >= 5_000 && !this.known.has(item.symbol)) {
      const oldest = this.known.keys().next().value;
      if (oldest !== undefined) this.known.delete(oldest);
    }
    this.known.set(item.symbol, item);
  }

  private localList(): SymbolItem[] {
    let raw: readonly unknown[] = [];
    try {
      raw = this.source()?.list?.() ?? [];
    } catch {
      raw = [];
    }
    const out: SymbolItem[] = [];
    for (const entry of raw) {
      const item = normalizeSymbolItem(entry);
      if (item) out.push(item);
    }
    return out;
  }

  private sorted(items: SymbolItem[], query: string): SymbolItem[] {
    const sort = this.options.sort;
    return sort ? [...items].sort((a, b) => sort(a, b, query)) : items;
  }

  private cancel(): void {
    if (this.timer !== null) (this.options.timers ?? globalThis).clearTimeout(this.timer as never);
    this.timer = null;
    this.controller?.abort();
    this.controller = null;
    this.generation++;
  }

  /** Recomputes results for the current query and tab (immediately, or debounced for `search`). */
  private refresh(immediate = false): void {
    this.cancel();
    const s = this._state;
    if (!s.open) return;
    const source = this.source();
    if (!source) return;
    const limit = this.limit();
    if (s.group === FAVORITE_SYMBOLS || s.group === RECENT_SYMBOLS) {
      const symbols = s.group === FAVORITE_SYMBOLS ? this.favorites() : this.recent();
      const items = filterSymbols(
        symbols.map((symbol) => this.itemOf(symbol)),
        s.query,
        limit,
      );
      this.ready(this.sorted(items, s.query));
      return;
    }
    const group = s.group === ALL_SYMBOLS ? undefined : s.group;
    if (!source.search) {
      const list = this.localList();
      for (const item of list.slice(0, 5_000)) this.remember(item);
      this.ready(this.sorted(filterSymbols(list, s.query, limit, group), s.query));
      return;
    }
    const generation = this.generation;
    this.set({ ...s, status: 'loading', error: null });
    const run = (): void => {
      this.timer = null;
      const controller = new AbortController();
      this.controller = controller;
      let request: Promise<readonly SymbolItem[]>;
      try {
        request = Promise.resolve(
          source.search!(s.query, {
            signal: controller.signal,
            limit,
            ...(group ? { group } : {}),
          }),
        );
      } catch (error) {
        request = Promise.reject(error);
      }
      request.then(
        (results) => {
          if (generation !== this.generation || controller.signal.aborted) return;
          this.controller = null;
          const items: SymbolItem[] = [];
          for (const entry of Array.isArray(results) ? results : []) {
            const item = normalizeSymbolItem(entry);
            if (item) items.push(item);
            if (items.length >= limit) break;
          }
          for (const item of items) this.remember(item);
          this.ready(this.sorted(items, s.query));
        },
        (error: unknown) => {
          if (generation !== this.generation || controller.signal.aborted) return;
          this.controller = null;
          const message =
            error instanceof Error ? safeText(error.message, 200) : safeText(error, 200);
          this.set({
            ...this._state,
            status: 'error',
            results: [],
            active: -1,
            error: message || this.ui.i18n.t('symbols.error'),
          });
        },
      );
    };
    const delay = immediate ? 0 : Math.max(0, this.options.debounceMs ?? 200);
    if (delay === 0) run();
    else this.timer = (this.options.timers ?? globalThis).setTimeout(run, delay);
  }

  private ready(results: SymbolItem[]): void {
    const active = results.findIndex((r) => !r.disabled);
    this.set({
      ...this._state,
      status: 'ready',
      results,
      error: null,
      active: this._state.query ? active : -1,
    });
  }

  private set(state: SymbolSearchState): void {
    this._state = state;
    this.emitter.emit('change', { state });
  }
}

/**
 * The symbol selector feature: `createChartUi(chart, { features: [symbolSearch({ mode: 'both' })] })`. Adds the
 * header dropdown and search button (per the selector mode), the shortcut and type-to-search, a settings
 * entry for the mode, and `ui.symbols` for opening the search from code or a custom component.
 */
export function symbolSearch(options: SymbolSearchOptions = {}): ChartUiFeature {
  return {
    id: 'symbols',
    install(ui) {
      const search = new SymbolSearch(ui, options);
      const offs: Unsubscribe[] = [];
      const modeIs = (...modes: SymbolSelectorMode[]) => modes.includes(search.mode());
      offs.push(
        ui.provide({ symbols: search, keyHandler: (event) => search.handleChartKey(event) }),
        ui.registry.registerAll(
          [
            {
              // Rendered as a dropdown by the React layer; a button that opens the search elsewhere.
              id: 'symbols.picker',
              label: (ctx) => ctx.ui.symbols?.current() ?? ctx.t('header.symbol'),
              description: 'header.symbol',
              icon: 'search',
              locations: ['header'],
              section: 'left',
              group: 'symbol',
              order: 10,
              isVisible: () => !!search.source() && modeIs('dropdown', 'both'),
              run: () => search.open(),
            },
            {
              id: 'symbols.search',
              label: 'symbols.search',
              icon: 'search',
              locations: ['header'],
              section: 'left',
              group: 'symbol',
              order: 11,
              isVisible: () => !!search.source() && modeIs('modal', 'both'),
              run: () => search.open(),
            },
          ],
          { owner: 'symbols' },
        ),
      );
      const modes = options.modes ?? ['dropdown', 'modal', 'both'];
      if (modes.length) {
        offs.push(
          ui.settings.register({
            id: 'symbols',
            label: 'symbols.settings',
            order: 100,
            fields: () => [
              {
                kind: 'select',
                id: 'symbols.mode',
                label: 'symbols.mode',
                value: () => search.mode(),
                options: () =>
                  [...new Set([...modes, search.mode()])].map((m) => ({
                    value: m,
                    label: `symbols.mode.${m}`,
                  })),
                set: (value) => search.setMode(value as SymbolSelectorMode),
              },
            ],
          }),
        );
      }
      return () => {
        for (const off of offs.splice(0).reverse()) off();
        search.destroy();
      };
    },
  };
}
