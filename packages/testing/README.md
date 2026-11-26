# @market-chart/testing

Deterministic, seedable **synthetic** OHLCV data for demos, tests and benchmarks.

```ts
import { generateAsset, HOUR, TickSimulator } from '@market-chart/testing';

const bars = generateAsset('BTCUSDT', 2_000, HOUR); // synthetic, BTC-like behaviour
const sim = new TickSimulator(bars.at(-1)!, { interval: HOUR });
series.update(sim.next(1_000));
```

All presets (`BTCUSDT`, `ETHUSDT`, `EURUSD`, `AAPL`, `NDXLIKE`, `XAUUSD`, `XAGUSD`) are random walks
with parameters chosen to *resemble* those instruments. They are **not** real prices and must not be
presented as real-time or exchange-verified data.
