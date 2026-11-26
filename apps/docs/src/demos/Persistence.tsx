import { useEffect, useMemo, useState } from 'react';
import type { SeriesApi } from '@market-chart/core';
import { CandlestickSeries, Chart } from '@market-chart/react';
import {
  ChartPersistence,
  createLocalStorage,
  defaultSeriesResolver,
  drawingsProvider,
  indicatorsProvider,
} from '@market-chart/persistence';
import type { SaveStatus } from '@market-chart/persistence';
import { UiPreferencesStore, uiPreferencesProvider } from '@market-chart/ui';
import { ChartInterface } from '@market-chart/ui/react';
import { syntheticBars } from '../data';
import { useTheme } from '../site';
import { useTradingChart } from './useTradingChart';

const bars = syntheticBars('XAGUSD', 400);

/**
 * Add indicators and drawings, change settings, then reload the page: the layout (view, indicators,
 * drawings and interface preferences) is saved to localStorage automatically.
 */
export default function Persistence() {
  const theme = useTheme();
  const preferences = useMemo(() => new UiPreferencesStore(), []);
  const { chart, setChart, ui, drawings, indicators } = useTradingChart({ preferences });
  const [candles, setCandles] = useState<SeriesApi<'candlestick'> | null>(null);
  const [persistence, setPersistence] = useState<ChartPersistence | null>(null);
  const [status, setStatus] = useState<SaveStatus>('idle');

  useEffect(() => {
    if (!chart || !drawings || !indicators || !candles) return;
    const p = new ChartPersistence({
      chart,
      storage: createLocalStorage({ prefix: 'market-chart-docs:' }),
      id: 'persistence-example',
      debounceMs: 600,
      conflict: 'overwrite',
      providers: {
        indicators: indicatorsProvider(indicators, defaultSeriesResolver(chart)),
        drawings: drawingsProvider(drawings, () => candles.id),
        ui: uiPreferencesProvider(preferences),
      },
    });
    const off = p.on('status', (e) => setStatus(e.status));
    void p.load();
    setPersistence(p);
    return () => {
      off();
      p.destroy();
    };
  }, [chart, candles, drawings, indicators, preferences]);

  return (
    <>
      <div className="demo-toolbar">
        <span className="demo-note">
          layout: <b>{status}</b>
        </span>
        <button
          type="button"
          onClick={async () => {
            drawings?.clear();
            indicators?.list().forEach((i) => i.remove());
            preferences.reset();
            await persistence?.save();
          }}
        >
          Reset saved layout
        </button>
      </div>
      <ChartInterface ui={ui} height={480}>
        <Chart ref={setChart} theme={theme} height="100%">
          <CandlestickSeries data={bars} ref={setCandles} />
        </Chart>
      </ChartInterface>
    </>
  );
}
