import { useEffect, useMemo, useState } from 'react';
import { Chart, ChartProvider } from '@market-chart/react';
import { createSyntheticDatafeed } from '@market-chart/datafeed';
import { DatafeedSeries } from '@market-chart/datafeed/react';
import type { DatafeedState } from '@market-chart/datafeed/react';
import {
  ChartPersistence,
  createLocalStorage,
  defaultSeriesResolver,
  drawingsProvider,
  indicatorsProvider,
} from '@market-chart/persistence';
import type { SaveStatus } from '@market-chart/persistence';
import { UiPreferencesStore, uiPreferencesProvider, validateUiPreferences } from '@market-chart/ui';
import type { UiPreferences } from '@market-chart/ui';
import { ChartInterface } from '@market-chart/ui/react';
import { useDemoChart } from './ui-common';

const SYMBOLS = ['SYN:BTCUSD', 'SYN:ETHUSD', 'SYN:ACME', 'SYN:EURUSD'];
const TIMEFRAMES = ['5m', '15m', '1h', '4h', '1D'];

/**
 * Demo 9: everything together. A synthetic datafeed (symbol and timeframe from the header), indicators and
 * drawings, the context menu, settings, and one layout saved to localStorage: chart view, indicators, drawings
 * and interface preferences (language, toolbars, menus) through `ChartPersistence` providers.
 */
export function UiIntegratedExample() {
  return (
    <ChartProvider locale="en">
      <Inner />
    </ChartProvider>
  );
}

function Inner() {
  const datafeed = useMemo(() => createSyntheticDatafeed({ latencyMs: 120 }), []);
  const preferences = useMemo(
    () =>
      new UiPreferencesStore({
        storage: createLocalStorage<UiPreferences>({
          prefix: 'market-chart:playground:',
          validate: validateUiPreferences,
        }),
        id: 'ui-integrated-preferences',
      }),
    [],
  );
  const [symbol, setSymbol] = useState(SYMBOLS[0]!);
  const [timeframe, setTimeframe] = useState('1h');
  const [feed, setFeed] = useState<DatafeedState | null>(null);
  const [persistence, setPersistence] = useState<ChartPersistence | null>(null);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const extra = useMemo(
    () => ({
      symbol: {
        value: () => symbol,
        options: () => SYMBOLS.map((s) => ({ value: s, label: s })),
        set: setSymbol,
      },
      timeframe: { value: () => timeframe, options: TIMEFRAMES, set: setTimeframe },
      ...(persistence ? { saveLayout: () => persistence.save() } : {}),
      alerts: {
        create: ({ price }: { price: number }) =>
          demo.ui?.notify(`Alert created at ${price.toFixed(2)} (demo: no backend)`),
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [symbol, timeframe, persistence],
  );
  const demo = useDemoChart({ preferences, extra });

  useEffect(() => {
    const { chart, indicators, drawings } = demo;
    if (!chart || !indicators || !drawings || !feed?.series) return;
    const series = feed.series;
    const p = new ChartPersistence({
      chart,
      storage: createLocalStorage({ prefix: 'market-chart:playground:' }),
      id: 'ui-integrated-layout',
      debounceMs: 800,
      conflict: 'overwrite',
      getContext: () => ({ symbol, interval: timeframe }),
      providers: {
        indicators: indicatorsProvider(indicators, defaultSeriesResolver(chart)),
        drawings: drawingsProvider(drawings, () => series.id),
        ui: uiPreferencesProvider(preferences),
      },
    });
    const off = p.on('status', (e) => setStatus(e.status));
    void p.load().then((found) => {
      if (!found && indicators.list().length === 0)
        indicators.add('ema', series, { params: { length: 21 } });
    });
    setPersistence(p);
    return () => {
      off();
      p.destroy();
      setPersistence(null);
    };
    // The layout follows the chart and its main series.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo.chart, demo.indicators, demo.drawings, feed?.series, preferences]);

  return (
    <>
      <p className="desc">
        Layout {status}. Change language, toolbars or the sidebar in Settings, add indicators and
        drawings, then reload the page: everything comes back. Symbol and timeframe are header
        selects backed by the datafeed.
      </p>
      <ChartInterface ui={demo.ui} height={600}>
        <Chart ref={demo.setChart} height="100%">
          <DatafeedSeries
            datafeed={datafeed}
            symbol={symbol}
            interval={timeframe}
            onStateChange={setFeed}
          />
        </Chart>
      </ChartInterface>
    </>
  );
}
