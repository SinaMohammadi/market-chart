import { useMemo, useState } from 'react';
import { CandlestickSeries, Chart } from '@market-chart/react';
import type { PriceMarker } from '@market-chart/trading';
import { TradingOverlay } from '@market-chart/trading/react';
import { ChartInterface } from '@market-chart/ui/react';
import { useTheme } from '../site';
import { SIMULATED, simulatedBars } from './simulated';
import { useTradingChart } from './useTradingChart';

const bars = simulatedBars('SYN:ETHUSDT', 300);
const last = bars[bars.length - 1]!.close;

/**
 * The application's own price objects: a liquidation price and a draggable break-even target, with a custom
 * label format and colours.
 */
export default function CustomMarkers() {
  const theme = useTheme();
  const [target, setTarget] = useState(Math.round(last * 1.04 * 100) / 100);
  const markers = useMemo<PriceMarker[]>(
    () => [
      {
        id: 'liq',
        kind: 'liquidation',
        price: Math.round(last * 0.9 * 100) / 100,
        color: '#e040fb',
        lineStyle: 'solid',
      },
      {
        id: 'target',
        kind: 'target',
        price: target,
        color: '#00bcd4',
        draggable: true,
        label: 'My target',
      },
    ],
    [target],
  );
  const { setChart, ui } = useTradingChart();
  return (
    <>
      <p className="demo-note">{SIMULATED}. Drag “My target”.</p>
      <ChartInterface ui={ui} height={420} sidebar={false}>
        <Chart ref={setChart} theme={theme} height="100%">
          <CandlestickSeries data={bars} />
          {ui ? (
            <TradingOverlay
              ui={ui}
              markers={markers}
              labelFormat={({ object, price }) => {
                const m = object as PriceMarker;
                return m.kind === 'liquidation'
                  ? ['⚠ LIQUIDATION', price]
                  : [m.label ?? 'Target', price];
              }}
              onModify={(_, price) => {
                setTarget(price);
                return true;
              }}
            />
          ) : null}
        </Chart>
      </ChartInterface>
    </>
  );
}
