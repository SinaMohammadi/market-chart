# Timeline performance: before and after

Benchmarks for the timeline fixes described in `TIMELINE_AUDIT.md`.

## Environment and method

- Node v24.13.0, win32/x64, Intel Core i7-12700K, 32 GB RAM; Vitest 5.1.2, jsdom, a no-op canvas
  context. Frame times are therefore the engine's CPU work (geometry, scales, labels), not rasterisation.
- Datasets: deterministic synthetic 1-minute OHLCV bars (`generateBars`, seed 7), **1,000,000 bars**.
  "Sparse volume" is a histogram series that skips every 7th bar, so its mapping is not the identity.
- Command: `NODE_OPTIONS=--expose-gc pnpm bench` (the memory tests need `--expose-gc`; see the note in
  the audit). The new suite is `benchmarks/timeline.perf.ts`; it writes `benchmarks/results/timeline.md`.
- "Before" is commit `465a54a` with only the benchmark file added; "after" is this change. Timings are
  single runs of medians (or throughput over 50,000 updates); expect ±15–20 % noise between runs on this
  machine — for example the existing "replace 1M candles + 4 indicators" benchmark measured 1,619 and
  1,996 ms on two runs of the _same_ code.

## Timeline suite (`benchmarks/timeline.perf.ts`)

| Measurement                                                                                  | Before                         | After               | Notes                                                                                                   |
| -------------------------------------------------------------------------------------------- | ------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------- |
| Realtime: 1M candles + sparse volume, updates/s (10 ticks per bar, a frame every 10 updates) | 80,895                         | 85,124 – 86,870     | Hot path unchanged; within noise.                                                                       |
| Correct an older bar (500 bars back), 1M candles + SMA + RSI                                 | 0.03 ms ⚠                      | 166 – 171 ms        | Before was fast because indicators **ignored** the correction (T-1). After: one correct full recompute. |
| Correct the previous bar (inside the 16-bar rewind window)                                   | not measured (same wrong path) | 0.02 ms             | Tail rewrite, no recompute.                                                                             |
| Insert a missing bar (new timeline time), 1M bars, candles + volume, median                  | 12.9 ms                        | 9.5 – 10.0 ms       | Same rebuild code; difference is noise. Now also keeps the view (T-5).                                  |
| Then insert that time into volume (time already in timeline), median                         | 5.33 ms                        | 3.78 – 3.82 ms      | Same; noise.                                                                                            |
| `setData` recent, then `setData` with a 1,000-bar older page (pair), 1M bars                 | 258 ms                         | 209 – 238 ms        | Same; noise.                                                                                            |
| 1M candles + one regression channel, updates/s                                               | **39.9**                       | **40,313 – 47,009** | T-4: ≈1,000× — the drawing no longer copies the series on every tick.                                   |
| Engine memory per bar, 1M candles + sparse volume, after GC                                  | 99.3 bytes                     | 98.8 bytes          | Unchanged.                                                                                              |

## Existing core suite (`benchmarks/core.perf.ts`), after the change

All budgets pass. Compared with the last recorded run of the unchanged code:

| Measurement                                                 | Recorded before | After            |
| ----------------------------------------------------------- | --------------- | ---------------- |
| `setData` 1M candles                                        | 96.8 ms         | 80.3 ms          |
| Engine memory per candle (1M)                               | 61.0 bytes      | 61.0 bytes       |
| Same with SMA, EMA, Bollinger, RSI (6 output series)        | 241 bytes       | 241 bytes        |
| Full frame, 2,000 bars visible                              | 1.42 ms         | 1.41 ms          |
| Pan frame p95 (candles + volume)                            | 1.55 ms         | 1.52 ms          |
| Add SMA, EMA, Bollinger, RSI to 1M candles                  | 1,058 ms        | 804 – 960 ms     |
| Replace 1M candles + volume with 4 indicators, steady state | 1,998 ms        | 1,585 – 2,350 ms |
| Realtime updates/s, 1M candles                              | 85,839          | 91,768           |
| Realtime updates/s, same with 4 incremental indicators      | 25,421          | 26,679           |
| Heap growth after 200,000 forming-bar updates               | −73.3 KB        | −74.1 KB         |
| Heap growth after 200 create/destroy cycles                 | 421 KB          | 274 KB           |

The "replace with 4 indicators" row varies widely between runs (it includes major GCs). Running it twice
on the original code and twice on the fixed code gave 1,619 / 1,996 ms before and 1,585 / 1,708 ms after:
no regression.

## Trade-offs

- **Correctness over a skipped update (T-1).** A correction of a bar more than 16 bars back now costs a full
  indicator recomputation, O(n). This is the price of not showing wrong values; the frequent case — the
  previous bar finalised after the next one opened — stays O(1)-ish through the rewind ring.
- **Rewind ring memory.** Each indicator retains up to 16 calculator-state clones instead of 1. States are
  small (window buffers of the indicator's length), so this is a few KB per indicator; the per-candle
  memory benchmark with 4 indicators did not change (241 bytes).
- **View anchoring** adds one small object and O(1) work per `update()` and O(log N) per actual timeline
  change; realtime throughput is unchanged.
- **Drawings** now do O(m log n) work per recomputation (m = bars between the anchors) instead of O(n)
  object allocation, plus two binary searches per frame to validate the cache.
- **Not optimised:** inserting a timestamp no series had still rebuilds the union and all mappings,
  O(total points). At ≈10 ms for 2M points it is below one frame and only happens on historical
  corrections; an incremental insert would need per-mapping shifts of the same order and was not worth the
  extra code.
