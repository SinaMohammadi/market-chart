# @market-chart/charts

## 0.2.0

### Minor Changes

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

- Updated dependencies [13703f1]
  - @market-chart/core@0.1.1
