# @market-chart/react

React bindings for `@market-chart/core`.

```tsx
import { Chart, CandlestickSeries, LineSeries, useCrosshair } from '@market-chart/react';

function Legend() {
  const crosshair = useCrosshair(); // only this component re-renders on pointer moves
  return <div className="legend">{crosshair?.time}</div>;
}

export function App({ bars, sma }) {
  return (
    <Chart theme="dark" height={500} options={chartOptions /* memoise */}>
      <CandlestickSeries data={bars} />
      <LineSeries data={sma} options={{ color: '#f5a623', lineWidth: 1 }} />
      <Legend />
    </Chart>
  );
}
```

- **Data updates:** when you pass a new array that keeps the same element references and only replaces the
  last point or appends a few, the component calls `series.update()` instead of `setData()`.
- **Data by symbol:** `<Chart dataSource={source} symbol="BTCUSDT" interval="1h">` loads and reloads in place.
  `datafeedSource(feed)` from `@market-chart/datafeed` is a source; any `{ connect(chart, { symbol, interval }) }`
  returning `{ update, destroy }` works.
- **Imperative access:** use `ref` on `<Chart>` (`ChartApi`) or on a series (`SeriesApi`).
- **Hooks:** `useChart(id?)`, `useSeries`, `useChartEvent`, `useCrosshair`, `useChartState`.
- **Sharing charts:** wrap the tree in `<ChartProvider>`, give the chart a `chartId`, then call `useChart(id)` from any component.
- **Languages:** `<ChartProvider locale="fa" direction="auto" i18n={optional}>` provides an `I18n` from
  `@market-chart/i18n`. `useTranslation()`, `useLocale()` and `useDirection()` read and change it without
  recreating charts. `<Chart syncLocale>` keeps the chart's axis locale and direction in step (`'digits'` also
  shows local digits).
- **SSR:** the main entry is a client module. `import { StaticChart } from '@market-chart/react/ssr'` renders
  deterministic SVG on the server, with no browser APIs and without the interactive engine.
- **Progressive enhancement:** `<ProgressiveChart type="candlestick" data={bars} height={360} activate="visible" />`
  renders the same SVG on the server and switches to the interactive engine on `mount`, `idle`, `visible`
  (default) or `interaction`, keeping the picture until the engine has data. Pass children to choose the
  interactive content. See [docs/SSR.md](../../docs/SSR.md).

## Server rendering and request isolation

Wrap each request's tree in its own `<ChartProvider locale={…}>`. Without a provider, `useI18n()` /
`useTranslation()` return a shared English instance in the browser, but on the server every component gets its
own instance, so a language change made while rendering one request can never leak into another request.
