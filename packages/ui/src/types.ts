import type { ChartUi } from './chart-ui.js';
import type {
  ChartApi,
  ContextMenuEvent,
  SeriesApi,
  SeriesData,
  SeriesType,
  TradingSession,
  Unsubscribe,
} from '@market-chart/core';
import type { AnyTranslationKey, I18n, TranslationValues } from '@market-chart/i18n';
import type { Drawing, DrawingManager } from '@market-chart/drawing-tools';
import type { IndicatorHandle, IndicatorManager } from '@market-chart/indicators';

/** Where an action can appear. */
export type ActionLocation = 'contextMenu' | 'header' | 'sidebar';

/** Header sections; "left"/"right" are the start/end of the reading direction (mirrored in RTL). */
export type HeaderSection = 'left' | 'center' | 'right';

/** What was right-clicked (or long-pressed, or opened from the keyboard). */
export type ContextTargetKind =
  | 'chart'
  | 'pane'
  | 'candlestick'
  | 'series'
  | 'indicator'
  | 'drawing'
  | 'drawingHandle'
  | 'priceAxis'
  | 'timeAxis'
  // Application objects shown at prices (see `@market-chart/trading`), resolved by `ui.targets.register`.
  | 'order'
  | 'position'
  | 'alert'
  | 'marker';

/** An application object under the pointer (order, position, alert, custom marker). */
export interface PriceObjectTarget {
  readonly type: 'order' | 'position' | 'alert' | 'marker';
  readonly id: string;
  /** Part of the object that was hit, e.g. `takeProfit` / `stopLoss` lines of a position. */
  readonly part?: string;
  /** The application's object as it was passed in (read-only for actions). */
  readonly data: unknown;
}

export interface ContextTarget {
  readonly kind: ContextTargetKind;
  /** The core event the target was resolved from. */
  readonly event: ContextMenuEvent;
  readonly pane: number | null;
  readonly time: number | null;
  readonly price: number | null;
  /** Series under the point (data-point and indicator targets). */
  readonly series?: SeriesApi;
  readonly point?: SeriesData<SeriesType>;
  readonly indicator?: IndicatorHandle;
  readonly drawing?: Drawing;
  /** Handle index (`drawingHandle`). */
  readonly handle?: number;
  /** Price axis side (`priceAxis`). */
  readonly side?: 'left' | 'right';
  /** Application object (`order`, `position`, `alert`, `marker` targets). */
  readonly object?: PriceObjectTarget;
}

export interface Choice {
  readonly value: string;
  readonly label: AnyTranslationKey | string;
  readonly labelValues?: TranslationValues;
  readonly icon?: string;
}

/**
 * Features the application provides. Actions that need a capability (`requires`) are hidden when it is
 * missing, so a menu never offers something that cannot work.
 */
/**
 * The current symbol's trading session, e.g. `datafeedSession(controller)` from `@market-chart/datafeed`.
 * `subscribe` reports changes (a new symbol).
 */
export interface SessionCapability {
  value(): TradingSession | null;
  subscribe?(listener: () => void): Unsubscribe;
}

/** Size of the "+" button and its gap to the price axis (CSS px), shared with the React button. */
export const PRICE_BUTTON_SIZE = 20;
export const PRICE_BUTTON_GAP = 3;

/** A rectangle in CSS px relative to a pane's top-left corner (see `ChartUi.reservedAreas`). */
export interface ReservedArea {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface ChartUiCapabilities {
  /**
   * Indicators. With a `session` capability or a session time-zone preference other than `exchange`, the
   * UI keeps `indicators.setSession` in step with `ui.session()`.
   */
  readonly indicators?: IndicatorManager;
  /** The symbol's exchange session (see `SessionCapability`). */
  readonly session?: SessionCapability;
  readonly drawings?: DrawingManager;
  /** Interval switching (e.g. a `DatafeedController`). */
  readonly timeframe?: {
    value(): string;
    readonly options: readonly string[];
    set(value: string): void;
  };
  /** Changing the main series' representation (the application owns the series). */
  readonly chartType?: {
    value(): string;
    readonly options: readonly string[];
    set(value: string): void;
  };
  /** Simple symbol switcher (a fixed list of choices). `symbols` is the richer source used by symbol search. */
  readonly symbol?: { value(): string; options?(): readonly Choice[]; set(value: string): void };
  /**
   * Symbol source for the symbol selector (`symbolSearch()` feature): current symbol, a static list and/or an
   * async, cancellable server search, and groups. See `SymbolSource`.
   */
  readonly symbols?: SymbolSource;
  /**
   * Comparison series. `open` opens the application's own dialog; `add` lets the symbol search add the chosen
   * symbol as a comparison (the search opens in compare mode).
   */
  readonly compare?: {
    open?(): void;
    add?(item: SymbolItem): void | Promise<void>;
  };
  /**
   * Order entry owned by the application (`orderTicket()` feature). The library never trades: it shows a
   * ticket and calls `submit` after an explicit user action.
   */
  readonly trading?: TradingCapability;
  readonly alerts?: {
    create(input: { price: number; time: number | null; series?: SeriesApi }): void;
    open?(): void;
  };
  readonly inspect?: (target: ContextTarget) => void;
  /** Saves the layout (e.g. `ChartPersistence.save`). */
  readonly saveLayout?: () => void | Promise<void>;
  readonly loadWorkspace?: () => void;
  /** Opens the settings UI (the React layer provides one). */
  readonly openSettings?: (category?: string) => void;
  readonly editDrawingText?: (drawing: Drawing) => void;
  readonly drawingProperties?: (drawing: Drawing) => void;
  readonly indicatorSettings?: (indicator: IndicatorHandle, tab: 'inputs' | 'style') => void;
  /** Side panels: toggled by sidebar actions, `isOpen` drives the active state. */
  readonly panels?: Readonly<Record<string, { toggle(): void; isOpen(): boolean }>>;
  /** Overrides for side effects (default: clipboard API, file download, console). */
  readonly clipboard?: (text: string) => void | Promise<void>;
  readonly download?: (file: { name: string; blob: Blob }) => void;
  readonly notify?: (message: string) => void;
  /** Element shown in fullscreen (default: the UI root or the chart element). */
  readonly fullscreenElement?: () => HTMLElement | null;
}

export type CapabilityName = keyof ChartUiCapabilities;

export interface ActionContext {
  readonly ui: ChartUi;
  readonly chart: ChartApi;
  readonly i18n: I18n;
  readonly t: I18n['t'];
  readonly capabilities: ChartUiCapabilities;
  /** Set for context-menu actions. */
  readonly target: ContextTarget | null;
  readonly location: ActionLocation | 'shortcut' | 'api';
  /**
   * The price the user pointed at, rounded to the series' tick size, for price actions (context menu on the
   * chart, candles and price axis; the price-axis "+" button; shortcuts at the crosshair). Null elsewhere.
   */
  readonly price?: PriceContext | null;
}

/** Where a price action was asked for (see `ActionContext.price`). */
export interface PriceContext {
  /** Rounded to the series' `minMove` (tick size). */
  readonly price: number;
  /** The price formatted like the series' axis labels (with locale digits when enabled). */
  readonly formatted: string;
  /** Bar time under the point, if any. */
  readonly time: number | null;
  /** Relative to the series' last price (`above` when equal or unknown). */
  readonly side: 'above' | 'below';
  readonly series: SeriesApi | null;
  readonly pane: number;
  /** Current symbol (from the `symbols` or `symbol` capability), or null. */
  readonly symbol: string | null;
  /** Tick size used for rounding (0 when the series has none). */
  readonly tick: number;
  /** Entry point: context menu, "+" button, keyboard shortcut, touch long-press or code. */
  readonly source: 'contextMenu' | 'axisButton' | 'shortcut' | 'touch' | 'api';
}

// ───────────────────────────── symbols ─────────────────────────────

/** One entry of the symbol list or of search results. Texts are shown as plain text (never as HTML). */
export interface SymbolItem {
  readonly symbol: string;
  readonly name?: string;
  readonly description?: string;
  readonly exchange?: string;
  readonly type?: string;
  /** Group id (see `SymbolSource.groups`). */
  readonly group?: string;
  /** Image URL (https, http or data:image) or a registered icon name. */
  readonly icon?: string;
  /** Short tag such as "PERP" or "NEW". */
  readonly badge?: string;
  readonly disabled?: boolean;
  /** Anything the application needs back (never read by the library). */
  readonly meta?: unknown;
}

export interface SymbolSearchRequest {
  /** Aborted when a newer query replaces this one or the search closes. */
  readonly signal: AbortSignal;
  readonly limit: number;
  /** Selected group id, if a group tab is selected. */
  readonly group?: string;
}

/** Where symbols come from. Provide `list` (filtered locally), `search` (e.g. a server), or both. */
export interface SymbolSource {
  /** Current symbol. */
  value(): string;
  set(symbol: string, item?: SymbolItem): void;
  /** Async, cancellable search. Called with the debounced query (also the empty query, to fill the list). */
  search?(query: string, options: SymbolSearchRequest): Promise<readonly SymbolItem[]>;
  /** A static list; filtered and sorted locally when there is no `search`. */
  list?(): readonly SymbolItem[];
  /** Group tabs (e.g. Crypto, Forex, Stocks). Favorites and Recent are added by the library. */
  readonly groups?: readonly { readonly id: string; readonly label: string }[];
}

// ───────────────────────────── order entry ─────────────────────────────

export type OrderSide = 'buy' | 'sell';

/** A field of the order ticket. The application declares which fields exist and how they are validated. */
export interface TicketField {
  readonly id: string;
  /** Translation key or text. */
  readonly label: AnyTranslationKey | string;
  /**
   * `price` fields are prefilled with the clicked price and stepped by the tick size; `number` fields are
   * stepped by `step`; `select` fields use `options`; `side` is the buy/sell switch; `text` is free text.
   */
  readonly kind: 'price' | 'number' | 'select' | 'text' | 'side';
  readonly options?: readonly Choice[];
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly maxLength?: number;
  readonly required?: boolean;
  readonly default?: string | number;
  /** Shown (and validated) only when this returns true, e.g. a stop price only for stop-limit orders. */
  readonly visible?: (values: TicketValues) => boolean;
  /** Extra validation; return a message (translation key or text) to reject the value. */
  readonly validate?: (value: string | number | null, values: TicketValues) => string | null;
}

/** Ticket values by field id (numbers for price/number fields, strings otherwise; null when empty). */
export type TicketValues = Readonly<Record<string, string | number | null>>;

/** What `submit` receives. */
export interface OrderTicketSubmission {
  readonly side: OrderSide;
  readonly type: string;
  readonly symbol: string | null;
  /** Every visible field, validated. Price fields are rounded to the tick size. */
  readonly values: TicketValues;
  /** Where the ticket was opened (price, time, series), or null when opened from code without a price. */
  readonly context: PriceContext | null;
}

/** The application's answer to `submit`. A rejected promise counts as `{ ok: false }` with its message. */
export interface OrderSubmitResult {
  readonly ok: boolean;
  /** Shown to the user as plain text (e.g. the order id or the rejection reason). */
  readonly message?: string;
}

export interface TradingCapability {
  /**
   * Sends the order. Called once per explicit user confirmation and never retried by the library; while it is
   * pending the ticket cannot be submitted again.
   */
  submit(ticket: OrderTicketSubmission): Promise<OrderSubmitResult>;
  /** Order types offered (default `limit` and `stop`). */
  readonly orderTypes?: readonly Choice[];
  /** Ticket fields (default: side, type, price, quantity). */
  readonly fields?: readonly TicketField[];
  /** Default quantity (default 1). */
  readonly defaultQuantity?: number;
  /** Lets users switch off the confirmation step in settings (default false: always confirm). */
  readonly allowSkipConfirmation?: boolean;
  /**
   * Shown on the ticket when set, for submissions that do not reach a real market (e.g. "Simulated").
   * Examples and demos must set it.
   */
  readonly simulatedLabel?: string;
}

/** One entry of a dynamic submenu (or of a select/menu in the header). */
export interface SubmenuItem {
  readonly id: string;
  readonly label: AnyTranslationKey | string;
  readonly labelValues?: TranslationValues;
  readonly icon?: string;
  readonly checked?: boolean;
  readonly disabled?: boolean;
  /** Informational row (e.g. OHLC values): shown, not executable. */
  readonly info?: boolean;
  readonly separatorBefore?: boolean;
  readonly children?: readonly SubmenuItem[];
  run?(): void | Promise<void>;
}

/**
 * How toolbars show an action: a button (`run`), a toggle (`isActive`), a select (`options` + `value`) or a
 * menu (dropdown of `submenu`). Context menus show every kind as a menu item (selects as submenus).
 */
export type ActionKind = 'button' | 'toggle' | 'select' | 'menu';

export interface UiActionDefinition {
  readonly id: string;
  /** Translation key (or literal text) and its values. */
  readonly label: AnyTranslationKey | string | ((ctx: ActionContext) => string);
  readonly labelValues?: (ctx: ActionContext) => TranslationValues;
  readonly description?: AnyTranslationKey | string;
  readonly icon?: string;
  readonly kind?: ActionKind;
  /** Context-menu category; categories are separated and ordered by `categoryOrder`. */
  readonly category?: string;
  /** Toolbar group (separators between groups; sidebar flyouts for tool groups). */
  readonly group?: string;
  readonly locations?: readonly ActionLocation[];
  /** Context-menu targets (default: none, so not in context menus). */
  readonly targets?: readonly ContextTargetKind[];
  /** Default header section. */
  readonly section?: HeaderSection;
  readonly order?: number;
  /** Shown by default in toolbars (default true). Users can change it without touching the definition. */
  readonly defaultVisible?: boolean;
  /** e.g. `Mod+Z`, `Alt+R`, `Shift+Delete` (`Mod` = Ctrl, or ⌘ on macOS). */
  readonly shortcut?: string;
  readonly requires?: readonly CapabilityName[];
  readonly isVisible?: (ctx: ActionContext) => boolean;
  readonly isEnabled?: (ctx: ActionContext) => boolean;
  /** Toggle state (pressed button, checked menu item). */
  readonly isActive?: (ctx: ActionContext) => boolean;
  readonly run?: (ctx: ActionContext) => void | Promise<void>;
  readonly submenu?: (ctx: ActionContext) => readonly SubmenuItem[];
  /**
   * A price action: listed in the price-axis "+" menu and the context menu's "At this price" category, and
   * runnable from its shortcut at the crosshair price; `ctx.price` is set when it runs. Register through
   * `ui.priceActions.register` (the `priceActions()` feature) to get the default targets and category.
   */
  readonly priceAction?: boolean;
  /** Searchable submenu (large lists such as indicators). */
  readonly searchable?: boolean;
  /** `kind: 'select'` */
  readonly options?: (ctx: ActionContext) => readonly Choice[];
  readonly value?: (ctx: ActionContext) => string;
  readonly select?: (ctx: ActionContext, value: string) => void;
  /** Asks before running (translated message). */
  readonly confirm?: AnyTranslationKey | string | ((ctx: ActionContext) => string | null);
  /** Plugin or package that registered the action (removed together with `unregisterOwner`). */
  readonly owner?: string;
  /** Opaque custom renderer for UI layers (the React layer accepts a component). */
  readonly component?: unknown;
}

/** A registered action with defaults applied. */
export interface UiAction extends UiActionDefinition {
  readonly kind: ActionKind;
  readonly locations: readonly ActionLocation[];
  readonly targets: readonly ContextTargetKind[];
  readonly order: number;
  readonly defaultVisible: boolean;
  readonly owner: string;
}
