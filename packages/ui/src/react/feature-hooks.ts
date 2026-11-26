import { createContext, createElement, useCallback, useId, useSyncExternalStore } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import type { ChartUi } from '../chart-ui.js';
import type { OrderTicket, OrderTicketState } from '../order-ticket.js';
import type { PriceButtonState } from '../price-actions.js';
import type { SymbolSearch, SymbolSearchState } from '../symbols.js';
import type { SymbolItem, TicketField } from '../types.js';
import { matchShortcut } from '../util.js';
import { useUiVersion } from './hooks.js';

/** Information passed to a custom result renderer. */
export interface SymbolItemRenderInfo {
  readonly active: boolean;
  readonly favorite: boolean;
  readonly current: boolean;
  readonly query: string;
}

/**
 * Custom views for the built-in symbol search (dialog and dropdown). Provide them with
 * `<SymbolSearchViews>` (or `ChartInterface`'s `symbolSearchViews`). Whatever they return is rendered by
 * React, so application text stays text.
 */
export interface SymbolSearchViewOptions {
  /** One result row (inside the option element; the favourite star is added unless `hideStar`). */
  readonly renderItem?: (item: SymbolItem, info: SymbolItemRenderInfo) => ReactNode;
  readonly renderEmpty?: (state: SymbolSearchState) => ReactNode;
  readonly renderError?: (state: SymbolSearchState, retry: () => void) => ReactNode;
  /** Row height in CSS px for the virtualised list (default 48). */
  readonly rowHeight?: number;
  readonly hideStar?: boolean;
}

export const SymbolSearchViewContext = createContext<SymbolSearchViewOptions>({});

export function SymbolSearchViews({
  children,
  ...views
}: SymbolSearchViewOptions & { readonly children?: ReactNode }) {
  return createElement(SymbolSearchViewContext.Provider, { value: views }, children);
}

const noop = (): void => undefined;

/** Everything a custom symbol selector needs: state, actions, and ARIA/keyboard props (combobox pattern). */
export interface SymbolSearchApi {
  /** Null until the `symbolSearch()` feature is installed. */
  readonly search: SymbolSearch | null;
  readonly state: SymbolSearchState | null;
  readonly groups: readonly { readonly id: string; readonly label: string }[];
  /** Current symbol (from the application's source). */
  readonly current: string | null;
  open(input?: Parameters<SymbolSearch['open']>[0]): void;
  close(): void;
  setQuery(query: string): void;
  setGroup(group: string): void;
  select(item: SymbolItem): void;
  isFavorite(symbol: string): boolean;
  toggleFavorite(symbol: string): void;
  /** Id of the result element at `index` (for `aria-activedescendant`). */
  optionId(index: number): string;
  readonly listboxId: string;
  /** Spread on the search `<input>`. */
  readonly inputProps: {
    readonly role: 'combobox';
    readonly 'aria-expanded': boolean;
    readonly 'aria-controls': string;
    readonly 'aria-autocomplete': 'list';
    readonly 'aria-activedescendant': string | undefined;
    readonly autoComplete: 'off';
    readonly spellCheck: false;
    readonly value: string;
    readonly onChange: (event: { target: { value: string } }) => void;
    readonly onKeyDown: (event: ReactKeyboardEvent) => void;
  };
  /** Spread on the results container. */
  readonly listboxProps: {
    readonly id: string;
    readonly role: 'listbox';
    readonly 'aria-label': string;
  };
  /** Spread on each result. */
  optionProps(index: number): {
    readonly id: string;
    readonly role: 'option';
    readonly 'aria-selected': boolean;
    readonly 'aria-disabled': boolean | undefined;
    readonly onMouseMove: () => void;
    readonly onClick: () => void;
  };
}

/**
 * Headless symbol search for a completely custom selector. Re-renders on search state changes. `Mod+D` in
 * the input toggles the highlighted symbol's favourite.
 */
export function useSymbolSearch(ui: ChartUi | null): SymbolSearchApi {
  useUiVersion(ui);
  const search = ui?.symbols ?? null;
  const state = useSyncExternalStore(
    (onChange) => (search ? search.on('change', onChange) : noop),
    () => search?.state ?? null,
    () => null,
  );
  // Favourites live in the preferences.
  useSyncExternalStore(
    (onChange) => (ui ? ui.preferences.on('change', onChange) : noop),
    () => ui?.preferences.get() ?? null,
    () => null,
  );
  const base = useId().replace(/:/g, '');
  const listboxId = `${base}-results`;
  const optionId = useCallback((index: number) => `${base}-option-${index}`, [base]);
  const t = ui ? ui.i18n.t.bind(ui.i18n) : (key: string) => key;
  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (!search) return;
      const s = search.state;
      if (matchShortcut('Mod+D', event)) {
        const item = s.results[s.active];
        if (item) {
          event.preventDefault();
          search.toggleFavorite(item.symbol);
        }
        return;
      }
      if (search.handleKey(event)) event.preventDefault();
    },
    [search],
  );
  const groups = search?.groups() ?? [];
  const active = state && state.active >= 0 ? optionId(state.active) : undefined;
  return {
    search,
    state,
    groups,
    current: search?.current() ?? null,
    open: (input) => search?.open(input),
    close: () => search?.close(),
    setQuery: (query) => search?.setQuery(query),
    setGroup: (group) => search?.setGroup(group),
    select: (item) => void search?.select(item),
    isFavorite: (symbol) => search?.isFavorite(symbol) ?? false,
    toggleFavorite: (symbol) => search?.toggleFavorite(symbol),
    optionId,
    listboxId,
    inputProps: {
      role: 'combobox',
      'aria-expanded': !!state?.open && state.results.length > 0,
      'aria-controls': listboxId,
      'aria-autocomplete': 'list',
      'aria-activedescendant': active,
      autoComplete: 'off',
      spellCheck: false,
      value: state?.query ?? '',
      onChange: (event) => search?.setQuery(event.target.value),
      onKeyDown,
    },
    listboxProps: { id: listboxId, role: 'listbox', 'aria-label': t('symbols.title') },
    optionProps: (index) => {
      const item = state?.results[index];
      return {
        id: optionId(index),
        role: 'option',
        'aria-selected': state?.active === index,
        'aria-disabled': item?.disabled ? true : undefined,
        onMouseMove: () => {
          if (search && search.state.active !== index && !item?.disabled) search.setActive(index);
        },
        onClick: () => {
          if (item && search) void search.select(item);
        },
      };
    },
  };
}

/** Headless order ticket: state, fields and actions for a custom ticket. */
export interface OrderTicketApi {
  /** Null until the `orderTicket()` feature is installed. */
  readonly ticket: OrderTicket | null;
  readonly state: OrderTicketState | null;
  /** Fields shown for the current values. */
  readonly fields: readonly TicketField[];
  /** Validation messages, once the user has edited or tried to submit. */
  readonly errors: Readonly<Record<string, string>>;
  readonly confirmationRequired: boolean;
  open(input?: Parameters<OrderTicket['open']>[0]): void;
  close(): void;
  setValue(id: string, value: string | number | null): void;
  step(id: string, direction: 1 | -1): void;
  submit(): void;
  confirm(): void;
  cancelConfirm(): void;
}

export function useOrderTicket(ui: ChartUi | null): OrderTicketApi {
  useUiVersion(ui);
  const ticket = ui?.orderTicket ?? null;
  const state = useSyncExternalStore(
    (onChange) => (ticket ? ticket.on('change', onChange) : noop),
    () => ticket?.state ?? null,
    () => null,
  );
  return {
    ticket,
    state,
    fields: ticket && state?.open ? ticket.visibleFields() : [],
    errors: ticket && state?.open && ticket.showErrors() ? state.errors : {},
    confirmationRequired: ticket?.confirmationRequired() ?? true,
    open: (input) => ticket?.open(input),
    close: () => ticket?.close(),
    setValue: (id, value) => ticket?.setValue(id, value),
    step: (id, direction) => ticket?.step(id, direction),
    submit: () => void ticket?.submit(),
    confirm: () => void ticket?.confirm(),
    cancelConfirm: () => ticket?.cancelConfirm(),
  };
}

/** Where the price-axis "+" button is, or null while it is hidden. */
export function usePriceButton(ui: ChartUi | null): PriceButtonState | null {
  useUiVersion(ui);
  const actions = ui?.priceActions ?? null;
  return useSyncExternalStore(
    (onChange) => (actions ? actions.on('button', onChange) : noop),
    () => actions?.button() ?? null,
    () => null,
  );
}
