import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Chart } from '@market-chart/react';
import {
  createStaticDatafeed,
  createSyntheticDatafeed,
  parseCandleFile,
} from '@market-chart/datafeed';
import type { Datafeed, SymbolInfo } from '@market-chart/datafeed';
import { DatafeedSeries } from '@market-chart/datafeed/react';
import type { DatafeedState } from '@market-chart/datafeed/react';
import { Legend } from '../Legend';

const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1D', '1W'] as const;

interface Imported {
  readonly feed: Datafeed;
  readonly name: string;
  readonly interval: string;
  readonly summary: string;
}

/** Guesses the bar interval of imported candles from the most common gap between bars. */
function guessInterval(times: readonly number[]): string {
  const counts = new Map<number, number>();
  for (let i = 1; i < times.length; i++) {
    const gap = times[i]! - times[i - 1]!;
    counts.set(gap, (counts.get(gap) ?? 0) + 1);
  }
  const gap = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 86_400_000;
  const known: [number, string][] = [
    [60_000, '1m'],
    [300_000, '5m'],
    [900_000, '15m'],
    [3_600_000, '1h'],
    [14_400_000, '4h'],
    [86_400_000, '1D'],
    [604_800_000, '1W'],
  ];
  return known.find(([ms]) => ms === gap)?.[1] ?? '1D';
}

/**
 * The synthetic datafeed behaves like a remote one: 250 ms simulated latency, unlimited deterministic history
 * (scroll left to load older pages) and a realtime update every second. All prices are synthetic.
 */
export function DatafeedExample() {
  const synthetic = useMemo(() => createSyntheticDatafeed({ latencyMs: 250, tickMs: 1000 }), []);
  const [symbols, setSymbols] = useState<SymbolInfo[]>([]);
  const [symbol, setSymbol] = useState('SYN:BTCUSD');
  const [interval, setTimeframe] = useState('1h');
  const [imported, setImported] = useState<Imported | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [state, setState] = useState<DatafeedState | null>(null);
  const [bars, setBars] = useState(0);

  useEffect(() => {
    void synthetic.searchSymbols?.('').then(setSymbols);
  }, [synthetic]);

  useEffect(() => {
    if (!state?.controller) return;
    const update = () => setBars(state.series?.length() ?? 0);
    update();
    const offs = [
      state.controller.on('historyLoaded', update),
      state.controller.on('realtime', update),
    ];
    return () => offs.forEach((off) => off());
  }, [state?.controller, state?.series]);

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const result = await parseCandleFile(file);
      if (!result.candles.length) throw new Error('no valid candles found');
      const tf = guessInterval(result.candles.map((c) => c.time));
      const name = file.name.replace(/\.[^.]+$/, '').slice(0, 40) || 'IMPORTED';
      setImported({
        feed: createStaticDatafeed({
          [name]: { candles: result.candles, timeframe: tf, info: { name: file.name } },
        }),
        name,
        interval: tf,
        summary: `${result.candles.length.toLocaleString()} candles · ${result.dropped} invalid rows dropped · ${result.duplicates} duplicates merged`,
      });
      setImportError(null);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    }
  };

  const feed = imported?.feed ?? synthetic;
  const activeSymbol = imported?.name ?? symbol;
  const activeInterval = imported?.interval ?? interval;
  const status = state?.status ?? 'idle';

  return (
    <>
      <div className="toolbar">
        {imported ? (
          <button onClick={() => setImported(null)}>← Back to synthetic feed</button>
        ) : (
          <>
            <select value={symbol} onChange={(e) => setSymbol(e.target.value)} aria-label="Symbol">
              {symbols.map((s) => (
                <option key={s.symbol} value={s.symbol}>
                  {s.symbol} · {s.name}
                </option>
              ))}
            </select>
            {INTERVALS.map((tf) => (
              <button key={tf} aria-pressed={interval === tf} onClick={() => setTimeframe(tf)}>
                {tf}
              </button>
            ))}
          </>
        )}
        <label className="file-button">
          Import CSV / JSON…
          <input
            type="file"
            accept=".csv,.json,.txt,text/csv,application/json"
            onChange={(e) => void onFile(e)}
            hidden
          />
        </label>
        <span className={`badge status-${status}`}>{status}</span>
        <span className="desc" style={{ margin: 0 }}>
          {bars.toLocaleString()} bars loaded
          {state?.symbolInfo?.session ? ` · session ${state.symbolInfo.session}` : ''}
          {imported ? ` · ${imported.summary}` : ' · scroll left to load older history'}
        </span>
      </div>
      {importError ? <p className="desc down">Import failed: {importError}</p> : null}
      <div className="card">
        <Chart height={520}>
          <DatafeedSeries
            datafeed={feed}
            symbol={activeSymbol}
            interval={activeInterval}
            onStateChange={setState}
          />
          <Legend
            symbol={`${activeSymbol} · ${activeInterval}${imported ? ' (imported file)' : ' (synthetic feed)'}`}
            series={state?.series ?? null}
          />
        </Chart>
      </div>
      <p className="desc">
        CSV headers are matched case-insensitively (
        <code>time/date/timestamp, open, high, low, close, volume</code>
        ); without a header, columns are read in that order. Times may be seconds, milliseconds or
        ISO dates (UTC). JSON may be an array of objects/arrays or an object with a{' '}
        <code>candles</code>/<code>data</code>
        array. Files are parsed locally and never uploaded.
      </p>
    </>
  );
}
