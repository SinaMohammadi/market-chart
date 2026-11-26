import { useEffect, useMemo, useState } from 'react';
import { CandlestickSeries, Chart } from '@market-chart/react';
import type { TradingOrder, TradingPosition } from '@market-chart/trading';
import { TradingOverlay } from '@market-chart/trading/react';
import { ChartInterface } from '@market-chart/ui/react';
import { useTheme } from '../site';
import { SIMULATED, SimulatedBroker, simulatedBars } from './simulated';
import { useTradingChart } from './useTradingChart';

const bars = simulatedBars('SYN:SOLUSDT', 300);
const last = bars[bars.length - 1]!.close;
const round = (p: number) => Math.round(p * 100) / 100;

/**
 * Orders and a position with take-profit and stop-loss. Drag a line to modify it (pending until the
 * simulated broker answers; it snaps back on a rejection), × cancels, right-click for the order menu,
 * hover for details. Statuses change in realtime.
 */
export default function TradingObjects() {
  const theme = useTheme();
  const broker = useMemo(() => {
    const b = new SimulatedBroker({ rejectRate: 0.25 });
    b.orders = [
      {
        id: 'SIM-A',
        side: 'buy',
        type: 'limit',
        price: round(last * 0.97),
        quantity: 5,
        status: 'working',
      },
      {
        id: 'SIM-B',
        side: 'sell',
        type: 'limit',
        price: round(last * 1.03),
        quantity: 3,
        status: 'working',
      },
      {
        id: 'SIM-C',
        side: 'buy',
        type: 'stop',
        price: round(last * 1.05),
        quantity: 2,
        status: 'pending',
      },
    ];
    return b;
  }, []);
  const [orders, setOrders] = useState<TradingOrder[]>(broker.orders);
  const [position, setPosition] = useState<TradingPosition>({
    id: 'POS-1',
    side: 'buy',
    entryPrice: round(last * 0.99),
    quantity: 4,
    takeProfit: round(last * 1.06),
    stopLoss: round(last * 0.94),
  });
  useEffect(() => broker.subscribe(() => setOrders(broker.orders)), [broker]);
  useEffect(() => () => broker.destroy(), [broker]);
  // Realtime: the simulated P&L ticks and order statuses change every second.
  useEffect(() => {
    let n = 0;
    const timer = setInterval(() => {
      n++;
      const value = Math.round((Math.sin(n / 3) * 40 + 12) * 100) / 100;
      setPosition((p) => ({
        ...p,
        pnl: `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(2)} USD`,
        pnlValue: value,
      }));
      const target = broker.orders[n % Math.max(1, broker.orders.length)];
      if (target && target.status !== 'cancelled')
        broker.update(target.id, { status: target.status === 'partial' ? 'working' : 'partial' });
    }, 1000);
    return () => clearInterval(timer);
  }, [broker]);
  const { setChart, ui } = useTradingChart();
  const positions = useMemo(() => [position], [position]);
  return (
    <>
      <p className="demo-note">{SIMULATED}.</p>
      <ChartInterface ui={ui} height={460} sidebar={false}>
        <Chart ref={setChart} theme={theme} height="100%">
          <CandlestickSeries data={bars} />
          {ui ? (
            <TradingOverlay
              ui={ui}
              orders={orders}
              positions={positions}
              onModify={async (object, price, info) => {
                if (info.kind === 'order') return broker.modify(object as TradingOrder, price);
                // Take-profit / stop-loss: accepted after a short delay.
                await new Promise((r) => setTimeout(r, 300));
                setPosition((p) => ({ ...p, [info.part]: price }));
                return true;
              }}
              onCancel={(object, info) =>
                info.kind === 'order'
                  ? broker.cancel(object as TradingOrder)
                  : setPosition((p) => ({ ...p, [info.part]: null }))
              }
              onClosePosition={() => setPosition((p) => ({ ...p, quantity: 0, pnl: 'closed' }))}
              onEdit={(object) =>
                ui.notify(
                  `Edit ${'id' in object ? object.id : ''} (the application opens its own editor)`,
                )
              }
            />
          ) : null}
        </Chart>
      </ChartInterface>
    </>
  );
}
