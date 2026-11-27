import {
  EventEmitter,
  createPriceFormatter,
  priceTickSize,
  roundToTick,
  safeText,
} from '@market-chart/core';
import type {
  ChartApi,
  ChartPluginContext,
  ChartPointerEvent,
  LineStyle,
  PaneLayerDrawContext,
  PriceLineApi,
  SeriesApi,
  Unsubscribe,
} from '@market-chart/core';
import { defaultLabel, defaultTooltip, layoutTradingLabels } from './layout.js';
import { attachTradingUi } from './ui-bridge.js';
import type { LabelBox, Translate } from './layout.js';
import { tradingMessages, tradingMessagesEn } from './messages.js';
import type {
  PriceMarker,
  TradingAlert,
  TradingColors,
  TradingLabelInput,
  TradingObject,
  TradingObjectInfo,
  TradingObjectKind,
  TradingObjectPart,
  TradingOrder,
  TradingOverlayOptions,
  TradingPosition,
  TradingPreferences,
} from './types.js';
import {
  DEFAULT_TRADING_PREFERENCES,
  MAX_TRADING_OBJECTS,
  TradingError,
  normalizeAlert,
  normalizeMarker,
  normalizeOrder,
  normalizePosition,
  validateTradingPreferences,
} from './validate.js';

export const DEFAULT_TRADING_COLORS: TradingColors = {
  buy: '#2962ff',
  sell: '#f23645',
  pending: '#9598a1',
  takeProfit: '#089981',
  stopLoss: '#f23645',
  alert: '#ff9800',
  marker: '#7e57c2',
  profit: '#089981',
  loss: '#f23645',
  labelText: '#ffffff',
};

/** Namespace of the overlay's preferences inside `UiPreferences.extensions`. */
export const TRADING_PREFERENCES_KEY = 'trading';

/** One drawn line (an order, alert, marker, or one of a position's three lines). */
export interface TradingItem {
  readonly key: string;
  readonly kind: TradingObjectKind;
  readonly part: TradingObjectPart;
  readonly id: string;
  /** Drawn price (the dragged or pending price while it differs from the object's). */
  price: number;
  readonly object: TradingObject;
  readonly color: string;
  readonly lineStyle: LineStyle;
  readonly dim: boolean;
  readonly draggable: boolean;
  readonly cancellable: boolean;
  readonly axisLabel: boolean;
  /** Waiting for `onModify` / cancel, or the order itself is `pending`. */
  readonly pending: boolean;
}

/** What is under a point: an item and the part of its label (or its line). */
export interface TradingHit {
  readonly item: TradingItem;
  readonly area: 'label' | 'cancel' | 'line';
}

export interface TradingOverlayEvents {
  /** Objects, preferences or display state changed (renderers of lists re-read). */
  change: { readonly revision: number };
  hover: { readonly item: TradingItem | null };
  select: { readonly item: TradingItem | null };
}

interface Drawn {
  readonly item: TradingItem;
  readonly y: number;
  readonly box: LabelBox | null;
  readonly segments: readonly { readonly text: string; readonly width: number }[];
  readonly cancelWidth: number;
}

const LABEL_HEIGHT = 18;
const CANCEL_WIDTH = 16;
const PADDING = 6;
const LINE_HIT = 4;
const DRAG_THRESHOLD = 3;
const DASHES: Record<LineStyle, number[]> = { solid: [], dashed: [6, 4], dotted: [1.5, 3] };
const HIDDEN_STATUSES = new Set(['filled', 'cancelled', 'rejected']);
let overlayCounter = 0;

function keyOf(kind: TradingObjectKind, id: string, part: TradingObjectPart = 'main'): string {
  return part === 'main' ? `${kind}:${id}` : `${kind}:${id}:${part}`;
}

/**
 * Draws the application's orders, positions (with take-profit and stop-loss), alerts and custom markers as
 * lines and labels at their prices, with optional dragging, cancel buttons, clicks, tooltips, context menus,
 * an object-tree section and settings. It is display only: it calls the application's callbacks and never
 * sends anything anywhere.
 *
 * Updates are batched: any number of `set…`/`upsert…`/`remove…` calls in one task cause one rebuild and one
 * frame. Lines are drawn in one path per colour and style, so hundreds of objects add little to a frame.
 */
export class TradingOverlay {
  readonly chart: ChartApi;
  private options: TradingOverlayOptions;
  private readonly emitter = new EventEmitter<TradingOverlayEvents>();
  private readonly pluginId: string;
  private ctx: ChartPluginContext | null = null;
  private readonly offs: Unsubscribe[] = [];
  private readonly layerPanes = new Set<number>();
  private explicitSeries: SeriesApi | null;
  private boundSeries: SeriesApi | null = null;

  private readonly _orders = new Map<string, TradingOrder>();
  private readonly _positions = new Map<string, TradingPosition>();
  private readonly _alerts = new Map<string, TradingAlert>();
  private readonly _markers = new Map<string, PriceMarker>();
  /** Bumped whenever the application replaces an object, so late callbacks do not override newer data. */
  private readonly revisions = new Map<string, number>();
  /** Prices waiting for `onModify`. */
  private readonly pendingPrices = new Map<string, number>();
  /** Prices accepted by `onModify` that the application has not sent back yet. */
  private readonly acceptedPrices = new Map<string, { price: number; revision: number }>();
  private readonly cancelling = new Set<string>();

  private _items: TradingItem[] = [];
  private readonly itemsByKey = new Map<string, TradingItem>();
  private readonly lines = new Map<string, PriceLineApi>();
  private drawn: Drawn[] = [];
  private readonly widths = new Map<string, number>();
  private prefs: TradingPreferences;
  private defaults: TradingPreferences;
  private dirty = false;
  private scheduled = false;
  private revision = 0;
  private destroyed = false;

  private press: {
    key: string;
    area: TradingHit['area'];
    startY: number;
    startPrice: number;
    revision: number;
  } | null = null;
  private drag: { key: string; price: number } | null = null;
  private hover: { key: string; area: TradingHit['area']; x: number; y: number } | null = null;
  private _selected: string | null = null;
  private highlighted: string | null = null;
  private translateFn: Translate;

  constructor(chart: ChartApi, options: TradingOverlayOptions = {}) {
    this.chart = chart;
    this.options = options;
    this.explicitSeries = options.series ?? null;
    this.defaults = validateTradingPreferences(options.defaults ?? {}, DEFAULT_TRADING_PREFERENCES);
    this.prefs = this.readPreferences();
    this.translateFn = this.createTranslator();
    this.pluginId = `market-chart/trading/${++overlayCounter}`;
    chart.use({
      id: this.pluginId,
      version: '1.0.0',
      install: (ctx) => {
        this.ctx = ctx;
        ctx.addInputHandler({
          hover: (e) => this.onHover(e),
          pointerDown: (e) => this.onPointerDown(e),
          pointerMove: (e) => this.onPointerMove(e),
          pointerUp: (e) => this.onPointerUp(e),
          pointerCancel: () => this.abortDrag(),
          // Holding a finger on a line (before dragging it) opens its context menu.
          longPress: () => this.press !== null && this.drag === null,
          doubleClick: (e) => this.onDoubleClick(e),
          keyDown: (e) => {
            if (e.key === 'Escape' && (this.drag || this.press)) {
              this.abortDrag();
              return true;
            }
            return false;
          },
        });
        this.ensureLayers();
        ctx.on('seriesAdded', () => {
          this.ensureLayers();
          this.invalidate();
        });
        ctx.on('seriesRemoved', ({ seriesId }) => {
          if (this.boundSeries?.id === seriesId) {
            // The engine removed the lines with the series.
            this.lines.clear();
            this.boundSeries = null;
          }
          this.invalidate();
        });
        ctx.on('paneResize', () => this.ensureLayers());
        ctx.on('optionsChanged', () => this.invalidate());
        ctx.on('directionChange', () => this.invalidate());
        ctx.on('resize', () => this.invalidate());
        ctx.on('destroy', () => this.destroy());
      },
    });
    const ui = options.ui;
    if (ui) {
      this.offs.push(
        ui.preferences.on('change', () => {
          const next = this.readPreferences();
          if (JSON.stringify(next) !== JSON.stringify(this.prefs)) {
            this.prefs = next;
            this.invalidate();
          }
        }),
        ui.i18n.on('change', () => this.invalidate()),
      );
    } else if (options.i18n) {
      this.offs.push(options.i18n.on('change', () => this.invalidate()));
    }
  }

  // ───────────────────────────── objects ─────────────────────────────

  on<K extends keyof TradingOverlayEvents>(
    event: K,
    listener: (payload: TradingOverlayEvents[K]) => void,
  ): Unsubscribe {
    return this.emitter.on(event, listener);
  }

  /** Replaces all orders. Invalid entries are dropped and reported (`onError`). */
  setOrders(orders: readonly TradingOrder[]): void {
    this.replaceAll('order', this._orders, orders, normalizeOrder);
  }

  /** Adds or replaces one order. Throws `TradingError` for invalid data. */
  upsertOrder(order: TradingOrder): void {
    this.upsert('order', this._orders, normalizeOrder(order));
  }

  removeOrder(id: string): boolean {
    return this.remove('order', this._orders, id);
  }

  orders(): TradingOrder[] {
    return [...this._orders.values()];
  }

  setPositions(positions: readonly TradingPosition[]): void {
    this.replaceAll('position', this._positions, positions, normalizePosition);
  }

  upsertPosition(position: TradingPosition): void {
    this.upsert('position', this._positions, normalizePosition(position));
  }

  removePosition(id: string): boolean {
    return this.remove('position', this._positions, id);
  }

  positions(): TradingPosition[] {
    return [...this._positions.values()];
  }

  setAlerts(alerts: readonly TradingAlert[]): void {
    this.replaceAll('alert', this._alerts, alerts, normalizeAlert);
  }

  upsertAlert(alert: TradingAlert): void {
    this.upsert('alert', this._alerts, normalizeAlert(alert));
  }

  removeAlert(id: string): boolean {
    return this.remove('alert', this._alerts, id);
  }

  alerts(): TradingAlert[] {
    return [...this._alerts.values()];
  }

  setMarkers(markers: readonly PriceMarker[]): void {
    this.replaceAll('marker', this._markers, markers, normalizeMarker);
  }

  /** Adds (or replaces) a custom price object. */
  addMarker(marker: PriceMarker): void {
    this.upsert('marker', this._markers, normalizeMarker(marker));
  }

  removeMarker(id: string): boolean {
    return this.remove('marker', this._markers, id);
  }

  markers(): PriceMarker[] {
    return [...this._markers.values()];
  }

  /** Removes every object. */
  clear(): void {
    for (const map of [this._orders, this._positions, this._alerts, this._markers]) map.clear();
    this.pendingPrices.clear();
    this.acceptedPrices.clear();
    this.cancelling.clear();
    this.invalidate();
  }

  /** The object with a kind and id, or undefined. */
  get(kind: TradingObjectKind, id: string): TradingObject | undefined {
    return this.mapOf(kind).get(id);
  }

  // ───────────────────────────── display ─────────────────────────────

  /** The lines currently shown (after the pending batch is applied). */
  items(): readonly TradingItem[] {
    this.flushNow();
    return this._items;
  }

  preferences(): TradingPreferences {
    return this.prefs;
  }

  /** Changes user preferences (saved with the UI preferences when a `ui` was given). */
  setPreferences(patch: Partial<TradingPreferences>): void {
    const next = validateTradingPreferences({ ...this.prefs, ...patch }, this.defaults);
    if (JSON.stringify(next) === JSON.stringify(this.prefs)) return;
    this.prefs = next;
    const ui = this.options.ui;
    if (ui) {
      // Only what differs from the application's defaults is stored.
      const stored: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(next))
        if (v !== (this.defaults as unknown as Record<string, unknown>)[k]) stored[k] = v;
      ui.preferences.update({ extensions: { [TRADING_PREFERENCES_KEY]: stored } });
    }
    this.options.onPreferencesChange?.(next);
    this.invalidate();
  }

  /** Restores the application defaults. */
  resetPreferences(): void {
    this.setPreferences(this.defaults);
  }

  /** Changes options later (callbacks, colours, label format…). `series` and `ui` cannot change here. */
  setOptions(patch: Omit<TradingOverlayOptions, 'ui' | 'series'>): void {
    this.options = { ...this.options, ...patch };
    if (patch.defaults) {
      this.defaults = validateTradingPreferences(patch.defaults, DEFAULT_TRADING_PREFERENCES);
      this.prefs = this.readPreferences();
    }
    this.invalidate();
  }

  /** Attaches the objects to another series (e.g. after the main series was replaced). */
  setSeries(series: SeriesApi | null): void {
    this.explicitSeries = series;
    this.invalidate();
  }

  series(): SeriesApi | null {
    const explicit = this.explicitSeries;
    if (explicit && this.chart.series().includes(explicit)) return explicit;
    if (explicit) return null;
    return this.chart.series()[0] ?? null;
  }

  /** Selected line key (`order:42`, `position:7:takeProfit`…), or null. */
  selected(): string | null {
    return this._selected;
  }

  select(key: string | null): void {
    if (key !== null && !this.itemsByKey.has(key)) key = null;
    if (key === this._selected) return;
    this._selected = key;
    // The selected line keeps its axis label when crowded labels are thinned.
    this.syncLinePriorities();
    this.emitter.emit('select', { item: key ? (this.itemsByKey.get(key) ?? null) : null });
    this.redraw('overlay');
    this.bump();
  }

  /** Emphasises a line (keyboard focus in the object tree). */
  highlight(key: string | null): void {
    if (key === this.highlighted) return;
    this.highlighted = key;
    this.redraw('overlay');
  }

  /** What is at a pane point (CSS px relative to the series' pane), using the last drawn layout. */
  hitTest(pane: number | null, x: number, y: number): TradingHit | null {
    if (pane === null || pane !== this.pane() || !Number.isFinite(y)) return null;
    for (let i = this.drawn.length - 1; i >= 0; i--) {
      const d = this.drawn[i]!;
      const b = d.box;
      if (!b || x < b.left || x > b.left + b.width || y < b.top || y > b.top + b.height) continue;
      const cancel = d.cancelWidth > 0 && this.isOnCancel(d, x);
      return { item: d.item, area: cancel ? 'cancel' : 'label' };
    }
    let best: Drawn | null = null;
    for (const d of this.drawn) {
      const distance = Math.abs(d.y - y);
      if (distance <= LINE_HIT && (!best || distance < Math.abs(best.y - y))) best = d;
    }
    return best ? { item: best.item, area: 'line' } : null;
  }

  /** Label boxes as last drawn (pane CSS px), for tests and custom renderers. */
  labelBoxes(): readonly LabelBox[] {
    return this.drawn.flatMap((d) => (d.box ? [d.box] : []));
  }

  /** Info passed to callbacks for an item. */
  infoOf(item: TradingItem): TradingObjectInfo {
    return { kind: item.kind, id: item.id, part: item.part };
  }

  /** The translated text for a key (the overlay's own dictionary, or the UI's language). */
  t(key: string, values?: Readonly<Record<string, string | number>>): string {
    return this.translateFn(key, values);
  }

  /** Price formatted like the series' axis labels. */
  formatPrice(price: number): string {
    const format = this.series()?.options().priceFormat;
    return createPriceFormatter(format ?? { type: 'price', precision: 2 })(price);
  }

  /** Runs the cancel (or close) action of an item, as its × button does. */
  async cancel(key: string): Promise<void> {
    const item = this.itemsByKey.get(key);
    if (!item || !item.cancellable || this.cancelling.has(key)) return;
    this.cancelling.add(key);
    this.invalidate();
    try {
      if (item.kind === 'position' && item.part === 'main')
        await this.options.onClosePosition?.(item.object as TradingPosition);
      else await this.options.onCancel?.(item.object, this.infoOf(item));
    } catch (error) {
      this.report(error, 'trading.cancelFailed');
    } finally {
      this.cancelling.delete(key);
      this.invalidate();
    }
  }

  /** Asks the application to edit an item (`onEdit`). */
  edit(key: string): void {
    const item = this.itemsByKey.get(key);
    if (item) this.safe(() => this.options.onEdit?.(item.object, this.infoOf(item)));
  }

  /**
   * Moves an item to a new price through `onModify`, as dragging does (for keyboard or custom UIs). The line
   * shows the new price as pending until the promise settles.
   */
  async modify(key: string, price: number): Promise<boolean> {
    const item = this.itemsByKey.get(key);
    if (!item || !item.draggable || this.pendingPrices.has(key)) return false;
    const series = this.series();
    const rounded = roundToTick(price, priceTickSize(series?.options().priceFormat));
    if (!Number.isFinite(rounded) || rounded === this.basePrice(item)) return false;
    return this.commitModify(item, rounded, this.revisions.get(this.objectKey(item)) ?? 0);
  }

  /** Whether the application handles a callback (menus and settings only offer what can work). */
  handles(callback: 'onModify' | 'onCancel' | 'onClosePosition' | 'onSelect' | 'onEdit'): boolean {
    return typeof this.options[callback] === 'function';
  }

  /** Runs `cleanup` when the overlay is destroyed (integrations use it). */
  own(cleanup: Unsubscribe): void {
    if (this.destroyed) cleanup();
    else this.offs.push(cleanup);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const off of this.offs.splice(0).reverse()) {
      try {
        off();
      } catch (error) {
        console.error('[market-chart/trading] cleanup failed', error);
      }
    }
    for (const line of this.lines.values()) line.remove();
    this.lines.clear();
    if (!this.chart.destroyed && this.chart.hasPlugin(this.pluginId))
      this.chart.removePlugin(this.pluginId);
    this.ctx = null;
    this.emitter.clear();
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }

  // ───────────────────────────── internals: data ─────────────────────────────

  private mapOf(kind: TradingObjectKind): Map<string, TradingObject> {
    return (
      kind === 'order'
        ? this._orders
        : kind === 'position'
          ? this._positions
          : kind === 'alert'
            ? this._alerts
            : this._markers
    ) as Map<string, TradingObject>;
  }

  private objectKey(item: { kind: TradingObjectKind; id: string }): string {
    return `${item.kind}:${item.id}`;
  }

  private touch(kind: TradingObjectKind, id: string): void {
    const key = `${kind}:${id}`;
    this.revisions.set(key, (this.revisions.get(key) ?? 0) + 1);
    // New data from the application replaces prices accepted locally.
    for (const part of ['main', 'takeProfit', 'stopLoss'] as const)
      this.acceptedPrices.delete(keyOf(kind, id, part));
  }

  private replaceAll<T extends TradingObject>(
    kind: TradingObjectKind,
    map: Map<string, T>,
    list: readonly T[],
    normalize: (input: unknown) => T,
  ): void {
    if (!Array.isArray(list)) throw new TradingError(`set ${kind}s expects an array`);
    const next = new Map<string, T>();
    let invalid = 0;
    for (const raw of list) {
      if (next.size >= MAX_TRADING_OBJECTS) {
        invalid++;
        continue;
      }
      try {
        const object = normalize(raw);
        next.set(object.id, object);
      } catch {
        invalid++;
      }
    }
    for (const id of map.keys()) if (!next.has(id)) this.revisions.delete(`${kind}:${id}`);
    for (const [id, object] of next) if (map.get(id) !== object) this.touch(kind, id);
    map.clear();
    for (const [id, object] of next) map.set(id, object);
    if (invalid) this.report(new TradingError(`${invalid} invalid ${kind}(s) ignored`), null);
    this.invalidate();
  }

  private upsert<T extends TradingObject>(
    kind: TradingObjectKind,
    map: Map<string, T>,
    object: T,
  ): void {
    if (!map.has(object.id) && map.size >= MAX_TRADING_OBJECTS)
      throw new TradingError(`at most ${MAX_TRADING_OBJECTS} ${kind}s`);
    map.set(object.id, object);
    this.touch(kind, object.id);
    this.invalidate();
  }

  private remove(kind: TradingObjectKind, map: Map<string, TradingObject>, id: string): boolean {
    const removed = map.delete(id);
    if (removed) {
      this.revisions.delete(`${kind}:${id}`);
      this.invalidate();
    }
    return removed;
  }

  private readPreferences(): TradingPreferences {
    const ui = this.options.ui;
    if (!ui) return this.prefs ?? this.defaults;
    const stored = ui.preferences.get().extensions[TRADING_PREFERENCES_KEY];
    return validateTradingPreferences(stored ?? {}, this.defaults);
  }

  private createTranslator(): Translate {
    const i18n = this.options.ui?.i18n ?? this.options.i18n;
    if (i18n) {
      // Add the overlay's texts without replacing the application's own.
      for (const [code, messages] of Object.entries(tradingMessages)) {
        if (!i18n.resolve(code)) continue;
        const missing: Record<string, string> = {};
        for (const [key, text] of Object.entries(messages))
          if (!i18n.has(key, code)) missing[key] = text;
        if (Object.keys(missing).length) i18n.extend(code, missing);
      }
      return (key, values) => i18n.t(key, values);
    }
    const dictionary = tradingMessagesEn as Readonly<Record<string, string>>;
    return (key, values) => {
      const text = dictionary[key] ?? key;
      return values
        ? text.replace(/\{(\w+)\}/g, (m, k: string) =>
            values[k] === undefined ? m : String(values[k]),
          )
        : text;
    };
  }

  // ───────────────────────────── internals: items ─────────────────────────────

  private invalidate(): void {
    if (this.destroyed) return;
    this.dirty = true;
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      this.flushNow();
    });
  }

  /** Applies a pending batch now (also used before hit-tests and reads). */
  private flushNow(): void {
    if (!this.dirty || this.destroyed) return;
    this.dirty = false;
    this.rebuild();
    this.syncLines();
    this.redraw('all');
    this.bump();
  }

  private bump(): void {
    this.revision++;
    this.emitter.emit('change', { revision: this.revision });
  }

  private basePrice(item: {
    kind: TradingObjectKind;
    part: TradingObjectPart;
    object: TradingObject;
  }): number {
    const o = item.object as unknown as Record<string, number>;
    if (item.kind === 'position')
      return item.part === 'takeProfit'
        ? o['takeProfit']!
        : item.part === 'stopLoss'
          ? o['stopLoss']!
          : o['entryPrice']!;
    return o['price']!;
  }

  private rebuild(): void {
    const p = this.prefs;
    const o = this.options;
    const c = { ...DEFAULT_TRADING_COLORS, ...o.colors };
    const canDrag = o.interaction?.drag !== false && !!o.onModify && p.draggable;
    const canCancel = o.interaction?.cancel !== false;
    const items: TradingItem[] = [];
    const add = (
      kind: TradingObjectKind,
      part: TradingObjectPart,
      object: TradingObject,
      base: number,
      style: {
        color: string;
        lineStyle: LineStyle;
        dim?: boolean;
        draggable: boolean;
        cancellable: boolean;
        axisLabel?: boolean;
        pending?: boolean;
      },
    ): void => {
      const key = keyOf(kind, object.id, part);
      const pendingPrice = this.pendingPrices.get(key);
      const accepted = this.acceptedPrices.get(key)?.price;
      const pending = pendingPrice !== undefined || this.cancelling.has(key) || !!style.pending;
      const price = this.drag?.key === key ? this.drag.price : (pendingPrice ?? accepted ?? base);
      items.push({
        key,
        kind,
        part,
        id: object.id,
        price,
        object,
        color: pending ? c.pending : style.color,
        lineStyle: style.lineStyle,
        dim: !!style.dim,
        draggable: style.draggable && pendingPrice === undefined && !this.cancelling.has(key),
        cancellable: style.cancellable && !this.cancelling.has(key),
        axisLabel: style.axisLabel !== false,
        pending,
      });
    };
    if (p.positions) {
      for (const pos of this._positions.values()) {
        const color = pos.color ?? (pos.side === 'buy' ? c.buy : c.sell);
        const drag = canDrag && pos.draggable !== false;
        add('position', 'main', pos, pos.entryPrice, {
          color,
          lineStyle: 'solid',
          draggable: false,
          cancellable: canCancel && !!o.onClosePosition,
        });
        if (pos.takeProfit !== undefined && pos.takeProfit !== null)
          add('position', 'takeProfit', pos, pos.takeProfit, {
            color: c.takeProfit,
            lineStyle: 'dotted',
            draggable: drag,
            cancellable: canCancel && !!o.onCancel,
          });
        if (pos.stopLoss !== undefined && pos.stopLoss !== null)
          add('position', 'stopLoss', pos, pos.stopLoss, {
            color: c.stopLoss,
            lineStyle: 'dotted',
            draggable: drag,
            cancellable: canCancel && !!o.onCancel,
          });
      }
    }
    if (p.orders) {
      for (const order of this._orders.values()) {
        if (HIDDEN_STATUSES.has(order.status ?? 'working')) continue;
        add('order', 'main', order, order.price, {
          color: order.color ?? (order.side === 'buy' ? c.buy : c.sell),
          lineStyle: p.lineStyle,
          draggable: canDrag && order.draggable !== false,
          cancellable: canCancel && !!o.onCancel && order.cancellable !== false,
          pending: order.status === 'pending',
        });
      }
    }
    if (p.alerts) {
      for (const alert of this._alerts.values()) {
        add('alert', 'main', alert, alert.price, {
          color: alert.color ?? c.alert,
          lineStyle: p.lineStyle,
          dim: alert.active === false,
          draggable: canDrag && alert.draggable !== false,
          cancellable: canCancel && !!o.onCancel && alert.cancellable !== false,
        });
      }
    }
    if (p.markers) {
      for (const marker of this._markers.values()) {
        add('marker', 'main', marker, marker.price, {
          color: marker.color ?? c.marker,
          lineStyle: marker.lineStyle ?? 'dotted',
          draggable: canDrag && marker.draggable === true,
          cancellable: canCancel && !!o.onCancel && marker.cancellable === true,
          axisLabel: marker.axisLabel,
        });
      }
    }
    this._items = items;
    this.itemsByKey.clear();
    for (const item of items) this.itemsByKey.set(item.key, item);
    if (this._selected && !this.itemsByKey.has(this._selected)) this.select(null);
    if (this.hover && !this.itemsByKey.has(this.hover.key)) this.setHover(null);
  }

  /** Engine price lines give each item its axis label (the lines themselves are drawn by the layer). */
  private syncLines(): void {
    const series = this.series();
    if (series !== this.boundSeries) {
      for (const line of this.lines.values()) line.remove();
      this.lines.clear();
      this.boundSeries = series;
    }
    if (!series) return;
    const axis = this.prefs.axisLabels;
    const keep = new Set<string>();
    for (const item of this._items) {
      if (!axis || !item.axisLabel) continue;
      keep.add(item.key);
      const line = this.lines.get(item.key);
      if (!line) {
        this.lines.set(
          item.key,
          series.createPriceLine({
            price: item.price,
            color: item.color,
            lineVisible: false,
            axisLabelVisible: true,
            title: '',
            autoscale: false,
            axisLabelPriority: this.labelPriority(item),
          }),
        );
        continue;
      }
      const current = line.options();
      const priority = this.labelPriority(item);
      if (
        current.price !== item.price ||
        current.color !== item.color ||
        current.axisLabelPriority !== priority
      )
        line.applyOptions({ price: item.price, color: item.color, axisLabelPriority: priority });
    }
    for (const [key, line] of this.lines) {
      if (keep.has(key)) continue;
      line.remove();
      this.lines.delete(key);
    }
  }

  /**
   * Axis-label priority when the engine thins crowded labels: the selected line above the series' last value
   * (1), positions above orders, alerts and markers.
   */
  private labelPriority(item: TradingItem): number {
    if (item.key === this._selected) return 2;
    return item.kind === 'position' && item.part === 'main' ? 0.5 : 0;
  }

  private syncLinePriorities(): void {
    for (const [key, line] of this.lines) {
      const item = this.itemsByKey.get(key);
      if (!item) continue;
      const priority = this.labelPriority(item);
      if (line.options().axisLabelPriority !== priority)
        line.applyOptions({ axisLabelPriority: priority });
    }
  }

  private pane(): number | null {
    const series = this.series();
    return series ? (series.options().pane ?? 0) : null;
  }

  private redraw(surface: 'all' | 'overlay'): void {
    if (this.destroyed || !this.ctx) return;
    this.ensureLayers();
    this.ctx.requestRedraw(surface);
  }

  private ensureLayers(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const panes = this.chart.panes().length;
    for (let pane = 0; pane < panes; pane++) {
      if (this.layerPanes.has(pane)) continue;
      this.layerPanes.add(pane);
      ctx.addPaneLayer({ pane, zOrder: 'above', draw: (c) => this.drawMain(c) });
      ctx.addPaneLayer({ pane, zOrder: 'top', draw: (c) => this.drawTop(c) });
    }
  }

  // ───────────────────────────── internals: drawing ─────────────────────────────

  private compact(): boolean {
    const mode = this.prefs.compact;
    return (
      mode === 'always' ||
      (mode === 'auto' && this.chart.size().width < (this.options.compactWidth ?? 520))
    );
  }

  private labelInput(item: TradingItem, compact: boolean): TradingLabelInput {
    return {
      kind: item.kind,
      part: item.part,
      object: item.object,
      price: this.formatPrice(item.price),
      compact,
      preferences: this.prefs,
    };
  }

  private font(): string {
    const layout = this.chart.options().layout;
    return `11px ${layout.fontFamily}`;
  }

  private measure(ctx: CanvasRenderingContext2D, text: string): number {
    let width = this.widths.get(text);
    if (width === undefined) {
      width = ctx.measureText(text).width;
      if (this.widths.size > 5_000) this.widths.clear();
      this.widths.set(text, width);
    }
    return width;
  }

  private isOnCancel(d: Drawn, x: number): boolean {
    const b = d.box!;
    const rtl = this.chart.getDirection() === 'rtl';
    return rtl ? x <= b.left + d.cancelWidth : x >= b.left + b.width - d.cancelWidth;
  }

  private drawMain(c: PaneLayerDrawContext): void {
    if (this.dirty) this.flushNow();
    if (c.pane !== this.pane()) return;
    const series = this.series();
    if (!series) return;
    const ctx = c.ctx;
    const pr = c.pixelRatio;
    const visible: { item: TradingItem; y: number }[] = [];
    for (const item of this._items) {
      const y = series.priceToCoordinate(item.price);
      if (y === null || !Number.isFinite(y) || y < -LABEL_HEIGHT || y > c.height + LABEL_HEIGHT)
        continue;
      visible.push({ item, y });
    }
    // Lines: one path per colour, style and opacity.
    const groups = new Map<string, { item: TradingItem; ys: number[] }>();
    for (const v of visible) {
      const style = v.item.pending ? 'dashed' : v.item.lineStyle;
      const group = `${v.item.color}|${style}|${v.item.dim ? 1 : 0}`;
      let entry = groups.get(group);
      if (!entry) groups.set(group, (entry = { item: v.item, ys: [] }));
      entry.ys.push(v.y);
    }
    ctx.save();
    const lineWidth = Math.max(1, Math.round(pr));
    const offset = lineWidth % 2 ? 0.5 : 0;
    const width = c.width * pr;
    for (const [group, { item, ys }] of groups) {
      const style = group.split('|')[1] as LineStyle;
      ctx.strokeStyle = item.color;
      ctx.globalAlpha = item.dim ? 0.45 : 1;
      ctx.lineWidth = lineWidth;
      ctx.setLineDash(DASHES[style].map((v) => v * pr));
      ctx.beginPath();
      for (const y of ys) {
        const yy = Math.round(y * pr) + offset;
        ctx.moveTo(0, yy);
        ctx.lineTo(width, yy);
      }
      ctx.stroke();
    }
    ctx.restore();

    // Labels: measured, stacked without overlaps, drawn in CSS px.
    ctx.save();
    ctx.scale(pr, pr);
    ctx.font = this.font();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    const compact = this.compact();
    const t = this.translateFn;
    const format = this.options.labelFormat;
    const rtl = this.chart.getDirection() === 'rtl';
    const prepared: {
      item: TradingItem;
      y: number;
      segments: { text: string; width: number }[];
      cancelWidth: number;
    }[] = [];
    for (const v of visible) {
      const input = this.labelInput(v.item, compact);
      let texts: readonly string[];
      try {
        texts = format ? format(input) : defaultLabel(input, t);
      } catch {
        texts = defaultLabel(input, t);
      }
      const segments = texts
        .map((s) => safeText(s, 40))
        .filter(Boolean)
        .map((text) => ({ text, width: Math.ceil(this.measure(ctx, text)) + PADDING * 2 }));
      if (rtl) segments.reverse();
      prepared.push({
        item: v.item,
        y: v.y,
        segments,
        cancelWidth: v.item.cancellable ? CANCEL_WIDTH : 0,
      });
    }
    const boxes = layoutTradingLabels(
      prepared.map((p) => ({
        key: p.item.key,
        y: p.y,
        width: p.segments.reduce((sum, s) => sum + s.width, 0) + p.cancelWidth,
      })),
      {
        paneWidth: c.width,
        paneHeight: c.height,
        height: LABEL_HEIGHT,
        position: this.options.labelPosition ?? 'right',
      },
    );
    const boxByKey = new Map(boxes.map((b) => [b.key, b]));
    const drawn: Drawn[] = [];
    for (const p of prepared) {
      const box = boxByKey.get(p.item.key) ?? null;
      drawn.push({ item: p.item, y: p.y, box, segments: p.segments, cancelWidth: p.cancelWidth });
      if (!box || box.top > c.height || box.top + box.height < 0) continue;
      this.drawLabel(ctx, p.item, box, p.segments, p.cancelWidth, rtl);
    }
    // Labels are drawn in y order; the topmost (last) wins hit-tests.
    drawn.sort((a, b) => (a.box?.top ?? a.y) - (b.box?.top ?? b.y));
    this.drawn = drawn;
    ctx.restore();
  }

  private drawLabel(
    ctx: CanvasRenderingContext2D,
    item: TradingItem,
    box: LabelBox,
    segments: readonly { text: string; width: number }[],
    cancelWidth: number,
    rtl: boolean,
  ): void {
    const colors = { ...DEFAULT_TRADING_COLORS, ...this.options.colors };
    // Connector from the line to a label that had to move.
    if (Math.abs(box.top + box.height / 2 - box.y) > 1) {
      ctx.fillStyle = item.color;
      ctx.fillRect(
        box.left + box.width / 2,
        Math.min(box.y, box.top + box.height / 2),
        1,
        Math.abs(box.top + box.height / 2 - box.y),
      );
    }
    ctx.globalAlpha = item.dim ? 0.55 : 1;
    ctx.fillStyle = item.color;
    ctx.fillRect(box.left, box.top, box.width, box.height);
    if (item.pending) {
      ctx.strokeStyle = colors.labelText;
      ctx.setLineDash([3, 2]);
      ctx.lineWidth = 1;
      ctx.strokeRect(box.left + 0.5, box.top + 0.5, box.width - 1, box.height - 1);
      ctx.setLineDash([]);
    }
    let x = box.left + (rtl ? cancelWidth : 0);
    const mid = box.top + box.height / 2;
    ctx.fillStyle = colors.labelText;
    segments.forEach((segment, i) => {
      if (i > 0) {
        ctx.globalAlpha = 0.35;
        ctx.fillRect(x, box.top + 3, 1, box.height - 6);
        ctx.globalAlpha = item.dim ? 0.55 : 1;
      }
      ctx.fillText(segment.text, x + segment.width / 2, mid + 0.5);
      x += segment.width;
    });
    if (cancelWidth) {
      const cx = rtl ? box.left + cancelWidth / 2 : box.left + box.width - cancelWidth / 2;
      ctx.globalAlpha = 0.35;
      ctx.fillRect(
        rtl ? box.left + cancelWidth : box.left + box.width - cancelWidth,
        box.top + 3,
        1,
        box.height - 6,
      );
      ctx.globalAlpha = 1;
      ctx.strokeStyle = colors.labelText;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(cx - 3.5, mid - 3.5);
      ctx.lineTo(cx + 3.5, mid + 3.5);
      ctx.moveTo(cx + 3.5, mid - 3.5);
      ctx.lineTo(cx - 3.5, mid + 3.5);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** Hover, selection, keyboard highlight and the tooltip: cheap overlay-surface drawing. */
  private drawTop(c: PaneLayerDrawContext): void {
    if (c.pane !== this.pane()) return;
    const keys = new Set([this.hover?.key, this._selected, this.highlighted, this.drag?.key]);
    keys.delete(undefined);
    keys.delete(null);
    if (!keys.size) return;
    const ctx = c.ctx;
    const pr = c.pixelRatio;
    ctx.save();
    ctx.scale(pr, pr);
    for (const d of this.drawn) {
      if (!keys.has(d.item.key)) continue;
      ctx.fillStyle = d.item.color;
      ctx.fillRect(0, Math.round(d.y) - 1, c.width, 2);
      if (d.box) {
        ctx.strokeStyle = d.item.color;
        ctx.lineWidth = 2;
        ctx.strokeRect(d.box.left - 1, d.box.top - 1, d.box.width + 2, d.box.height + 2);
      }
    }
    const hover = this.hover;
    const tooltip = this.options.tooltip;
    if (hover && !this.drag && tooltip !== false && hover.area !== 'cancel') {
      const item = this.itemsByKey.get(hover.key);
      if (item) {
        const input = this.labelInput(item, false);
        let lines: readonly string[] | null;
        try {
          lines = tooltip ? tooltip(input) : defaultTooltip(input, this.translateFn);
        } catch {
          lines = null;
        }
        if (lines?.length)
          this.drawTooltip(
            ctx,
            c,
            lines.map((l) => safeText(l, 80)),
            hover.x,
            hover.y,
          );
      }
    }
    ctx.restore();
  }

  private drawTooltip(
    ctx: CanvasRenderingContext2D,
    c: PaneLayerDrawContext,
    lines: readonly string[],
    x: number,
    y: number,
  ): void {
    ctx.font = this.font();
    ctx.textBaseline = 'middle';
    const rtl = this.chart.getDirection() === 'rtl';
    ctx.textAlign = rtl ? 'right' : 'left';
    const lineHeight = 16;
    const width = Math.min(260, Math.max(...lines.map((l) => this.measure(ctx, l))) + 16);
    const height = lines.length * lineHeight + 8;
    const left = Math.max(2, Math.min(x + 14, c.width - width - 2));
    const top = Math.max(2, Math.min(y + 14, c.height - height - 2));
    ctx.globalAlpha = 0.94;
    ctx.fillStyle = '#131722';
    ctx.fillRect(left, top, width, height);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffffff';
    lines.forEach((line, i) =>
      ctx.fillText(
        line,
        rtl ? left + width - 8 : left + 8,
        top + 4 + lineHeight * (i + 0.5),
        width - 16,
      ),
    );
  }

  // ───────────────────────────── internals: input ─────────────────────────────

  private setHover(hover: TradingOverlay['hover']): void {
    const before = this.hover?.key ?? null;
    this.hover = hover;
    const after = hover?.key ?? null;
    if (before !== after) {
      const item = after ? (this.itemsByKey.get(after) ?? null) : null;
      this.emitter.emit('hover', { item });
      this.safe(() =>
        this.options.onHover?.(item?.object ?? null, item ? this.infoOf(item) : null),
      );
    }
    this.redraw('overlay');
  }

  private onHover(e: ChartPointerEvent): string | null {
    if (this.drag) return 'ns-resize';
    const hit = e.region === 'pane' ? this.hitTest(e.pane, e.paneX, e.paneY) : null;
    if (!hit) {
      if (this.hover) this.setHover(null);
      return null;
    }
    this.setHover({ key: hit.item.key, area: hit.area, x: e.paneX, y: e.paneY });
    if (hit.area === 'cancel') return 'pointer';
    return hit.item.draggable ? 'ns-resize' : 'pointer';
  }

  private onPointerDown(e: ChartPointerEvent): boolean {
    if (e.button !== 0 || e.region !== 'pane') return false;
    this.flushNow();
    const hit = this.hitTest(e.pane, e.paneX, e.paneY);
    if (!hit) return false;
    // A plain line that can neither be dragged nor selected lets the chart pan.
    if (hit.area === 'line' && !hit.item.draggable && this.options.interaction?.select === false)
      return false;
    this.press = {
      key: hit.item.key,
      area: hit.area,
      startY: e.paneY,
      startPrice: hit.item.price,
      revision: this.revisions.get(this.objectKey(hit.item)) ?? 0,
    };
    return true;
  }

  private onPointerMove(e: ChartPointerEvent): void {
    const press = this.press;
    if (!press || press.area === 'cancel') return;
    const item = this.itemsByKey.get(press.key);
    if (!item?.draggable) return;
    if (!this.drag && Math.abs(e.paneY - press.startY) < DRAG_THRESHOLD) return;
    const series = this.series();
    if (!series || !Number.isFinite(e.paneY)) return;
    const raw = series.coordinateToPrice(e.paneY);
    if (raw === null) return;
    const price = roundToTick(raw, priceTickSize(series.options().priceFormat));
    if (!Number.isFinite(price)) return;
    this.drag = { key: item.key, price };
    item.price = price;
    this.lines.get(item.key)?.applyOptions({ price });
    this.redraw('all');
  }

  private onPointerUp(e: ChartPointerEvent): void {
    const press = this.press;
    this.press = null;
    if (!press) return;
    const drag = this.drag;
    this.drag = null;
    const item = this.itemsByKey.get(press.key);
    if (!item) return;
    if (drag) {
      if (drag.price === this.basePrice(item)) {
        this.invalidate();
        return;
      }
      void this.commitModify(item, drag.price, press.revision);
      return;
    }
    if (press.area === 'cancel') {
      const hit = this.hitTest(e.pane, e.paneX, e.paneY);
      if (hit?.item.key === item.key && hit.area === 'cancel') void this.cancel(item.key);
      return;
    }
    if (this.options.interaction?.select !== false) {
      this.select(item.key);
      this.safe(() => this.options.onSelect?.(item.object, this.infoOf(item)));
    }
  }

  private onDoubleClick(e: ChartPointerEvent): boolean {
    const hit = e.region === 'pane' ? this.hitTest(e.pane, e.paneX, e.paneY) : null;
    if (!hit || hit.area === 'cancel' || !this.options.onEdit) return false;
    this.edit(hit.item.key);
    return true;
  }

  private abortDrag(): void {
    const had = this.drag || this.press;
    this.drag = null;
    this.press = null;
    if (had) this.invalidate();
  }

  private async commitModify(item: TradingItem, price: number, revision: number): Promise<boolean> {
    const onModify = this.options.onModify;
    if (!onModify) return false;
    const key = item.key;
    this.pendingPrices.set(key, price);
    this.invalidate();
    let accepted = false;
    try {
      const result = await onModify(item.object, price, this.infoOf(item));
      accepted = result !== false;
    } catch (error) {
      this.report(error, 'trading.modifyFailed');
    }
    this.pendingPrices.delete(key);
    // Keep the new price only if the application has not sent newer data meanwhile.
    if (accepted && (this.revisions.get(this.objectKey(item)) ?? 0) === revision)
      this.acceptedPrices.set(key, { price, revision });
    this.invalidate();
    return accepted;
  }

  private safe(fn: () => void): void {
    try {
      fn();
    } catch (error) {
      this.report(error, null);
    }
  }

  private report(error: unknown, messageKey: string | null): void {
    if (this.options.onError) {
      this.options.onError(error);
      return;
    }
    const reason = error instanceof Error ? error.message : String(error);
    if (this.options.ui) {
      this.options.ui.notify(
        messageKey ? this.t(messageKey, { reason: safeText(reason, 200) }) : safeText(reason, 200),
        'error',
      );
      return;
    }
    if (this.ctx) this.ctx.reportError(error);
    else console.error('[market-chart/trading]', error);
  }
}

/**
 * Shows the application's orders, positions, alerts and markers on a chart:
 *
 * ```ts
 * const overlay = createTradingOverlay(chart, { ui, onModify, onCancel });
 * overlay.setOrders(orders);
 * ```
 */
export function createTradingOverlay(
  chart: ChartApi,
  options: TradingOverlayOptions = {},
): TradingOverlay {
  const overlay = new TradingOverlay(chart, options);
  if (options.ui) attachTradingUi(overlay, options.ui);
  return overlay;
}
