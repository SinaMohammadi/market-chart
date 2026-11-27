# @market-chart/datafeed

## 0.2.0

### Minor Changes

- 37872a9: `<Chart dataSource={datafeedSource(feed)} symbol="BTCUSDT" interval="1h">` loads a symbol without `<DatafeedSeries>`; changing `symbol` or `interval` reloads in place. `ChartDataSource` is a small structural contract (`connect(chart, { symbol, interval })` returning `{ update, destroy }`), so any data layer can provide one. The datafeed package adds `datafeedSource` and `attachDatafeed` (also used by `useDatafeed`).

  The header moves items into "More" before the browser paints after a resize, so no item visibly jumps one frame late.

- 6b53d7a: Exchange sessions and time zones:

  - `createTradingSession({ hours, timeZone, holidays, specialHours })` describes exchange hours in the exchange's time zone (daylight saving, overnight sessions, lunch breaks, holidays, half days): `isOpen`, `tradingDay`, `sessionDay`, `periodKey`, `sessionsOf`, and `withTimeZone` to read the same hours in another zone. `resolveSessionTimeZone` turns a choice (`exchange`, `chart`, `local`, `application`) into a zone.
  - Indicators: `IndicatorManager.setSession(session)`; VWAP, pivot points and CPR use trading days instead of UTC days. Definitions receive `create(params, context)` with `context.session`.
  - Charts: `sessions(items, session)`, and `session` options for the market profile and session volume profiles (TPO periods count from the open, outside-hours bars are left out).
  - Datafeed: the controller builds `session` from the symbol's `session` hours and `timezone` (`sessionChange` event, `session` option to override); `fillGaps` fills only trading hours and trading days; `datafeedSession(controller)` is a `ChartUi` session capability. `SymbolInfo.session` hours are now read in `timezone` (UTC when absent, as before).
  - UI: a "Session time zone" setting (exchange, chart, this computer, or the application's `applicationTimeZone`); with a `session` capability the UI keeps the indicators' session in step. `ui.session()` returns it.

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
