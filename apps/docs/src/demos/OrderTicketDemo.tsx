import { useEffect, useMemo, useState } from 'react';
import { CandlestickSeries, Chart } from '@market-chart/react';
import { TradingOverlay } from '@market-chart/trading/react';
import { orderTicket, priceActions } from '@market-chart/ui';
import type { TicketField } from '@market-chart/ui';
import { ChartInterface } from '@market-chart/ui/react';
import { useTheme } from '../site';
import { SIMULATED, SimulatedBroker, simulatedBars } from './simulated';
import { useTradingChart } from './useTradingChart';

const bars = simulatedBars('SYN:EURUSD', 300);
const features = [priceActions(), orderTicket()];

// The application declares the fields and their validation.
const FIELDS: TicketField[] = [
  { id: 'side', label: 'order.side', kind: 'side', required: true },
  {
    id: 'type',
    label: 'order.type',
    kind: 'select',
    required: true,
    options: [
      { value: 'limit', label: 'order.type.limit' },
      { value: 'stop', label: 'order.type.stop' },
    ],
  },
  { id: 'price', label: 'order.price', kind: 'price', required: true },
  {
    id: 'quantity',
    label: 'order.quantity',
    kind: 'number',
    required: true,
    min: 1,
    max: 1000,
    step: 1,
  },
  {
    id: 'note',
    label: 'Note (optional)',
    kind: 'text',
    maxLength: 40,
    validate: (value) =>
      typeof value === 'string' && /https?:/i.test(value) ? 'No links in notes' : null,
  },
];

/**
 * The order ticket with a simulated broker: about 20% of orders are rejected at random, quantities above 100
 * are always rejected, latency 0.3–0.8 s. Confirmation is on; this demo lets users switch it off in
 * Settings › Trading.
 */
export default function OrderTicketDemo() {
  const theme = useTheme();
  const broker = useMemo(() => new SimulatedBroker({ rejectRate: 0.2 }), []);
  const [orders, setOrders] = useState(broker.orders);
  useEffect(() => broker.subscribe(() => setOrders(broker.orders)), [broker]);
  useEffect(() => () => broker.destroy(), [broker]);
  const extra = useMemo(
    () => ({
      trading: {
        submit: broker.submit,
        fields: FIELDS,
        defaultQuantity: 10,
        allowSkipConfirmation: true,
        simulatedLabel: SIMULATED,
      },
    }),
    [broker],
  );
  const { setChart, ui } = useTradingChart({ features, extra });
  const openTicket = () => {
    const last = bars[bars.length - 1]!.close;
    const price = ui?.priceActions?.contextAt({ price: last * 0.998, pane: 0 }) ?? null;
    ui?.orderTicket?.open({ side: 'buy', type: 'limit', price });
  };
  return (
    <>
      <p className="demo-note">{SIMULATED}.</p>
      <div className="demo-toolbar">
        <button type="button" onClick={openTicket} disabled={!ui}>
          Open order ticket
        </button>
      </div>
      <ChartInterface ui={ui} height={420} sidebar={false}>
        <Chart ref={setChart} theme={theme} height="100%">
          <CandlestickSeries
            data={bars}
            options={{ priceFormat: { type: 'price', minMove: 0.0001 } }}
          />
          {ui ? (
            <TradingOverlay
              ui={ui}
              orders={orders}
              onCancel={(o) => broker.cancel(o as (typeof orders)[number])}
            />
          ) : null}
        </Chart>
      </ChartInterface>
    </>
  );
}
