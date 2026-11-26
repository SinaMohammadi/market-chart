import { useMemo, useState } from 'react';
import { CandlestickSeries, Chart } from '@market-chart/react';
import { symbolSearch } from '@market-chart/ui';
import type { ChartUi } from '@market-chart/ui';
import { ChartInterface, useSymbolSearch } from '@market-chart/ui/react';
import { useTheme } from '../site';
import { SIMULATED, SIMULATED_SYMBOLS, simulatedBars } from './simulated';
import { useTradingChart } from './useTradingChart';

const LIST = SIMULATED_SYMBOLS.slice(0, 200);
// `custom`: the library renders nothing; this component draws its own selector from the headless hook.
const features = [symbolSearch({ mode: 'custom', typeToSearch: false })];

function ChipSelector({ ui }: { ui: ChartUi | null }) {
  const search = useSymbolSearch(ui);
  const open = !!search.state?.open;
  return (
    <div className="chip-selector">
      <button type="button" onClick={() => (open ? search.close() : search.open())}>
        {search.current ?? '…'} ▾
      </button>
      {open ? (
        <div className="chip-panel">
          <input
            autoFocus
            placeholder="Filter…"
            aria-label="Filter symbols"
            {...search.inputProps}
          />
          <ul className="chips" {...search.listboxProps}>
            {search.state!.results.slice(0, 24).map((item, i) => (
              <li
                key={item.symbol}
                className="chip"
                data-active={search.state!.active === i}
                {...search.optionProps(i)}
              >
                {item.symbol.replace('SYN:', '')}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** A completely custom selector built on `useSymbolSearch` (state, keyboard and ARIA props). */
export default function CustomSymbolSelector() {
  const theme = useTheme();
  const [symbol, setSymbol] = useState('SYN:SOLUSDT');
  const extra = useMemo(
    () => ({ symbols: { value: () => symbol, set: setSymbol, list: () => LIST } }),
    [symbol],
  );
  const { setChart, ui } = useTradingChart({ features, extra });
  return (
    <>
      <p className="demo-note">{SIMULATED}.</p>
      <ChipSelector ui={ui} />
      <ChartInterface ui={ui} height={380} sidebar={false}>
        <Chart ref={setChart} theme={theme} height="100%">
          <CandlestickSeries data={simulatedBars(symbol, 300)} />
        </Chart>
      </ChartInterface>
    </>
  );
}
