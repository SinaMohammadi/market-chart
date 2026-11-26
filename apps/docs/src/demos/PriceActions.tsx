import { useEffect, useMemo, useState } from 'react';
import { CandlestickSeries, Chart } from '@market-chart/react';
import { TradingOverlay } from '@market-chart/trading/react';
import type { TradingAlert } from '@market-chart/trading';
import { orderTicket, priceActions } from '@market-chart/ui';
import { ChartInterface } from '@market-chart/ui/react';
import { useTheme } from '../site';
import { SIMULATED, SimulatedBroker, simulatedBars } from './simulated';
import { useTradingChart } from './useTradingChart';

const bars = simulatedBars('SYN:BTCUSDT', 300);
const features = [priceActions(), orderTicket()];

/**
 * Right-click the chart or press the "+" next to the price label: Buy limit / Sell limit (opening the order
 * ticket) and Create alert, at the price under the pointer, rounded to the tick size.
 */
export default function PriceActions() {
  const theme = useTheme();
  const broker = useMemo(() => new SimulatedBroker(), []);
  const [orders, setOrders] = useState(broker.orders);
  const [alerts, setAlerts] = useState<TradingAlert[]>([]);
  useEffect(() => broker.subscribe(() => setOrders(broker.orders)), [broker]);
  useEffect(() => () => broker.destroy(), [broker]);
  const extra = useMemo(
    () => ({
      trading: { submit: broker.submit, simulatedLabel: SIMULATED },
      alerts: {
        create: ({ price }: { price: number }) =>
          setAlerts((list) => [...list, { id: `alert-${list.length + 1}`, price, label: 'Alert' }]),
      },
    }),
    [broker],
  );
  const { setChart, ui } = useTradingChart({ features, extra });
  return (
    <>
      <p className="demo-note">
        {SIMULATED}. Right-click the chart, or hover it and press the + next to the price.
      </p>
      <ChartInterface ui={ui} height={440} sidebar={false}>
        <Chart ref={setChart} theme={theme} height="100%">
          <CandlestickSeries
            data={bars}
            options={{ priceFormat: { type: 'price', minMove: 0.5 } }}
          />
          {ui ? (
            <TradingOverlay
              ui={ui}
              orders={orders}
              alerts={alerts}
              onCancel={(object, info) =>
                info.kind === 'alert'
                  ? setAlerts((list) => list.filter((a) => a.id !== info.id))
                  : broker.cancel(object as (typeof orders)[number])
              }
            />
          ) : null}
        </Chart>
      </ChartInterface>
    </>
  );
}
