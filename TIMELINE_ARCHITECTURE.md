# Timeline architecture

How `market-chart` puts independent series on one time axis, what changed in this audit, and what each
operation costs. Issue numbers (T-n) refer to `TIMELINE_AUDIT.md`.

## Concepts

| Concept                          | Where                          | Meaning                                                                                               |
| -------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Time                             | everywhere                     | UTC milliseconds. Time zones affect labels only.                                                      |
| Local index                      | `ColumnStore` (one per series) | Position of a point in _its own_ series. Never shared between series.                                 |
| Timeline index (logical integer) | `Timeline`                     | Position in the sorted union of all series' timestamps. Bar `i` is centred at logical `i`.            |
| Mapping                          | `Timeline.mapping(store)`      | `Int32Array`, local index → timeline index, one per series.                                           |
| Logical coordinate               | `TimeScale`                    | Fractional timeline position; `timeToLogical` interpolates between bars and extrapolates beyond them. |
| Pixel                            | `TimeScale`                    | `x = width − (lastIndex + rightOffset − logical + 0.5) · barSpacing` (CSS px, per pane).              |

The two index spaces are deliberately separate: a series' local index says nothing about any other series.
Everything that crosses series goes through a **time**.

## Data flow

```
setData / setColumns ─┐                          ┌─► painters: x = indexToX(mapping[i])     (own time)
update() ─► ColumnStore.upsert ─► Timeline ──────┤─► autoscale: localRange(time range)        (by time)
            (append/replace/insert)  rebuild()   ├─► crosshair: x → index → time → each series indexOfTime(time)
                                     appendFrom()└─► conversions: timeToLogical / logicalToTime
                     │
                     └─► chart: viewAnchor() before, afterTimelineChange() after ─► TimeScale.handleTimelineChange
                     └─► dataChanged { series, kind, update?: { kind, time } }
                           ├─► IndicatorManager  (tick / append / tail rewrite / recompute)
                           ├─► DrawingManager    (data version; derived cache validated by time→logical probes)
                           └─► persistence, UI legends (by time)
```

Pixel → time is the reverse: `xToLogical(x)` → `logicalToTime(logical)` (interpolated), or for discrete
lookups `xToIndex(x)` (rounded, clamped) → `timeline.timeAt(index)` → each series `indexOfTime(time)`.
Rendering, hit-testing, crosshair and data lookup all use these same two functions of one `TimeScale`
shared by every pane.

## Index mapping strategy (unchanged — verified correct)

- **Construction.** `Timeline.rebuild(stores)` merges the stores' sorted time columns into the union. A
  store whose times equal the union so far is _compared_, not merged, and shares one identity mapping
  (`identity[i] = i`), so the common case — volume and indicator outputs on the price series' times — costs
  no allocation per series.
- **Realtime fast path.** `appendFrom(store)` handles "one point appended at the end of a store": a time
  after the union's end is appended to the union (amortised O(1)); a time already in the union is found by
  binary search; anything else (a time inside the union that no series had) returns false and the chart
  rebuilds. Existing timeline indices never move on this path.
- **Other mutations.** `replaced` points do not touch the timeline. `inserted` points and `setData` rebuild.
  `Timeline.version` increments on each rebuild; consumers that cache per-index data (tick weights) key on it.
- **Missing data.** A series simply has no mapping entry for a time it lacks. Lookups by time return
  nothing; painters break lines at whitespace (`NaN`) but connect consecutive points of the series.

## Corrections made in this audit

1. **View anchoring by time (T-5, T-6).** `ChartImpl.viewAnchor()` captures, before any timeline change,
   the last bar's time and — when the latest bar is out of view — the time of the bar at the right edge.
   `afterTimelineChange()` resolves that time on the new timeline (exact index, or interpolated position if
   the bar itself is gone) and `TimeScale.handleTimelineChange(anchor, view)` adjusts `rightOffset` so that
   bar keeps its x: `rightOffset += barsFromEndBefore − (lastIndexAfter − edgeLogicalAfter)`. When the latest
   bar is in view the chart keeps following it with the current zoom. The scale is notified whenever the
   timeline version changes (previously an append that fell back to a rebuild was not reported).
   No new data structure: the existing relative viewport plus one captured time.
2. **Change description on `dataChanged` (T-1).** `update()` reports `{ kind, time }` of the point it
   changed. Consumers can tell a tick on the last bar from a correction of an older bar.
3. **Indicator tail rewrite (T-1, T-2).** `IndicatorRunner` keeps the calculator state _before_ each of the
   last 16 bars in a ring (it already cloned the state once per new bar for tick updates; the ring retains
   15 more of those clones). A correction within that window restores the snapshot and re-runs only the
   tail; the manager pushes just the changed output points with `update()`. Older corrections, insertions
   and value ↔ whitespace changes recompute.
4. **Drawing data by time (T-3, T-4).** Data-derived tools read only the bars between their anchors, along
   the timeline, through `dataAt(time)`. Cached results are validated by checking that the first and last
   data points used still resolve to the same logical index.
5. **Datafeed positions by time (T-7, T-8, T-9).** Paging and trimming thresholds are measured from the
   logical index of the controller's own bars; a history epoch discards pages that a trim made stale.
6. **Persistence re-resolves times (T-10)** on its settle frame instead of re-applying old indices.

## Complexity

N = timeline length, n = points of one series, k = number of series, S = series on the chart,
V = visible bars, m = bars between a drawing's anchors, K = 16 (indicator rewind window).

| Operation                                  | Time                                        | Extra space                                                      | Notes                                                |
| ------------------------------------------ | ------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------- |
| `setData` / `setColumns` (one series)      | O(n) validate + O(Σn) rebuild               | O(N) union if times differ; O(n) mapping per non-identity series | Identity stores share one array.                     |
| `update()` — tick on the last point        | O(1)                                        | 0                                                                | No timeline work.                                    |
| `update()` — new last point                | amortised O(1); O(log N) if the time exists | amortised O(1)                                                   | `appendFrom`.                                        |
| `update()` — older point replaced          | O(log n)                                    | 0                                                                | No timeline work; `dataChanged.update` describes it. |
| `update()` — historical insertion          | O(n) store shift + O(Σn) rebuild            | as `setData`                                                     | ≈10 ms for 2 × 1M bars.                              |
| View anchor capture / restore              | O(1) / O(log N)                             | O(1)                                                             | Per timeline change.                                 |
| `timeToLogical`, `indexOf`, `nearestIndex` | O(log N)                                    | 0                                                                | Binary search on `Float64Array`.                     |
| `logicalToTime`, `indexToX`, `xToLogical`  | O(1)                                        | 0                                                                |                                                      |
| Visible range → local range per series     | O(log n)                                    | 0                                                                | `localRange` by time.                                |
| Frame (painting)                           | O(V) per visible series                     | 0                                                                | Viewport-only.                                       |
| Crosshair resolution                       | O(S log n)                                  | O(S) map                                                         | One time, every series by time.                      |
| Indicator tick / new bar                   | O(step) / O(step + state clone)             | ring of K state clones                                           |                                                      |
| Indicator correction, last K bars          | O(K · (step + clone) + K log n)             | 0                                                                | Pushes ≤ K points per output.                        |
| Indicator correction, older / insertion    | O(n · step)                                 | O(n)                                                             | Full recompute.                                      |
| Drawing data access (regression)           | O(m log n)                                  | O(m)                                                             | Was O(n) objects per tick.                           |
| Drawing cache validation                   | O(log N) per frame                          | O(1)                                                             | Two probes.                                          |
| Datafeed page / trim threshold             | O(log N)                                    | 0                                                                |                                                      |

## Memory

Per bar on the timeline: 8 bytes (`Float64Array` times). Per series: its `ColumnStore` columns (8 bytes ×
fields) plus 4 bytes per point for its mapping _only_ if its times differ from the union; series on the
union's times share one identity `Int32Array`. Capacity grows geometrically (×2), so arrays may hold up to
twice their length. Measured: 98.8 bytes per bar for 1M candles (5 fields) + a sparse volume series with
its own mapping, after GC — unchanged by this audit (see `TIMELINE_PERFORMANCE.md`).

## Invariants (enforced by tests)

- The canonical timeline is strictly increasing and equals the union of all series' timestamps.
- Every series' local index `i` maps to the timeline slot holding that point's own time.
- A missing series value is never replaced with another timestamp's value (crosshair, `dataAt`, painters).
- All panes share one logical coordinate system; pixel ↔ logical ↔ time conversions round-trip.
- Historical insertion keeps existing mappings exact and keeps the viewed times on screen.
- Realtime updates never create duplicate or out-of-order timeline entries.
- Indicator outputs equal a from-scratch computation over the source's current bars, at the same times.

Tests: `packages/core/src/model/timeline.test.ts` (property),
`packages/testing/src/integration/timeline-sync.integration.test.ts` (chart, property),
and `timeline-sync.integration.test.ts` in `indicators`, `drawing-tools`, `datafeed` and `persistence`.
