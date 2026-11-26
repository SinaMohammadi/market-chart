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

/**
 * Connects an overlay to a `ChartUi` (done by `createTradingOverlay` when `ui` is given): right-click targets
 * `order`, `position`, `alert` and `marker` with their actions in the shared context menu, an object-tree
 * section per kind, and the "Trading" settings category. Everything is removed with the overlay.
 */
export function attachTradingUi(overlay: TradingOverlay, ui: ChartUi): Unsubscribe {
  const offs: Unsubscribe[] = [];
  const itemOf = (ctx: ActionContext): TradingItem | undefined => {
    const key = keyOfTarget(ctx.target);
    return key ? overlay.items().find((i) => i.key === key) : undefined;
  };

  offs.push(
    ui.targets.register((event) => {
      if (event.region !== 'pane') return null;
      const hit = overlay.hitTest(event.pane, event.paneX, event.paneY);
      if (!hit) return null;
      const item = hit.item;
      // The menu acts on what the user sees highlighted.
      overlay.select(item.key);
      return {
        kind: item.kind,
        event,
        pane: event.pane,
        time: event.time,
        price: event.price,
        object: {
          type: item.kind,
          id: item.id,
          ...(item.part !== 'main' ? { part: item.part } : {}),
          data: item.object,
        },
      };
    }),
  );

  const base = { locations: ['contextMenu'] as const, category: 'trading', owner: 'trading' };
  const actions: UiActionDefinition[] = [
    {
      ...base,
      id: 'trading.modify',
      label: 'trading.modify',
      icon: 'edit',
      targets: KINDS,
      order: 10,
      isVisible: (ctx) => !!itemOf(ctx) && !!overlay.handles('onEdit'),
      run: (ctx) => overlay.edit(itemOf(ctx)!.key),
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
      run: (ctx) => overlay.cancel(itemOf(ctx)!.key),
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
      run: (ctx) => overlay.cancel(itemOf(ctx)!.key),
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
      run: (ctx) => overlay.cancel(itemOf(ctx)!.key),
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
      run: (ctx) => overlay.cancel(itemOf(ctx)!.key),
    },
    {
      ...base,
      id: 'trading.hideKind',
      label: (ctx) => ctx.t(HIDE_KEYS[itemOf(ctx)?.kind ?? 'order']),
      icon: 'eye-off',
      targets: KINDS,
      order: 80,
      isVisible: (ctx) => !!itemOf(ctx),
      run: (ctx) => overlay.setPreferences({ [PLURAL[itemOf(ctx)!.kind]]: false }),
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
  const detail = (item: TradingItem): string => {
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
  const name = (item: TradingItem): string => {
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
  KINDS.forEach((kind, i) => {
    offs.push(
      ui.objectTree.register({
        id: `trading.${PLURAL[kind]}`,
        label: `trading.${PLURAL[kind]}`,
        order: 500 + i,
        subscribe: (onChange) => overlay.on('change', onChange),
        items: () =>
          overlay
            .items()
            .filter((item) => item.kind === kind)
            .map((item): ObjectTreeItem => {
              const label = name(item);
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
                id: item.key,
                label,
                detail: detail(item),
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
            }),
      }),
    );
  });

  // Settings: the "Trading" category (shared with the order ticket's settings when installed).
  const toggle = (key: keyof TradingPreferences, label: string): SettingsField => ({
    kind: 'toggle',
    id: `trading.${key}`,
    label,
    value: () => overlay.preferences()[key] as boolean,
    set: (value) => overlay.setPreferences({ [key]: value }),
  });
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
        ...(overlay.handles('onModify') ? [toggle('draggable', 'trading.pref.draggable')] : []),
        toggle('showQuantity', 'trading.pref.showQuantity'),
        toggle('showPnl', 'trading.pref.showPnl'),
        toggle('showStatus', 'trading.pref.showStatus'),
        toggle('axisLabels', 'trading.pref.axisLabels'),
        {
          kind: 'select',
          id: 'trading.compact',
          label: 'trading.pref.compact',
          value: () => overlay.preferences().compact,
          options: () =>
            (['auto', 'always', 'never'] as const).map((v) => ({
              value: v,
              label: `trading.compact.${v}`,
            })),
          set: (value) =>
            overlay.setPreferences({ compact: value as TradingPreferences['compact'] }),
        },
        {
          kind: 'select',
          id: 'trading.lineStyle',
          label: 'trading.pref.lineStyle',
          value: () => overlay.preferences().lineStyle,
          options: () =>
            (['solid', 'dashed', 'dotted'] as const).map((v) => ({
              value: v,
              label: `trading.lineStyle.${v}`,
            })),
          set: (value) =>
            overlay.setPreferences({ lineStyle: value as TradingPreferences['lineStyle'] }),
        },
      ],
    }),
  );

  const off = (): void => {
    for (const fn of offs.splice(0).reverse()) fn();
  };
  overlay.own(off);
  return off;
}
