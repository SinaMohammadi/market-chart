# Next.js App Router example

Three pages showing the integration approaches, all with **synthetic** data:

| Route | Rendering | Uses |
|---|---|---|
| `/` | Server Component, SVG only, no chart JavaScript on the client | `StaticChart` from `@market-chart/react/ssr` |
| `/progressive` | Server-rendered SVG, upgraded to the canvas engine when visible or touched | `ProgressiveChart` from `@market-chart/react` |
| `/chart` | Client component with the full engine | `Chart`, `DatafeedSeries`, `Indicator`, `useChartPersistence` |

## Run

From the repository root:

```powershell
pnpm install
```

```powershell
pnpm build
```

```powershell
pnpm --filter nextjs-example dev
```

Then open <http://localhost:3000>. The example consumes the packages' built `dist/` folders like an external
app would, so run `pnpm build` again after changing a package (or use the Vite playground for fast iteration).

## What to look at

- **Client boundaries.** `@market-chart/react`, `…/indicators/react`, `…/datafeed/react` and `…/persistence/react`
  are built with a `"use client"` directive, so they can be imported from Server Components (as `/progressive`
  does) and render on the client. Main entries (`@market-chart/core`, `…/datafeed`, …) are plain modules usable
  on both sides.
- **No browser APIs on the server.** Datafeeds, storage adapters and the engine are created inside client
  components (`useMemo`, effects); importing them on the server is safe and does nothing.
- **Hydration.** `<Chart>` renders a sized empty `<div>` on the server; `<StaticChart>` and `<ProgressiveChart>`
  render the same SVG on both sides, so hydration has nothing to correct.
