# @market-chart/react

## 0.2.0

### Minor Changes

- 37872a9: `<Chart dataSource={datafeedSource(feed)} symbol="BTCUSDT" interval="1h">` loads a symbol without `<DatafeedSeries>`; changing `symbol` or `interval` reloads in place. `ChartDataSource` is a small structural contract (`connect(chart, { symbol, interval })` returning `{ update, destroy }`), so any data layer can provide one. The datafeed package adds `datafeedSource` and `attachDatafeed` (also used by `useDatafeed`).

  The header moves items into "More" before the browser paints after a resize, so no item visibly jumps one frame late.

### Patch Changes

- Updated dependencies [664d8e8]
- Updated dependencies [6b53d7a]
- Updated dependencies [07125ab]
  - @market-chart/core@0.2.0
  - @market-chart/i18n@0.2.0

## 0.1.1

### Patch Changes

- Updated dependencies [13703f1]
  - @market-chart/core@0.1.1
  - @market-chart/i18n@0.1.1
