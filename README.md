# market-chart

An open-source financial charting library for the web, written in TypeScript with first-class React support:
candlestick and other series, multiple panes and scales, 44 indicators, 35 drawing tools, advanced chart types,
multi-chart layouts, datafeeds and persistence, plus an optional chart interface (context menus, header, sidebar,
settings) in English, Persian and Arabic with full right-to-left support.

- **Independent engine.** `@market-chart/core` has no runtime dependencies, renders with Canvas 2D and does not
  depend on React.
- **React bindings.** `@market-chart/react` handles lifecycle and configuration only. React never renders
  individual candles, so realtime updates do not cause re-renders.
- **SSR-safe.** Every entry point can be imported on the server. `@market-chart/react/ssr` renders static SVG
  charts, and nothing touches `window`, storage or the network at import time.
- **Extensible.** Plugins, custom series, indicators and drawing tools use public APIs.
- **Honest data.** All bundled example data is **synthetic**. Nothing is presented as real or exchange-verified
  market data.

> **Status: pre-1.0 (`0.1.x`).** Implemented and tested: the engine, indicators, drawing tools, advanced chart
> types and multi-chart layouts, datafeeds and persistence, SSR and large-dataset performance, the chart interface
> with internationalisation, optional symbol selection, price actions and trading overlays, and a documentation
> site ([`apps/docs`](apps/docs), `pnpm docs`). Planned: CI and release automation, visual regression tests.
> APIs may still change before 1.0; breaking changes are listed in each package's changelog.
>
> [`FEATURE_MATRIX.md`](FEATURE_MATRIX.md) lists what is complete, partial or planned, with test status.
> [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) describes the design, [`docs/ADVANCED.md`](docs/ADVANCED.md)
> covers extending and integrating the library, [`docs/SSR.md`](docs/SSR.md) server rendering and Next.js,
> [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md) benchmarks and limits, [`SECURITY.md`](SECURITY.md) the
> security model, and [`docs/PUBLISHING.md`](docs/PUBLISHING.md) deployment and npm releases.

## Contents

- [Packages](#packages)
- [Install](#install)
- [Quick start](#quick-start): React, vanilla, datafeed, persistence, interface and languages, server rendering
- [Launch locally](#launch-locally): development, tests, builds
- [Publish](#publish): GitHub, npm and the documentation site ([full guide](docs/PUBLISHING.md))
- [Project layout](#project-layout)
- [License and disclaimer](#license-and-disclaimer) ([legal notes](docs/LEGAL.md))
- Further reading: [Advanced guide](docs/ADVANCED.md), [Architecture](docs/ARCHITECTURE.md),
  [Security](SECURITY.md), [Performance](docs/PERFORMANCE.md), [SSR](docs/SSR.md),
  [Feature status](FEATURE_MATRIX.md)

## Packages

| Package                                                 | Purpose                                                                                                                                                                                                                                        |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@market-chart/core`](packages/core)                   | Engine: data model, scales, renderer, interactions, events, plugins, custom series, chart sync; `./static` DOM-free geometry                                                                                                                   |
| [`@market-chart/react`](packages/react)                 | `<Chart>`, series components, hooks, provider, `<ChartLayout>`; `./ssr` → `<StaticChart>`                                                                                                                                                      |
| [`@market-chart/indicators`](packages/indicators)       | 44 incremental indicators, chart manager; `./react` hooks                                                                                                                                                                                      |
| [`@market-chart/drawing-tools`](packages/drawing-tools) | 35 drawing tools, selection, magnet, undo/redo, clipboard, serialisation; `./react` hooks                                                                                                                                                      |
| [`@market-chart/charts`](packages/charts)               | Heikin-Ashi, Renko, Kagi, Point & Figure, Line Break, footprint, heatmap, volume/market profile                                                                                                                                                |
| [`@market-chart/datafeed`](packages/datafeed)           | `Datafeed` contract; static, REST, WebSocket, SSE and synthetic adapters; CSV/JSON import; chart binding with realtime and history paging; `./react`                                                                                           |
| [`@market-chart/persistence`](packages/persistence)     | Storage adapters (memory, Web Storage, IndexedDB, REST), versioned schemas, autosave, conflicts, cross-tab sync, workspaces; `./react`                                                                                                         |
| [`@market-chart/i18n`](packages/i18n)                   | Typed translations: English, Persian, Arabic and custom languages, plurals, fallback, text direction, locale formatting                                                                                                                        |
| [`@market-chart/ui`](packages/ui)                       | Chart interface: one action registry for target-aware context menus, a configurable header and sidebar, shortcuts, settings and saved preferences; optional symbol search, price actions and order ticket; headless core, `./react` components |
| [`@market-chart/trading`](packages/trading)             | Your orders, positions (TP/SL), alerts and markers drawn at their prices: drag to modify, cancel, context menus, object tree; display only (it never trades); `./react`                                                                        |
| [`@market-chart/testing`](packages/testing)             | Deterministic **synthetic** datasets, tick simulator, canvas mock for tests                                                                                                                                                                    |
| [`apps/docs`](apps/docs)                                | Documentation site: guides, live examples with their source, chart builder that generates code, reference generated from the packages (private)                                                                                                |
| [`apps/playground`](apps/playground)                    | Vite app with 23 working examples, including the interface demos, a simulated trading page and a real-canvas performance page (private)                                                                                                        |
| [`apps/nextjs`](apps/nextjs)                            | Next.js App Router example: server-rendered SVG, progressive and interactive charts (private)                                                                                                                                                  |

## Install

> The packages are not on npm yet; see [Publish](#publish). Until then, use the workspace directly.

```powershell
pnpm add @market-chart/core @market-chart/react
```

Add only the feature packages you use, for example `@market-chart/indicators`, `@market-chart/datafeed` or
`@market-chart/persistence`. React 18 or 19 is a peer dependency of the React entries only.

## Quick start

### React

```tsx
import { Chart, CandlestickSeries, HistogramSeries } from '@market-chart/react';

export function TradingChart({ bars, volume }) {
  return (
    <Chart
      theme="dark"
      height={600}
      onReady={(c) =>
        c.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } })
      }
    >
      <CandlestickSeries data={bars} />
      <HistogramSeries
        data={volume}
        options={{ priceScaleId: 'volume', priceFormat: { type: 'volume' } }}
      />
    </Chart>
  );
}
```

Times are **UTC milliseconds** (`Date.now()` units). Data must be sorted by strictly increasing time.

### Vanilla TypeScript

```ts
import { createChart } from '@market-chart/core';

const chart = createChart(document.getElementById('chart')!, { theme: 'light' });
const candles = chart.addSeries('candlestick');
candles.setData(bars);
candles.update(latestBar); // realtime: append, replace the last bar, or correct history
chart.on('crosshairMove', (e) => console.log(e.time, e.seriesData.get(candles)));
```

### Datafeed: history, realtime and paging

```tsx
import { Chart } from '@market-chart/react';
import { createSyntheticDatafeed } from '@market-chart/datafeed';
import { DatafeedSeries } from '@market-chart/datafeed/react';

const feed = createSyntheticDatafeed(); // swap for createRestDatafeed / createWebSocketDatafeed / your own

export function LiveChart({ symbol, interval }: { symbol: string; interval: string }) {
  return (
    <Chart height={500}>
      <DatafeedSeries datafeed={feed} symbol={symbol} interval={interval} />
    </Chart>
  );
}
```

Scrolling left loads older pages. Changing `symbol` or `interval` reloads in place. See
[`packages/datafeed`](packages/datafeed) for REST, WebSocket, SSE and CSV/JSON import.

### Persistence: autosave layouts

```tsx
import { useMemo } from 'react';
import { createLocalStorage } from '@market-chart/persistence';
import { useChartPersistence } from '@market-chart/persistence/react';

function SaveStatus() {
  const storage = useMemo(() => createLocalStorage(), []);
  const { status } = useChartPersistence({ id: 'main-layout', storage }); // place inside <Chart>
  return <span>{status}</span>; // idle · dirty · saving · saved · error · conflict
}
```

Indicators, drawings and application state are added with providers. See
[`packages/persistence`](packages/persistence).

### Interface and languages

```tsx
import { ChartProvider, Chart, CandlestickSeries } from '@market-chart/react';
import { ChartInterface, useChartUi } from '@market-chart/ui/react';

function TradingChart({ bars }) {
  const [chart, setChart] = useState<ChartApi | null>(null);
  const ui = useChartUi(chart, {
    capabilities: chart
      ? { drawings: getDrawingManager(chart), indicators: getIndicatorManager(chart) }
      : {},
  });
  return (
    <ChartInterface ui={ui} height={600}>
      <Chart ref={setChart} height="100%">
        <CandlestickSeries data={bars} />
      </Chart>
    </ChartInterface>
  );
}

<ChartProvider locale="fa">
  {' '}
  {/* 'en', 'fa', 'ar', a registered language, or 'auto' */}
  <TradingChart bars={bars} />
</ChartProvider>;
```

This gives a header, a drawing sidebar, context menus for whatever is right-clicked or long-pressed, a settings
dialog and keyboard shortcuts. A legend shows the hovered bar's date, time, timestamp, OHLC, change, volume and
indicator values, and price labels can mark the visible high and low and the previous close. The interface
switches language and direction in place, and Persian and Arabic mirror it. Add your own actions with `ui.contextMenu.register(…)` or `ui.actions.register(…)`, or render
your own menu with `useContextMenu`. Without the UI package, `chart.setLocale('fa-IR')` and
`chart.setDirection('rtl')` localise the chart itself. See the [ui](packages/ui) and [i18n](packages/i18n)
READMEs.

### Symbols, price actions and orders (optional)

```ts
// SIMULATED: your application owns the broker; the library never trades.
const ui = createChartUi(chart, {
  capabilities: { symbols, trading: { submit: (ticket) => broker.place(ticket) } },
  features: [symbolSearch({ mode: 'both' }), priceActions(), orderTicket()],
});
const overlay = createTradingOverlay(chart, { ui, onModify, onCancel });
overlay.setOrders(orders);
```

A header dropdown and/or search dialog for symbols (async search, groups, favourites, recents), actions at the
price under the pointer (context menu, a "+" by the price label, shortcuts), an order ticket with your fields
and validation, and your orders, positions, alerts and markers on the chart. Nothing is installed or bundled
unless listed. See [ui](packages/ui) and [trading](packages/trading).

### Server rendering (Next.js App Router)

```tsx
// app/page.tsx: a Server Component
import { StaticChart } from '@market-chart/react/ssr';

export default function Page() {
  return <StaticChart type="area" data={history} height={180} title="Price, last 90 days" />;
}
```

The interactive `@market-chart/react` entry declares itself a client module (`'use client'`), so it can be
imported from Server Components and renders on the client. `<ProgressiveChart>` sends the SVG from the server
and switches to the interactive engine when the chart becomes visible or is touched. See
[`docs/SSR.md`](docs/SSR.md) and the [Next.js example](apps/nextjs).

### Large datasets

```ts
const { times, fields } = series.columns(); // typed-array copies, no object per point
other.setColumns({ times, fields: { value: fields.close! } }); // the fastest way to load big arrays
```

1M candles load in about 80 ms and render in under a millisecond of engine time per frame; see
[`docs/PERFORMANCE.md`](docs/PERFORMANCE.md).

## Launch locally

### Requirements

- **Node.js 20 or newer**
- **pnpm 10**. The version is pinned in `package.json`; enable it with Corepack:

```powershell
corepack enable
```

### First run

```powershell
pnpm install
```

```powershell
pnpm dev
```

The playground opens at <http://localhost:5173>. Packages are consumed from source, so edits show up
immediately without a build.

### Everyday commands

| Command                                        | What it does                                                                                                           |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                                     | Playground (Vite) with all examples                                                                                    |
| `pnpm docs` / `pnpm docs:build`                | Documentation site at <http://localhost:5173> / static build in `apps/docs/dist` (host it anywhere, e.g. GitHub Pages) |
| `pnpm test`                                    | All unit, integration and React tests (Vitest + jsdom), run against sources                                            |
| `pnpm test:watch`                              | Tests in watch mode                                                                                                    |
| `pnpm --filter @market-chart/datafeed test`    | Tests of one package                                                                                                   |
| `pnpm build`                                   | Builds every package with tsup (ESM + CJS + `.d.ts`) into `packages/*/dist`                                            |
| `pnpm bench`                                   | Performance and memory benchmarks with budgets (100K–1M bars); results in `benchmarks/results/`                        |
| `pnpm build; pnpm --filter nextjs-example dev` | Next.js example at <http://localhost:3000> (uses the built packages)                                                   |
| `pnpm typecheck`                               | Strict TypeScript check of every package (run `pnpm build` first, packages import each other's types)                  |
| `pnpm lint`                                    | ESLint                                                                                                                 |
| `pnpm format` / `pnpm format:check`            | Prettier                                                                                                               |

A full local check before a commit or release:

```powershell
pnpm build; pnpm typecheck; pnpm test; pnpm lint; pnpm format:check
```

## Publish

The complete step-by-step guide is [docs/PUBLISHING.md](docs/PUBLISHING.md): accounts and the npm scope,
preparing the repository (install, peer-dependency ranges, metadata), GitHub, the first npm release, checking
the published packages in a new project, later releases with Changesets, CI with npm provenance, and
deploying the documentation site.

Before the very first publish, do the one-time preparation in the guide: the npm organisation for the
`@market-chart` scope, `workspace:^` peer ranges and the `repository` fields. Each package tarball contains only
`dist/`, `README.md`, `LICENSE` and `package.json`.

A release, once that is done:

```powershell
pnpm build; pnpm typecheck; pnpm test; pnpm lint
```

```powershell
pnpm release:check
```

```powershell
pnpm release
```

```powershell
git push --follow-tags
```

## Project layout

```
packages/
  core/            engine (no dependencies)
  react/           React bindings and SSR entry
  indicators/      indicator engine and built-ins
  drawing-tools/   drawing manager and tools
  charts/          advanced chart types, profiles, order flow
  datafeed/        datafeed contract, adapters, chart binding
  persistence/     storage adapters, schemas, autosave, workspaces
  i18n/            translations, plurals, direction, locale formatting
  ui/              context menus, header, sidebar, settings, preferences, symbol search, price actions
  trading/         orders, positions, alerts and markers drawn at their prices (display only)
  testing/         synthetic data and test helpers
apps/
  playground/      Vite examples app (private)
  nextjs/          Next.js App Router example (private)
  docs/            documentation site (private)
benchmarks/        performance and memory benchmarks (pnpm bench)
tests/ssr/         cross-package SSR, import-safety and hydration tests
docs/
  ARCHITECTURE.md  design and technical decisions
  SSR.md           server rendering and Next.js
  PERFORMANCE.md   benchmarks, optimisations, limits
  PUBLISHING.md    deploy and publish, step by step
  ADVANCED.md      extending and integrating the library
  LEGAL.md         licence, trademarks, disclaimers, privacy, third-party notices
FEATURE_MATRIX.md  status of every feature and its tests
```

## License and disclaimer

[MIT](LICENSE). You may use, modify and redistribute the code, including commercially, as long as the copyright
notice and licence text are kept. The software is provided "as is", without warranty of any kind.

- **Independent.** market-chart is not affiliated with, endorsed by or derived from TradingView, Inc. or any other
  charting, brokerage or data company, and contains none of their code, assets or data. TradingView is a trademark
  of TradingView, Inc.; other names are trademarks of their owners.
- **Not financial advice.** The library displays whatever data you give it and provides no market data, analysis
  or signals.
- **Synthetic examples.** All bundled data is generated; preset names in `@market-chart/testing` are not the
  prices of those instruments.
- **No trading.** The symbol, price-action, order-ticket and trading-overlay components never execute or route
  orders; they call your callbacks. The chart is not the source of truth for order state, and regulatory duties
  for real trading belong to your application.
- **Privacy.** No telemetry; no network request or storage unless your application configures it.
- **Your data provider's terms** (display, redistribution, exchange fees) apply when you connect real data.

The full text, including third-party notices, is in [docs/LEGAL.md](docs/LEGAL.md). This is not legal advice.
