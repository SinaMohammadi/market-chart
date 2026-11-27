# @market-chart/charts

Advanced chart types, profiles and order flow for `@market-chart/core`. Computations are pure functions you can
test or run in a worker; renderers plug into the core's custom-series API.

## Chart types

| Type              | How                                                                         | Notes                                                 |
| ----------------- | --------------------------------------------------------------------------- | ----------------------------------------------------- |
| Heikin-Ashi       | `heikinAshi(bars)` → candlestick series                                     |                                                       |
| Renko             | `renko(bars, { boxSize: 50 \| { atr: 14 }, source })` → candlestick series  | Traditional: reversals need two boxes                 |
| Line Break        | `lineBreak(bars, { lines: 3 })`                                             |                                                       |
| Range bars        | `rangeBars(ticksOrBars, { range })`                                         | Exact with ticks; OHLC input assumes an intrabar path |
| Tick bars         | `tickBars(trades, { count })`                                               |                                                       |
| Spread            | `spread(a, b, 'difference' \| 'ratio')` → line series                       | Aligned on common times                               |
| Kagi              | `addKagiSeries(chart, { reversal, mode })`                                  | Yang (thick) and yin (thin) lines                     |
| Point & Figure    | `addPointFigureSeries(chart, { boxSize, reversal: 3 })`                     | X/O boxes                                             |
| Hollow candles    | `addHollowCandleSeries(chart)`                                              | Hollow when close > open; colour vs previous close    |
| Volume candles    | `addVolumeCandleSeries(chart)`                                              | Width proportional to volume                          |
| Footprint         | `addFootprintSeries(chart, { tickSize })` + `aggregateFootprint(trades, …)` | Bid × ask per level, diagonal imbalances, per-bar POC |
| Liquidity heatmap | `addHeatmapSeries(chart, { priceStep })` with order-book snapshots          | Size per price and time, mid price on top             |

Renko, Kagi, Point & Figure and Line Break don't depend on time. Each brick, column or line takes the time of the
bar that formed it, plus 1 ms when one bar forms several, so times stay strictly increasing.

## Profiles

```ts
addVolumeProfile(chart, candles, { mode: 'visible', rows: 48 }); // follows scrolling/zooming
addVolumeProfile(chart, candles, { mode: 'session', rows: 24 }); // one per UTC day
addVolumeProfile(chart, candles, { mode: 'session', session: nyse }); // one per trading day
addVolumeProfile(chart, candles, { mode: 'fixed', from: t0, to: t1, trades }); // exact buy/sell split from trades
addMarketProfile(chart, candles, { periodMinutes: 30 }); // TPO letters, POC, value area, initial balance
```

`computeVolumeProfile` and `computeMarketProfile` are available without a chart. Value areas use the
standard method: start at the POC and add the larger neighbouring row until 70 % of the volume is covered.
Without trades, each bar's volume is spread evenly over its high–low range and counted as buying when the bar
closed up. The result says so with `approximate: true`.

## Order flow

```ts
const footprint = aggregateFootprint(trades, { interval: 60_000, tickSize: 0.5 });
addFootprintSeries(chart, { tickSize: 0.5 }).setData(footprint);
chart.addSeries('histogram', { pane: 1 }).setData(deltaHistogram(footprint));
chart
  .addSeries('candlestick', { pane: 2 })
  .setData(cumulativeVolumeDelta(trades, { interval: 60_000 }));
```

CVD candles are computed trade by trade, so their intrabar highs and lows are exact.

## Custom chart types

Every renderer here is an ordinary `CustomSeriesView` from `@market-chart/core`:

```ts
const series = chart.addCustomSeries({
  kind: 'ohlc',
  paint(c) {
    /* draw with c.ctx, c.x(i), c.y(price) */
  },
});
```

Data the store cannot hold (footprint levels, order books) stays in the view, keyed by time. The series data
acts as the envelope that drives the time axis, auto-scaling and crosshair values.

## Limitations

- Without a `session`, market and session profiles use UTC days. With one, the market profile counts its
  periods from the session's open and leaves out bars outside trading hours.
- Fixed-range volume profiles are set by API (`from` / `to`), not yet drawn interactively as a drawing tool.
- Realtime: helpers recompute from the full input on each `setData` call (O(n)).
- Synthetic trades and order books in `@market-chart/testing` are for demos and tests only.
