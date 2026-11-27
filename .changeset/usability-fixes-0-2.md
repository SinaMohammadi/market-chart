---
'@market-chart/core': minor
'@market-chart/ui': minor
'@market-chart/trading': minor
'@market-chart/indicators': minor
'@market-chart/drawing-tools': minor
'@market-chart/i18n': minor
---

Usability fixes:

- Shortcuts match the physical key when the typed character does not name it: `Alt`+letter on macOS, Persian and Arabic keyboard layouts, `Shift`+digit (`KeyLike.code`, new `shortcutKeyOf`). The shortcut recorder stores the letter, not the character.
- Price actions are listed in the shortcut settings, with a sample price, when the `priceActions({ shortcuts: true })` feature is installed (new `PriceActions.sample()`).
- Several trading overlays on one `ChartUi` share the menu items, object-tree sections and "Trading" settings; each action runs on the overlay that drew the object it was opened on. They are removed with the last overlay.
- Crowded axis labels are thinned instead of stacked over the whole axis: one label per label height, the series' last value and the selected trading line first, with "+N" on the label that stands for the others. New price-line option `axisLabelPriority`; `layoutLabels` takes `{ thin, maxStack }` and returns `count`.
- An indicator moved to another pane is saved in `config()` as `pane` and moved back by `restore()`.
- Touch: drawings get larger handles after a touch, and holding a finger on a drawing or a trading line opens its context menu instead of moving it (with `interaction.touchContextMenu`). Plugins opt in through the new `ChartInputHandler.longPress`.
- All 44 built-in indicators have names in English, Persian and Arabic.
