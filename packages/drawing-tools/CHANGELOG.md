# @market-chart/drawing-tools

## 0.2.0

### Minor Changes

- 07125ab: Usability fixes:

  - Shortcuts match the physical key when the typed character does not name it: `Alt`+letter on macOS, Persian and Arabic keyboard layouts, `Shift`+digit (`KeyLike.code`, new `shortcutKeyOf`). The shortcut recorder stores the letter, not the character.
  - Price actions are listed in the shortcut settings, with a sample price, when the `priceActions({ shortcuts: true })` feature is installed (new `PriceActions.sample()`).
  - Several trading overlays on one `ChartUi` share the menu items, object-tree sections and "Trading" settings; each action runs on the overlay that drew the object it was opened on. They are removed with the last overlay.
  - Crowded axis labels are thinned instead of stacked over the whole axis: one label per label height, the series' last value and the selected trading line first, with "+N" on the label that stands for the others. New price-line option `axisLabelPriority`; `layoutLabels` takes `{ thin, maxStack }` and returns `count`.
  - An indicator moved to another pane is saved in `config()` as `pane` and moved back by `restore()`.
  - Touch: drawings get larger handles after a touch, and holding a finger on a drawing or a trading line opens its context menu instead of moving it (with `interaction.touchContextMenu`). Plugins opt in through the new `ChartInputHandler.longPress`.
  - All 44 built-in indicators have names in English, Persian and Arabic.

### Patch Changes

- Updated dependencies [664d8e8]
- Updated dependencies [6b53d7a]
- Updated dependencies [07125ab]
  - @market-chart/core@0.2.0

## 0.1.1

### Patch Changes

- 13703f1: Fix timeline synchronisation: the view keeps its timestamps when bars are inserted or the latest series is shortened; indicators recompute after corrections of older bars (recent bars re-run only the tail) and drop values of bars that became whitespace; regression channels stay aligned when other series change the timeline and no longer slow realtime on large series; the datafeed loads and trims history by its own bars and avoids gaps from trims during page loads; restored views re-resolve their saved times. `dataChanged` now reports `update: { kind, time }`.
- Updated dependencies [13703f1]
  - @market-chart/core@0.1.1
  - @market-chart/react@0.1.1
