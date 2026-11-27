import type { Unsubscribe } from '@market-chart/core';
import type {
  ActionContext,
  ChartUi,
  ContextTarget,
  ObjectTreeItem,
  SettingsField,
  UiActionDefinition,
} from '@market-chart/ui';
import { formatQuantity } from './layout.js';
import type { TradingItem, TradingOverlay } from './overlay.js';
import type {
  TradingObjectKind,
  TradingOrder,
  TradingPosition,
  TradingPreferences,
} from './types.js';

const KINDS: readonly TradingObjectKind[] = ['order', 'position', 'alert', 'marker'];
const PLURAL: Record<TradingObjectKind, 'orders' | 'positions' | 'alerts' | 'markers'> = {
  order: 'orders',
  position: 'positions',
  alert: 'alerts',
  marker: 'markers',
};
const HIDE_KEYS: Record<TradingObjectKind, string> = {
  order: 'trading.hideOrders',
  position: 'trading.hidePositions',
  alert: 'trading.hideAlerts',
  marker: 'trading.hideMarkers',
};

function keyOfTarget(target: ContextTarget | null): string | null {
  const o = target?.object;
  if (!o) return null;
  return o.part && o.part !== 'main' ? `${o.type}:${o.id}:${o.part}` : `${o.type}:${o.id}`;
}

/** What the overlays attached to one `ChartUi` share: the actions, object-tree sections and settings. */
interface Bridge {
  readonly overlays: TradingOverlay[];
  /** The overlay that resolved a context-menu target (keyed by the target's `object`). */
  readonly owners: WeakMap<object, TradingOverlay>;
  /** Numbers the overlays so object-tree rows of different overlays get different ids. */
  readonly serials: WeakMap<TradingOverlay, number>;
  /** Called when an overlay is attached or detached (object-tree sections follow every overlay). */
  readonly listeners: Set<() => void>;
  serial: number;
  off: Unsubscribe;
}

function notify(bridge: Bridge): void {
  for (const listener of [...bridge.listeners]) listener();
}

const bridges = new WeakMap<ChartUi, Bridge>();

/**
 * Connects an overlay to a `ChartUi` (done by `createTradingOverlay` when `ui` is given): right-click targets
 * `order`, `position`, `alert` and `marker` with their actions in the shared context menu, an object-tree
 * section per kind, and the "Trading" settings category. Several overlays on one UI share the actions,
 * sections and settings; an action runs on the overlay that drew the object it was opened on. Everything is
 * removed with the last overlay.
 */
export function attachTradingUi(overlay: TradingOverlay, ui: ChartUi): Unsubscribe {
  let bridge = bridges.get(ui);
  if (!bridge) {
    const created: Bridge = {
      overlays: [],
      owners: new WeakMap(),
      serials: new WeakMap(),
      listeners: new Set(),
      serial: 0,
      off: () => undefined,
    };
    created.off = registerShared(created, ui);
    bridges.set(ui, created);
    bridge = created;
  }
  const shared = bridge;
  shared.overlays.push(overlay);
  shared.serials.set(overlay, ++shared.serial);

  const offTarget = ui.targets.register((event) => {
    if (event.region !== 'pane') return null;
    const hit = overlay.hitTest(event.pane, event.paneX, event.paneY);
    if (!hit) return null;
    const item = hit.item;
    // The menu acts on what the user sees highlighted.
    overlay.select(item.key);
    const object = {
      type: item.kind,
      id: item.id,
      ...(item.part !== 'main' ? { part: item.part } : {}),
      data: item.object,
    };
    shared.owners.set(object, overlay);
    return {
      kind: item.kind,
      event,
      pane: event.pane,
      time: event.time,
      price: event.price,
      object,
    };
  });

  // The order labels have their own controls (the × button): keep the price-axis "+" button off them.
  const offReserved = ui.reservedAreas.register((pane) => {
    const series = overlay.series();
    return series && (series.options().pane ?? 0) === pane ? overlay.labelBoxes() : [];
  });
  notify(shared);

  let attached = true;
  const off = (): void => {
    if (!attached) return;
    attached = false;
    offTarget();
    offReserved();
    const index = shared.overlays.indexOf(overlay);
    if (index >= 0) shared.overlays.splice(index, 1);
    if (!shared.overlays.length) {
      shared.off();
      bridges.delete(ui);
    } else notify(shared);
  };
  overlay.own(off);
  return off;
}

function registerShared(bridge: Bridge, ui: ChartUi): Unsubscribe {
  const offs: Unsubscribe[] = [];
  /** The overlay and line a context-menu action applies to. */
  const find = (ctx: ActionContext): { overlay: TradingOverlay; item: TradingItem } | undefined => {
    const key = keyOfTarget(ctx.target);
    if (!key) return undefined;
    const owner = ctx.target?.object ? bridge.owners.get(ctx.target.object) : undefined;
    for (const overlay of owner ? [owner] : bridge.overlays) {
      if (!bridge.overlays.includes(overlay)) continue;
      const item = overlay.items().find((i) => i.key === key);
      if (item) return { overlay, item };
    }
    return undefined;
  };
  const itemOf = (ctx: ActionContext): TradingItem | undefined => find(ctx)?.item;
  const on =
    (fn: (overlay: TradingOverlay, item: TradingItem) => void) =>
    (ctx: ActionContext): void => {
      const found = find(ctx);
      if (found) fn(found.overlay, found.item);
    };
  /** Preferences are shared through the UI preferences, so any overlay reads them. */
  const first = (): TradingOverlay => bridge.overlays[0]!;

  const base = { locations: ['contextMenu'] as const, category: 'trading', owner: 'trading' };
  const actions: UiActionDefinition[] = [
    {
      ...base,
      id: 'trading.modify',
      label: 'trading.modify',
      icon: 'edit',
      targets: KINDS,
      order: 10,
      isVisible: (ctx) => !!find(ctx)?.overlay.handles('onEdit'),
      run: on((overlay, item) => overlay.edit(item.key)),
    },
    {
      ...base,
      id: 'trading.cancelOrder',
      label: 'trading.cancelOrder',
      icon: 'close',
      targets: ['order'],
      order: 20,
      isVisible: (ctx) => !!itemOf(ctx)?.cancellable,
      confirm: (ctx) => ctx.t('trading.confirmCancel'),
      run: on((overlay, item) => overlay.cancel(item.key)),
    },
    {
      ...base,
      id: 'trading.closePosition',
      label: 'trading.closePosition',
      icon: 'close',
      targets: ['position'],
      order: 20,
      isVisible: (ctx) => {
        const item = itemOf(ctx);
        return !!item && item.part === 'main' && item.cancellable;
      },
      confirm: (ctx) => ctx.t('trading.confirmClose'),
      run: on((overlay, item) => overlay.cancel(item.key)),
    },
    {
      ...base,
      id: 'trading.removeBracket',
      label: (ctx) =>
        ctx.t(
          itemOf(ctx)?.part === 'stopLoss' ? 'trading.removeStopLoss' : 'trading.removeTakeProfit',
        ),
      icon: 'trash',
      targets: ['position'],
      order: 30,
      isVisible: (ctx) => {
        const item = itemOf(ctx);
        return !!item && item.part !== 'main' && item.cancellable;
      },
      run: on((overlay, item) => overlay.cancel(item.key)),
    },
    {
      ...base,
      id: 'trading.removeObject',
      label: (ctx) =>
        ctx.t(itemOf(ctx)?.kind === 'alert' ? 'trading.removeAlert' : 'trading.removeMarker'),
      icon: 'trash',
      targets: ['alert', 'marker'],
      order: 20,
      isVisible: (ctx) => !!itemOf(ctx)?.cancellable,
      run: on((overlay, item) => overlay.cancel(item.key)),
    },
    {
      ...base,
      id: 'trading.hideKind',
      label: (ctx) => ctx.t(HIDE_KEYS[itemOf(ctx)?.kind ?? 'order']),
      icon: 'eye-off',
      targets: KINDS,
      order: 80,
      isVisible: (ctx) => !!itemOf(ctx),
      run: on((overlay, item) => overlay.setPreferences({ [PLURAL[item.kind]]: false })),
    },
    {
      ...base,
      id: 'trading.settings',
      label: 'trading.settingsItem',
      icon: 'settings',
      targets: KINDS,
      order: 90,
      run: (ctx) => ctx.ui.openSettings('trading'),
    },
  ];
  for (const action of actions) {
    if (!ui.registry.has(action.id)) offs.push(ui.registry.register(action, { owner: 'trading' }));
  }

  // Object tree: one section per kind; rows are keyboard-focusable and highlight their line.
  const detail = (overlay: TradingOverlay, item: TradingItem): string => {
    const price = overlay.formatPrice(item.price);
    if (item.kind === 'order') {
      const o = item.object as TradingOrder;
      return `${price} · ${formatQuantity(o.quantity)} · ${overlay.t(`trading.status.${o.status ?? 'working'}`)}`;
    }
    if (item.kind === 'position' && item.part === 'main') {
      const o = item.object as TradingPosition;
      return [price, formatQuantity(o.quantity), o.pnl].filter(Boolean).join(' · ');
    }
    return price;
  };
  const name = (overlay: TradingOverlay, item: TradingItem): string => {
    const o = item.object as unknown as Record<string, unknown>;
    const label = typeof o['label'] === 'string' ? o['label'] : null;
    if (item.kind === 'order') {
      const order = item.object as TradingOrder;
      return label ?? `${overlay.t(`trading.side.${order.side}`)} ${order.type}`;
    }
    if (item.kind === 'position') {
      if (item.part === 'takeProfit') return overlay.t('trading.takeProfitName');
      if (item.part === 'stopLoss') return overlay.t('trading.stopLossName');
      return (
        label ??
        `${overlay.t('trading.position')} · ${overlay.t(`trading.side.${(item.object as TradingPosition).side}`)}`
      );
    }
    if (item.kind === 'alert') return label ?? overlay.t('trading.alertName');
    const kind = o['kind'];
    return label ?? (typeof kind === 'string' ? kind : overlay.t('trading.marker'));
  };
  const row = (overlay: TradingOverlay, item: TradingItem): ObjectTreeItem => {
    const label = name(overlay, item);
    const serial = bridge.serials.get(overlay) ?? 0;
    const rowActions: ObjectTreeItem['actions'] = [
      ...(overlay.handles('onEdit')
        ? [
            {
              id: 'edit',
              label: overlay.t('trading.edit', { name: label }),
              icon: 'edit',
              run: () => overlay.edit(item.key),
            },
          ]
        : []),
      ...(item.cancellable
        ? [
            {
              id: 'cancel',
              label: overlay.t('trading.cancel', { name: label }),
              icon: 'close',
              danger: true,
              run: () => overlay.cancel(item.key),
            },
          ]
        : []),
    ];
    return {
      // The first overlay keeps the plain key; others are numbered so ids never collide.
      id: serial > 1 ? `${serial}/${item.key}` : item.key,
      label,
      detail: detail(overlay, item),
      color: item.color,
      selected: overlay.selected() === item.key,
      select: () => {
        overlay.select(item.key);
        // Bring the line into view when it is outside the visible prices.
        const series = overlay.series();
        const y = series?.priceToCoordinate(item.price);
        if (
          series &&
          (y === null ||
            y === undefined ||
            y < 0 ||
            y > (overlay.chart.panes()[series.options().pane ?? 0]?.height() ?? 0))
        )
          series.priceScale().applyOptions({ autoScale: true });
      },
      focus: (focused) => overlay.highlight(focused ? item.key : null),
      actions: rowActions,
    };
  };
  KINDS.forEach((kind, i) => {
    offs.push(
      ui.objectTree.register({
        id: `trading.${PLURAL[kind]}`,
        label: `trading.${PLURAL[kind]}`,
        order: 500 + i,
        subscribe: (onChange) => {
          // Overlays attached later are followed too.
          const subscribed = new Map<TradingOverlay, Unsubscribe>();
          const sync = (): void => {
            for (const overlay of bridge.overlays)
              if (!subscribed.has(overlay)) subscribed.set(overlay, overlay.on('change', onChange));
            for (const [overlay, unsubscribe] of subscribed)
              if (!bridge.overlays.includes(overlay)) {
                unsubscribe();
                subscribed.delete(overlay);
              }
          };
          sync();
          const listener = (): void => {
            sync();
            onChange();
          };
          bridge.listeners.add(listener);
          return () => {
            bridge.listeners.delete(listener);
            for (const unsubscribe of subscribed.values()) unsubscribe();
            subscribed.clear();
          };
        },
        items: () =>
          bridge.overlays.flatMap((overlay) =>
            overlay
              .items()
              .filter((item) => item.kind === kind)
              .map((item) => row(overlay, item)),
          ),
      }),
    );
  });

  // Settings: the "Trading" category (shared with the order ticket's settings when installed).
  const toggle = (key: keyof TradingPreferences, label: string): SettingsField => ({
    kind: 'toggle',
    id: `trading.${key}`,
    label,
    value: () => first().preferences()[key] as boolean,
    set: (value) => setAll({ [key]: value }),
  });
  const setAll = (patch: Partial<TradingPreferences>): void => {
    for (const overlay of [...bridge.overlays]) overlay.setPreferences(patch);
  };
  offs.push(
    ui.settings.register({
      id: 'trading',
      label: 'trading.settings',
      order: 200,
      fields: () => [
        { kind: 'heading', id: 'trading.section', label: 'trading.section' },
        toggle('orders', 'trading.pref.orders'),
        toggle('positions', 'trading.pref.positions'),
        toggle('alerts', 'trading.pref.alerts'),
        toggle('markers', 'trading.pref.markers'),
        ...(bridge.overlays.some((o) => o.handles('onModify'))
          ? [toggle('draggable', 'trading.pref.draggable')]
          : []),
        toggle('showQuantity', 'trading.pref.showQuantity'),
        toggle('showPnl', 'trading.pref.showPnl'),
        toggle('showStatus', 'trading.pref.showStatus'),
        toggle('axisLabels', 'trading.pref.axisLabels'),
        {
          kind: 'select',
          id: 'trading.compact',
          label: 'trading.pref.compact',
          value: () => first().preferences().compact,
          options: () =>
            (['auto', 'always', 'never'] as const).map((v) => ({
              value: v,
              label: `trading.compact.${v}`,
            })),
          set: (value) => setAll({ compact: value as TradingPreferences['compact'] }),
        },
        {
          kind: 'select',
          id: 'trading.lineStyle',
          label: 'trading.pref.lineStyle',
          value: () => first().preferences().lineStyle,
          options: () =>
            (['solid', 'dashed', 'dotted'] as const).map((v) => ({
              value: v,
              label: `trading.lineStyle.${v}`,
            })),
          set: (value) => setAll({ lineStyle: value as TradingPreferences['lineStyle'] }),
        },
      ],
    }),
  );

  return () => {
    for (const fn of offs.splice(0).reverse()) fn();
  };
}
