# Server rendering and Next.js

market-chart supports React Server Components, the Next.js App Router, other SSR frameworks and plain client
apps. There are three ways to put a chart on a server-rendered page:

| Approach                                      | Server output         | Client JavaScript                           | Use for                                                |
| --------------------------------------------- | --------------------- | ------------------------------------------- | ------------------------------------------------------ |
| `StaticChart` from `@market-chart/react/ssr`  | SVG                   | none for the chart                          | Landing pages, market overviews, previews, SEO content |
| `ProgressiveChart` from `@market-chart/react` | the same SVG          | the engine, loaded when the chart is needed | Pages where most visitors only look, some interact     |
| `Chart` from `@market-chart/react`            | a sized empty `<div>` | the engine                                  | Trading screens and dashboards                         |

A working example with all three is in [`apps/nextjs`](../apps/nextjs).

## Rules the packages follow

- **No browser API at import time.** Importing any entry point (`core`, `core/static`, `react`, `react/ssr`,
  `indicators`, `drawing-tools`, `charts`, `datafeed`, `persistence`, their `/react` entries, `testing`) reads no
  `window`, `document`, storage, `indexedDB`, `fetch`, `WebSocket`, `BroadcastChannel` or animation-frame API.
  `tests/ssr/imports.test.ts` enforces this by trapping those globals while every entry is imported in plain Node.
- **Client boundaries are built in.** The `@market-chart/react` entry and every `/react` entry are built with a
  `"use client"` directive, so Server Components can import them directly. Main entries are plain modules that
  work on both sides.
- **The SSR entry stays small.** `@market-chart/react/ssr` imports only `react` and `@market-chart/core/static`
  (geometry, formatting, themes). The interactive engine never ends up in a server bundle by accident.
- **No hydration mismatches.** `StaticChart` output depends only on its props (no clock, no random ids, no
  measurements). `Chart` renders the same empty placeholder on both sides and creates the engine after mount.
  `tests/ssr/hydration.test.tsx` hydrates server HTML and fails on any recoverable error or console error.
- **Effects only on the client.** Datafeeds, storage adapters and the engine are created in effects or
  memoised inside client components. Rendering them on the server does nothing.

## Static charts in Server Components

```tsx
// app/page.tsx: a Server Component
import { StaticChart } from '@market-chart/react/ssr';

export default async function Page() {
  const history = await loadDailyCloses(); // your data, on the server
  return (
    <StaticChart
      type="area"
      data={history}
      height={180}
      theme="dark"
      title="Closing price, 90 days"
      showLastValue
    />
  );
}
```

`type` is `line`, `area` or `candlestick`. Long histories are downsampled (min/max per bucket) to keep HTML
small. The SVG stretches to its container and carries an accessible label.

## Progressive enhancement

```tsx
// app/asset/[symbol]/page.tsx: still a Server Component
import { ProgressiveChart } from '@market-chart/react';

export default async function AssetPage() {
  const candles = await loadCandles();
  return (
    <ProgressiveChart
      type="candlestick"
      data={candles}
      height={360}
      theme="dark"
      activate="visible"
    />
  );
}
```

The server sends the `StaticChart` picture. On the client the interactive chart is created when `activate` says
so:

- `mount`: right after hydration;
- `idle`: when the browser is idle;
- `visible`: when the chart scrolls into view (default);
- `interaction`: on the first pointer, touch or keyboard focus.

The static picture stays until the interactive chart has data, so there is no blank flash. Pass `children`
(series, indicators, a `DatafeedSeries`) to control the interactive content; without children, one series of the
same `type` and `data` is created and fitted to the full range. The wrapper's `data-chart-state` attribute is
`static` or `interactive`.

## Full interactive charts

Put the interactive chart in a client component and render it from a Server Component:

```tsx
// app/chart/trading-chart.tsx
'use client';
import { useMemo } from 'react';
import { Chart } from '@market-chart/react';
import { buildUrl, createRestDatafeed } from '@market-chart/datafeed';
import { DatafeedSeries } from '@market-chart/datafeed/react';

export function TradingChart({ symbol }: { symbol: string }) {
  const datafeed = useMemo(
    () =>
      createRestDatafeed({
        // Every value is encoded; never concatenate symbols into URLs.
        history: ({ symbol, interval, from, to }) =>
          buildUrl('/api/candles', { symbol, interval, from, to }),
      }),
    [],
  );
  return (
    <Chart height={520} theme="dark">
      <DatafeedSeries datafeed={datafeed} symbol={symbol} interval="1h" />
    </Chart>
  );
}
```

```tsx
// app/chart/page.tsx
import { TradingChart } from './trading-chart';
export default function Page() {
  return <TradingChart symbol="BTCUSD" />;
}
```

Server Components cannot pass functions as props to client components. Callbacks such as `onReady` or
`onStateChange` therefore belong inside the client component.

## Next.js notes

- The packages publish compiled ESM and CJS with the directives already in place; no `transpilePackages` entry
  is needed.
- In this monorepo the example uses the built `dist/` folders: run `pnpm build` before
  `pnpm --filter nextjs-example dev`.
- Verified with Next.js 16.2 (webpack build): all example routes prerender, and the overview page ships no chart
  engine code.
- Pages Router and other frameworks (Remix, Astro islands, Vite SSR) follow the same rules: import freely, create
  charts only in client components.
