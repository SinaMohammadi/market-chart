import type { LineStyle, SeriesApi } from '@market-chart/core';
// Type-only: erased at runtime, so both packages stay optional peers.
import type { I18n } from '@market-chart/i18n';
import type { ChartUi } from '@market-chart/ui';

export type TradingSide = 'buy' | 'sell';

/** Order status; drives the colour and the status text. `filled`, `cancelled` and `rejected` are not drawn. */
export type OrderStatus = 'pending' | 'working' | 'partial' | 'filled' | 'cancelled' | 'rejected';

/** An order of the application, drawn as a line and a label at its price. */
export interface TradingOrder {
  readonly id: string;
  readonly side: TradingSide;
  /** `limit`, `stop`, `market` or the application's own type (shown as given). */
  readonly type: string;
  readonly price: number;
  readonly quantity: number;
  readonly status?: OrderStatus;
  /** Replaces the type text in the label (plain text). */
  readonly label?: string;
  /** CSS colour (default: by side and status). */
  readonly color?: string;
  /** Per-order override of dragging (default: the overlay option and the user's preference). */
  readonly draggable?: boolean;
  /** Per-order override of the cancel (×) button. */
  readonly cancellable?: boolean;
  /** Anything the application needs back (never read by the library). */
  readonly meta?: unknown;
}

/** A position, with optional take-profit and stop-loss lines linked to it. */
export interface TradingPosition {
  readonly id: string;
  readonly side: TradingSide;
  readonly entryPrice: number;
  readonly quantity: number;
  /** P&L text supplied by the application (the library never calculates prices or P&L). */
  readonly pnl?: string;
  /** Sign of the P&L, for its colour (positive green, negative red). */
  readonly pnlValue?: number;
  readonly takeProfit?: number | null;
  readonly stopLoss?: number | null;
  readonly label?: string;
  readonly color?: string;
  /** Per-position override of dragging its take-profit and stop-loss lines. */
  readonly draggable?: boolean;
  readonly meta?: unknown;
}

/** A price alert. */
export interface TradingAlert {
  readonly id: string;
  readonly price: number;
  readonly label?: string;
  readonly color?: string;
  /** Inactive alerts are drawn dimmed. */
  readonly active?: boolean;
  readonly draggable?: boolean;
  readonly cancellable?: boolean;
  readonly meta?: unknown;
}

/** Any other price object of the application (liquidation price, break-even, target…). */
export interface PriceMarker {
  readonly id: string;
  readonly price: number;
  readonly label?: string;
  readonly color?: string;
  /** The application's own marker type (shown in tooltips and passed back). */
  readonly kind?: string;
  readonly lineStyle?: LineStyle;
  readonly draggable?: boolean;
  readonly cancellable?: boolean;
  /** Price label on the axis (default true). */
  readonly axisLabel?: boolean;
  readonly meta?: unknown;
}

export type TradingObjectKind = 'order' | 'position' | 'alert' | 'marker';

/** The line of a position: its entry, its take-profit or its stop-loss. */
export type TradingObjectPart = 'main' | 'takeProfit' | 'stopLoss';

export type TradingObject = TradingOrder | TradingPosition | TradingAlert | PriceMarker;

/** Which object, and which of its lines, a callback is about. */
export interface TradingObjectInfo {
  readonly kind: TradingObjectKind;
  readonly id: string;
  readonly part: TradingObjectPart;
}

/** User preferences (saved with the UI preferences when a `ChartUi` is given). */
export interface TradingPreferences {
  readonly orders: boolean;
  readonly positions: boolean;
  readonly alerts: boolean;
  readonly markers: boolean;
  /** Drag lines to modify prices (only where the application handles `onModify`). */
  readonly draggable: boolean;
  readonly showQuantity: boolean;
  readonly showPnl: boolean;
  readonly showStatus: boolean;
  /** Price labels on the price axis. */
  readonly axisLabels: boolean;
  /** `auto`: compact labels on charts narrower than `compactWidth`. */
  readonly compact: 'auto' | 'always' | 'never';
  readonly lineStyle: LineStyle;
}

export interface TradingColors {
  readonly buy: string;
  readonly sell: string;
  /** Orders still waiting for the broker (`pending`) and lines waiting for `onModify`. */
  readonly pending: string;
  readonly takeProfit: string;
  readonly stopLoss: string;
  readonly alert: string;
  readonly marker: string;
  readonly profit: string;
  readonly loss: string;
  /** Label text on coloured backgrounds. */
  readonly labelText: string;
}

/** What a custom label format receives. */
export interface TradingLabelInput {
  readonly kind: TradingObjectKind;
  readonly part: TradingObjectPart;
  readonly object: TradingObject;
  /** The price formatted like the series' axis labels. */
  readonly price: string;
  readonly compact: boolean;
  readonly preferences: TradingPreferences;
}

export interface TradingOverlayOptions {
  /** Series the objects are attached to (default: the chart's first series, also once it is added). */
  readonly series?: SeriesApi;
  /**
   * A `ChartUi` (`@market-chart/ui`) for context menus on the objects, an object-tree section, a "Trading"
   * settings category, persisted preferences and translations. Optional: the overlay works without it.
   */
  readonly ui?: ChartUi;
  /** Application defaults of the user preferences. */
  readonly defaults?: Partial<TradingPreferences>;
  /** Called when the user changes a preference (without a `ui`, to persist them yourself). */
  readonly onPreferencesChange?: (preferences: TradingPreferences) => void;
  readonly colors?: Partial<TradingColors>;
  /** Label segments (plain text). Default: type/side, quantity, status, P&L. */
  readonly labelFormat?: (input: TradingLabelInput) => readonly string[];
  /** Tooltip lines on hover (plain text); null for none. Default: kind, side, price, quantity, status. */
  readonly tooltip?: ((input: TradingLabelInput) => readonly string[] | null) | false;
  /** Label side (default `right`, next to the price axis). */
  readonly labelPosition?: 'left' | 'right';
  /** Width below which `compact: 'auto'` shortens labels (default 520 CSS px). */
  readonly compactWidth?: number;
  /** Dragging, cancel buttons and clicks (each default true when its callback is given). */
  readonly interaction?: {
    readonly drag?: boolean;
    readonly cancel?: boolean;
    readonly select?: boolean;
  };
  /**
   * The user dragged a line to `price` (rounded to the tick size). The line shows as pending until the promise
   * settles and goes back to its old price when it rejects or resolves to `false`. Apply the change by
   * updating the object (`upsertOrder` …) or let a resolved promise keep the new price.
   */
  readonly onModify?: (
    object: TradingObject,
    price: number,
    info: TradingObjectInfo,
    // The result: `false` (or a rejected promise) means the change was refused; anything else accepts it.
  ) => unknown;
  /** Cancel (×) of an order, alert or marker, or of a position's take-profit / stop-loss. */
  readonly onCancel?: (object: TradingObject, info: TradingObjectInfo) => unknown;
  /** Close a position (× on its label and the context menu). The × is shown only when this is given. */
  readonly onClosePosition?: (position: TradingPosition) => Promise<void> | void;
  readonly onSelect?: (object: TradingObject, info: TradingObjectInfo) => void;
  /** Double-click, the "Modify" menu item and the object tree's edit button. */
  readonly onEdit?: (object: TradingObject, info: TradingObjectInfo) => void;
  readonly onHover?: (object: TradingObject | null, info: TradingObjectInfo | null) => void;
  /** Failed callbacks and invalid objects (default: the UI's notification, else the chart's `error` event). */
  readonly onError?: (error: unknown) => void;
  /** Translations without a `ui`: an i18n instance (`@market-chart/i18n`) whose language is used. */
  readonly i18n?: I18n;
}
