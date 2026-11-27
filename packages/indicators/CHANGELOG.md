# @market-chart/indicators

## 0.1.1

### Patch Changes

- 13703f1: Fix timeline synchronisation: the view keeps its timestamps when bars are inserted or the latest series is shortened; indicators recompute after corrections of older bars (recent bars re-run only the tail) and drop values of bars that became whitespace; regression channels stay aligned when other series change the timeline and no longer slow realtime on large series; the datafeed loads and trims history by its own bars and avoids gaps from trims during page loads; restored views re-resolve their saved times. `dataChanged` now reports `update: { kind, time }`.
- Updated dependencies [13703f1]
  - @market-chart/core@0.1.1
  - @market-chart/react@0.1.1
