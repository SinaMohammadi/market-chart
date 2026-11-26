import { useMemo, useState } from 'react';
import { Chart, Series } from '@market-chart/react';
import type {
  ChartOptionsInput,
  CrosshairMode,
  LinePoint,
  PriceScaleMode,
  SeriesType,
} from '@market-chart/core';
import { dailyBars } from '../data';

const types: SeriesType[] = ['candlestick', 'bar', 'line', 'area', 'baseline', 'histogram'];
const modes: PriceScaleMode[] = ['normal', 'logarithmic', 'percentage', 'indexed'];
const crosshairs: CrosshairMode[] = ['normal', 'magnet', 'hidden'];

export function SeriesTypesExample() {
  const bars = dailyBars('AAPL', 600);
  const line = useMemo<LinePoint[]>(
    () => bars.map((b) => ({ time: b.time, value: b.close })),
    [bars],
  );
  const [type, setType] = useState<SeriesType>('candlestick');
  const [mode, setMode] = useState<PriceScaleMode>('normal');
  const [inverted, setInverted] = useState(false);
  const [crosshair, setCrosshair] = useState<CrosshairMode>('normal');
  const options = useMemo<ChartOptionsInput>(
    () => ({ rightPriceScale: { mode, invertScale: inverted }, crosshair: { mode: crosshair } }),
    [mode, inverted, crosshair],
  );
  const baselineOptions = useMemo(() => ({ baseValue: bars[0]!.close }), [bars]);

  return (
    <>
      <div className="toolbar">
        {types.map((t) => (
          <button key={t} aria-pressed={t === type} onClick={() => setType(t)}>
            {t}
          </button>
        ))}
      </div>
      <div className="toolbar">
        {modes.map((m) => (
          <button key={m} aria-pressed={m === mode} onClick={() => setMode(m)}>
            {m}
          </button>
        ))}
        <button aria-pressed={inverted} onClick={() => setInverted((v) => !v)}>
          invert
        </button>
        <select
          value={crosshair}
          onChange={(e) => setCrosshair(e.target.value as CrosshairMode)}
          aria-label="Crosshair mode"
        >
          {crosshairs.map((c) => (
            <option key={c} value={c}>
              crosshair: {c}
            </option>
          ))}
        </select>
      </div>
      <div className="card">
        <Chart height={500} options={options}>
          {type === 'candlestick' || type === 'bar' ? (
            <Series key={type} type={type} data={bars} />
          ) : type === 'baseline' ? (
            <Series key={type} type="baseline" data={line} options={baselineOptions} />
          ) : (
            <Series key={type} type={type} data={line} />
          )}
        </Chart>
      </div>
      <p className="desc" style={{ marginTop: 10 }}>
        Drag the price axis to scale it, double-click it to restore auto-scale. Drag the time axis
        to change bar spacing, double-click it to reset. Synthetic AAPL-like daily data with
        weekends skipped.
      </p>
    </>
  );
}
