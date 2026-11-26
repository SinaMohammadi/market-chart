# @market-chart/trading

Shows **your application's** orders, positions (with take-profit and stop-loss), price alerts and custom
price markers as lines and labels at their prices on a `@market-chart/core` chart. Users can drag lines to
change prices, cancel with the × on a label, click, double-click, right-click and hover — each part
optional, each calling your callbacks.

> **The library never trades.** There is no broker code here and nothing is sent anywhere. Your application
> owns accounts, validation and execution; the overlay only draws what you give it and calls your callbacks
> after an explicit user action. The chart is **not the source of truth** for order state: keep your server
> authoritative and show its state elsewhere too. Regulatory duties for real trading belong to your application.
> All examples in this repository are **simulated**. See [LEGAL.md](../../docs/LEGAL.md) and the trading section
> of [SECURITY.md](../../SECURITY.md).

```sh
npm install @market-chart/core @market-chart/trading
# optional: @market-chart/ui (menus, object tree, settings), @market-chart/react + react
```

## Usage

```ts
import { createTradingOverlay } from '@market-chart/trading';

const overlay = createTradingOverlay(chart, {
  ui, // optional ChartUi: context menus, object tree, "Trading" settings, saved preferences, translations
  onModify: (order, price) => api.modifyOrder(order.id, price), // line shows pending; snaps back on reject
  onCancel: (order) => api.cancelOrder(order.id),
  onClosePosition: (position) => api.closePosition(position.id), // × on positions only when given
  onSelect: (object, info) => select(info.id),
  onEdit: (object) => openEditor(object), // double-click, "Modify…", object tree
});

overlay.setOrders([
  { id: '1', side: 'buy', type: 'limit', price: 101.5, quantity: 2, status: 'working' },
]);
overlay.upsertOrder({
  id: '1',
  side: 'buy',
  type: 'limit',
  price: 101.5,
  quantity: 2,
  status: 'partial',
});
overlay.removeOrder('1');
overlay.setPositions([
  {
    id: 'p',
    side: 'buy',
    entryPrice: 100,
    quantity: 3,
    takeProfit: 108,
    stopLoss: 96,
    pnl: '+12.40',
  },
]);
overlay.setAlerts([{ id: 'a', price: 105 }]);
overlay.addMarker({ id: 'liq', price: 88, label: 'Liquidation', color: '#e040fb' });
```

React:

```tsx
import { TradingOverlay } from '@market-chart/trading/react';

<Chart>
  <CandlestickSeries data={bars} />
  <TradingOverlay
    ui={ui}
    orders={orders}
    positions={positions}
    onModify={modify}
    onCancel={cancel}
  />
</Chart>;
```

## Behaviour

- **Display**: a line plus a label (side and type, quantity, status, P&L text you supply) and an axis label
  per object, coloured by side and status. Overlapping labels are stacked. Lines follow their price when
  panning, zooming or moving the series to another pane. Compact labels on narrow charts.
- **Dragging**: rounded to the series' tick size (`minMove`). The line stays pending until `onModify`
  settles and returns to its old price when the promise rejects or resolves to `false`. New data from you
  (`upsertOrder`) always wins.
- **Batching**: any number of `set…`/`upsert…`/`remove…` calls in one task produce one rebuild and one frame.
  Lines are drawn as one path per colour and style. See `benchmarks/trading.perf.ts` (1,000 orders).
- **Validation**: objects are validated (`normalizeOrder` …): ids, sides, finite prices, non-negative
  quantities; labels are plain text without control or bidi characters; only plain CSS colours. Invalid
  objects are dropped from `set…` and reported; `upsert…` throws `TradingError`.
- **With a `ChartUi`**: right-click targets `order`, `position`, `alert`, `marker` with Modify, Cancel
  order, Close position, Remove take-profit/stop-loss, Hide and settings items (cancel and close ask for
  confirmation); an object-tree section per kind (rows are focusable buttons: Enter selects, Delete cancels,
  focus highlights the line); a "Trading" settings category; preferences saved under
  `extensions.trading`; texts in English, Persian and Arabic.

## Preferences

`orders`, `positions`, `alerts`, `markers` (visibility), `draggable`, `showQuantity`, `showPnl`,
`showStatus`, `axisLabels`, `compact` (`auto` | `always` | `never`), `lineStyle`. Application defaults via
`defaults`; without a `ui`, persist them yourself with `onPreferencesChange`.

## Limitations

- Labels are drawn on the canvas: screen readers reach the objects through the object tree (with a
  `ChartUi`), not on the chart itself.
- One overlay per `ChartUi` registers the context-menu actions; a second overlay on the same UI shares them.
- Drag and cancel interactions use the chart's input handlers: mouse, pen and touch. Keyboard users modify
  objects through `onEdit` (object tree) or `overlay.modify(key, price)`.

MIT licensed.
