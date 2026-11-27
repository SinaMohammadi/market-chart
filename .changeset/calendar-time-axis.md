---
'@market-chart/core': minor
'@market-chart/ui': minor
'@market-chart/i18n': minor
---

Calendar time axis and session marks:

- `timeScale.calendar`: time runs evenly, so weekends, nights and other closed times take space (empty slots at the bar interval, detected automatically or set with `calendarStep`; gaps longer than `calendarMaxGapBars` are shortened). Turning it on or off keeps the view on the same dates.
- `timeScale().setSession(session)` with `sessionBreaks` (a dashed line where each session opens) and `closedShading` (a band over time outside trading hours, including pre- and after-market bars).
- UI: the time-axis menu has "Calendar time axis", and with a session "Session breaks" and "Shade outside trading hours"; the UI passes its session (in the user's chosen time zone) to the chart.
