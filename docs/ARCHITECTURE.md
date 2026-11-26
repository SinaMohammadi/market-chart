# Architecture

This document is the source of truth for package boundaries, core data structures,
rendering, extensibility, SSR and persistence. It is written before the code and
updated as features land. Status of each feature lives in [`FEATURE_MATRIX.md`](../FEATURE_MATRIX.md).

---

## 1. Goals and non-goals

**Goals**

- An independent, framework-agnostic charting engine (`@market-chart/core`) with zero runtime dependencies.
- React bindings that are thin: React owns lifecycle and configuration, never per-candle rendering.
- A replaceable rendering backend (Canvas 2D first; WebGL/WebGPU later, only where benchmarks justify it).
- Every advanced capability (indicators, drawing tools, advanced chart types, datafeeds, persistence)
  is a separately installable package built on public core APIs.
- SSR-safe everywhere: no browser global is touched at module scope; a separate, DOM-free static entry.

**Non-goals**

- Wrapping or reproducing proprietary charting code, designs or assets. Established charting products
  (TradingView, a trademark of TradingView, Inc., among others) are used only as a reference for which features
  users expect; no code, assets or data are taken from them. See [LEGAL.md](LEGAL.md).
- Executing trades. Trading-related components only display the application's objects and call its callbacks.
- A monolithic "do everything" component. UI components are optional and headless-friendly.

---

## 2. Package structure

```
packages/
  core/           @market-chart/core           engine: model, scales, renderer, interactions, events, plugins
  react/          @market-chart/react          <Chart>, <Series>, hooks, provider; "./ssr" static entry
  testing/        @market-chart/testing        deterministic synthetic datasets, test helpers
  charts/         @market-chart/charts         chart-type transforms, custom renderers, profiles, order flow
  indicators/     @market-chart/indicators     indicator engine, 44 built-ins, chart manager; "./react" hooks
  drawing-tools/  @market-chart/drawing-tools  drawing manager, 35 tools, history, persistence; "./react" hooks
  plugins/        @market-chart/plugins        (planned) first-party plugins (watermark, legends, …)
  datafeed/       @market-chart/datafeed       Datafeed contract, static/REST/WS/SSE/synthetic adapters, CSV/JSON, chart binding; "./react"
  themes/         @market-chart/themes         (planned) extra themes; dark/light ship in core
  persistence/    @market-chart/persistence    storage adapters, versioned schemas, migrations, autosave, workspaces; "./react"
  i18n/           @market-chart/i18n           typed translations (en, fa, ar + custom), plurals, direction, locale formatting
  ui/             @market-chart/ui             action registry, context menus, header/sidebar, settings, preferences;
                                               optional symbol search, price actions, order ticket; "./react"
  trading/        @market-chart/trading        app orders, positions, alerts, markers drawn at prices (display only); "./react"
apps/
  playground/     Vite app with working examples
  docs/           documentation site: guides, live examples, builder, generated reference
  nextjs/         Next.js App Router example
```

Packages marked _planned_ are not created until work on them starts, so the repository never
contains empty placeholder packages that look finished.

### Dependency graph (allowed directions)

```
            core  ◄──────────────────────────────┐
   ▲   ▲    ▲    ▲         ▲            ▲         │
   │   │    │    │         │            │         │
 react charts indicators drawing-tools datafeed persistence
   ▲                                              │
   │      i18n → core                              │
   └──────────── ui (core, i18n, persistence; ────┘
                     drawing-tools / indicators as optional peers; react only in "./react")
react → i18n (provider and hooks)
trading → core (runtime); ui, i18n, react only as optional peers (types, and "./react")
testing → core (dev-only for every package)
```

- `core` depends on nothing.
- Feature packages depend only on `core`'s public API (no deep imports).
- `react` depends on `core`; it does not depend on feature packages (those integrate through plugins).
- No circular dependencies; enforced by package boundaries (each package only lists what it may import).

---

## 3. Core engine

```
core/src/
  model/        types, ColumnStore (columnar typed-array storage), Timeline (merged time index)
  scales/       TimeScale (logical index ↔ x), PriceScale (price ↔ y, modes), tick generators
  time/         ZonedClock (UTC / local / IANA via cached offsets), time label formatting
  format/       price/volume/percent formatters
  options/      option types, defaults, deep merge
  theme/        dark / light themes
  events/       typed EventEmitter with listener isolation
  render/       RenderBackend interface, Canvas2D backend, frame scheduler, painters (grid, axes, crosshair)
  series/       Series model + per-type painters, series registry
  chart/        ChartImpl (lifecycle/orchestration), Pane, layout, crosshair model, public ChartApi
  interaction/  pointer/wheel/touch controller (pan, zoom, axis scaling, crosshair)
  plugins/      plugin lifecycle, pane render layers
  static/       DOM-free geometry for SSR (separate entry point: @market-chart/core/static)
```

### 3.1 Core data structures

| Structure     | Purpose               | Notes                                                                                                                                                                                                                   |
| ------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ColumnStore` | Series data           | One `Float64Array` per field (`time`, `open`, `high`, `low`, `close`, `volume` or `time`, `value`). Capacity doubles, so realtime appends are amortised O(1) with no per-bar object allocation.                         |
| `Timeline`    | Shared X axis         | Sorted, de-duplicated union of all series timestamps. Each series keeps a `localToGlobal: Int32Array` mapping into it. Appending a newer bar is O(1); out-of-order inserts trigger an O(n) merge.                       |
| `TimeScale`   | Logical index ↔ pixel | State is `barSpacing` + `rightOffset`. Logical index `i` is centred at `x = width − (lastIndex + rightOffset − i + 0.5) · barSpacing`. Missing candles do not create gaps (index-based axis, like most trading charts). |
| `PriceScale`  | Price ↔ pixel         | Works in a transformed space (normal, log10, percentage, indexed-to-100), with margins, inversion, auto-scale and manual range.                                                                                         |

Time values are **UTC milliseconds since epoch** (same unit as `Date.now()`), which avoids
conversions when consuming exchange APIs.

### 3.2 Rendering architecture

```
               ┌───────────────── frame (requestAnimationFrame) ─────────────────┐
invalidate(m) →│ layout?  → autoscale → ticks → measure axis → (re)layout once   │
               │ main?    → background, grid, below-layers, series, above-layers,│
               │            axes, last-value labels, separators                  │
               │ overlay? → crosshair lines + axis labels, top-layers            │
               └─────────────────────────────────────────────────────────────────┘
```

- **Two surfaces per chart**: `main` (expensive, redrawn on data/scale change) and `overlay`
  (cheap, redrawn on crosshair movement). Moving the mouse never repaints candles.
  This is layer-level dirty tracking; rect-level dirty regions are deferred until profiling shows a need.
- **Invalidation mask** (`Layout | Main | Overlay`) coalesces any number of changes into one frame.
- **Bitmap coordinate space** for geometry: painters receive the device pixel ratio and snap to
  physical pixels, giving crisp 1-device-pixel wicks and grid lines on any DPR. Text is drawn in CSS pixels.
- **Viewport culling**: painters only iterate the visible logical range (plus one bar each side for line continuity),
  found with binary search on the series' time column.
- **Bounded work**: `minBarSpacing` (default 0.5 CSS px) caps visible bars at ~2× pane width, so per-frame
  cost is independent of total dataset size. Auto-scale scans only the visible range.
- **Allocation discipline**: painters read typed arrays directly; no per-bar objects are created during a frame.
- **Backend boundary**: `RenderBackend` creates `RenderSurface`s; painters are registered per backend.
  The public API never exposes a `CanvasRenderingContext2D`, except to plugin layers that explicitly
  target the `canvas2d` backend. A WebGL backend can be added without public API changes.

### 3.3 Interactions

A single `InteractionController` attaches listeners **once** to the overlay surface:

| Input              | Region                  | Effect                                                                                 |
| ------------------ | ----------------------- | -------------------------------------------------------------------------------------- |
| drag               | pane                    | pan time; pan price scales that are not auto-scaled; optional kinetic fling on release |
| drag               | left / right price axis | scale that axis (turns its auto-scale off)                                             |
| drag               | time axis               | change bar spacing anchored at the right edge                                          |
| drag               | pane separator          | resize the two neighbouring panes                                                      |
| wheel              | pane                    | zoom around cursor; horizontal wheel / shift-wheel pans                                |
| wheel              | price axis              | scale that axis                                                                        |
| pinch              | pane                    | zoom around the gesture midpoint                                                       |
| long-press (touch) | pane                    | crosshair that follows the finger; next tap hides it                                   |
| dbl-click          | price axis              | re-enable auto-scale                                                                   |
| dbl-click          | time axis               | reset bar spacing and scroll to latest bar                                             |
| move               | pane                    | crosshair (normal or magnet-to-close)                                                  |
| keys (focused)     | chart                   | ←/→ scroll (Shift: 10 bars), ↑/↓/+/− zoom, Home/End, Esc hides crosshair               |

Timers and animation frames are injected (`InteractionEnvironment`), so gestures such as long-press and kinetic
scrolling are unit-tested deterministically in Node.

### 3.4 Multi-pane

A chart has one or more `Pane`s stacked vertically, sharing the `TimeScale`. Each pane owns a right
and a left price scale plus any number of overlay scales (no axis, own range, e.g. volume). The layout is
`[left axis | panes | right axis]`; the left column appears only while some series uses `priceScaleId: 'left'`.
Panes are resized by dragging separators. The vertical crosshair line spans all panes; the horizontal line
and price labels (both axes) are drawn in the hovered pane. Last-value labels are laid out without overlaps.

### 3.6 Synchronisation hooks

`setCrosshairPosition(time, price?, pane?)` places the crosshair programmatically and emits
`crosshairMove` with `source: 'api'`; pointer-driven events carry `source: 'pointer'`. Multi-chart
synchronisation (`createChartSync`) forwards only pointer events, which prevents feedback loops.

### 3.5 Event system

`EventEmitter<Map>` is strongly typed; `on()` returns an unsubscribe function, listeners are
isolated (an exception in one listener is reported through `onError` and does not break others),
and all listeners are dropped on `destroy()`.

---

## 4. Public API (core surface)

```ts
const chart = createChart(container, { theme: 'dark' });
const candles = chart.addSeries('candlestick', { upColor: '#26a69a' });
candles.setData(bars);
candles.update({ time, open, high, low, close });          // realtime
const vol = chart.addSeries('histogram', { priceScaleId: 'volume', priceFormat: { type: 'volume' } });
chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
chart.on('crosshairMove', (e) => …);
chart.timeScale().fitContent();
chart.setTheme('light');
chart.destroy();
```

Series types are a discriminated union keyed by `SeriesType`; `addSeries('line', …)` returns
`SeriesApi<'line'>` whose `setData` only accepts `LinePoint[]` and whose options only accept line options.

Options are **plain JSON** (serialisable). Functions (custom formatters) live in a separate
`formatters` bag so that persisted state never contains code.

---

## 5. Plugin architecture

```ts
interface ChartPlugin {
  id: string;
  version: string;
  dependencies?: readonly string[]; // plugin ids that must be installed first
  install(context: ChartPluginContext): void;
  destroy?(): void;
}
```

`ChartPluginContext` exposes the public `ChartApi`, typed event subscription, and
`addPaneLayer({ pane, zOrder: 'below' | 'above' | 'top', draw })`. Every resource registered through
the context is tracked and released automatically on uninstall or chart destroy. Plugins never receive
internal mutable objects, so they cannot silently corrupt engine state; failures in `install`/`draw`
are caught and reported. Future extension points (custom series types, indicators, drawing tools,
context menus) are added to the context, not by exposing internals.

---

## 6. SSR boundaries

| Entry                       | Browser globals                                  | Purpose                                     |
| --------------------------- | ------------------------------------------------ | ------------------------------------------- |
| `@market-chart/core`        | only inside `createChart()` and later calls      | interactive engine                          |
| `@market-chart/core/static` | none                                             | pure geometry (paths, candle rects, ranges) |
| `@market-chart/react`       | only inside effects; file carries `"use client"` | interactive React chart                     |
| `@market-chart/react/ssr`   | none, imports only `core/static`                 | `<StaticChart>` server-rendered SVG         |

`StaticChart` uses a fixed `viewBox` and `preserveAspectRatio="none"` with
`vector-effect="non-scaling-stroke"`, so markup is deterministic and identical on server and client:
no measurement, no hydration mismatch.

---

## 7. Indicators (`@market-chart/indicators`)

```
definition (schema + outputs + create)  ──►  IndicatorRunner  ──►  IndicatorResult (columnar)
       │                                       │  reset(bars)        │
       │                                       │  append(bar)        ▼
       └── registry (validated)                │  updateLast(bar)  IndicatorManager ──► ordinary chart series,
                                               ▼                     price lines (levels), pane layer (fills)
                                     calc(state, step)
```

- **Calculators** are `calc(state, step)`: plain state plus a pure step function. Realtime updates of the last
  bar restore a deep copy of the state taken before that bar (`cloneState`) and run one step, so the cost is
  O(state size) per tick and repeated ticks never accumulate error.
- **Primitives** (SMA/EMA/RMA/WMA, rolling sums, monotonic-deque extremes, standard deviation, lags) are O(1)
  per value and correct floating-point drift by recomputing exact sums once per window.
- **Inputs** are a declarative schema (`int`, `float`, `source`, `enum`, `bool`, `time`). It drives defaults,
  validation (unknown keys rejected) and generated settings forms.
- **Chart integration** uses only the public API. Outputs become line/histogram series (whitespace where there is
  no value), levels become price lines, and band fills are a plugin pane layer. Source changes arrive through
  `dataChanged`: `update` → incremental, `set` → full recompute.
- **Correctness**: every built-in is tested against batch/stream equivalence under repeated tick updates, and
  the main indicators against independent naive reference implementations.

## 8. Drawing tools (`@market-chart/drawing-tools`)

- **Model**: immutable `Drawing` records with data-space anchors (`{ time, price }`) attached to a series
  (pane and price scale). Times snap to bar centres through the time scale's logical index and may lie beyond the data.
- **Tools** are stateless definitions: `draw`, `distance` (hit testing), and optionally `handles`, `moveHandle`,
  `seed` (one-click tools) and `compute` (data-derived values, cached by drawing identity and data version).
- **Input**: a plugin input handler (core `addInputHandler`) captures gestures before the chart pans, so drawing
  and panning never conflict; uncaptured clicks fall through to the chart.
- **Rendering**: per-pane layers. Resting drawings are on the `above` layer of the main surface; the draft and the
  drawings being dragged are on the `top` layer, repainted with overlay-only redraws.
- **History**: change sets of `{ before, after }` record pairs (records are immutable), one per user action.
- **Persistence**: `{ version, drawings }` snapshots, validated record by record, with a migration table.

## 9. Advanced features

- **Custom series** (`chart.addCustomSeries(view)`): the core stores an OHLC or value _envelope_ (time axis,
  auto-scale, crosshair, last value) and calls `view.paint` with bitmap coordinates for the visible range.
  Richer data such as footprint levels or order books stays in the view, keyed by time.
- **Sync** (`createChartSync`): crosshair via `setCrosshairPosition` (pointer events only), visible range mapped
  through time (`logicalToTime` → `timeToLogical`), stopping when a chart is already within tolerance.
  `<ChartLayout>` creates one sync group and charts inside join it automatically.
- **Plugins** declare `requires.core` and versioned dependencies (semver ranges), checked at install time.
- **@market-chart/charts** keeps computations pure (transforms, profiles, order-flow aggregation) and puts
  rendering in custom views and pane layers.

## 10. Datafeeds and persistence

### Datafeed

`@market-chart/datafeed` defines the `Datafeed` contract (`searchSymbols?`, `resolveSymbol`, `getHistoricalData`,
`subscribe`) and adapters that implement it. Adapters only move and normalise data; a `DatafeedController`
binds one to a series:

```
resolveSymbol ─► apply price format
subscribe ─────► buffer updates ──┐
getHistoricalData(last N bars) ───┴► setData, then replay buffer ─► live: series.update()
visibleRangeChange near start ─► getHistoricalData(older page) ─► merge, setData
```

- Subscribing before the first history request (and buffering) means no update between the two is lost.
- Every load carries a generation number; responses for a previous symbol/interval are dropped.
- Untrusted rows pass through `normalizeCandles`: times in s/ms/ISO (zone-less ISO = UTC), sorting,
  duplicates (last wins), high/low repair; invalid rows are counted and dropped, never guessed.
- Timers, `fetch`, `WebSocket` and `EventSource` are injectable, so reconnect, backoff and heartbeat logic is
  tested with a manual clock. Nothing is created at import time.

### Persistence

```ts
interface StorageAdapter<T extends { revision: number }> {
  save(id: string, state: T): Promise<void>; // rejects with StorageConflictError unless state.revision is newer
  load(id: string): Promise<T | null>; // validated (and migrated) on read
  delete(id: string): Promise<void>;
  list(): Promise<ChartLayoutMetadata[]>;
}
```

- **Schema.** `SerializedChartState` and `WorkspaceState` carry `version` (schema) and `revision` (save counter).
  Loading sanitises to plain JSON (no functions, prototypes or forbidden keys, bounded size and depth), runs pure
  `vN → vN+1` migrations, then validates every field.
- **State capture.** `ChartPersistence` reads chart options, the exact visible range (logical edges converted to
  times, so restore → save is idempotent) and named providers (`indicatorsProvider`, `drawingsProvider`,
  `valueProvider`). Packages stay decoupled: providers are structurally typed.
- **Saving.** Chart and provider change events mark the state dirty; a debounced save compares a canonical
  serialisation with the last saved/loaded one and skips no-op saves.
- **Conflicts.** Optimistic concurrency by revision: memory/Web Storage/IndexedDB check before writing (IndexedDB in
  one transaction), REST uses `If-Match` and 409/412. Strategies: overwrite, reload, fail, or a merge function.
- **Cross-tab.** A `BroadcastChannel` message after each save makes other tabs reload unless they hold real edits.
- **SSR.** Adapters resolve `localStorage`, `indexedDB`, `fetch` and `BroadcastChannel` lazily.

---

## 11. SSR and performance

### SSR boundaries

- No entry point touches a browser API at import time (enforced by `tests/ssr/imports.test.ts`, which traps
  `window`, `document`, storage, `indexedDB`, `fetch`, `WebSocket`, `BroadcastChannel`, animation frames…
  while importing every entry in plain Node). Environment checks run when code is used, not when it is loaded.
- Interactive React entries are built with `"use client"`; main entries are plain modules; `react/ssr` imports
  only `react` and `core/static`.
- `ProgressiveChart` (react) renders `StaticChart` SVG on both sides and mounts `<Chart>` on mount, idle,
  visibility or first interaction, keeping the picture until the engine has data. See [SSR.md](SSR.md).

### Data paths for large series

- `SeriesApi.columns()` returns typed-array copies of a series; `SeriesApi.setColumns()` replaces data from
  typed or plain arrays with the same validation as `setData`. Indicators use both, so recalculation creates no
  object per output point.
- `Timeline.rebuild` compares a store with the union so far before merging; stores with identical times share
  one identity mapping (`appendFrom` keeps it while appends stay aligned and copies it when they diverge). The
  union buffer is reused across rebuilds.
- `IndicatorManager` builds the Bar array of a source once per data-change dispatch and shares it between the
  indicators on that source. It is not kept after the dispatch, so nothing is retained.
- `DatafeedController` updates the forming bar in O(1) and can cap history with `maxBars`.

Measurements, the before/after numbers and the options that were evaluated but not adopted (OffscreenCanvas,
indicator workers, WebGL) are in [PERFORMANCE.md](PERFORMANCE.md).

---

## 12. Interface layer and internationalisation

### Boundaries

- The engine has no UI. `core` gains only what a UI needs to ask about: `localization.direction`,
  `localization.localizeNumbers`, `setLocale/getLocale/setDirection/getDirection` with `localeChange` and
  `directionChange` events, and a `contextMenu` event. The event is raised by right-click, the ContextMenu
  key, Shift+F10, and long-press when `interaction.touchContextMenu` is set. It carries the pane, the side
  (axis or pane), time, logical index, price and the series hits under the pointer. The native menu is
  suppressed only while the chart has `contextMenu` listeners.
- `@market-chart/i18n` depends on `core` for the event emitter and chart types only. Dictionaries are plain
  objects, and the English one defines the `TranslationKey` type. `syncChartLocale` connects an `I18n` to a
  chart through `applyOptions`, so nothing is recreated.
- `@market-chart/ui` is headless. `ChartUi` owns one `ActionRegistry`, a `ContextMenuController`, layout
  functions (`headerLayout`, `sidebarLayout`) and a `UiPreferencesStore`. Renderers draw state and call back
  into it. The React entry is one renderer and is the only place that imports React.
- Drawing and indicator actions call `DrawingManager` and `IndicatorManager`. They do not reimplement drawing,
  hit-testing or indicator logic. For hit-testing, the managers gained `drawingAt`, `canPaste`,
  `indicatorForSeries` and `IndicatorHandle.moveToPane`.

### One registry

Every action is `UiActionDefinition`: id, translation key, icon, kind, category, group, `locations`
(contextMenu, header, sidebar), `targets`, section, order, shortcut, `requires` (capabilities), visibility,
enabled and active predicates, `run`, `submenu`, `options`/`select`, `confirm`, `owner` and `component`.
The context menu, header, sidebar, shortcuts and settings dialog all read the same registry. User preferences
(placement, visibility, hidden menu items, shortcuts) are applied on top of the definitions without changing
them, and `override`/`restore` lets applications patch built-ins.

Actions that need something the application owns (symbol list, timeframe switcher, alerts, layout saving)
declare it in `requires`. If the capability is missing, the action is not offered.

### Direction

Direction is a property of the language unless forced. In RTL, the interface uses logical CSS properties and
`dir`, so start and end swap: the header sections and the sidebar position mirror, menus open and flip toward
the left, and arrow keys swap in menus and toolbars. Directional icons mirror. Chart price-line titles are
right-aligned.

The time axis keeps its left-to-right time order, and axis dates stay Gregorian (tick positions are
Gregorian), with localised month names and optionally localised digits.

### Preferences

`UiPreferencesStore` stores versioned JSON through any persistence `StorageAdapter`, with debounced autosave
and latest-wins writes. Loads and imports go through `validateUiPreferences`, which migrates older versions and
drops invalid entries. `uiPreferencesProvider` puts the preferences into a `ChartPersistence` layout.
Version 2 added the legend fields and the price-label switches.

### Legend and price labels

The legend is data first: `legendData(ui, time)` (`ui.legend()`) returns formatted items for the hovered or
last bar, and `<ChartLegend>` renders them, re-rendering at most once per animation frame. Price labels
(`PriceMarkers`) use only the engine's public price-line and series-option APIs. The visible high and low are
recomputed from the visible bars after range, data or preference changes, batched into one microtask. Neither
adds anything to the engine.

### Documentation site

`apps/docs` consumes the packages from source. Its pages read the repository's Markdown with `?raw` imports,
its examples show their own source files, and its reference pages are generated at runtime from the packages
(indicator and tool registries, built-in actions, default options, dictionaries, module exports). Every number
and table in the documentation therefore comes from the code it describes. It is a static build with hash
routing, so it can be hosted from any folder.

---

## 13. Symbols, price actions and trading objects

All of it is optional and display only. The library never trades: it shows UI and calls the application's
callbacks after an explicit user action; the repository contains no broker code.

### Opt-in features in `@market-chart/ui`

`ChartUi` gained generic extension points: `use(feature)` / `features: […]` (features own their cleanup),
`provide()` (a feature publishes its controller, keyboard handler and price resolution), `targets.register` /
`targets.intercept` (context-menu targets for objects the engine does not know: `order`, `position`, `alert`,
`marker`), and data-described `settings` and `objectTree` sections. The three features are separate modules
(`symbolSearch()`, `priceActions()`, `orderTicket()`); `ChartUi` refers to them by type only, and
`<ChartInterface>` loads their React views with `lazy()` when the feature is installed. A headless bundle
without them contains none of their code (checked by bundling a minimal app against `dist/`).

- **SymbolSearch**: query, debounce, group tabs, favourites and recents (preferences `symbols`), an
  `AbortController` per request plus a generation counter (stale answers are dropped), keyboard state, and
  `surface` (dropdown, dialog or custom). Untrusted items pass through `normalizeSymbolItem`.
- **PriceActions**: actions in the shared registry with `priceAction: true`; `ActionContext.price` (price
  rounded with core `roundToTick`, formatted, side vs. last price, symbol) is resolved from the context-menu
  target, the crosshair (`+` button, shortcuts) or code. `{price}` in labels is filled automatically.
- **OrderTicket**: fields declared by the application, validation, `idle → confirming → submitting →
accepted | rejected`, a pending-promise guard against double submission, no retries.

Preferences moved to version 3 (`symbols`, `trade`, `extensions`); `extensions` is per-package JSON validated by
its owner and bounded in size.

### `@market-chart/trading`

```
set/upsert/remove ─► validate (normalize…) ─► maps by kind ─► microtask flush (one per task)
                                                              ├─► items (prefs, pending/accepted prices)
                                                              ├─► engine price lines (axis labels only)
                                                              └─► requestRedraw
frame ─► 'above' layer per pane: lines in one path per colour/style, labels measured and stacked (core
         layoutLabels), hit boxes kept ─► 'top' layer: hover, selection, keyboard highlight, tooltip
input handler ─► hover cursor, capture on press, drag (price rounded to the tick), × cancel, click, dbl-click
```

- It is a chart plugin, so everything it registers goes with `destroy()` or the chart.
- The engine's price-line API provides the axis labels (with the engine's collision layout); lines are drawn by
  the layer as one path per colour and style, because dashed price lines are drawn by the engine as one
  rectangle per dash and hundreds of them would cost more per frame.
- Dragging updates the price line on each move (a main-surface frame, like panning). On release the line is
  pending until `onModify` settles; a rejection restores the old price, and newer data from the application
  always wins over an accepted local price (revision counter per object).
- With a `ChartUi` (structural use only, no runtime import) it registers target resolvers, context-menu
  actions, object-tree sections and the Trading settings category, and stores its preferences in
  `extensions.trading`; translations are added to the UI's `I18n` without replacing application texts.

### Core additions

Generic and additive only: `layoutLabels` is exported (and generic over the label type),
`priceTickSize`/`roundToTick` (built on the existing `roundToStep`) and `safeText` (plain-text sanitiser) are
exported so `ui` and `trading` share them. Hit-testing and dragging use the existing plugin input-handler
API; no engine behaviour changed.

## 14. Technical decisions

| Decision           | Choice                    | Why                                                                                                    |
| ------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------ |
| Rendering baseline | Canvas 2D                 | Universally available, fast for ≤ a few thousand visible bars, simple text. GPU only after benchmarks. |
| Time unit          | UTC ms                    | Matches `Date.now()` and most exchange APIs.                                                           |
| X axis             | logical index             | No weekend/overnight gaps, O(1) index→x.                                                               |
| Storage            | typed-array columns       | No per-bar objects, cache-friendly, cheap realtime appends.                                            |
| Imports            | explicit `.js` extensions | Works unchanged in tsc ESM output, Node, Vite, tsup.                                                   |
| Bundler            | tsup (ESM + CJS + d.ts)   | Simple multi-entry builds, `"use client"` banner for React entry.                                      |
| Tests              | Vitest + RTL + Playwright | Unit/integration/visual.                                                                               |
| Runtime deps       | none in core              | Tree-shakeable, `sideEffects: false`.                                                                  |

---

## 15. Roadmap

| Milestone                     | Scope                                                                                                                                                                                                                                                                         | Status  |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Foundation                    | monorepo, core model, Canvas renderer, time/price scales, candlestick/bar/line/area/histogram, pan/zoom/crosshair, React bindings, static SSR chart                                                                                                                           | done    |
| Professional engine           | left scales, label collision, per-series formatters, pane resize, kinetic scroll, keyboard, touch crosshair, crosshair API                                                                                                                                                    | done    |
| Indicators                    | engine, incremental calculation, 44 standard indicators, chart manager, React bindings, serialisation                                                                                                                                                                         | done    |
| Drawing tools                 | input handlers, drawing manager, 35 tools, selection, magnet, undo/redo, clipboard, persistence                                                                                                                                                                               | done    |
| Advanced features             | custom series, sync, layouts, advanced chart types, volume/market profile, order flow, heatmap, plugin versions                                                                                                                                                               | done    |
| Data and persistence          | datafeed contract and adapters, chart binding with pagination, storage adapters, schemas and migrations, autosave, conflicts, cross-tab sync, workspaces, import/export                                                                                                       | done    |
| SSR and performance           | import-safety and hydration tests, ProgressiveChart, Next.js App Router example, benchmarks (100K/500K/1M), memory profiling, columnar data paths                                                                                                                             | done    |
| Interface and languages       | i18n package (en, fa, ar, custom languages, plurals, RTL, locale formatting), chart locale/direction API, context-menu event and target-aware menus, unified action registry, configurable header and sidebar, settings UI, persisted preferences, legend, documentation site | done    |
| Security review               | findings SEC-01 to SEC-43, `SECURITY.md`, shared network and text helpers                                                                                                                                                                                                     | done    |
| Symbols and trading interface | optional symbol selection (dropdown, search dialog, custom), price actions, order ticket, `@market-chart/trading` (orders, positions, alerts, markers)                                                                                                                        | done    |
| Release automation            | CI running tests, build and benchmarks; changesets release workflow with npm provenance; visual regression tests (Playwright)                                                                                                                                                 | planned |
