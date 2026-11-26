import { useMemo, useState } from 'react';
import { CandlestickSeries, Chart, HistogramSeries } from '@market-chart/react';
import { createTheme } from '@market-chart/core';
import type { ThemeInput } from '@market-chart/core';
import { syntheticBars, volume } from '../data';

const ocean = createTheme('dark', {
  name: 'ocean',
  background: '#0a1a2f',
  textColor: '#9fb3c8',
  gridColor: 'rgba(80, 120, 170, 0.18)',
  borderColor: '#1d3557',
  upColor: '#4cc9f0',
  downColor: '#f72585',
  crosshairLabelBackground: '#1d3557',
});

const themes: Record<string, ThemeInput> = { dark: 'dark', light: 'light', ocean };
const volumeOptions = {
  priceScaleId: 'volume',
  priceFormat: { type: 'volume' as const },
  lastValueVisible: false,
};

export function ThemesExample() {
  const bars = syntheticBars('XAUUSD', 1_200);
  const vol = useMemo(() => volume(bars), [bars]);
  const [name, setName] = useState('dark');
  return (
    <>
      <div className="toolbar">
        {Object.keys(themes).map((t) => (
          <button key={t} aria-pressed={t === name} onClick={() => setName(t)}>
            {t}
          </button>
        ))}
        <span className="desc" style={{ margin: 0 }}>
          Series colours follow the theme unless set explicitly.
        </span>
      </div>
      <div className="card">
        <Chart
          height={480}
          theme={themes[name]}
          onReady={(c) =>
            c.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } })
          }
        >
          <CandlestickSeries data={bars} />
          <HistogramSeries data={vol} options={volumeOptions} />
        </Chart>
      </div>
    </>
  );
}
