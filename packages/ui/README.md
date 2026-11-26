# @market-chart/ui

The chart interface layer:

- **Context menus** for whatever was right-clicked, long-pressed or opened from the keyboard.
- **A configurable header and sidebar**.
- **Keyboard shortcuts**.
- **A settings dialog**.
- **User preferences**, saved through `@market-chart/persistence`.

The menus and both toolbars show actions from **one action registry**. Every text comes from
`@market-chart/i18n`, and the whole interface mirrors in right-to-left languages.

| Entry | Contents |
|---|---|
| `@market-chart/ui` | Headless and framework-independent: `ChartUi`, the action registry, the menu controller, layout, positioning, preferences, built-in actions, icons. No React, no DOM at import time |
| `@market-chart/ui/react` | Client-only React renderers: `<ChartInterface>`, `<ChartHeader>`, `<ChartSidebar>`, `<ChartContextMenu>`, `<ChartSettings>`, dialogs, panels, and the headless hook `useContextMenu` |

The engine stays UI-free. `@market-chart/core` only reports *what* was right-clicked through its
`contextMenu` event. This package decides what to offer. Drawing and indicator features call the existing
`DrawingManager` and `IndicatorManager` APIs, which are optional peer dependencies.

## Quick start (React)

```tsx
import { useMemo, useState } from 'react';
import type { ChartApi } from '@market-chart/core';
import { CandlestickSeries, Chart, ChartProvider } from '@market-chart/react';
import { getDrawingManager } from '@market-chart/drawing-tools';
import { getIndicatorManager } from '@market-chart/indicators';
import { ChartInterface, useChartUi } from '@market-chart/ui/react';

function TradingChart({ bars }) {
  const [chart, setChart] = useState<ChartApi | null>(null);
  const capabilities = useMemo(
    () => (chart ? { drawings: getDrawingManager(chart), indicators: getIndicatorManager(chart) } : {}),
    [chart],
  );
  const ui = useChartUi(chart, { capabilities });
  return (
    <ChartInterface ui={ui} height={600}>
      <Chart ref={setChart} height="100%">
        <CandlestickSeries data={bars} />
      </Chart>
    </ChartInterface>
  );
}

export const App = () => (
  <ChartProvider locale="fa">   {/* language and direction for everything below */}
    <TradingChart bars={bars} />
  </ChartProvider>
);
```

`<ChartInterface>` renders all of the following around the chart:

- header and sidebar (at the start or end of the reading direction);
- context menu;
- settings dialog;
- object tree and data window panels;
- indicator and drawing dialogs;
- notifications and keyboard shortcuts.

Each part can be switched off (`header`, `sidebar`, `contextMenu`, `panels`, `dialogs`) or used on its own.

Without React:

```ts
import { createChartUi } from '@market-chart/ui';

const ui = createChartUi(chart, { capabilities: { drawings, indicators } });
ui.menu.on('change', ({ state }) => renderMyMenu(state));   // render with any framework
const offKeys = ui.bindKeyboard();                          // shortcuts on the chart element
```

## Capabilities

Some actions need something the application owns, such as a symbol list, a timeframe switcher or a layout
store. Those actions declare it with `requires`. **When a capability is missing, the action is hidden**, so
no menu offers something that cannot work.

```ts
ui.setCapabilities({
  symbol: { value: () => symbol, options: () => symbols, set: setSymbol },
  timeframe: { value: () => interval, options: ['5m', '1h', '1D'], set: setInterval },
  chartType: { value: () => type, options: ['candlestick', 'line'], set: setType },
  saveLayout: () => persistence.save(),
  alerts: { create: ({ price, time }) => api.createAlert(price, time) },
  inspect: (target) => console.log(target),
  clipboard: (text) => myClipboard(text),     // optional overrides for side effects
  download: ({ name, blob }) => save(name, blob),
});
```

`indicators` and `drawings` are the existing managers. `<ChartInterface>` itself provides `openSettings`,
`panels`, `indicatorSettings`, `drawingProperties` and `editDrawingText`.

## Context menus

`ContextTarget.kind` is one of `chart`, `pane`, `candlestick`, `series`, `indicator`, `drawing`,
`drawingHandle`, `priceAxis` or `timeAxis`. The target carries the clicked time and price, and where it
applies, the series and data point, the indicator handle, the drawing, the handle index, or the axis side.

The menu opens from:

- a right-click;
- the ContextMenu key or Shift+F10;
- a touch long-press (`touchContextMenu`, default true when the UI is attached).

```ts
const off = ui.contextMenu.register({
  id: 'app.copy-close',
  label: 'app.copyClose',                // translation key or literal text
  icon: 'copy',
  targets: ['candlestick'],
  category: 'point',                     // groups separated in the menu
  order: 5,
  shortcut: 'Alt+C',
  isVisible: (ctx) => ctx.target?.point != null,
  isEnabled: (ctx) => !readOnly,
  confirm: 'app.copyCloseConfirm',       // optional confirmation inside the menu
  run: async (ctx) => {
    await copyText(String(ctx.target!.point!.close), ctx.capabilities);
    ctx.ui.notify('Copied');
  },
});

ui.contextMenu.register({
  id: 'app.bar-stats',
  label: 'Bar statistics',
  targets: ['candlestick'],
  submenu: (ctx) => [
    { id: 'range', label: `Range ${range(ctx)}`, info: true },
    { id: 'more', label: 'More', children: [/* nested */] },
  ],
});

ui.contextMenu.getActions('drawing');        // actions for a target kind
ui.contextMenu.setEnabled('drawing.delete', false);
ui.contextMenu.setHidden('point.inspect', true); // user preference, persisted
ui.contextMenu.unregister('app.copy-close');
```

The default renderer behaves as follows:

- **Submenus:** nested, and the large ones (indicators, drawing tools) are searchable. Type-ahead also works.
- **Keyboard:** full navigation; ←/→ are swapped in RTL.
- **Focus:** moves into the menu and is restored when it closes.
- **Closing:** on Escape, an outside click, scroll, resize or window blur.
- **Positioning:** viewport-aware and RTL-aware (opens and flips toward the start side).
- **Shortcuts:** shown in the platform's style (⌘ on Apple platforms).
- **Accessibility:** ARIA menus with `aria-activedescendant`, forced colours and reduced motion are supported.

**Custom rendering.** `useContextMenu(ui)` gives the same state, keyboard handling and ARIA props for your own
markup:

```tsx
function MyMenu({ ui }) {
  const menu = useContextMenu(ui);
  if (!menu) return null;
  const level = menu.levels[menu.levels.length - 1]!;
  return (
    <ul {...menu.getMenuProps(level.level)} style={{ position: 'fixed', left: menu.state.x, top: menu.state.y }}>
      {level.entries.map((entry, i) =>
        entry.type === 'separator' ? <hr key={entry.key} /> : (
          <li key={entry.key} {...menu.getItemProps(level.level, i)}>{entry.label}</li>
        ),
      )}
    </ul>
  );
}

<ChartInterface ui={ui} contextMenu={false}>…</ChartInterface>
<MyMenu ui={ui} />
```

Outside React, use `ui.menu`, a `ContextMenuController` with `show`, `hover`, `activate`, `handleKey`,
`setQuery` and `close`, and the pure `placeMenu` and `placeSubmenu` functions.

## Header and sidebar

Header and sidebar items are actions with `locations: ['header']` or `['sidebar']`:

- **Kinds:** `button` (`run`), `toggle` (`isActive`), `select` (`options` + `value` + `select`) or `menu`
  (`submenu` as a dropdown).
- **Layout:** `section` (`left`, `center` or `right`, mirrored in RTL) and `group` (separators between
  groups).
- **Custom components:** `component`, which in React receives `ToolbarComponentProps`.

```tsx
ui.actions.register({
  id: 'app.last-price',
  label: 'Last price',
  locations: ['header'],
  section: 'center',
  component: LastPrice,          // ({ ui, action, context, location }) => ReactNode
});
ui.actions.register({
  id: 'app.flip-theme',
  label: 'Flip theme',
  icon: 'theme',
  locations: ['header', 'sidebar'],
  section: 'right',
  shortcut: 'Alt+T',
  isActive: (ctx) => ctx.chart.theme().name === 'light',
  run: (ctx) => ctx.ui.preferences.update({ theme: ctx.chart.theme().name === 'light' ? 'dark' : 'light' }),
});

ui.actions.override('header.screenshot', { icon: 'camera', shortcut: 'Mod+Shift+S' });
ui.actions.restore('header.screenshot');
ui.actions.unregisterOwner('my-plugin');   // everything a plugin registered
await ui.actions.execute('chart.resetView');
```

**Header.** Items have tooltips with shortcuts, and arrow keys move between them (roving focus). Items that
do not fit go into a "More" menu, taken first from the end of the start section and then from the start of
the end section.

**Sidebar.** Drawing tools are grouped by category into flyouts, and each button shows the active or last
used tool. Panel toggles open the object tree and data window. The sidebar has these modes:

- `expanded` (labels shown);
- `collapsed` (icons only);
- `floating` (draggable);
- `hidden`.

It sits at `start` or `end`, and below 640px it becomes a horizontal bar under the chart.

Users rearrange the toolbars in the settings dialog:

- show or hide actions;
- move actions between header and sidebar;
- change section and order with drag and drop or the arrow buttons;
- record shortcuts.

The same operations are available as `ui.setActionVisible`, `ui.moveAction` and `ui.shiftAction`.

## Legend

`<ChartInterface>` shows a legend over the chart (`legend={false}` turns it off). `<ChartLegend ui={ui} />`
renders the same legend on its own. For the hovered bar, or the last bar when the pointer is away, it shows:

- the series title (series `title`, the application's symbol, or the series type);
- **date**, **time** and **timestamp** (milliseconds since 1970, UTC);
- **open**, **high**, **low** and **close**, coloured by the bar's direction;
- **change** from the previous bar, as an amount and a percentage;
- **volume**, from the bar itself or from a separate volume histogram (`priceFormat: { type: 'volume' }`);
- a row per **indicator** with its values in the output colours.

Indicator rows have buttons to hide the indicator, open its settings and remove it. A collapse button folds
the indicator rows away. The main row has buttons to open Settings → Legend and price labels, and to hide the
legend.

Each value is a user preference, so users choose what they see:

```ts
ui.preferences.update({
  legend: { visible: true, fields: { timestamp: true, volume: false } },
});
// date · time · timestamp · open · high · low · close · change · volume · indicators
```

The legend uses the language's labels (Persian: باز، سقف، کف، بسته), and its digits follow the same setting
as the axes (`localDigits`). Custom renderers read the same data as the built-in legend:

```ts
const data = ui.legend(hoveredTime); // or ui.legend() for the last bar
data.timeItems; // [{ key: 'date', text: 'Jan 21, 2024' }, …]
data.items;     // [{ key: 'open', label: 'O', text: '1506.65', value: 1506.65, trend: 'up' }, …]
data.indicators; // [{ indicator, label: 'RSI 14 close', visible, items: [{ text: '62.10', color }] }]
```

## Price labels

Price labels are drawn by the engine through its price-line API. `ui.markers` (a `PriceMarkers`) decides what
to show:

| Preference (`markers`) | What it does | Default |
|---|---|---|
| `highLow` | Lines and axis labels at the highest high and lowest low of the **visible** bars; they follow scrolling and zooming | off |
| `previousClose` | A line at the previous bar's close | off |
| `lastPriceLine` | The main series' last-price line | on |
| `lastValueLabel` | The main series' last-price label on the axis | on |
| `indicatorLabels` | The indicators' last-value labels on the axis | on |

```ts
ui.preferences.update({ markers: { highLow: true, previousClose: true } });
ui.markers.values(); // { high: { price, time }, low: { price, time }, previousClose }
```

The last three switches change series options only once the user changes them. Until then, the series
options your application set are left alone.

The same switches are in Settings → Legend and price labels, in the object tree, and in the chart's context
menu (Price labels on the chart).

## Object tree

The object tree panel (sidebar → Object tree) lists:

- **series**, each with its last value and a show/hide button;
- **indicators**, each with show/hide, settings and remove buttons;
- **drawings**, each with select, show/hide, lock, properties and delete buttons;
- the **price labels**: toggles plus the current high/low and previous-close values.

## Built-in actions

| Area | Action ids |
|---|---|
| Chart | `chart.resetView` (Alt+R), `chart.fitContent`, `pane.resetHeights`, `chart.addIndicator`, `chart.addDrawing`, `chart.crosshairMode`, `chart.chartType`, `chart.timeframe`, `chart.theme`, `chart.legend`, `chart.priceLabels`, `chart.settings`, `chart.exportImage`, `chart.exportData` |
| Data point | `point.viewOhlc`, `point.copyPrice`, `point.copyTimestamp`, `point.horizontalLine`, `point.createAlert`, `point.inspect` |
| Drawing | `drawing.edit`, `drawing.properties`, `drawing.duplicate` (Mod+D), `drawing.copy`, `drawing.paste`, `drawing.lock`, `drawing.visibility`, `drawing.bringToFront`, `drawing.sendToBack`, `drawing.group`, `drawing.ungroup`, `drawing.delete` (Delete) |
| Indicator | `indicator.settings`, `indicator.appearance`, `indicator.duplicate`, `indicator.visibility`, `indicator.moveToPane`, `indicator.reset`, `indicator.remove` |
| Axes | `axis.resetScale`, `axis.autoScale`, `axis.invert`, `axis.scaleMode`, `axis.resetTime`, `axis.timeVisible`, `axis.settings` |
| Header | `header.symbol`, `header.compare`, `header.indicators`, `header.drawingTools`, `header.undo` (Mod+Z), `header.redo` (Mod+Shift+Z), `header.saveLayout` (Mod+S), `header.loadWorkspace`, `header.language`, `header.settings`, `header.screenshot` (Alt+S), `header.export`, `header.fullscreen` |
| Sidebar | `sidebar.cursor` (Escape), `sidebar.crosshair`, `tool.<type>` for each of the 35 drawing tools, `sidebar.magnet`, `sidebar.removeAll`, `sidebar.<panel>` |

`builtins: { exclude: ['header.compare'] }` leaves some out, and `builtins: false` leaves out all of them.
`Mod` is ⌘ on Apple platforms and Ctrl elsewhere.

## Preferences

```ts
import { createLocalStorage } from '@market-chart/persistence';
import { UiPreferencesStore, uiPreferencesProvider, validateUiPreferences } from '@market-chart/ui';

const preferences = new UiPreferencesStore({
  storage: createLocalStorage({ prefix: 'app:', validate: validateUiPreferences }), // any StorageAdapter
  id: 'ui',
  defaults: { sidebar: { position: 'end' }, density: 'compact' },  // application defaults
  debounceMs: 500,
});
await preferences.load();
const ui = createChartUi(chart, { preferences, defaultLocale: 'en' });

preferences.update({ locale: 'ar', localDigits: true }); // applied at once, saved after a quiet period
preferences.on('status', ({ status }) => …);             // idle · dirty · saving · saved · error
const json = preferences.exportJson();
preferences.importJson(json);                            // validated and migrated
preferences.reset(['locale']);                           // restore defaults, keeping the language
```

The stored preferences cover the language, direction, numerals, local digits on the axes, theme and density.
They also cover header visibility, sidebar position and mode, action placements, hidden context-menu actions,
custom shortcuts, the legend fields and the price labels.

The data is versioned (`UI_PREFERENCES_VERSION`, now 2; version 1 data gains the legend and price-label
defaults when it is loaded). Every load and import is
validated, and invalid entries are dropped instead of failing. To keep the interface in the same saved layout
as the chart, add `uiPreferencesProvider(preferences)` to a `ChartPersistence`'s providers.

## Icons and styles

- **Icons:** about 70 built-in SVG path icons. Directional ones such as arrows and undo are mirrored in RTL.
  Add your own with `registerIcon('rocket', 'M12 2 L…')`, which accepts path data only, so no markup is
  injected.
- **Styles:** injected once, in an insertion effect, so never on the server. They use CSS variables
  (`--mc-ui-bg`, `--mc-ui-fg`, `--mc-ui-accent`…) and logical properties, so RTL needs no extra CSS. They
  follow the chart theme (light or dark) and density.
- **Your own styles:** `UI_CSS` holds the stylesheet text.
- **Content-Security-Policy:** under `style-src` without `'unsafe-inline'`, an injected `<style>` is blocked.
  Pass your nonce, or turn injection off and ship `UI_CSS` as a static `.css` file:

  ```tsx
  import { UiStylesProvider } from '@market-chart/ui/react';

  <UiStylesProvider nonce={cspNonce}>{/* or inject={false} */}
    <ChartInterface … />
  </UiStylesProvider>
  ```

## Security

See [SECURITY.md](../../SECURITY.md).

- **CSV export** (`seriesCsv`, and `csvCell` / `csvRow` for your own exports): text cells starting with `=`, `+`,
  `-`, `@`, tab or CR get a leading `'` so spreadsheets do not run them as formulas; cells are quoted as needed.
- **Downloads:** `downloadFile` passes every name through `safeFileName` (no path separators, control or bidi
  characters, reserved Windows names; at most 120 characters), also to your `capabilities.download` handler.
- **Icons:** `registerIcon` accepts SVG path data of at most `MAX_ICON_PATH_LENGTH` (8192) characters; names
  such as `__proto__` are rejected.
- **Stored preferences** keep at most `MAX_PREFERENCE_ENTRIES` (500) action placements, shortcuts and hidden
  menu entries; locale codes are at most 35 characters.

## Optional features: symbols, price actions, order ticket

Three features are installed only when you list them, so an application that does not opt in keeps the
current behaviour and does not bundle them (measured: a headless app without them contains none of their
code; with all three, +26 KB minified; their React views are lazy chunks).

```ts
import { createChartUi, orderTicket, priceActions, symbolSearch } from '@market-chart/ui';

const ui = createChartUi(chart, {
  capabilities: {
    symbols: {
      value: () => symbol,
      set: setSymbol,
      search: (query, { signal, limit, group }) => api.search(query, { signal, limit, group }), // or list()
      groups: [{ id: 'crypto', label: 'Crypto' }, { id: 'fx', label: 'Forex' }],
    },
    compare: { add: (item) => addComparison(item.symbol) },
    trading: { submit: (ticket) => broker.place(ticket), simulatedLabel: 'Paper trading' },
    alerts: { create: ({ price }) => api.createAlert(price) },
  },
  features: [symbolSearch({ mode: 'both' }), priceActions({ shortcuts: true }), orderTicket()],
});
```

**The library never trades.** Price actions and the ticket only show UI and call your callbacks after an
explicit user action. The repository contains no broker code; all examples are simulated.

### Symbol selection (`symbolSearch(options)`)

- Modes (a user preference with your default): `dropdown` (header), `modal` (header button + dialog), `both`,
  `custom` (render your own with `useSymbolSearch`) and `none`. `Mod+K` (configurable) or typing a letter or
  digit on the chart opens it.
- Search: debounced, cancellable (`AbortSignal`; stale answers are ignored), or a static `list()` filtered and
  ranked locally. Group tabs (with `groupOrder`), favourites (star, `Mod+D`) and recent symbols saved in the
  preferences, loading/empty/error states with retry, a virtualised list for thousands of symbols.
- Accessibility: combobox + listbox pattern (`aria-activedescendant`), focus trap and restore, arrow/Page/Enter/
  Escape keys, RTL, full screen on small screens.
- Customisation: `limit`, `sort`, `groupOrder`, `favorites: false`, `recent: false`; custom row, empty and
  error views through `<ChartInterface symbolSearchViews={…}>`; `ui.symbols.open()` / `close()` from code.
- Compare: with `compare.add`, the header's Compare button opens the same search in compare mode.
- The existing `symbol` capability still works (as a plain select, or as the source of the search).

### Actions at a price (`priceActions(options)`)

Entry points, each switchable: the context menu ("At this price" category on chart, candle and price-axis
targets), a "+" button next to the crosshair's price label, shortcuts at the crosshair price (`shortcuts:
true`), and touch long-press (the price menu, with the full menu one tap away). The price is rounded to the
series' tick size (`minMove`) before it is shown or passed on.

```ts
ui.priceActions!.register({
  id: 'app.measure',
  label: 'Measure from {price}',                // {price}: formatted, rounded
  run: (ctx) => startMeasure(ctx.price!),       // { price, formatted, time, side, series, pane, symbol, tick, source }
});
```

Built-ins: `price.buy` / `price.sell` (buy limit below the last price, buy stop above, and the reverse for
sells), `price.order` (submenu of order types), `price.alert`, `price.copy`.

### Order ticket (`orderTicket()`)

A dialog prefilled with side, type, price and quantity. You declare the fields and their validation
(`trading.fields`: `side`, `select`, `price`, `number`, `text`, with `min`, `max`, `step`, `required`,
`visible`, `validate`). States: `idle → confirming → submitting → accepted | rejected`, showing your message
as plain text. Confirmation is on; users can switch it off in Settings › Trading only when
`allowSkipConfirmation` is set. `submit` is called once per confirmation, never retried, and a second
submission is refused while one is pending; the confirm button ignores clicks for 400 ms after it appears,
so a double-click on "Review order" cannot send. Numbers can be typed with Persian or Arabic digits.
`useOrderTicket(ui)` drives a custom ticket.

### Extension points (for packages such as `@market-chart/trading`)

- `ui.use(feature)` / `features: […]`: optional features with their own cleanup.
- `ui.targets.register(resolver)`: context-menu targets the engine does not know (`order`, `position`,
  `alert`, `marker`, with `target.object`); `ui.targets.intercept(fn)` can handle a request instead.
- `ui.objectTree.register(section)` and `ui.settings.register(section)`: object-tree sections and settings
  categories described as data (several registrations may share a category, e.g. "Trading").
- Preferences version 3 adds `symbols`, `trade` and `extensions` (per-package JSON, validated by its owner,
  at most 16 KB each). Older preferences migrate automatically.

## SSR

Both entries can be imported on the server. `@market-chart/ui/react` is marked `'use client'`. The
interface's `dir` and `lang` come from the provider, so the server markup matches the client. The settings
panel is loaded lazily in its own chunk.

## Limitations

- The header's overflow measures item widths after rendering and corrects itself on the next frame, so a
  single frame can show one item too many before it moves to "More".
- Drag-and-drop ordering is in the settings dialog. The toolbars themselves are not rearranged by dragging.
- When the UI is attached, a touch long-press opens the context menu instead of the touch crosshair. Pass
  `touchContextMenu: false` to keep the crosshair.
- Moving an indicator to another pane is not stored in the indicator manager's `config()`, so it is not
  restored by persistence.
- Price-line titles (High, Low, Prev close) are drawn by the engine at the pane's left edge, under the legend.
  The legend rows have a translucent background so both stay readable, and the axis labels show the prices.
- The visible high/low is recomputed after scrolling and zooming by reading the visible bars (at most a few
  thousand, because the engine caps visible bars), once per change batch.
- Symbol search: type-to-search uses letters and digits only (other keys stay with the chart and shortcuts).
  The favourite star inside a result row is not in the tab order; the keyboard path is `Mod+D`.
- Price-action shortcuts compare `event.key`: on macOS, `Alt`+letter produces another character, so define
  `Mod`- or `Shift`-based shortcuts there.
- The "+" button follows the crosshair; keyboard users reach price actions through the context menu
  (ContextMenu key or Shift+F10) and the shortcuts.
- Price actions are not listed in the shortcut settings (they need a price); their shortcuts are set on the
  definition or with `ui.actions.override`.
