import { useEffect, useMemo, useState } from 'react';
import { CandlestickSeries, Chart, ChartProvider } from '@market-chart/react';
import type { OhlcBar } from '@market-chart/core';
import { HOUR, generateBars } from '@market-chart/testing';
import type { PriceMarker, TradingOrder, TradingPosition } from '@market-chart/trading';
import { TradingOverlay } from '@market-chart/trading/react';
import { UiPreferencesStore, orderTicket, priceActions, symbolSearch } from '@market-chart/ui';
import type {
  OrderTicketSubmission,
  SymbolItem,
  SymbolSearchRequest,
  UiPreferences,
} from '@market-chart/ui';
import { createLocalStorage } from '@market-chart/persistence';
import { validateUiPreferences } from '@market-chart/ui';
import { ChartInterface } from '@market-chart/ui/react';
import { useDemoChart } from './ui-common';

/*
 * SIMULATED trading demo. Nothing here talks to a network or a broker: symbols are generated, orders live in
 * component state, latency and rejections are random. The library never trades.
 */
const SIMULATED = 'SIMULATED — nothing is sent to a real market';
const GROUPS = [
  { id: 'crypto', label: 'Crypto' },
  { id: 'stocks', label: 'Stocks' },
];
const SYMBOLS: SymbolItem[] = Array.from({ length: 5000 }, (_, i) => {
  const crypto = i < 200;
  const code = crypto ? `C${i}USDT` : `S${String(i).padStart(4, '0')}`;
  return {
    symbol: `SYN:${code}`,
    name: `${crypto ? 'Coin' : 'Stock'} ${i} (synthetic)`,
    group: crypto ? 'crypto' : 'stocks',
    exchange: 'SIM',
  };
});
const barsCache = new Map<string, OhlcBar[]>();
function barsOf(symbol: string): OhlcBar[] {
  let bars = barsCache.get(symbol);
  if (!bars) {
    let seed = 1;
    for (const ch of symbol) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    bars = generateBars({
      count: 400,
      interval: HOUR,
      seed,
      startPrice: 50 + (seed % 300),
      volatility: 0.01,
    });
    barsCache.set(symbol, bars);
  }
  return bars;
}
const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });
async function search(query: string, { signal, limit, group }: SymbolSearchRequest) {
  await wait(120 + Math.random() * 300, signal);
  if (query.toLowerCase() === 'error') throw new Error('Simulated server error');
  const q = query.toUpperCase();
  return SYMBOLS.filter((s) => (!group || s.group === group) && s.symbol.includes(q)).slice(
    0,
    limit,
  );
}
const features = [symbolSearch({ mode: 'both' }), priceActions({ shortcuts: true }), orderTicket()];
let nextId = 1;
const round = (p: number) => Math.round(p * 100) / 100;

export function TradingExample() {
  return (
    <ChartProvider locale="en">
      <Inner />
    </ChartProvider>
  );
}

function Inner() {
  const preferences = useMemo(
    () =>
      new UiPreferencesStore({
        storage: createLocalStorage<UiPreferences>({
          prefix: 'mc-playground-trading:',
          validate: validateUiPreferences,
        }),
      }),
    [],
  );
  useEffect(() => {
    void preferences.load();
  }, [preferences]);
  const [symbol, setSymbol] = useState('SYN:C1USDT');
  const bars = barsOf(symbol);
  const last = bars[bars.length - 1]!.close;
  const [orders, setOrders] = useState<TradingOrder[]>(() => [
    { id: 'SIM-A', side: 'buy', type: 'limit', price: round(last * 0.97), quantity: 3 },
    {
      id: 'SIM-B',
      side: 'sell',
      type: 'stop',
      price: round(last * 0.95),
      quantity: 1,
      status: 'pending',
    },
  ]);
  const [position, setPosition] = useState<TradingPosition>({
    id: 'POS',
    side: 'buy',
    entryPrice: round(last * 0.99),
    quantity: 2,
    takeProfit: round(last * 1.05),
    stopLoss: round(last * 0.93),
  });
  const [markers] = useState<PriceMarker[]>([
    { id: 'liq', price: round(last * 0.85), label: 'Liquidation', color: '#e040fb' },
  ]);
  const [alerts, setAlerts] = useState<{ id: string; price: number }[]>([]);
  const [stress, setStress] = useState(false);

  // Realtime: P&L text and statuses change every 500 ms (with 1,000 orders in stress mode).
  useEffect(() => {
    const timer = setInterval(() => {
      setPosition((p) => {
        const v = round((Math.random() - 0.4) * 50);
        return { ...p, pnl: `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`, pnlValue: v };
      });
      setOrders((list) =>
        list.map((o, i) =>
          i % 7 === Math.floor(Math.random() * 7)
            ? { ...o, status: o.status === 'partial' ? 'working' : 'partial' }
            : o,
        ),
      );
    }, 500);
    return () => clearInterval(timer);
  }, []);

  const toggleStress = () => {
    setStress((s) => !s);
    setOrders((list) =>
      stress
        ? list.filter((o) => !o.id.startsWith('STRESS'))
        : [
            ...list,
            ...Array.from({ length: 1000 }, (_, i): TradingOrder => ({
              id: `STRESS-${i}`,
              side: i % 2 ? 'sell' : 'buy',
              type: 'limit',
              price: round(last * (0.9 + (0.2 * i) / 1000)),
              quantity: 1 + (i % 5),
            })),
          ],
    );
  };

  const submit = async (ticket: OrderTicketSubmission) => {
    await wait(300 + Math.random() * 600);
    if (Math.random() < 0.2) return { ok: false, message: 'Simulated rejection (random)' };
    const id = `SIM-${nextId++}`;
    setOrders((list) => [
      ...list,
      {
        id,
        side: ticket.side,
        type: ticket.type,
        price: Number(ticket.values['price']),
        quantity: Number(ticket.values['quantity']),
        status: 'pending',
      },
    ]);
    setTimeout(
      () => setOrders((list) => list.map((o) => (o.id === id ? { ...o, status: 'working' } : o))),
      600,
    );
    return { ok: true, message: `Simulated order ${id} accepted` };
  };

  const extra = useMemo(
    () => ({
      symbols: { value: () => symbol, set: setSymbol, search, groups: GROUPS },
      trading: { submit, allowSkipConfirmation: true, simulatedLabel: SIMULATED },
      alerts: {
        create: ({ price }: { price: number }) =>
          setAlerts((a) => [...a, { id: `AL-${nextId++}`, price }]),
      },
    }),
    [symbol],
  );
  const { setChart, ui } = useDemoChart({ preferences, features, extra });
  const positions = useMemo(() => [position], [position]);

  return (
    <>
      <div className="toolbar">
        <strong>{SIMULATED}</strong>
        <button type="button" onClick={toggleStress}>
          {stress ? 'Remove the 1,000 orders' : 'Add 1,000 orders (performance)'}
        </button>
      </div>
      <ChartInterface ui={ui} height={560}>
        <Chart ref={setChart} height="100%">
          <CandlestickSeries data={bars} />
          {ui ? (
            <TradingOverlay
              ui={ui}
              orders={orders}
              positions={positions}
              alerts={alerts}
              markers={markers}
              onModify={async (object, price, info) => {
                await wait(400);
                if (Math.random() < 0.25) throw new Error('Simulated rejection: price moved');
                if (info.kind === 'order')
                  setOrders((l) => l.map((o) => (o.id === info.id ? { ...o, price } : o)));
                else if (info.kind === 'position')
                  setPosition((p) => ({ ...p, [info.part]: price }));
                else if (info.kind === 'alert')
                  setAlerts((l) => l.map((a) => (a.id === info.id ? { ...a, price } : a)));
                return true;
              }}
              onCancel={async (_object, info) => {
                await wait(300);
                if (info.kind === 'order') setOrders((l) => l.filter((o) => o.id !== info.id));
                else if (info.kind === 'alert') setAlerts((l) => l.filter((a) => a.id !== info.id));
                else if (info.kind === 'position')
                  setPosition((p) => ({ ...p, [info.part]: null }));
              }}
              onClosePosition={() => setPosition((p) => ({ ...p, quantity: 0, pnl: 'closed' }))}
              onEdit={(object) =>
                ui.notify(`Edit ${(object as { id: string }).id} (your editor opens here)`)
              }
            />
          ) : null}
        </Chart>
      </ChartInterface>
    </>
  );
}
