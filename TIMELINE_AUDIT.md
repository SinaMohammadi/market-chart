# Timeline synchronisation audit

Scope: how `market-chart` keeps several independent series on one time axis — the canonical timeline,
time-scale conversions, painting, crosshair, realtime updates, indicators, drawings, the datafeed
controller and persistence. Every issue below was reproduced by a failing test on the code before the fix
(commit `465a54a`), then fixed; the tests are listed with each issue.

Severity: **High** — silently wrong data shown to the user, or the feature becomes unusable at scale.
**Medium** — wrong view/state in a realistic scenario, or data dropped from the screen. **Low** — a wrong
or missing value in a narrow case.

## What was verified correct (no change needed)

The core index model is sound. These were checked with targeted tests and two property-based tests
(random multi-series `setData` / `update` / out-of-order sequences, 25 and 40 seeds):

- `Timeline` (`packages/core/src/model/timeline.ts`) is the sorted, de-duplicated union of all series'
  timestamps; each series has its own local → global mapping. No code path uses one series' array index
  for another series. `rebuild()` and the `appendFrom()` fast path keep the union strictly increasing and
  every mapping exact, including shared identity mappings when series diverge.
- Painters (`series/painters/*`, custom series) position point `i` at `mapping[i]`, i.e. at its own
  timestamp. A missing point leaves a gap in that series only.
- Crosshair, `seriesData`, magnet snapping and context-menu hits resolve one timeline time and then look up
  each series **by that time** (`store.indexOfTime`); a series without a value there is omitted, never
  given a neighbour's value. All panes share one `TimeScale`, so all panes agree on the x and the time.
- `timeToLogical` / `logicalToTime` / `indexToX` / `xToLogical` are mutually consistent (round trips to
  1e-9) after zoom and pan, including fractional positions.
- Chart sync maps ranges through time; persistence stores the view as times; drawing anchors are
  `{ time, price }`; indicator outputs carry the times of the bars they were computed from.
- Timestamps are UTC milliseconds; a daylight-saving fall-back produces distinct instants and is kept as
  distinct bars (time zones only affect labels).
- Duplicate times are rejected by `setData` (previous data kept); `update()` at an existing time replaces
  it and never adds a timeline entry.

## Confirmed issues (all fixed)

### T-1 · High · Indicators kept stale values after a correction of an older bar

- **File / function:** `packages/indicators/src/chart/indicator-manager.ts`,
  `IndicatorInstance.onSourceChanged`.
- **Root cause:** the chart's `dataChanged` event did not say which point an `update()` changed. The
  manager only looked at the source's _last_ point: a `replaced` older bar had the same last time and the
  same length as a tick on the forming bar, so it ran `runner.updateLast(lastBar)`. The corrected bar and
  every value derived from it after it were never recomputed.
- **Reproduction:** 120 candles + SMA(5) + RSI(14); `candles.update({ ...bars[100], close: ×1.2 })`.
- **Expected:** outputs equal a full computation over the corrected bars.
  **Actual:** SMA at bar 100 was 109.16 instead of 113.64 (and bars 101–104 likewise), silently.
- **Fix:** `dataChanged` now carries `update: { kind: 'appended' | 'replaced' | 'inserted', time }`
  (additive). A change at a time other than the last point triggers a recomputation — or, for the last
  16 bars, a tail rewrite from a kept calculator snapshot (`IndicatorRunner.rewrite`).
- **Performance:** older corrections cost one full recomputation (≈170 ms for SMA + RSI on 1M bars;
  previously ≈0 ms because they were skipped). Correcting a recent bar — the common "previous bar
  finalised" feed pattern — re-runs ≤ 16 steps (0.02 ms).
- **Tests:** `indicators/src/chart/timeline-sync.integration.test.ts` ("historical correction",
  "re-runs only the tail"); `indicators/src/indicators.test.ts` ("rewriting recent bars matches batch",
  every built-in indicator).

### T-2 · Medium · An indicator value survived after its source point became whitespace

- **File / function:** same, `onSourceChanged` (`if (!bar) return`).
- **Root cause:** when the last source point was updated to whitespace (`{ time }`), the handler returned
  early; the indicator kept a value at a time where the source no longer has one. The source length was not
  re-synchronised either, so the next value point forced a full recomputation.
- **Reproduction:** line source + SMA(3); `line.update({ time: lastTime })`.
- **Expected:** no SMA value at `lastTime`. **Actual:** the old value stayed plotted.
- **Fix:** a withdrawn value recomputes; an appended whitespace point is counted; a trailing whitespace
  point that receives a value is processed as one new bar.
- **Tests:** "drops the value of a bar that became whitespace and follows whitespace appends".

### T-3 · Medium · Data-derived drawings used stale logical indices after another series changed the timeline

- **File / function:** `packages/drawing-tools/src/manager.ts`, `dataAccess` / `derived`.
- **Root cause:** the regression channel computes in logical (bar index) space. The manager cached the
  series' logical indices and the derived regression keyed only by _that series'_ data version. Inserting
  or removing timestamps in _any other_ series (a comparison symbol with more history, an indicator with
  displaced outputs) shifts global indices without changing that version.
- **Reproduction:** 200 candles + regression channel over bars 110–180; add a line series with 100 older
  bars.
- **Expected:** regression from logical 210. **Actual:** drawn from logical 110 — 100 bars to the left of
  its anchors.
- **Fix:** values are read along the timeline by time; each cached result records the (time, logical
  index) of the first and last data points it used and is reused only while both still map to the same
  index (two binary searches per frame).
- **Tests:** `drawing-tools/src/timeline-sync.integration.test.ts`.

### T-4 · High (performance) · A regression channel made realtime unusable on large series

- **File / function:** `packages/drawing-tools/src/manager.ts`, `dataAccess`.
- **Root cause:** every `dataChanged` (every tick) invalidated the values cache, which was rebuilt with
  `series.data()` — one object per point for the whole series — plus a `timeToLogical` per point, on the
  next frame.
- **Measured:** 1M candles + one regression channel: **39.9 updates/s** (≈250 ms per frame).
- **Fix:** read only the bars between the anchors (`timeToLogical` → `logicalToTime(i)` → `dataAt`),
  O(m log n) for m bars in range, no copy of the series. **After: 40,313–47,009 updates/s.**
- **Tests:** existing drawing tests plus T-3; benchmark `benchmarks/timeline.perf.ts`.

### T-5 · Medium · The view jumped when a timestamp was inserted after the visible range

- **Files / functions:** `packages/core/src/chart/chart.ts` (`updateSeries`, `afterTimelineChange`),
  `packages/core/src/scales/time-scale.ts` (`handleTimelineChange`).
- **Root cause:** the viewport is stored relative to the last bar, and the only anchor used after a change
  was the previously last bar. Inserting a timestamp between the visible range and the last bar (a late
  candle, a gap filled by a backfill, a volume series appending a time the candles lack) moves every earlier
  bar one slot left. In addition, an `appended` update whose time fell inside the timeline triggered a
  rebuild without notifying the time scale at all.
- **Reproduction:** 199 candles with minute 150 missing; view logical 10–60; `candles.update(bar(150))`.
- **Expected:** same visible times. **Actual:** the view shifted by one bar per inserted timestamp.
- **Fix:** before each timeline change the chart captures the _time_ of the bar at the right edge when the
  latest bar is out of view; afterwards that bar keeps its x (exact index if it still exists, interpolated
  otherwise). The time scale is notified whenever the timeline version changed.
- **Performance:** O(1) capture, O(log N) after a change; no extra work on ticks.
- **Tests:** `testing/src/integration/timeline-sync.integration.test.ts`, "historical insertion keeps the
  view" (5 cases).

### T-6 · Medium · Zoom and position reset when the series holding the latest time was shortened

- **File / function:** `packages/core/src/chart/chart.ts`, `afterTimelineChange`.
- **Root cause:** if the previous last timestamp no longer existed, the change was treated as "data
  replaced entirely" and the time scale reset bar spacing and right offset to the options.
- **Reproduction:** candles + a forecast series extending 20 bars further; zoom to bars 50–100; shorten the
  forecast to 10 bars. **Expected:** same zoom and times. **Actual:** bar spacing 14.9 → 8 (default) and the
  view jumped to the latest bar.
- **Fix:** the edge anchor (T-5) keeps the view; when the latest bar was in view the chart keeps following
  the new latest bar with the current zoom. A reset still happens on the first data and when the viewed
  times are no longer covered by the data.
- **Behaviour change:** replacing data while following the latest bar (e.g. switching interval) now keeps
  the bar spacing instead of resetting it to `timeScale.barSpacing`. No API change.

### T-7 · Medium · History paging never triggered when another series started earlier

- **File / function:** `packages/datafeed/src/controller.ts`, constructor's `visibleRangeChange` handler.
- **Root cause:** `e.logical.from < loadMoreThreshold` compares a position on the _shared_ timeline with a
  constant, assuming the controller's first bar is logical 0.
- **Reproduction:** comparison series with 500 bars more history; scroll to the controller's first bar
  (logical 500). **Expected:** an older page loads. **Actual:** nothing (test timed out).
- **Fix:** compare with the logical index of the controller's own first bar (`timeToLogical`, O(log N)).
- **Tests:** `datafeed/src/timeline-sync.integration.test.ts`.

### T-8 · Medium · `maxBars` trimming dropped bars that were on screen

- **File / function:** `packages/datafeed/src/controller.ts`, `trimHistory`.
- **Root cause:** `visible.from < excess` compares a shared-timeline index with a count of the controller's
  candles.
- **Reproduction:** comparison series 300 bars earlier; look at the controller's oldest bars (logical
  300–340); 15 realtime bars arrive. **Expected:** no trim. **Actual:** 10 visible bars removed.
- **Fix:** compare with the logical index of the first bar that would be kept.

### T-9 · Medium · Trimming during an in-flight history page left a permanent gap

- **File / function:** `packages/datafeed/src/controller.ts`, `loadMore` / `trimHistory`.
- **Root cause:** a page requested for "before the first bar" was merged after `trimHistory` had removed
  the oldest bars, leaving a hole between the page and the kept bars; the cursor was then set past it.
- **Reproduction:** page request held back; 10 realtime bars trim 10 old bars; the page resolves.
  **Expected:** contiguous bars. **Actual:** a 10-bar gap.
- **Fix:** a history epoch, incremented on trim; a page from an older epoch is discarded (scrolling back
  requests the right range again).

### T-10 · Medium · A restored view re-applied stale logical indices

- **File / function:** `packages/persistence/src/chart-persistence.ts`, `restoreView`.
- **Root cause:** the view is stored as times, but the "settle" step re-applied the logical range computed
  when the view was first applied. History inserted before the next frame shifts indices, and the settle
  step moved the view onto the wrong bars.
- **Reproduction:** restore a saved view, then prepend 50 bars before the first frame.
  **Expected:** the saved time range. **Actual:** the view moved 50 bars into the past.
- **Fix:** the settle step resolves the saved times again.
- **Tests:** `persistence/src/timeline-sync.integration.test.ts`.

### T-11 · Low · `valuesAt()` returned null for values plotted into the future

- **File / function:** `packages/indicators/src/chart/indicator-manager.ts`, `IndicatorInstance.valuesAt`.
- **Root cause:** outputs with a positive offset (Ichimoku leading spans) are plotted on extrapolated future
  times, but `valuesAt` only searched the source bars' times.
- **Fix:** invert the extrapolation for times after the last bar.

## Remaining risks (not changed)

- **Single-point timeline.** With exactly one timestamp there is no interval to interpolate with:
  `timeToLogical` returns null for any other time, so drawings cannot be placed and `timeToCoordinate` of
  other times is null until a second bar exists. Inherent to index-based spacing.
- **Insertion of a new timestamp is O(total points).** A late bar with a time no series has rebuilds the
  union and all mappings (≈10 ms for 2 series × 1M bars). Fine for occasional corrections; bulk backfills
  should use `setData` / `setColumns`, which costs the same once.
- **Indicator corrections older than 16 bars** recompute the whole indicator (≈170 ms for SMA + RSI on
  1M bars). Periodic calculator checkpoints would bound this further at a memory cost.
- **Tick labels across a DST fall-back** were not audited in depth (weights are computed from local clock
  parts); bar positions and data are unaffected.
- **Benchmark tooling:** the installed Vitest (5.1.2) does not apply `poolOptions.forks.execArgv` from
  `vitest.bench.config.ts`, so memory benchmarks need `NODE_OPTIONS=--expose-gc` (pre-existing).

## Public API impact

No breaking changes. Additive only:

- `ChartEventMap['dataChanged']` is now `DataChangedEvent` with an optional
  `update?: { kind: DataUpdateKind; time: number }`; `DataChangedEvent` and `DataUpdateKind` are exported
  from `@market-chart/core`.
- `IndicatorRunner.REWIND_BARS`, `canRewrite(index)` and `rewrite(index, bars)`.
- Behaviour change described under T-6.
