import { useEffect, useMemo, useState } from 'react';
import { Chart } from '@market-chart/react';
import { createSyntheticDatafeed } from '@market-chart/datafeed';
import { DatafeedSeries } from '@market-chart/datafeed/react';
import type { DatafeedState } from '@market-chart/datafeed/react';
import { UiPreferencesStore } from '@market-chart/ui';
import { ChartInterface } from '@market-chart/ui/react';
import { useTheme } from '../site';
import { useTradingChart } from './useTradingChart';

const SYMBOLS = ['SYN:BTCUSD', 'SYN:ETHUSD', 'SYN:EXAMPLE', 'SYN:EURUSD'];
const TIMEFRAMES = ['5m', '15m', '1h', '4h', '1D'];

/**
 * The complete interface: header (symbol, timeframe, indicators, drawing tools, undo/redo, language,
 * settings, screenshot, export, fullscreen), drawing sidebar, legend, context menus and a synthetic realtime
 * datafeed. Right-click anything on the chart.
 */
export default function FullInterface({ height = 560 }: { height?: number }) {
  const theme = useTheme();
  const datafeed = useMemo(() => createSyntheticDatafeed({ latencyMs: 80 }), []);
  // Application defaults for the user's preferences: here, high/low labels on.
  const preferences = useMemo(
    () => new UiPreferencesStore({ defaults: { markers: { highLow: true } } }),
    [],
  );
  const [symbol, setSymbol] = useState(SYMBOLS[0]!);
  const [timeframe, setTimeframe] = useState('1h');
  const [feed, setFeed] = useState<DatafeedState | null>(null);
  const extra = useMemo(
    () => ({
      symbol: {
        value: () => symbol,
        options: () => SYMBOLS.map((s) => ({ value: s, label: s })),
        set: setSymbol,
      },
      timeframe: { value: () => timeframe, options: TIMEFRAMES, set: setTimeframe },
    }),
    [symbol, timeframe],
  );
  const { setChart, ui, indicators } = useTradingChart({ preferences, extra });

  // Two indicators to start with; users add more from the header or the context menu.
  useEffect(() => {
    const series = feed?.series;
    if (!indicators || !series || indicators.list().length) return;
    indicators.add('ema', series, { params: { length: 21 } });
    indicators.add('rsi', series);
  }, [indicators, feed?.series]);

  return (
    <ChartInterface ui={ui} height={height}>
      <Chart ref={setChart} theme={theme} height="100%">
        <DatafeedSeries
          datafeed={datafeed}
          symbol={symbol}
          interval={timeframe}
          onStateChange={setFeed}
        />
      </Chart>
    </ChartInterface>
  );
}
