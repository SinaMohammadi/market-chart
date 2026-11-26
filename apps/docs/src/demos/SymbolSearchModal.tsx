import { useMemo, useState } from 'react';
import { CandlestickSeries, Chart, LineSeries } from '@market-chart/react';
import { symbolSearch } from '@market-chart/ui';
import type { SymbolItem } from '@market-chart/ui';
import { ChartInterface } from '@market-chart/ui/react';
import { closes } from '../data';
import { useTheme } from '../site';
import { SIMULATED, SYMBOL_GROUPS, simulatedBars, simulatedSearch } from './simulated';
import { useTradingChart } from './useTradingChart';

const features = [symbolSearch({ mode: 'modal', groupOrder: ['stocks', 'crypto', 'forex'] })];
const COLORS = ['#ff9800', '#ab47bc', '#26c6da'];

/**
 * Search dialog over a server-like async search (latency, cancellation, errors: type "error"), group tabs,
 * favorites, recents, and "Compare" adding a comparison series. Start typing on the chart to search.
 */
export default function SymbolSearchModal() {
  const theme = useTheme();
  const [symbol, setSymbol] = useState('SYN:ETHUSDT');
  const [compared, setCompared] = useState<string[]>([]);
  const extra = useMemo(
    () => ({
      symbols: {
        value: () => symbol,
        set: setSymbol,
        search: simulatedSearch,
        groups: SYMBOL_GROUPS,
      },
      compare: {
        add: (item: SymbolItem) =>
          setCompared((list) =>
            list.includes(item.symbol) ? list : [...list, item.symbol].slice(-3),
          ),
      },
    }),
    [symbol],
  );
  const { setChart, ui } = useTradingChart({ features, extra });
  return (
    <>
      <p className="demo-note">
        {SIMULATED}. Click the search button, press Ctrl/⌘+K or start typing on the chart.
      </p>
      <ChartInterface ui={ui} height={440} sidebar={false}>
        <Chart ref={setChart} theme={theme} height="100%">
          <CandlestickSeries data={simulatedBars(symbol, 300)} />
          {compared.map((s, i) => (
            <LineSeries
              key={s}
              data={closes(simulatedBars(s, 300))}
              options={{ priceScaleId: 'compare', color: COLORS[i], title: s, lineWidth: 1 }}
            />
          ))}
        </Chart>
      </ChartInterface>
    </>
  );
}
