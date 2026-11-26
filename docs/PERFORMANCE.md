# Performance and memory

How the engine stays fast with large datasets, how it is measured, which optimisations were made, and the
limits that remain. All data used for measurement is synthetic.

## Design choices that matter

| Area         | Choice                                                                                                                     | Effect                                                                                |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Storage      | One `Float64Array` per field (columnar), geometric growth                                                                  | 61 bytes per candle; realtime appends are amortised O(1) and allocate nothing per bar |
| Time axis    | Shared union of series times with per-series index mappings; series with identical times share one identity mapping        | Extra series on the same bars (volume, indicators) cost a comparison, not a merge     |
| Rendering    | At most one frame per animation frame (`FrameScheduler`), two canvas layers (main + overlay)                               | Crosshair moves redraw only the overlay; bursts of updates render once                |
| Visible work | Only visible bars are drawn; bar spacing has a minimum (default 0.5 px), so the visible count is bounded by the pane width | Frame cost does not grow with dataset size                                            |
| Indicators   | `calc(state, step)` calculators; ticks restore a state snapshot and re-run one step                                        | O(1) per tick, never a full recalculation on realtime updates                         |
| React        | React never renders bars; components push data into the engine and diff appends                                            | No re-render per tick                                                                 |
| Bulk data    | `series.columns()` and `series.setColumns()` read and write typed arrays directly                                          | Large series move without creating an object per point                                |

## Measuring

```powershell
pnpm bench
```

Runs [`benchmarks/`](../benchmarks) with Vitest in Node, with `--expose-gc`, so memory figures come after a forced
collection. Results are printed and written to `benchmarks/results/*.md|json`. Each measurement has a loose budget
that the run asserts. The budgets catch regressions; they are not targets. Canvas calls go to a no-op context, so
the Node frame times are the engine's CPU work (scales, geometry, labels) without rasterisation.

For real-canvas numbers, open the playground's **Performance** page (`pnpm dev`, then _Performance_).
It loads 100K–1M candles and measures setData, first frame, pan and zoom frame times, and sustained realtime
updates with and without indicators, all inside animation frames on your machine.

## Results

Measured with `pnpm bench` on a desktop PC (2026-11-25); results vary by device:

| Measurement                                                                              | Result                                                         |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `setData`, 100K / 500K / 1M candles                                                      | 8.5 / 41.7 / 81 ms                                             |
| First frame after `setData` (1M candles)                                                 | 0.8 ms                                                         |
| Full frame: 200 bars visible / 2,000 visible / fully zoomed out (1M)                     | 0.23 / 0.79 / 0.81 ms                                          |
| Pan frame p95 (candles + volume, 1M)                                                     | 1.1 ms                                                         |
| Engine memory per candle                                                                 | 61 bytes                                                       |
| Same with SMA, EMA, Bollinger and RSI attached (6 output series)                         | 241 bytes                                                      |
| Add SMA, EMA, Bollinger, RSI to 1M candles                                               | 988 ms                                                         |
| Replace 1M candles + volume with those 4 indicators attached (steady state / first time) | 1,645 / 1,954 ms                                               |
| Realtime updates/s on 1M candles (frame every 10 updates)                                | 101,000                                                        |
| Same with 4 indicators (incremental)                                                     | 30,000                                                         |
| Datafeed: normalise and load 1M candles + volume through `DatafeedController`            | 587 ms                                                         |
| Datafeed: forming-bar ticks/s through feed → controller → series, 1M bars loaded         | 96,600                                                         |
| Heap growth after 200,000 forming-bar updates                                            | none measurable (−54 KB)                                       |
| Heap growth after 200 create/destroy cycles (20K candles + RSI each)                     | 478 KB, the size of JIT and caches, not proportional to cycles |

Trading overlay (`benchmarks/trading.perf.ts`, 2026-11-26, 100K candles, 2,000 visible, no-op
canvas): `setOrders(1,000)` + first frame 6.2 ms; 1,000 `upsertOrder` status changes in one task + frame 5.6 ms
(one rebuild); pan frame p95 with 1,000 orders on screen 3.9 ms (0.6 ms without the overlay); `hitTest` over
1,000 objects 4.5 µs per pointer move. Most of the added frame time is the engine laying out and drawing 1,000
axis labels; switch `axisLabels` off for very large order books. Not yet measured on a real canvas: the
playground's trading page has an "Add 1,000 orders" button for that.

Real canvas, Chromium (playground Performance page, 500K candles): pan p95 3.4 ms, zoom sweep p95
2.6 ms, realtime frame (20 updates + render) p95 1.7 ms, or 2.5 ms with 4 indicators.

## Optimisations for large datasets

Profiling (`node:inspector` CPU profiles of the benchmarks) found the costs in data movement and garbage
collection, not in drawing or indicator maths:

| Problem                                                                                                                   | Fix                                                                                                                 | Before → after (1M bars)                            |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Every `setData` re-merged the time axis of all series, allocating new arrays each time                                    | Series whose times equal the axis are compared, not merged; one shared identity mapping; the axis buffer is reused  | 190 → 40 ms per additional series                   |
| The indicator manager read its source through `series.data()`, one object per bar                                         | New `series.columns()` (typed-array copies); one Bar array shared by all indicators recalculated in the same change | Adding 4 indicators: 1,992 → 988 ms                 |
| Indicator outputs were written as one object per point                                                                    | New `series.setColumns()`; outputs written as two typed arrays                                                      | (included above)                                    |
| Each forming-bar tick in `DatafeedController` searched all loaded candles (O(n))                                          | Last-bar fast path, binary search otherwise                                                                         | Ticks/s with 1M bars: effectively unusable → 96,600 |
| `createStaticDatafeed().push()` re-merged and re-sorted all candles per tick, and scanned them for aggregated subscribers | O(1) append/replace; binary search for the aggregation bucket                                                       | (included above)                                    |
| Long realtime sessions kept every bar                                                                                     | `DatafeedController` option `maxBars` drops the oldest bars (10% slack, only while they are off-screen)             | Memory bounded                                      |

A cache that kept shared indicator inputs until the end of the current task was tried and removed. It held charts
alive until the microtask ran, which the lifecycle benchmark reported as a 246 MB leak. The shared input now
lives only for the duration of one data-change dispatch.

## Evaluated, not adopted (yet)

- **OffscreenCanvas / rendering in a worker.** A full frame costs ≤ 1 ms of engine CPU and a few milliseconds
  with rasterisation at 1M bars. Moving the engine to a worker would add input forwarding and asynchronous APIs
  (`priceToCoordinate`, hit testing, plugins) without a measurable gain at these frame times. Revisit if
  profiling of a real application shows main-thread rendering as a bottleneck.
- **Indicators in a Web Worker.** `computeIndicator(definition, bars, params)` is pure and returns typed
  arrays, so it can run in a worker and its results can be transferred. A built-in worker is not shipped,
  because bundlers handle worker files in libraries differently. The main-thread cost to plan for is roughly
  150–650 ms per indicator per 1M bars (Bollinger is the heaviest of the four measured); incremental realtime
  updates stay O(1).
- **WebGL backend.** Not justified by these measurements; Canvas 2D stays the only backend.

## Known limits

- Replacing very large datasets with many indicators attached is dominated by garbage collection of the
  previous data (about 1.6 s for 1M bars with 4 indicators). Prefer appending with `update()` and paging
  history over replacing everything.
- A major GC in a heap of around 1 GB can still cause an occasional long frame (seen as 100–150 ms in
  Chromium right after loading 1M bars plus indicators). Keep `maxBars` set for long sessions.
- Indicator runners keep their own time column, which duplicates the source times (8 bytes per bar per
  indicator).
- Node benchmark frame times exclude rasterisation; use the playground page for end-to-end numbers on target
  hardware.
