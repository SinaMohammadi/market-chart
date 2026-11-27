import {
  EventEmitter,
  createDigitLocalizer,
  createPriceFormatter,
  priceTickSize,
  roundToTick,
} from '@market-chart/core';
import type { CrosshairMoveEvent, SeriesApi, Unsubscribe } from '@market-chart/core';
import type { ChartUi } from './chart-ui.js';
import type { ChartUiFeature } from './extensions.js';
import type { MenuEntry } from './menu.js';
import type {
  ActionContext,
  ContextTarget,
  ContextTargetKind,
  PriceContext,
  ReservedArea,
  SubmenuItem,
  UiAction,
  UiActionDefinition,
} from './types.js';
import { PRICE_BUTTON_GAP, PRICE_BUTTON_SIZE } from './types.js';
import { copyText, matchShortcut } from './util.js';
import type { KeyLike } from './util.js';

/** Context-menu targets that carry a price for price actions. */
export const PRICE_TARGETS: readonly ContextTargetKind[] = [
  'chart',
  'pane',
  'candlestick',
  'series',
  'priceAxis',
];

export interface PriceActionsOptions {
  /** Price actions in the context menu's "At this price" category (default true). */
  readonly contextMenu?: boolean;
  /** The "+" button next to the crosshair price label (default true; users can hide it in settings). */
  readonly axisButton?: boolean;
  /** Run price actions from their shortcuts (e.g. Alt+B) at the crosshair price (default false). */
  readonly shortcuts?: boolean;
  /** Touch long-press on the chart opens the price-action menu (default true). */
  readonly touch?: boolean;
  /**
   * Built-in actions: `price.buy`, `price.sell`, `price.order` (need the order ticket), `price.alert` (needs
   * `alerts`) and `price.copy`. Default true; pass ids to leave some out.
   */
  readonly builtins?: boolean | { readonly exclude?: readonly string[] };
}

/** Where the "+" button is (chart CSS px) and the price it acts on; null while hidden. */
export interface PriceButtonState {
  /** Vertical centre of the crosshair's price label, relative to the chart element. */
  readonly y: number;
  /** Left edge of the price axis the label is on (the button sits just inside the pane). */
  readonly axisX: number;
  readonly price: PriceContext;
}

export interface PriceActionsEvents {
  /** The "+" button moved, appeared or disappeared. */
  button: { readonly state: PriceButtonState | null };
}

/** Tick size of a series: its `priceFormat.minMove`, else one unit of its precision (core `priceTickSize`). */
export function tickSizeOf(series: SeriesApi | null | undefined): number {
  return priceTickSize(series?.options().priceFormat);
}

function mainSeriesOf(ui: ChartUi, pane: number | null): SeriesApi | null {
  const indicators = ui.capabilities.indicators;
  const all = ui.chart.series().filter((s) => !indicators?.indicatorForSeries(s));
  return (
    all.find((s) => (s.options().pane ?? 0) === (pane ?? 0)) ??
    all[0] ??
    ui.chart.series()[0] ??
    null
  );
}

function lastPrice(series: SeriesApi | null): number | null {
  const last = series?.lastPoint() as Readonly<Record<string, number>> | undefined;
  const value = last?.['close'] ?? last?.['value'];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Price actions: "Buy limit at 1,234.50", "Create alert", or the application's own, run at a price the user
 * points at from the context menu, the price-axis "+" button, a shortcut at the crosshair or a touch
 * long-press. Prices are rounded to the series' tick size before they are shown or passed on.
 */
export class PriceActions {
  readonly options: Readonly<PriceActionsOptions>;
  private readonly ui: ChartUi;
  private readonly emitter = new EventEmitter<PriceActionsEvents>();
  private crosshair: CrosshairMoveEvent | null = null;
  private _button: PriceButtonState | null = null;
  private held = false;

  constructor(ui: ChartUi, options: PriceActionsOptions = {}) {
    this.ui = ui;
    this.options = options;
  }

  on<K extends keyof PriceActionsEvents>(
    event: K,
    listener: (payload: PriceActionsEvents[K]) => void,
  ): Unsubscribe {
    return this.emitter.on(event, listener);
  }

  /**
   * Registers a price action. Defaults: the context-menu targets with a price, category `trade`, visible only
   * when there is a price. `{price}` in a label is replaced by the formatted price.
   */
  register(definition: Omit<UiActionDefinition, 'priceAction'>, owner = 'app'): Unsubscribe {
    const userVisible = definition.isVisible;
    return this.ui.registry.register(
      {
        targets: PRICE_TARGETS,
        locations: ['contextMenu'],
        category: 'trade',
        ...definition,
        priceAction: true,
        isVisible: (ctx) => {
          if (!ctx.price) return false;
          if (ctx.price.source === 'contextMenu' && this.options.contextMenu === false)
            return false;
          return userVisible ? userVisible(ctx) : true;
        },
      },
      { owner },
    );
  }

  /** Every registered price action (available or not). */
  actions(): UiAction[] {
    return this.ui.registry.list().filter((a) => a.priceAction === true);
  }

  /**
   * The price context for a price on a pane (and optionally a series and time): rounded, formatted, with
   * the side relative to the last price. Null for a non-finite price or a chart without series.
   */
  contextAt(input: {
    readonly price: number;
    readonly time?: number | null;
    readonly pane?: number | null;
    readonly series?: SeriesApi | null;
    readonly source?: PriceContext['source'];
  }): PriceContext | null {
    if (!Number.isFinite(input.price)) return null;
    const series = input.series ?? mainSeriesOf(this.ui, input.pane ?? null);
    if (!series) return null;
    const tick = tickSizeOf(series);
    const price = roundToTick(input.price, tick);
    const last = lastPrice(series);
    const format = series.options().priceFormat;
    let formatted = createPriceFormatter(
      format?.type === 'price' ? format : { type: 'price', minMove: tick },
    )(price);
    if (this.ui.preferences.get().localDigits && this.ui.i18n.numerals === 'native')
      formatted = createDigitLocalizer(this.ui.i18n.formatLocale)?.(formatted) ?? formatted;
    const caps = this.ui.capabilities;
    let symbol: string | null = null;
    try {
      symbol = caps.symbols?.value() ?? caps.symbol?.value() ?? null;
    } catch {
      symbol = null;
    }
    return {
      price,
      formatted,
      time: input.time ?? null,
      side: last !== null && price < last ? 'below' : 'above',
      series,
      pane: input.pane ?? series.options().pane ?? 0,
      symbol,
      tick,
      source: input.source ?? 'api',
    };
  }

  /** Price context of a context-menu target (null for targets without a price, such as drawings). */
  contextOfTarget(target: ContextTarget): PriceContext | null {
    if (target.price === null || !PRICE_TARGETS.includes(target.kind)) return null;
    return this.contextAt({
      price: target.price,
      time: target.time,
      pane: target.pane,
      series: target.series ?? null,
      source: target.event.source === 'touch' ? 'touch' : 'contextMenu',
    });
  }

  /** Price context at the crosshair (for shortcuts), or null when the crosshair is hidden. */
  atCrosshair(source: PriceContext['source'] = 'shortcut'): PriceContext | null {
    const e = this.crosshair;
    if (!e || e.price === null || e.pane === null) return null;
    return this.contextAt({ price: e.price, time: e.time, pane: e.pane, source });
  }

  /**
   * A sample price context for lists that show price actions without a price (the shortcut settings): the
   * main series' last price (100 while it has no data), from the `shortcut` source. Null without a series.
   */
  sample(): PriceContext | null {
    const series = mainSeriesOf(this.ui, null);
    if (!series) return null;
    return this.contextAt({ price: lastPrice(series) ?? 100, series, source: 'shortcut' });
  }

  /** Menu entries of the available price actions at `price`. */
  entries(price: PriceContext): MenuEntry[] {
    const context = this.ui.context(null, 'contextMenu', price);
    const hidden = new Set(this.ui.preferences.get().contextMenu.hidden);
    return this.ui.menuEntries(
      this.actions().filter((a) => !hidden.has(a.id)),
      context,
    );
  }

  /** Opens the price-action menu at viewport point (x, y). Returns false when no action is available. */
  openMenu(
    x: number,
    y: number,
    price: PriceContext,
    input: { source?: 'mouse' | 'touch' | 'keyboard' | 'api'; extra?: readonly MenuEntry[] } = {},
  ): boolean {
    const entries = this.entries(price);
    if (!entries.some((e) => e.type === 'item')) return false;
    this.ui.menu.show({
      x,
      y,
      target: null,
      entries: input.extra?.length
        ? [...entries, { type: 'separator', key: 'sep:price-more' }, ...input.extra]
        : entries,
      direction: this.ui.direction,
      source: input.source ?? 'api',
    });
    return true;
  }

  /** Runs a price action at a price (e.g. from application code). */
  run(id: string, price: PriceContext): Promise<void> {
    return this.ui.execute(id, 'api', null, price);
  }

  /** The "+" button: where it is and what it acts on, or null while hidden. */
  button(): PriceButtonState | null {
    return this._button;
  }

  /** Whether the "+" button is switched on (application option and user preference). */
  buttonEnabled(): boolean {
    return this.options.axisButton !== false && this.ui.preferences.get().trade.axisButton;
  }

  /**
   * Keeps the button where it is while the pointer is over it (the chart hides its crosshair when the
   * pointer leaves the canvas for the button).
   */
  hold(held: boolean): void {
    this.held = held;
    if (!held && !this.crosshair) this.setButton(null);
  }

  /** Hides the button (until the pointer moves again). */
  hide(): void {
    this.held = false;
    this.setButton(null);
  }

  /** @internal Crosshair updates (wired by the feature). */
  onCrosshair(event: CrosshairMoveEvent): void {
    // Shortcuts need only a price; the button also needs a pointer position.
    this.crosshair = event.pane !== null && event.price !== null ? event : null;
    const visible = this.crosshair !== null && event.point !== null;
    if (this.held) return;
    if (!visible || !this.buttonEnabled() || event.source !== 'pointer') {
      this.setButton(null);
      return;
    }
    const price = this.contextAt({
      price: event.price!,
      time: event.time,
      pane: event.pane,
      source: 'axisButton',
    });
    if (
      !price ||
      !this.actions().some((a) =>
        this.ui.isAvailable(a, this.ui.context(null, 'contextMenu', price)),
      )
    ) {
      this.setButton(null);
      return;
    }
    const chart = this.ui.chart;
    const right = chart.priceScale('right', event.pane!).width();
    const axisX = chart.size().width - right;
    const y = event.point!.y;
    // Not over something with its own controls (an order label's × button): the click must reach it.
    if (this.ui.reservedAreas.overlaps(event.pane!, this.buttonArea(event.pane!, axisX, y))) {
      this.setButton(null);
      return;
    }
    this.setButton({ y, axisX, price });
  }

  /** The button's rectangle relative to its pane (it is drawn just inside the price axis, centred on `y`). */
  private buttonArea(pane: number, axisX: number, y: number): ReservedArea {
    const chart = this.ui.chart;
    const separator = chart.options().panes.separatorHeight;
    let top = 0;
    for (const p of chart.panes()) {
      if (p.index >= pane) break;
      top += p.height() + separator;
    }
    const left = chart.priceScale('left', pane).width();
    const half = PRICE_BUTTON_SIZE / 2;
    return {
      left: axisX - PRICE_BUTTON_SIZE - PRICE_BUTTON_GAP - left,
      top: y - half - top,
      width: PRICE_BUTTON_SIZE,
      height: PRICE_BUTTON_SIZE,
    };
  }

  /** @internal Shortcut handling (wired by the feature when `shortcuts` is on). */
  handleKey(event: KeyLike): boolean {
    if (!this.options.shortcuts) return false;
    for (const action of this.actions()) {
      const shortcut = this.ui.rawShortcut(action);
      if (!shortcut || !action.run || !matchShortcut(shortcut, event)) continue;
      const price = this.atCrosshair('shortcut');
      if (!price) continue;
      const context = this.ui.context(null, 'shortcut', price);
      if (!this.ui.isAvailable(action, context) || !this.ui.isEnabled(action, context)) continue;
      void this.ui.execute(action.id, 'shortcut', null, price);
      return true;
    }
    return false;
  }

  destroy(): void {
    this.setButton(null);
    this.emitter.clear();
  }

  private setButton(state: PriceButtonState | null): void {
    const a = this._button;
    if (
      a === state ||
      (a &&
        state &&
        a.y === state.y &&
        a.axisX === state.axisX &&
        a.price.price === state.price.price)
    )
      return;
    this._button = state;
    this.emitter.emit('button', { state });
  }
}

/** Built-in price actions (registered by the feature; listed in the documentation's reference). */
export function builtInPriceActions(): Omit<UiActionDefinition, 'priceAction'>[] {
  const ticket = (ctx: ActionContext) => !!ctx.ui.orderTicket && !!ctx.capabilities.trading;
  const orderType = (side: 'buy' | 'sell', ctx: ActionContext): 'limit' | 'stop' => {
    const below = ctx.price?.side === 'below';
    return side === 'buy' ? (below ? 'limit' : 'stop') : below ? 'stop' : 'limit';
  };
  const open = (ctx: ActionContext, side: 'buy' | 'sell', type: string) =>
    ctx.ui.orderTicket!.open({ side, type, price: ctx.price! });
  return [
    {
      id: 'price.buy',
      label: (ctx) =>
        ctx.t(orderType('buy', ctx) === 'limit' ? 'price.buyLimit' : 'price.buyStop', {
          price: ctx.price?.formatted ?? '…',
        }),
      description: 'price.buy',
      icon: 'position-long',
      order: 10,
      shortcut: 'Alt+B',
      requires: ['trading'],
      isVisible: ticket,
      run: (ctx) => open(ctx, 'buy', orderType('buy', ctx)),
    },
    {
      id: 'price.sell',
      label: (ctx) =>
        ctx.t(orderType('sell', ctx) === 'limit' ? 'price.sellLimit' : 'price.sellStop', {
          price: ctx.price?.formatted ?? '…',
        }),
      description: 'price.sell',
      icon: 'position-short',
      order: 20,
      shortcut: 'Alt+S',
      requires: ['trading'],
      isVisible: ticket,
      run: (ctx) => open(ctx, 'sell', orderType('sell', ctx)),
    },
    {
      id: 'price.order',
      label: 'price.orderAt',
      icon: 'edit',
      order: 30,
      kind: 'menu',
      requires: ['trading'],
      isVisible: ticket,
      submenu: (ctx): SubmenuItem[] => {
        const types = ctx.capabilities.trading!.orderTypes ?? [
          { value: 'limit', label: 'order.type.limit' },
          { value: 'stop', label: 'order.type.stop' },
        ];
        return (['buy', 'sell'] as const).flatMap((side, i) =>
          types.map((type, j) => ({
            id: `${side}-${type.value}`,
            label: side === 'buy' ? 'price.buyType' : 'price.sellType',
            labelValues: { type: ctx.ui.translate(type.label, type.labelValues) },
            separatorBefore: i > 0 && j === 0,
            run: () => open(ctx, side, type.value),
          })),
        );
      },
    },
    {
      id: 'price.alert',
      label: 'price.alert',
      icon: 'bell',
      order: 40,
      shortcut: 'Alt+A',
      requires: ['alerts'],
      run: (ctx) =>
        ctx.capabilities.alerts!.create({
          price: ctx.price!.price,
          time: ctx.price!.time,
          ...(ctx.price!.series ? { series: ctx.price!.series } : {}),
        }),
    },
    {
      id: 'price.copy',
      label: 'price.copy',
      icon: 'copy',
      order: 90,
      run: async (ctx) => {
        await copyText(String(ctx.price!.price), ctx.capabilities);
        ctx.ui.notify(ctx.t('common.copied'));
      },
    },
  ];
}

/**
 * The price-actions feature: `createChartUi(chart, { features: [priceActions({ shortcuts: true })] })`. Adds
 * the "At this price" context-menu category, the price-axis "+" button state (`ui.priceActions.button()`,
 * drawn by the React layer), shortcuts at the crosshair, the touch long-press menu and built-in actions.
 */
export function priceActions(options: PriceActionsOptions = {}): ChartUiFeature {
  return {
    id: 'priceActions',
    install(ui) {
      const actions = new PriceActions(ui, options);
      const offs: Unsubscribe[] = [];
      offs.push(
        ui.provide({
          priceActions: actions,
          keyHandler: (event) => actions.handleKey(event),
          priceContext: (target) => actions.contextOfTarget(target),
        }),
        ui.chart.on('crosshairMove', (event) => actions.onCrosshair(event)),
        ui.preferences.on('change', () => {
          if (!actions.buttonEnabled()) actions.hide();
        }),
      );
      if (options.builtins !== false) {
        const exclude = new Set(
          typeof options.builtins === 'object' ? (options.builtins.exclude ?? []) : [],
        );
        for (const definition of builtInPriceActions())
          if (!exclude.has(definition.id)) offs.push(actions.register(definition, 'priceActions'));
      }
      if (options.touch !== false) {
        offs.push(
          ui.targets.intercept((event, target) => {
            if (
              event.source !== 'touch' ||
              !['chart', 'pane', 'candlestick', 'series'].includes(target.kind)
            )
              return false;
            const price = actions.contextOfTarget(target);
            if (!price) return false;
            // The full chart menu stays one tap away.
            const more: MenuEntry = {
              type: 'item',
              key: 'price.more',
              actionId: 'price.more',
              label: ui.i18n.t('price.moreActions'),
              path: '',
              disabled: false,
              checked: null,
              info: false,
              children: null,
              searchable: false,
              confirm: null,
              run: () => ui.contextMenu.open({ x: event.clientX, y: event.clientY, target }),
            };
            return actions.openMenu(event.clientX, event.clientY, price, {
              source: 'touch',
              extra: [more],
            });
          }),
        );
      }
      if (options.axisButton !== false) {
        offs.push(
          ui.settings.register({
            id: 'trading',
            label: 'trade.settings',
            order: 200,
            fields: () => [
              {
                kind: 'toggle',
                id: 'trade.axisButton',
                label: 'trade.axisButton',
                value: () => ui.preferences.get().trade.axisButton,
                set: (axisButton) => ui.preferences.update({ trade: { axisButton } }),
              },
            ],
          }),
        );
      }
      return () => {
        for (const off of offs.splice(0).reverse()) off();
        actions.destroy();
      };
    },
  };
}
