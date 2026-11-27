---
'@market-chart/react': minor
'@market-chart/datafeed': minor
'@market-chart/ui': patch
---

`<Chart dataSource={datafeedSource(feed)} symbol="BTCUSDT" interval="1h">` loads a symbol without `<DatafeedSeries>`; changing `symbol` or `interval` reloads in place. `ChartDataSource` is a small structural contract (`connect(chart, { symbol, interval })` returning `{ update, destroy }`), so any data layer can provide one. The datafeed package adds `datafeedSource` and `attachDatafeed` (also used by `useDatafeed`).

The header moves items into "More" before the browser paints after a resize, so no item visibly jumps one frame late.
