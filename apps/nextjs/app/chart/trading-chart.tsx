'use client';

import { useMemo, useState } from 'react';
import { Chart } from '@market-chart/react';
import { createSyntheticDatafeed } from '@market-chart/datafeed';
import { DatafeedSeries } from '@market-chart/datafeed/react';
import type { DatafeedState } from '@market-chart/datafeed/react';
import { Indicator } from '@market-chart/indicators/react';
import { createLocalStorage } from '@market-chart/persistence';
import { useChartPersistence } from '@market-chart/persistence/react';

const SYMBOLS = ['SYN:BTCUSD', 'SYN:ETHUSD', 'SYN:EXAMPLE', 'SYN:EURUSD'];
const INTERVALS = ['5m', '15m', '1h', '4h', '1D'];

function SaveStatus() {
  // Created on the client only (this component renders inside <Chart>, after mount).
  const storage = useMemo(() => createLocalStorage({ prefix: 'nextjs-example:' }), []);
  const { status } = useChartPersistence({ id: 'trading-chart', storage, debounceMs: 800 });
  return <span className="badge">layout {status}</span>;
}

export function TradingChart() {
  // The datafeed is created once per mount; nothing runs on the server.
  const datafeed = useMemo(() => createSyntheticDatafeed({ latencyMs: 150 }), []);
  const [symbol, setSymbol] = useState(SYMBOLS[0]!);
  const [interval, setTimeframe] = useState('1h');
  const [feed, setFeed] = useState<DatafeedState | null>(null);
  const [indicators, setIndicators] = useState({ sma: true, rsi: true });

  return (
    <div className="panel">
      <div className="toolbar">
        <select value={symbol} onChange={(e) => setSymbol(e.target.value)} aria-label="Symbol">
          {SYMBOLS.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        {INTERVALS.map((tf) => (
          <button key={tf} aria-pressed={interval === tf} onClick={() => setTimeframe(tf)}>
            {tf}
          </button>
        ))}
        <button
          aria-pressed={indicators.sma}
          onClick={() => setIndicators((s) => ({ ...s, sma: !s.sma }))}
        >
          SMA 50
        </button>
        <button
          aria-pressed={indicators.rsi}
          onClick={() => setIndicators((s) => ({ ...s, rsi: !s.rsi }))}
        >
          RSI
        </button>
        <span className="badge">{feed?.status ?? 'idle'}</span>
      </div>
      <Chart height={520} theme="dark">
        <DatafeedSeries
          datafeed={datafeed}
          symbol={symbol}
          interval={interval}
          onStateChange={setFeed}
        />
        {indicators.sma ? (
          <Indicator type="sma" source={feed?.series ?? null} params={{ length: 50 }} />
        ) : null}
        {indicators.rsi ? <Indicator type="rsi" source={feed?.series ?? null} /> : null}
        <SaveStatus />
      </Chart>
    </div>
  );
}
