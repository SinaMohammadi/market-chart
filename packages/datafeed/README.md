# @market-chart/datafeed

The `Datafeed` contract, ready-made adapters (static/in-memory, REST, WebSocket, SSE, synthetic), CSV/JSON
parsing, candle utilities and a controller that binds a datafeed to a chart series with realtime updates and
history pagination. Framework independent; `@market-chart/datafeed/react` adds a hook and a component.

Times are **UTC milliseconds**. Nothing touches the network, `WebSocket` or `EventSource` at import time.

## The contract

```ts
interface Datafeed {
  searchSymbols?(query: string): Promise<SymbolInfo[]>;
  resolveSymbol(symbol: string): Promise<SymbolInfo>;
  getHistoricalData(
    symbol: string,
    interval: Timeframe,
    range: { from: number; to: number },
  ): Promise<Candle[]>;
  subscribe(symbol: string, interval: Timeframe, callback: (candle: Candle) => void): Unsubscribe;
  unsubscribe?(subscriptionId: string): void;
  destroy?(): void;
}
```

A realtime candle can be a new bar, an update of the forming bar (same time as the last bar) or a correction of
an older bar. `SymbolInfo` carries `pricePrecision`/`minMove` (applied to the series), `session`, and
`historyStart`/`historyEnd` (where history loading stops/starts).

Intervals: `1s`, `1m`, `5m`, `15m`, `1h`, `4h`, `1D`, `1W`, `1M` (also bare minutes such as `60`). Weeks start on
Monday (UTC); months follow the calendar.

## Connecting a chart

```ts
import { createChart } from '@market-chart/core';
import {
  DatafeedController,
  buildUrl,
  createRestDatafeed,
  createWebSocketDatafeed,
} from '@market-chart/datafeed';

const history = createRestDatafeed({
  // buildUrl encodes every value: a symbol such as `BTC/USD&x=1` cannot change the path or add parameters.
  history: ({ symbol, interval, from, to }) =>
    buildUrl('/api/candles', { symbol, tf: interval, from, to }),
  maxBarsPerRequest: 1000, // long ranges are split into several requests
  // Same-origin API: cookies are sent (the default 'same-origin'). Never put secret API keys in browser code:
  // proxy third-party APIs through your server and authenticate the user there.
});
const feed = createWebSocketDatafeed({
  url: 'wss://example.com/stream',
  history,
  subscribeMessage: (symbol, interval) => ({ op: 'subscribe', symbol, interval }),
  unsubscribeMessage: (symbol, interval) => ({ op: 'unsubscribe', symbol, interval }),
  parseMessage: (m: any) =>
    m.type === 'candle' ? [{ symbol: m.symbol, interval: m.interval, candle: m.k }] : null,
  heartbeat: { message: { op: 'ping' }, intervalMs: 20_000 },
});

const chart = createChart(element);
const candles = chart.addSeries('candlestick');
const controller = new DatafeedController(chart, candles, {
  datafeed: feed,
  symbol: 'BTCUSD',
  interval: '1h',
});
controller.on('status', ({ status }) => console.log(status)); // loading → ready, loading-more, error
await controller.setSymbol('ETHUSD', '15m'); // late responses for the old symbol are ignored
controller.destroy();
```

The controller:

- resolves the symbol and applies its price format;
- subscribes **before** loading history and buffers updates, so nothing between the two requests is lost;
- applies new bars, forming-bar updates and corrections of older bars with `series.update`;
- loads older pages when the visible range comes within `loadMoreThreshold` bars (default 10) of the start,
  and stops at `historyStart` or after three empty pages;
- can fill missing bars with flat candles (`fillGaps`, for 24/7 markets only) and feed a volume histogram
  (`volumeSeries`);
- updates the forming bar in O(1), and with `maxBars` keeps memory bounded in long sessions (old bars are dropped
  while off-screen and reloaded when scrolled back to; `historyTrimmed` event).

## Adapters

| Adapter                                                               | Use                                                                                                                                                                                  |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `createStaticDatafeed({ SYMBOL: { candles, timeframe } })`            | Fixtures, imported files, tests. Larger multiples are resampled on request (1m → 15m, 1D → 1W/1M). `push()` feeds realtime bars.                                                     |
| `createRestDatafeed({ history, resolve?, search?, … })`               | Any HTTP API: URL builders and response parsers, chunking, retries on network errors / 429 / 5xx with exponential backoff, timeouts. 4xx errors are not retried.                     |
| `createWebSocketDatafeed({ url, subscribeMessage, parseMessage, … })` | One shared socket, reference-counted subscriptions, resubscription after reconnect, exponential backoff, heartbeat, connection `status()`.                                           |
| `createSseDatafeed({ url, parse?, eventName? })`                      | Server-Sent Events (the browser reconnects by itself).                                                                                                                               |
| `composeDatafeed({ history, realtime })`                              | History from one source, realtime from another.                                                                                                                                      |
| `createSyntheticDatafeed(options?)`                                   | **Synthetic** prices for demos and tests: deterministic, unlimited history, consistent across pages and intervals, simulated latency, gaps and realtime ticks. Not real market data. |

A custom provider is any object implementing `Datafeed`.

## Files and data utilities

```ts
const { candles, dropped, duplicates } = parseCsv(text); // header aliases, quotes, ; , tab | delimiters
parseJsonCandles(json); // arrays of objects/arrays, or { candles | data | bars }
await parseCandleFile(file); // a File from <input type="file">, CSV or JSON

normalizeCandles(rows); // seconds/ms/ISO times, string numbers, sorting, duplicates (last wins), high/low repair
resampleCandles(candles, '1W');
fillMissingCandles(candles, '1m');
mergeCandles(older, newer);
new CandleAggregator('1m').push({ time, price, size }); // ticks → forming candle
```

ISO date-times without a zone are read as **UTC**, so results do not depend on the viewer's time zone. Rows with
missing or non-finite fields are dropped and counted, never guessed.

## React

```tsx
import { Chart } from '@market-chart/react';
import { DatafeedSeries, useDatafeed } from '@market-chart/datafeed/react';

<Chart height={500}>
  <DatafeedSeries
    datafeed={feed}
    symbol={symbol}
    interval={interval}
    onStateChange={(s) => setStatus(s.status)}
  />
</Chart>;
```

`useDatafeed(datafeed, symbol, interval, options)` (inside `<Chart>`) returns `{ status, symbolInfo, error, series,
controller }`. Changing `symbol` or `interval` reloads in place; a new `datafeed` object recreates the series.
Memoise the datafeed.

## Security

Everything a datafeed returns is untrusted input. The adapters validate and bound it; see [SECURITY.md](../../SECURITY.md).

- **URLs:** build them with `buildUrl(template, params)` (re-exported from the core package): `{name}` placeholders are
  path-encoded and the other parameters become an encoded query string. Never concatenate symbols or user input.
- **Credentials:** `createRestDatafeed({ credentials })` is sent explicitly (default `'same-origin'`). API keys in a
  browser bundle are public; keep them on your server. Error messages contain URLs with the query string removed
  (`redactUrl`), so tokens in query strings do not end up in logs.
- **Limits:** `maxResponseBytes` (REST, default 64 MiB), `maxRequestsPerRange` (default 1000), `maxMessageBytes`
  (WebSocket/SSE, default 4 MiB), `parseCsv` / `parseJsonCandles` / `parseCandleFile` `maxBytes` (default 100 MiB, the
  file size is checked before reading) and `maxRows` (default 5,000,000).
- **Values:** candles with times outside the JavaScript Date range or prices/volumes beyond ±1e18 are dropped
  (`MAX_CANDLE_TIME`, `MAX_CANDLE_VALUE`); the controller passes symbol info through `sanitizeSymbolInfo`.
- **Reconnects:** WebSocket backoff has jitter (`reconnect.jitter`, default 0.5) and only resets after a message or a
  connection that stayed open for `maxDelayMs`, so a server that accepts and drops connections is not hammered.
- **Realtime volume:** for long sessions set `maxBars` on the controller to bound memory.
