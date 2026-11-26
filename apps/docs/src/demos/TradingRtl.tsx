import { useEffect, useMemo, useState } from 'react';
import { CandlestickSeries, Chart, ChartProvider } from '@market-chart/react';
import type { TradingOrder } from '@market-chart/trading';
import { TradingOverlay } from '@market-chart/trading/react';
import { orderTicket, priceActions, symbolSearch } from '@market-chart/ui';
import { ChartInterface } from '@market-chart/ui/react';
import { useTheme } from '../site';
import { SIMULATED, SIMULATED_SYMBOLS, SimulatedBroker, simulatedBars } from './simulated';
import { useTradingChart } from './useTradingChart';

const features = [symbolSearch({ mode: 'both' }), priceActions(), orderTicket()];
const LIST = SIMULATED_SYMBOLS.slice(0, 60);

function PersianTrading() {
  const theme = useTheme();
  const [symbol, setSymbol] = useState('SYN:BTCUSDT');
  const bars = simulatedBars(symbol, 300);
  const broker = useMemo(() => {
    const b = new SimulatedBroker({ rejectRate: 0.2 });
    const last = bars[bars.length - 1]!.close;
    b.orders = [
      {
        id: 'SIM-1',
        side: 'buy',
        type: 'limit',
        price: Math.round(last * 0.97 * 100) / 100,
        quantity: 2,
        status: 'pending',
      },
    ];
    return b;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [orders, setOrders] = useState<TradingOrder[]>(broker.orders);
  useEffect(() => broker.subscribe(() => setOrders(broker.orders)), [broker]);
  useEffect(() => () => broker.destroy(), [broker]);
  const extra = useMemo(
    () => ({
      symbols: { value: () => symbol, set: setSymbol, list: () => LIST },
      trading: {
        submit: broker.submit,
        simulatedLabel: 'شبیه سازی شده — هیچ سفارشی به بازار واقعی ارسال نمی شود',
      },
    }),
    [symbol, broker],
  );
  const { setChart, ui } = useTradingChart({ features, extra });
  return (
    <ChartInterface ui={ui} height={460}>
      <Chart ref={setChart} theme={theme} height="100%" syncLocale="digits">
        <CandlestickSeries data={bars} />
        {ui ? (
          <TradingOverlay
            ui={ui}
            orders={orders}
            onModify={(o, price) => broker.modify(o as TradingOrder, price)}
            onCancel={(o) => broker.cancel(o as TradingOrder)}
          />
        ) : null}
      </Chart>
    </ChartInterface>
  );
}

/** The symbol search, price actions, order ticket and order lines in Persian, right to left. */
export default function TradingRtl() {
  return (
    <>
      <p className="demo-note">{SIMULATED}.</p>
      <ChartProvider locale="fa">
        <PersianTrading />
      </ChartProvider>
    </>
  );
}
