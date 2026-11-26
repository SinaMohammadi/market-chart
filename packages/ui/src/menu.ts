import { EventEmitter } from '@market-chart/core';
import type { ContextMenuEvent, Unsubscribe } from '@market-chart/core';
import type {
  ActionContext,
  ChartUiCapabilities,
  ContextTarget,
  SubmenuItem,
  UiAction,
} from './types.js';

// ───────────────────────────── targets ─────────────────────────────

const OHLC_TYPES = new Set(['candlestick', 'bar', 'custom']);

/**
 * What a context-menu event points at, most specific first: drawing handle, drawing, indicator, data point
 * (candlestick or other series), then pane / chart background, or an axis.
 */
export function resolveTarget(
  event: ContextMenuEvent,
  capabilities: ChartUiCapabilities,
): ContextTarget {
  const base = { event, pane: event.pane, time: event.time, price: event.price };
  switch (event.region) {
    case 'priceAxis':
      return { ...base, kind: 'priceAxis', side: event.side ?? 'right' };
    case 'timeAxis':
      return { ...base, kind: 'timeAxis' };
    case 'separator':
      return { ...base, kind: 'pane' };
    case 'pane': {
      const hit = capabilities.drawings?.drawingAt(event);
      if (hit) {
        return hit.handle !== null
          ? { ...base, kind: 'drawingHandle', drawing: hit.drawing, handle: hit.handle }
          : { ...base, kind: 'drawing', drawing: hit.drawing };
      }
      const nearest = event.series[0];
      if (nearest) {
        const indicator = capabilities.indicators?.indicatorForSeries(nearest.series);
        if (indicator)
          return {
            ...base,
            kind: 'indicator',
            indicator,
            series: nearest.series,
            point: nearest.point,
          };
        const kind =
          OHLC_TYPES.has(nearest.series.type) && 'open' in nearest.point ? 'candlestick' : 'series';
        return { ...base, kind, series: nearest.series, point: nearest.point };
      }
      return { ...base, kind: event.pane === 0 || event.pane === null ? 'chart' : 'pane' };
    }
    default:
      return { ...base, kind: 'chart' };
  }
}

// ───────────────────────────── entries ─────────────────────────────

export interface MenuItemEntry {
  readonly type: 'item';
  readonly key: string;
  readonly actionId: string;
  readonly label: string;
  /** Breadcrumb shown with search results, e.g. "Add indicator › Momentum". */
  readonly path: string;
  readonly icon?: string;
  readonly shortcut?: string;
  readonly disabled: boolean;
  /** null when the item is not checkable. */
  readonly checked: boolean | null;
  /** Information row, not executable. */
  readonly info: boolean;
  readonly children: readonly MenuEntry[] | null;
  readonly searchable: boolean;
  readonly confirm: string | null;
  readonly run: (() => void | Promise<void>) | null;
}

export interface MenuSeparatorEntry {
  readonly type: 'separator';
  readonly key: string;
}

export type MenuEntry = MenuItemEntry | MenuSeparatorEntry;

/** Context-menu categories in display order; unknown categories go last, in registration order. */
export const CATEGORY_ORDER = [
  // Price actions ('At this price') first: the menu was opened at a price.
  'trade',
  'drawing',
  'drawing-arrange',
  'drawing-danger',
  'indicator',
  'indicator-danger',
  'point',
  'axis',
  'pane',
  'view',
  'add',
  'chart',
  'export',
  'settings',
];

export interface MenuBuildEnvironment {
  readonly context: ActionContext;
  readonly translate: (label: string, values?: Readonly<Record<string, string | number>>) => string;
  readonly isAvailable: (action: UiAction, context: ActionContext) => boolean;
  readonly isEnabled: (action: UiAction, context: ActionContext) => boolean;
  readonly shortcutOf: (action: UiAction) => string | undefined;
  readonly labelOf: (action: UiAction, context: ActionContext) => string;
  readonly confirmOf: (action: UiAction, context: ActionContext) => string | null;
}

/** Builds the menu for a set of actions (already filtered by target and user preferences). */
export function buildEntries(actions: readonly UiAction[], env: MenuBuildEnvironment): MenuEntry[] {
  const ctx = env.context;
  const available = actions.filter((action) => env.isAvailable(action, ctx));
  const rank = (category: string | undefined): number => {
    const index = CATEGORY_ORDER.indexOf(category ?? '');
    return index < 0 ? CATEGORY_ORDER.length : index;
  };
  const sorted = available
    .map((action, i) => ({ action, i }))
    .sort(
      (a, b) =>
        rank(a.action.category) - rank(b.action.category) ||
        a.action.order - b.action.order ||
        a.i - b.i,
    )
    .map((x) => x.action);
  const out: MenuEntry[] = [];
  let lastCategory: string | undefined;
  for (const action of sorted) {
    if (out.length && action.category !== lastCategory)
      out.push({ type: 'separator', key: `sep:${action.id}` });
    lastCategory = action.category;
    const label = env.labelOf(action, ctx);
    const disabled = !env.isEnabled(action, ctx);
    let children: MenuEntry[] | null = null;
    if (action.kind === 'select' && action.options) {
      const current = action.value!(ctx);
      children = action.options(ctx).map((choice) => ({
        type: 'item' as const,
        key: `${action.id}:${choice.value}`,
        actionId: action.id,
        label: env.translate(choice.label, choice.labelValues),
        path: label,
        ...(choice.icon ? { icon: choice.icon } : {}),
        disabled: false,
        checked: choice.value === current,
        info: false,
        children: null,
        searchable: false,
        confirm: null,
        run: () => action.select!(ctx, choice.value),
      }));
    } else if (action.submenu) {
      children = submenuEntries(action, action.submenu(ctx), label, env);
    }
    const shortcut = env.shortcutOf(action);
    out.push({
      type: 'item',
      key: action.id,
      actionId: action.id,
      label,
      path: '',
      ...(action.icon ? { icon: action.icon } : {}),
      ...(shortcut ? { shortcut } : {}),
      disabled: disabled || (children !== null && children.length === 0 && !action.run),
      checked: action.isActive ? action.isActive(ctx) : null,
      info: false,
      children: children && action.run ? null : children,
      searchable: action.searchable === true,
      confirm: env.confirmOf(action, ctx),
      run: action.run ? () => action.run!(ctx) : null,
    });
  }
  return out;
}

function submenuEntries(
  action: UiAction,
  items: readonly SubmenuItem[],
  parentPath: string,
  env: MenuBuildEnvironment,
): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const item of items) {
    if (item.separatorBefore && out.length)
      out.push({ type: 'separator', key: `sep:${action.id}:${item.id}` });
    const label = env.translate(item.label, item.labelValues);
    out.push({
      type: 'item',
      key: `${action.id}:${item.id}`,
      actionId: action.id,
      label,
      path: parentPath,
      ...(item.icon ? { icon: item.icon } : {}),
      disabled: item.disabled === true,
      checked: item.checked ?? null,
      info: item.info === true,
      children: item.children
        ? submenuEntries(action, item.children, `${parentPath} › ${label}`, env)
        : null,
      searchable: false,
      confirm: null,
      run: item.run ? () => item.run!() : null,
    });
  }
  return out;
}

/** Lower-cased, without combining marks (accents, Arabic harakat), for searching. */
export const foldText = (text: string): string =>
  text.toLocaleLowerCase().normalize('NFD').replace(/[̀-ًͯ-ٟ]/g, '');

/** Executable items matching `query` anywhere in the menu tree (with their breadcrumb), for searchable menus. */
export function searchEntries(
  entries: readonly MenuEntry[],
  query: string,
  limit = 50,
): MenuItemEntry[] {
  const q = foldText(query.trim());
  if (!q) return [];
  const out: MenuItemEntry[] = [];
  const walk = (list: readonly MenuEntry[]): void => {
    for (const entry of list) {
      if (out.length >= limit) return;
      if (entry.type !== 'item') continue;
      if (entry.children) walk(entry.children);
      else if (
        entry.run &&
        !entry.info &&
        (foldText(entry.label).includes(q) || foldText(entry.path).includes(q))
      )
        out.push(entry);
    }
  };
  walk(entries);
  return out;
}

// ───────────────────────────── controller ─────────────────────────────

export interface ContextMenuState {
  readonly open: boolean;
  /** Viewport coordinates of the anchor point. */
  readonly x: number;
  readonly y: number;
  readonly target: ContextTarget | null;
  readonly entries: readonly MenuEntry[];
  readonly query: string;
  /** Flat search results when `query` is not empty. */
  readonly results: readonly MenuItemEntry[] | null;
  /** Active item index per open level (`path.length` = number of open menus). */
  readonly path: readonly number[];
  readonly confirm: { readonly message: string; readonly entry: MenuItemEntry } | null;
  readonly direction: 'ltr' | 'rtl';
  /** How it was opened (keyboard menus focus their first item). */
  readonly source: 'mouse' | 'touch' | 'keyboard' | 'api';
}

export interface ContextMenuEvents {
  change: { readonly state: ContextMenuState };
  execute: { readonly actionId: string; readonly target: ContextTarget | null };
  error: { readonly error: unknown; readonly actionId: string };
}

const CLOSED: ContextMenuState = {
  open: false,
  x: 0,
  y: 0,
  target: null,
  entries: [],
  query: '',
  results: null,
  path: [],
  confirm: null,
  direction: 'ltr',
  source: 'api',
};

/**
 * Headless context-menu state machine: open/close, nested submenus, search, keyboard navigation (with
 * RTL-aware left/right), confirmation and execution. Any renderer (the React one or a custom one) drives it.
 */
export class ContextMenuController {
  private readonly emitter = new EventEmitter<ContextMenuEvents>();
  private _state: ContextMenuState = CLOSED;

  get state(): ContextMenuState {
    return this._state;
  }

  on<K extends keyof ContextMenuEvents>(
    event: K,
    listener: (payload: ContextMenuEvents[K]) => void,
  ): Unsubscribe {
    return this.emitter.on(event, listener);
  }

  show(input: {
    x: number;
    y: number;
    target: ContextTarget | null;
    entries: readonly MenuEntry[];
    direction: 'ltr' | 'rtl';
    source: ContextMenuState['source'];
  }): void {
    if (!input.entries.some((e) => e.type === 'item')) {
      this.close();
      return;
    }
    const first = input.source === 'keyboard' ? firstEnabled(input.entries) : -1;
    this.set({ ...CLOSED, ...input, open: true, path: [first] });
  }

  close(): void {
    if (!this._state.open) return;
    this.set(CLOSED);
  }

  /** Entries of open level `level` (search results replace the root level). */
  levelEntries(level: number): readonly MenuEntry[] {
    let list: readonly MenuEntry[] = this._state.results ?? this._state.entries;
    for (let i = 0; i < level; i++) {
      const entry = list[this._state.path[i]!];
      if (!entry || entry.type !== 'item' || !entry.children) return [];
      list = entry.children;
    }
    return list;
  }

  /** Pointer hover: makes the item active and opens its submenu (closing deeper ones). */
  hover(level: number, index: number): void {
    const entry = this.levelEntries(level)[index];
    if (!entry || entry.type !== 'item') return;
    const path = [...this._state.path.slice(0, level), index];
    if (entry.children && !entry.disabled) path.push(-1);
    this.set({ ...this._state, path });
  }

  setQuery(query: string): void {
    const results = query.trim() ? searchEntries(this._state.entries, query) : null;
    this.set({ ...this._state, query, results, path: [results && results.length ? 0 : -1] });
  }

  /** Activates an item: opens its submenu or runs it (after confirmation when required). */
  activate(level: number, index: number): void {
    const entry = this.levelEntries(level)[index];
    if (!entry || entry.type !== 'item' || entry.disabled || entry.info) return;
    if (entry.children) {
      this.set({
        ...this._state,
        path: [...this._state.path.slice(0, level), index, firstEnabled(entry.children)],
      });
      return;
    }
    if (!entry.run) return;
    if (entry.confirm) {
      this.set({ ...this._state, confirm: { message: entry.confirm, entry } });
      return;
    }
    this.execute(entry);
  }

  /** Answers a pending confirmation. */
  confirm(accept: boolean): void {
    const pending = this._state.confirm;
    if (!pending) return;
    if (accept) this.execute(pending.entry);
    else this.set({ ...this._state, confirm: null });
  }

  /**
   * Keyboard handling. Returns true when the key was used. ArrowRight/ArrowLeft open and close submenus
   * according to the reading direction (mirrored in RTL).
   */
  handleKey(key: string): boolean {
    const s = this._state;
    if (!s.open) return false;
    if (s.confirm) {
      if (key === 'Escape') this.confirm(false);
      else if (key === 'Enter') this.confirm(true);
      else return false;
      return true;
    }
    const level = s.path.length - 1;
    const list = this.levelEntries(level);
    const active = s.path[level] ?? -1;
    const forward = s.direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
    const back = s.direction === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
    const setActive = (index: number): void =>
      this.set({ ...s, path: [...s.path.slice(0, level), index] });
    switch (key) {
      case 'ArrowDown':
        setActive(step(list, active, 1));
        return true;
      case 'ArrowUp':
        setActive(step(list, active < 0 ? list.length : active, -1));
        return true;
      case 'Home':
        setActive(step(list, -1, 1));
        return true;
      case 'End':
        setActive(step(list, list.length, -1));
        return true;
      case forward: {
        const entry = list[active];
        if (entry?.type === 'item' && entry.children && !entry.disabled)
          this.activate(level, active);
        return true;
      }
      case back:
        if (level > 0) this.set({ ...s, path: s.path.slice(0, level) });
        return true;
      case 'Escape':
        if (s.query) this.setQuery('');
        else if (level > 0) this.set({ ...s, path: s.path.slice(0, level) });
        else this.close();
        return true;
      case 'Enter':
      case ' ':
        if (active >= 0) this.activate(level, active);
        return true;
      case 'Tab':
        this.close();
        return false;
      default:
        if (key.length === 1 && key !== ' ' && !s.results) {
          // Type-ahead: next item whose label starts with the character.
          const lower = key.toLocaleLowerCase();
          for (let i = 1; i <= list.length; i++) {
            const index = (active + i) % list.length;
            const entry = list[index];
            if (
              entry?.type === 'item' &&
              !entry.disabled &&
              entry.label.toLocaleLowerCase().startsWith(lower)
            ) {
              setActive(index);
              return true;
            }
          }
        }
        return false;
    }
  }

  destroy(): void {
    this._state = CLOSED;
    this.emitter.clear();
  }

  private execute(entry: MenuItemEntry): void {
    const target = this._state.target;
    this.close();
    try {
      const result = entry.run!();
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch((error: unknown) =>
          this.emitter.emit('error', { error, actionId: entry.actionId }),
        );
      }
      this.emitter.emit('execute', { actionId: entry.actionId, target });
    } catch (error) {
      this.emitter.emit('error', { error, actionId: entry.actionId });
    }
  }

  private set(state: ContextMenuState): void {
    this._state = state;
    this.emitter.emit('change', { state });
  }
}

function step(list: readonly MenuEntry[], from: number, delta: 1 | -1): number {
  if (!list.length) return -1;
  let index = from;
  for (let i = 0; i < list.length; i++) {
    index = (index + delta + list.length) % list.length;
    const entry = list[index];
    if (entry?.type === 'item' && !entry.disabled) return index;
  }
  return from;
}

function firstEnabled(list: readonly MenuEntry[]): number {
  return step(list, -1, 1);
}
