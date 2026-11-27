# @market-chart/indicators

An incremental technical-indicator engine for `@market-chart/core`, plus helpers that plot indicators on a chart.

- **44 built-in indicators** across trend, momentum, volatility, volume and advanced levels.
- **Incremental.** A new bar costs one calculator step. Realtime ticks restore a snapshot of the state from before
  the last bar and re-run one step, so values never drift however often the last bar changes.
- **Chart-free core.** `computeIndicator(definition, bars, params)` is a pure function. It has no DOM dependency, so
  it can run in a Web Worker.
- **Typed, validated inputs.** Each indicator declares an input schema. Parameters are validated, unknown keys are
  rejected, and settings forms can be generated from the schema.
- **Serialisable.** Instances save to plain JSON and restore with validation; invalid entries are skipped and reported.

## Plot on a chart

```ts
import { createChart } from '@market-chart/core';
import { getIndicatorManager } from '@market-chart/indicators';

const chart = createChart(el);
const candles = chart.addSeries('candlestick');
candles.setData(bars);

const indicators = getIndicatorManager(chart);
const rsi = indicators.add('rsi', candles, { params: { length: 14 } }); // new pane, 70/50/30 levels
const bb = indicators.add('bollinger', candles); // overlay with a band fill
rsi.setParams({ length: 21 });
candles.update(tick); // indicators update incrementally
const saved = indicators.serialize(); // plain JSON
indicators.restore(saved, (id) => chart.series().find((s) => s.id === id));
```

Session-based indicators (VWAP, pivot points, CPR) start their days at midnight UTC. Give the manager a
trading session to use the exchange's trading days instead (`indicators.setSession(controller.session)`, or
let `@market-chart/ui` do it with the user's time-zone choice). Custom indicators get it as
`create(params, context)` → `context.session`.

Indicator outputs are ordinary series, so crosshair data, legends, scales and panes all work through the public
chart API. Indicators can take another indicator's output as their source (for example, an SMA of the RSI).

## React

```tsx
import { Indicator } from '@market-chart/indicators/react';

<Chart>
  <CandlestickSeries data={bars} ref={setCandles} />
  <Indicator type="macd" source={candles} params={{ fast: 12, slow: 26 }} />
</Chart>;
```

## Custom indicators

```ts
import {
  calc,
  defineIndicator,
  Ema,
  createDefaultRegistry,
  IndicatorManager,
} from '@market-chart/indicators';

const zlema = defineIndicator({
  type: 'zlema',
  name: 'Zero-lag EMA',
  shortName: 'ZLEMA',
  category: 'trend',
  placement: 'overlay',
  inputs: { length: { type: 'int', default: 20, min: 2 } },
  outputs: [{ id: 'ma', name: 'ZLEMA', kind: 'line', color: '#e91e63' }],
  create: (p) =>
    calc({ ema: new Ema(p.length), history: [] as number[] }, (s, bar) => {
      s.history.push(bar.close);
      const lag = Math.floor((p.length - 1) / 2);
      if (s.history.length > lag + 1) s.history.shift();
      return [s.ema.next(2 * bar.close - s.history[0]!)];
    }),
});

const registry = createDefaultRegistry().register(zlema);
const manager = new IndicatorManager(chart, registry);
```

Calculators keep all mutable data in the `state` passed to `calc`. The engine deep-copies that state to support
realtime updates of the last bar.

## Built-in indicators

| Category   | Indicators                                                                                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trend      | SMA, EMA, WMA, VWMA, DEMA, TEMA, HMA, MA Ribbon, Supertrend, Parabolic SAR, ADX (+DI/−DI), Aroon, Ichimoku Cloud                                                |
| Momentum   | RSI, MACD, Stochastic, Stochastic RSI, CCI, ROC, Momentum, Williams %R, Awesome Oscillator, Ultimate Oscillator, TRIX                                           |
| Volatility | Bollinger Bands, ATR, Keltner Channels, Donchian Channels, Standard Deviation, Historical Volatility, Chaikin Volatility                                        |
| Volume     | Volume (+MA), OBV, VWAP (day/week/month, bands), Anchored VWAP, MFI, CMF, Accumulation/Distribution, Volume Oscillator                                          |
| Advanced   | Pivot Points (traditional, Fibonacci, Woodie, Camarilla), CPR, Fibonacci retracement levels (rolling), Support/Resistance (pivot-based), Premium/Discount zones |

### Conventions and known differences

- Moving averages are seeded with the SMA of their first `length` values, as in Pine Script's `ta.ema`.
  RSI, ATR and ADX use Wilder smoothing (RMA).
- Standard deviation is the population form (Pine `ta.stdev` with `biased = true`).
- Stochastic and Stochastic RSI return 50 when the high–low range is zero (Pine returns `na`).
- VWAP, pivot points and CPR use **UTC** day, week (Monday) and month boundaries. Exchange session times are planned.
- Ichimoku leading spans are plotted `displacement − 1` bars ahead, using times extrapolated from the last bar
  interval; they are rebuilt whenever a new bar arrives.
- Pivot levels are drawn as step lines, so a vertical segment joins consecutive periods.

### Not yet available

- **CVD (cumulative volume delta):** needs per-trade buy/sell volume. It is planned together with the order-flow
  data model, rather than approximated from candles.
- **Market structure, order blocks, fair value gaps and liquidity zones:** need zone and marker rendering on top of
  the drawing layer. Not started.
- **Running calculations in a worker:** `computeIndicator` is worker-safe, so you can call it from your own worker.
  A ready-made worker transport was evaluated and not adopted, because incremental updates are already O(1) per
  tick; see [PERFORMANCE.md](../../docs/PERFORMANCE.md).

## Security

`IndicatorManager.restore(configs, resolveSource, { max })` re-creates at most `max` indicators (default
`MAX_RESTORED_INDICATORS` = 100) and reports the rest through the `error` event. Parameters must be the
definition's own inputs (inherited names such as `constructor` are rejected) within their ranges; style colours
must be strings of at most 64 characters.
