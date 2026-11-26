import { useMemo, useState } from 'react';
import { CandlestickSeries, Chart } from '@market-chart/react';
import { symbolSearch } from '@market-chart/ui';
import { ChartInterface } from '@market-chart/ui/react';
import { useTheme } from '../site';
import { SIMULATED, SIMULATED_SYMBOLS, simulatedBars } from './simulated';
import { useTradingChart } from './useTradingChart';

// A short static list: filtered locally as the user types.
const LIST = SIMULATED_SYMBOLS.filter((s) => s.group !== 'stocks').slice(0, 40);
const features = [symbolSearch({ mode: 'dropdown' })];

/** Header dropdown over a static list (favorites and recents are saved in the user's preferences). */
export default function SymbolDropdown() {
  const theme = useTheme();
  const [symbol, setSymbol] = useState('SYN:BTCUSDT');
  const extra = useMemo(
    () => ({ symbols: { value: () => symbol, set: setSymbol, list: () => LIST } }),
    [symbol],
  );
  const { setChart, ui } = useTradingChart({ features, extra });
  return (
    <>
      <p className="demo-note">{SIMULATED}. Click the symbol in the header, or press Ctrl/⌘+K.</p>
      <ChartInterface ui={ui} height={420} sidebar={false}>
        <Chart ref={setChart} theme={theme} height="100%">
          <CandlestickSeries data={simulatedBars(symbol, 300)} />
        </Chart>
      </ChartInterface>
    </>
  );
}
