# @market-chart/core

A framework-independent financial charting engine with no runtime dependencies.

```ts
import { createChart } from '@market-chart/core';

const chart = createChart(container, {
  theme: 'dark',
  localization: { timeZone: 'America/New_York' },
  crosshair: { mode: 'magnet' },
});

const candles = chart.addSeries('candlestick', { title: 'BTCUSDT' });
candles.setData(bars); // [{ time: UTC ms, open, high, low, close, volume? }]

const volume = chart.addSeries('histogram', { priceScaleId: 'volume', priceFormat: { type: 'volume' } });
chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

const rsi = chart.addSeries('line', { pane: 1, color: '#7e57c2' }); // new pane below

chart.timeScale().fitContent();
chart.applyOptions({ rightPriceScale: { mode: 'logarithmic' } });
chart.destroy();
```

## Price scales and interaction

```ts
// A second instrument on its own left axis.
const eth = chart.addSeries('line', { priceScaleId: 'left' });
eth.setPriceFormatter((p) => `${p.toFixed(0)}`); // not part of options, so options stay serialisable

// Sync the crosshair of another chart (forward only user-driven moves).
chart.on('crosshairMove', (e) => {
  if (e.source !== 'pointer') return;
  if (e.time === null) other.clearCrosshair();
  else other.setCrosshairPosition(e.time);
});

chart.applyOptions({ interaction: { kineticScroll: { mouse: true }, keyboard: true } });
```

Pane separators can be dragged to resize panes (`paneResize` event). With focus, the chart accepts ←/→, ↑/↓, +/−,
Home/End and Esc. On touch devices, a long press shows the crosshair.

## Locale, direction and context menus

```ts
chart.setLocale('fa-IR');   // axis dates and numbers (Gregorian calendar, localised month names)
chart.setDirection('rtl');  // canvas text direction; price-line titles start at the right edge
chart.applyOptions({ localization: { localizeNumbers: true } }); // Persian/Arabic digits on the axes
chart.on('localeChange', ({ locale }) => …);

chart.on('contextMenu', (e) => {
  // Right-click, ContextMenu key, Shift+F10, or long-press with interaction.touchContextMenu.
  e.preventDefault();
  openMenu(e.clientX, e.clientY, { pane: e.pane, side: e.side, time: e.time, price: e.price, hits: e.series });
});
```

The engine only reports what was clicked. The browser menu is suppressed while there are `contextMenu`
listeners. Menus and toolbars are provided by `@market-chart/ui`.

## Large datasets

```ts
const series = chart.addSeries('candlestick');
series.setColumns({ times, fields: { open, high, low, close, volume } }); // typed or plain arrays
const { length, times: t, fields } = series.columns(); // typed-array copies, safe to keep or modify
```

`setColumns` validates like `setData` (strictly increasing times; required fields finite; optional fields may be
NaN or missing) without creating an object per point. Series that share the same times (candles, volume,
indicators) share the time-axis mapping, so adding them costs no merge. Benchmarks and limits:
[docs/PERFORMANCE.md](../../docs/PERFORMANCE.md).

## Series types

`candlestick`, `bar`, `line` (simple/step), `area`, `baseline`, `histogram`. Options and data are typed
per type: `chart.addSeries('line', …)` returns `SeriesApi<'line'>`.

## Plugins

```ts
chart.use({
  id: 'my/watermark',
  version: '1.0.0',
  install(ctx) {
    ctx.addPaneLayer({
      zOrder: 'below',
      draw({ ctx: c, pixelRatio, width, height }) {
        c.fillText('DEMO', (width / 2) * pixelRatio, (height / 2) * pixelRatio);
      },
    });
    ctx.on('visibleRangeChange', () => ctx.requestRedraw());
  },
});
```

Everything a plugin registers is removed with `chart.removePlugin(id)` or `chart.destroy()`.

## Small helpers for plugins

- `layoutLabels(labels, height, limit, gap?)`: stacks equal-height labels without overlaps, as the engine does
  for axis labels (generic over the label type; used by `@market-chart/trading` for order labels).
- `priceTickSize(format)` and `roundToTick(price, tick)`: the tick size of a price format (`minMove`, else one
  unit of `precision`) and noise-free rounding to it.
- `safeText(value, maxLength?)`: application text for canvas or UI labels, without control or bidi-override
  characters and bounded in length.

## Entry points

- `@market-chart/core`: the interactive engine. Importing it has no side effects; the DOM is touched only by `createChart`.
- `@market-chart/core/static`: DOM-free geometry for server rendering.

## Security helpers

Shared by the datafeed and persistence adapters, and useful in your own code (see [SECURITY.md](../../SECURITY.md)):

| Export | Purpose |
|---|---|
| `buildUrl(template, params)` | Builds a URL with every value encoded: `{name}` placeholders are path-encoded, other params become the query string. Use it instead of concatenating symbols or ids. |
| `redactUrl(url)` | The URL without credentials, query string or fragment, for error messages and logs. |
| `readTextLimited(response, maxBytes)` / `readJsonLimited` | Read a `fetch` response body with a size limit (`Content-Length` and streaming); throw `ResponseTooLargeError`. |
| `safePrecision(value, fallback)` | Clamps an untrusted price precision to an integer in [0, 20]. `createPriceFormatter` now does this itself and ignores a non-positive `minMove`, so a bad `precision` from a datafeed or stored layout can no longer make every frame throw. |
