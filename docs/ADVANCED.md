# Advanced guide

How to extend and integrate market-chart beyond the quick starts: the runtime model, plugins and custom
rendering, custom series, indicators and drawing tools, data and state, the interface layer, trading
integrations, performance, server rendering, testing and hardening. Each section points to the package README
with the full API.

- [1. Runtime model](#1-runtime-model)
- [2. Plugins: layers, input and lifecycle](#2-plugins-layers-input-and-lifecycle)
- [3. Custom chart types](#3-custom-chart-types)
- [4. Custom indicators and drawing tools](#4-custom-indicators-and-drawing-tools)
- [5. Data: datafeeds, history and realtime](#5-data-datafeeds-history-and-realtime)
- [6. State: persistence, providers and workspaces](#6-state-persistence-providers-and-workspaces)
- [7. The interface layer in depth](#7-the-interface-layer-in-depth)
- [8. Languages and right-to-left](#8-languages-and-right-to-left)
- [9. Integrating trading safely](#9-integrating-trading-safely)
- [10. Performance tuning](#10-performance-tuning)
- [11. Server rendering and hydration](#11-server-rendering-and-hydration)
- [12. Testing your integration](#12-testing-your-integration)
- [13. Hardening checklist](#13-hardening-checklist)
- [14. Versioning and upgrades](#14-versioning-and-upgrades)

---

## 1. Runtime model

```
application ──► ChartApi (core) ──► model (typed-array columns, shared timeline)
                    │                        │
                    │ invalidate(mask)       ▼
                    └──────────────► FrameScheduler ──► one frame per animation frame
                                                         ├─ layout   (scales, ticks, axis widths)
                                                         ├─ main     (grid, series, 'below'/'above' layers, axes)
                                                         └─ overlay  (crosshair, 'top' layers)
plugins ── addPaneLayer / addInputHandler / on(event) ──► tracked, released with the plugin
ui ─────── ChartUi (actions, menus, preferences, features) ──► renderers (React or your own)
```

Rules that follow from it:

- **Any number of changes in one task cost one frame.** `setData`, `update`, `applyOptions`, price-line changes
  and plugin redraw requests only set an invalidation mask; the scheduler renders once per animation frame.
  `chart.render()` forces a synchronous frame (tests, screenshots).
- **Pointer movement repaints only the overlay surface.** Keep anything that follows the pointer on a `top`
  layer and call `requestRedraw('overlay')`; never redraw series for hover effects.
- **Coordinates.** Data is UTC milliseconds and prices. The time axis is a *logical index* (bar `i` is centred at
  logical `i`), so gaps (weekends, nights) take no space. Layer drawing uses **bitmap pixels**
  (`cssPx × pixelRatio`); hit-testing and events use **CSS pixels**.
- **React never renders bars.** Components push data into the engine; a realtime tick is an engine call, not a
  React render.
- **Everything is disposable.** Plugins, managers, `ChartUi` and its features own their listeners and remove them
  on `destroy()`; the chart's `destroy` event triggers that cascade.

## 2. Plugins: layers, input and lifecycle

A plugin receives a context whose registrations are released automatically:

```ts
import type { ChartPlugin, PaneLayerDrawContext } from '@market-chart/core';

export function sessionShading(sessions: readonly { from: number; to: number }[]): ChartPlugin {
  return {
    id: 'app/session-shading',
    version: '1.0.0',
    requires: { core: '^0.1.0' },
    install(ctx) {
      const draw = (c: PaneLayerDrawContext): void => {
        c.ctx.fillStyle = 'rgba(41, 98, 255, 0.06)';
        for (const s of sessions) {
          const x0 = c.timeToX(s.from);
          const x1 = c.timeToX(s.to);
          if (x0 === null || x1 === null) continue;
          // Bitmap pixels: multiply CSS coordinates by the pixel ratio.
          c.ctx.fillRect(x0 * c.pixelRatio, 0, (x1 - x0) * c.pixelRatio, c.height * c.pixelRatio);
        }
      };
      ctx.addPaneLayer({ pane: 0, zOrder: 'below', draw });
    },
  };
}

chart.use(sessionShading(sessions));
```

**Layer order.** `below` (under series, main surface), `above` (over series, main surface), `top` (overlay
surface, repainted on every pointer move: keep it cheap). Register one layer per pane you draw in; panes appear
when series are placed in them, so listen to `seriesAdded` and `paneResize` if you need new panes (the drawing and
trading managers do this).

**Input handlers** run before the chart's own behaviour, most recently registered first:

```ts
ctx.addInputHandler({
  hover: (e) => (isOverMyThing(e.paneX, e.paneY) ? 'pointer' : null), // cursor, or null for default
  pointerDown: (e) => {
    if (e.button !== 0 || !isOverMyThing(e.paneX, e.paneY)) return false; // false: the chart pans as usual
    startGesture(e);
    return true; // captured: moves and the release of this pointer come to this handler
  },
  pointerMove: (e) => continueGesture(e),
  pointerUp: (e) => finishGesture(e),
  pointerCancel: () => abortGesture(), // second finger, pointer cancel, chart destroyed
  doubleClick: (e) => handled(e),
  keyDown: (e) => e.key === 'Escape' && abortGesture(),
});
```

Capture only what you hit: returning `true` for every press would disable panning. A handler that throws is
isolated and reported through the chart's `error` event; it cannot break input.

**Dependencies and versions.** `dependencies: ['other/plugin', { id: 'x', version: '^2.0.0' }]` and
`requires: { core: '^0.1.0' }` are checked at `use()`. Ids must be unique per chart (`hasPlugin(id)`).

**Cleanup.** Everything registered through the context is removed by `chart.removePlugin(id)` or
`chart.destroy()`; `destroy?()` on the plugin is for your own resources (timers, sockets).

**Shared helpers** for plugins: `layoutLabels` (stack labels without overlaps, like the axis does),
`priceTickSize`/`roundToTick` (round to a series' tick size), `safeText` (plain text for canvas labels).

## 3. Custom chart types

`chart.addCustomSeries(view)` gives you the engine's time axis, auto-scaling, crosshair values, last-value label and
price lines, while you paint:

```ts
import type { CustomSeriesView } from '@market-chart/core';

const dots: CustomSeriesView = {
  kind: 'value', // or 'ohlc'; the store drives the axis, autoscale and crosshair
  paint({ ctx, data, from, to, x, y, pixelRatio }) {
    ctx.fillStyle = '#ff9800';
    for (let i = from; i <= to; i++) {
      const v = data.value(i);
      if (Number.isNaN(v)) continue; // whitespace
      ctx.beginPath();
      ctx.arc(x(i), y(v), 2.5 * pixelRatio, 0, Math.PI * 2); // x/y are bitmap pixels already
      ctx.fill();
    }
  },
  autoscale: (data, from, to) => {
    let min = Infinity;
    let max = -Infinity;
    for (let i = from; i <= to; i++) {
      const v = data.value(i);
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return min <= max ? { min, max } : null;
  },
};

const series = chart.addCustomSeries(dots, { title: 'Signal' });
series.setData(points); // [{ time, value }]
```

Paint only `from..to` (the visible range, padded by one point): the engine already culled the data, so cost is
bounded by the pane width, not the dataset. Data that does not fit OHLC or a value (footprints, order books) stays
in your view, keyed by time; `@market-chart/charts` does this for footprint and heatmap charts.

## 4. Custom indicators and drawing tools

**Indicators** are `calc(state, step)`: all mutable data lives in `state`, which the engine deep-copies before the
last bar so realtime ticks re-run one step instead of recalculating history. Use the O(1) primitives (`Ema`,
`Sma`, `Rma`, `Wma`, `RollingSum`, `RollingExtreme`, `StdDev`, `createMa`) rather than arrays you rescan. Validate inputs declaratively (`inputs` schema); the same
schema drives settings dialogs and persistence. Test every custom indicator for batch/stream equivalence: compute
over a series at once, then bar by bar with repeated updates of the forming bar, and compare. See the
[indicators README](../packages/indicators/README.md#custom-indicators).

**Drawing tools** are stateless definitions: `draw` (canvas), `distance` (hit-testing in CSS px), optional
`handles`/`moveHandle` (editing), `seed` (one-click tools) and `compute` (derived values, cached per drawing and
data version). Anchors are `{ time, price }`, so drawings survive zoom, pane resize and reloads. See the
[drawing-tools README](../packages/drawing-tools/README.md).

## 5. Data: datafeeds, history and realtime

Implement the `Datafeed` contract once and `DatafeedController` handles ordering, paging and realtime:

```ts
import type { Datafeed } from '@market-chart/datafeed';

const feed: Datafeed = {
  resolveSymbol: async (symbol) => api.symbolInfo(symbol),
  getHistoricalData: async (symbol, interval, range) => api.candles(symbol, interval, range.from, range.to),
  subscribe(symbol, interval, onCandle) {
    const socket = api.stream(symbol, interval, onCandle);
    return () => socket.close();
  },
};
```

What the controller guarantees, and what you should rely on:

- **No lost ticks between history and live.** It subscribes first, buffers, loads history, then replays.
- **No stale responses.** Each load has a generation number; answers for a previous symbol or interval are
  dropped, so fast symbol switching is safe.
- **Untrusted input is normalised.** Times in seconds, milliseconds or ISO (zone-less ISO is UTC), duplicates
  (last wins), unsorted rows, inconsistent high/low; invalid rows are counted and dropped, never guessed.
- **Bounded memory.** Set `maxBars` for long-running realtime screens; without it, memory grows with new bars.
- **Paging.** Scrolling near the start loads `chunkBars` older bars (`loadMoreThreshold`).

For your own WebSocket protocol, keep parsing outside the chart: validate messages, then call
`series.update(point)`. `update` appends a newer bar, replaces the bar with the same time (the forming bar) or
inserts a historical correction.

## 6. State: persistence, providers and workspaces

`ChartPersistence` stores chart options, the exact visible range and named **providers**:

```ts
import type { StateProvider } from '@market-chart/persistence';

const watchlist: StateProvider = {
  capture: () => ({ symbols: store.symbols() }),
  restore: (data) => store.setSymbols(validateWatchlist(data)), // validate: stored data is untrusted
  subscribe: (onChange) => store.on('change', onChange),       // triggers debounced autosave
};

new ChartPersistence({ chart, storage, id: 'main', providers: { watchlist } });
```

- **Validate in `restore`.** Storage can be edited by users, extensions or another version of your app. The
  built-in providers validate every field; yours must too.
- **Version your provider data** (`{ v: 2, … }`) and migrate in `restore`; the layout schema itself is versioned
  and migrated by the package.
- **Conflicts** use optimistic concurrency (`revision`): choose `overwrite`, `reload`, `fail` or a merge function.
  For a REST store, enforce `If-Match` on the server; the client cannot protect other users' data.
- **Interface preferences** live in `UiPreferencesStore` (language, toolbars, legend, favourite symbols, trading
  display options) and can be saved separately or inside a layout with `uiPreferencesProvider`.

## 7. The interface layer in depth

### One registry, many renderers

Every menu item, header button, sidebar tool and shortcut is one `UiActionDefinition`. Renderers read the same
registry, so an action registered once can be moved, hidden or re-bound by the user without touching its
definition. Prefer `isVisible`/`isEnabled` predicates and `requires` capabilities over registering and
unregistering actions as state changes.

### Headless rendering

The React components are one renderer. `ChartUi` exposes state machines you can render with anything:
`ui.menu` (`ContextMenuController`: state, `hover`, `activate`, `handleKey`, confirmation), `ui.header()`,
`ui.sidebar()`, `ui.legend(time)`, `ui.placements()`. In React, `useContextMenu`, `useSymbolSearch`,
`useOrderTicket` and `usePriceButton` give state plus ARIA and keyboard props for custom UIs.

### Writing your own feature

Optional features are objects with `install(ui)` returning their cleanup. They are installed only when listed,
so they cost nothing otherwise:

```ts
import type { ChartUiFeature } from '@market-chart/ui';

export function watchlistFeature(store: WatchlistStore): ChartUiFeature {
  return {
    id: 'app.watchlist',
    install(ui) {
      const offs = [
        ui.registry.register(
          {
            id: 'app.watchlist.add',
            label: 'Add to watchlist', // translation key or text
            targets: ['candlestick', 'chart'],
            locations: ['contextMenu'],
            category: 'app',
            run: (ctx) => store.add(ctx.target?.price ?? null),
          },
          { owner: 'app.watchlist' },
        ),
        ui.settings.register({
          id: 'app.watchlist',
          label: 'Watchlist',
          fields: () => [
            { kind: 'toggle', id: 'wl.sound', label: 'Sound on alerts', value: () => store.sound, set: (v) => store.setSound(v) },
          ],
        }),
        ui.objectTree.register({
          id: 'app.watchlist',
          label: 'Watchlist',
          items: () => store.list().map((w) => ({ id: w.id, label: w.symbol, detail: w.note })),
          subscribe: (onChange) => store.on('change', onChange),
        }),
      ];
      return () => offs.forEach((off) => off());
    },
  };
}

const ui = createChartUi(chart, { features: [watchlistFeature(store)] });
```

Store a feature's user settings under your own namespace in `UiPreferences.extensions` (plain JSON, at most
16 KB) and validate them when you read them.

### Context-menu targets for your own objects

`ui.targets.register(resolver)` lets a right-click on something the engine does not know (a marker you draw in a
plugin) open the shared menu for it: return `{ kind, event, pane, time, price, object: { type, id, data } }` when
your hit test matches, `null` otherwise. `@market-chart/trading` uses this for orders and positions.

## 8. Languages and right-to-left

- **Add a language** with `i18n.register({ code, name, englishName, direction, messages })`; missing keys fall back
  to English. Plurals follow `Intl.PluralRules` (`zero`/`one`/`two`/`few`/`many`/`other`).
- **Add texts for your own actions** with `i18n.extend(code, messages)`; it merges over the dictionary without
  replacing it. Packages do the same (the trading overlay adds its texts only where the application has none).
- **Direction** follows the language unless forced. In RTL the interface mirrors (logical CSS properties, `dir`),
  menus open toward the left, and arrow keys swap. The time axis keeps left-to-right time order.
- **Digits.** `localDigits` shows prices and dates in the language's digits on the axes; number inputs (order
  ticket) accept Latin, Persian and Arabic-Indic digits.
- **Canvas text** in custom layers inherits the chart element's `dir`; reverse segment order yourself when you lay
  out multi-part labels (as the trading labels do).

## 9. Integrating trading safely

The trading components display your objects and call your callbacks; they never send anything. A robust
integration looks like this:

```
user action ──► ticket / drag / × ──► your callback ──► your API (authorises, validates, idempotency key)
                                                            │
broker / back end ─── order events (WebSocket) ─────────────┴──► overlay.upsertOrder / setOrders (batched)
```

1. **Server is authoritative.** Feed the overlay from your back end's order and position events. Treat the chart
   as a view; show the same state in a table or blotter outside it.
2. **Callbacks are requests.** `onModify(order, price)` should send a modify request and resolve when the back end
   accepted it (or reject with a message). The line stays pending meanwhile and snaps back on rejection. When the
   confirmed order arrives through your event stream, `upsertOrder` replaces the local price.
3. **Idempotency.** Generate a client id per submission and send it with the order; the ticket refuses a second
   submission while one is pending and never retries, but your transport might.
4. **Confirmation.** Keep it on for real money (`allowSkipConfirmation` is off by default). The confirm button
   ignores clicks for 400 ms after it appears, so a double-click on "Review order" cannot send.
5. **Validation twice.** Declare field rules in `trading.fields` for fast feedback, and validate again on the
   server (tick size, lot size, price bands, buying power).
6. **Large order books.** Updates are batched per task; 1,000 orders keep panning within budget in the
   benchmark. Turn `axisLabels` off when hundreds of orders crowd the price axis; use `labelFormat` for compact
   labels.
7. **Accessibility.** Lines on the canvas are not reachable by screen readers; the object-tree section (with a
   `ChartUi`) lists every object as focusable rows with edit and cancel buttons.
8. **Label simulations.** Set `trading.simulatedLabel` for demos and paper trading.

See [LEGAL.md](LEGAL.md#trading-interfaces) for responsibilities and [SECURITY.md](../SECURITY.md) for the
security guidance.

## 10. Performance tuning

| Situation | Do this |
|---|---|
| Loading 100K+ bars | `series.setColumns({ time, open, high, low, close })` from typed arrays: no object per bar |
| Reading data back | `series.columns()` instead of `data()` |
| Realtime screens running for hours | `DatafeedController` `maxBars`, or trim history yourself periodically |
| Bursts of ticks | Call `update` per tick; the scheduler draws once per frame. Do not call `render()` per tick |
| Pointer effects in plugins | `top` layer + `requestRedraw('overlay')` |
| Many indicators on one source | Add them through one `IndicatorManager`; the source's bars are prepared once per change |
| Hundreds of price lines or orders | Draw lines in one path per style (as the trading overlay does); limit axis labels |
| Very wide zoom-out | `timeScale.minBarSpacing` caps visible bars at about twice the pane width |

Measure with `pnpm bench` (engine work, no-op canvas) and the playground's Performance page (real canvas). Numbers
and the optimisations behind them are in [PERFORMANCE.md](PERFORMANCE.md).

## 11. Server rendering and hydration

- Every entry is import-safe on the server; interactive React entries carry `"use client"`.
- `<StaticChart>` (`@market-chart/react/ssr`) renders deterministic SVG on the server; `<ProgressiveChart>` swaps
  in the interactive chart on mount, idle, visibility or first interaction, keeping the picture until data is
  ready.
- Pass the language to `<ChartProvider locale>` on the server so `dir`/`lang` are right in the first HTML and RTL
  pages hydrate without a flip.
- Load preferences (`UiPreferencesStore.load()`) in an effect: storage exists only in the browser.

Details: [SSR.md](SSR.md).

## 12. Testing your integration

- **Synthetic data:** `generateBars({ count, interval, seed, startPrice })` and the `TickSimulator` give
  reproducible series; never use real prices in fixtures.
- **Canvas in jsdom:** `installCanvasMock()` from `@market-chart/testing` replaces `getContext` with a recording
  context; `drawnTexts(ctx)` returns the texts drawn (assert labels, escaping, translations).
- **Integration tests** create a real chart (`createChart(container, { autoSize: false, width, height })`), call
  `chart.render()` to draw synchronously, and dispatch pointer events on the `canvas[data-layer="overlay"]` element
  at chart coordinates (`series.priceToCoordinate`, `timeScale().logicalToCoordinate`).
- **Timers and network** are injectable in datafeeds, persistence and symbol search (`timers`, `now`, custom
  `fetch`), so reconnects, debounces and autosave are testable without waiting.
- **Real browser:** layout (menu placement, virtualised lists, focus traps) needs Chromium; keep those tests
  separate (`*.browser.test.*` files here skip themselves under jsdom).

## 13. Hardening checklist

- [ ] Strict Content-Security-Policy: pass `nonce` to `UiStylesProvider`, or ship `UI_CSS` as a file
  (`inject={false}`).
- [ ] Build datafeed URLs with `buildUrl`; never concatenate symbols into URLs.
- [ ] Keep response and message size limits on (`maxResponseBytes`, `maxMessageBytes`).
- [ ] Validate every custom `StateProvider.restore` and every extension-preference namespace.
- [ ] Authorise trading callbacks on the server; send idempotency keys; keep confirmation on.
- [ ] Exclude export and screenshot actions if your data licence forbids them.
- [ ] Review third-party plugins: plugins and custom actions run with full page rights.
- [ ] Keep dependencies current (`pnpm audit --prod`).

The threat model and what the library validates are in [SECURITY.md](../SECURITY.md).

## 14. Versioning and upgrades

- The project is pre-1.0 (`0.x`): a minor version may contain breaking changes, a patch version does not. Every
  change is listed in the package changelogs (Changesets).
- All `@market-chart/*` packages are released with the same version; install matching versions.
- Stored data is versioned: layouts, workspaces, drawings, interface preferences (currently version 3) and their
  migrations run automatically on load. Never edit stored JSON by hand without validating it.
- Before upgrading, read the changelog of every `@market-chart/*` package you use, then run your tests.
