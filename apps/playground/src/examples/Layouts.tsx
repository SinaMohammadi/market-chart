import { useMemo, useState } from 'react';
import {
  CandlestickSeries,
  Chart,
  ChartLayout,
  layoutCellCount,
  layoutPresets,
  useLayoutCell,
} from '@market-chart/react';
import type { LayoutPreset } from '@market-chart/react';
import { syntheticAssets } from '@market-chart/testing';
import { syntheticBars } from '../data';

const PRESETS: LayoutPreset[] = ['1', '2h', '2v', '3', '4', '6', '8', '12'];
const SYMBOLS = Object.keys(syntheticAssets);
const INTERVALS: Record<string, number> = {
  '15m': 15 * 60_000,
  '1h': 3_600_000,
  '4h': 4 * 3_600_000,
};

/** One cell: its own symbol, the layout's (linked) interval. */
function Cell() {
  const { index, symbol, interval, setSymbol, setInterval } = useLayoutCell();
  const sym = symbol ?? SYMBOLS[index % SYMBOLS.length]!;
  const iv = interval ?? '1h';
  const bars = useMemo(() => syntheticBars(sym, 600, INTERVALS[iv]), [sym, iv]);
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        border: '1px solid var(--border)',
        borderRadius: 6,
        overflow: 'hidden',
      }}
    >
      <div style={{ position: 'absolute', top: 4, left: 6, zIndex: 3, display: 'flex', gap: 4 }}>
        <select
          value={sym}
          onChange={(e) => setSymbol(e.target.value)}
          aria-label={`Symbol of chart ${index + 1}`}
          className="mini"
        >
          {SYMBOLS.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select
          value={iv}
          onChange={(e) => setInterval(e.target.value)}
          aria-label={`Interval of chart ${index + 1}`}
          className="mini"
        >
          {Object.keys(INTERVALS).map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <Chart height="100%" options={{ timeScale: { rightOffset: 3 } }}>
        <CandlestickSeries data={bars} />
      </Chart>
    </div>
  );
}

export function LayoutsExample() {
  const [preset, setPreset] = useState<LayoutPreset>('4');
  const [crosshair, setCrosshair] = useState(true);
  const [timeRange, setTimeRange] = useState(true);
  const [linkSymbol, setLinkSymbol] = useState(false);
  return (
    <>
      <div className="toolbar">
        {PRESETS.map((p) => (
          <button key={p} aria-pressed={p === preset} onClick={() => setPreset(p)}>
            {p} ({layoutCellCount(layoutPresets[p])})
          </button>
        ))}
      </div>
      <div className="toolbar">
        <button aria-pressed={crosshair} onClick={() => setCrosshair((v) => !v)}>
          sync crosshair
        </button>
        <button aria-pressed={timeRange} onClick={() => setTimeRange((v) => !v)}>
          sync time range
        </button>
        <button aria-pressed={linkSymbol} onClick={() => setLinkSymbol((v) => !v)}>
          link symbols
        </button>
        <span className="desc" style={{ margin: 0 }}>
          Intervals are linked across cells. Scroll or zoom one chart and the others follow by time.
        </span>
      </div>
      <ChartLayout
        key={preset}
        layout={preset}
        height={620}
        gap={6}
        sync={{ crosshair, timeRange }}
        linkSymbol={linkSymbol}
        linkInterval
        defaultInterval="1h"
      >
        {() => <Cell />}
      </ChartLayout>
    </>
  );
}
