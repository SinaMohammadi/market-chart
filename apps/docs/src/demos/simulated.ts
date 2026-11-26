/**
 * SIMULATED symbols and a SIMULATED broker for the documentation examples. Nothing here talks to a network,
 * an exchange or a broker: symbols are generated, "orders" live in memory, latency and rejections are random.
 * Your application provides the real versions (the library never trades).
 */
import type {
  OrderSubmitResult,
  OrderTicketSubmission,
  SymbolItem,
  SymbolSearchRequest,
} from '@market-chart/ui';
import type { TradingOrder, TradingPosition } from '@market-chart/trading';
import type { OhlcBar } from '@market-chart/core';
import { HOUR, generateBars, syntheticAssets } from '@market-chart/testing';
import { syntheticBars } from '../data';

export const SIMULATED = 'SIMULATED — nothing is sent to a real market';

export const SYMBOL_GROUPS = [
  { id: 'crypto', label: 'Crypto' },
  { id: 'forex', label: 'Forex' },
  { id: 'stocks', label: 'Stocks' },
] as const;

const CRYPTO = ['BTC', 'ETH', 'SOL', 'ADA', 'XRP', 'DOT', 'AVAX', 'LINK', 'ATOM', 'NEAR'];
const FX = ['EUR', 'USD', 'GBP', 'JPY', 'CHF', 'AUD', 'CAD', 'NZD'];
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** About 3,000 generated symbols (enough to show the virtualised list). */
export const SIMULATED_SYMBOLS: readonly SymbolItem[] = (() => {
  const out: SymbolItem[] = [];
  for (const c of CRYPTO)
    for (const q of ['USDT', 'USD', 'EUR'])
      out.push({
        symbol: `SYN:${c}${q}`,
        name: `${c} / ${q} (synthetic)`,
        exchange: 'SIM',
        type: 'crypto',
        group: 'crypto',
        ...(q === 'USDT' ? { badge: 'PERP' } : {}),
      });
  for (const a of FX)
    for (const b of FX)
      if (a !== b)
        out.push({
          symbol: `SYN:${a}${b}`,
          name: `${a} / ${b} (synthetic)`,
          exchange: 'SIM',
          type: 'forex',
          group: 'forex',
        });
  for (let i = 0; out.length < 3000; i++) {
    const code =
      LETTERS[i % 26]! + LETTERS[Math.floor(i / 26) % 26]! + LETTERS[Math.floor(i / 676) % 26]!;
    out.push({
      symbol: `SYN:${code}`,
      name: `${code} Industries (synthetic)`,
      exchange: 'SIM',
      type: 'stock',
      group: 'stocks',
    });
  }
  return out;
})();

const barCache = new Map<string, OhlcBar[]>();

/** SYNTHETIC bars for any simulated symbol: the testing presets where they exist, else a seeded random walk. */
export function simulatedBars(symbol: string, count = 300): OhlcBar[] {
  const name = symbol.replace(/^SYN:/, '');
  if (syntheticAssets[name]) return syntheticBars(name, count);
  const key = `${symbol}:${count}`;
  let bars = barCache.get(key);
  if (!bars) {
    let hash = 7;
    for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    bars = generateBars({
      count,
      interval: HOUR,
      seed: hash,
      startPrice: 20 + (hash % 400),
      volatility: 0.01,
    });
    barCache.set(key, bars);
  }
  return bars;
}

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });

/**
 * A server-like search: 150–400 ms latency, honours the abort signal, filters by group and query. Type
 * "error" to see the error state.
 */
export async function simulatedSearch(
  query: string,
  request: SymbolSearchRequest,
): Promise<SymbolItem[]> {
  await wait(150 + Math.random() * 250, request.signal);
  if (query.toLowerCase().includes('error'))
    throw new Error('Simulated server error (type something else)');
  const q = query.trim().toUpperCase();
  return SIMULATED_SYMBOLS.filter(
    (s) =>
      (!request.group || s.group === request.group) &&
      (!q || s.symbol.includes(q) || s.name!.toUpperCase().includes(q)),
  ).slice(0, request.limit);
}

let orderId = 0;

/** In-memory "broker": accepts, rejects and fills orders after a delay. Listeners get every change. */
export class SimulatedBroker {
  orders: TradingOrder[] = [];
  positions: TradingPosition[] = [];
  private listeners = new Set<() => void>();
  private timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(readonly options: { latencyMs?: number; rejectRate?: number } = {}) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The application's `trading.submit`: validates like a real broker would, then answers. */
  submit = async (ticket: OrderTicketSubmission): Promise<OrderSubmitResult> => {
    await wait(this.latency());
    const quantity = Number(ticket.values['quantity']);
    const price = Number(ticket.values['price']);
    if (quantity > 100) return { ok: false, message: 'Simulated rejection: quantity above 100' };
    if (Math.random() < (this.options.rejectRate ?? 0.2))
      return { ok: false, message: 'Simulated rejection: the market is closed (random)' };
    const id = `SIM-${++orderId}`;
    const order: TradingOrder = {
      id,
      side: ticket.side,
      type: ticket.type,
      price,
      quantity,
      status: 'pending',
    };
    this.orders = [...this.orders, order];
    this.emit();
    this.later(400, () => this.update(id, { status: 'working' }));
    return { ok: true, message: `Simulated order ${id} accepted` };
  };

  /** `onModify` of the overlay: accepts after the latency, rejects at random. */
  modify = async (order: TradingOrder, price: number): Promise<boolean> => {
    await wait(this.latency());
    if (Math.random() < (this.options.rejectRate ?? 0.2))
      throw new Error('Simulated rejection: price moved');
    this.update(order.id, { price });
    return true;
  };

  cancel = async (order: TradingOrder): Promise<void> => {
    await wait(this.latency());
    this.update(order.id, { status: 'cancelled' });
    this.later(300, () => {
      this.orders = this.orders.filter((o) => o.id !== order.id);
      this.emit();
    });
  };

  add(order: TradingOrder): void {
    this.orders = [...this.orders, order];
    this.emit();
  }

  update(id: string, patch: Partial<TradingOrder>): void {
    this.orders = this.orders.map((o) => (o.id === id ? { ...o, ...patch } : o));
    this.emit();
  }

  destroy(): void {
    this.timers.forEach(clearTimeout);
    this.listeners.clear();
  }

  private latency(): number {
    return this.options.latencyMs ?? 300 + Math.random() * 500;
  }

  private later(ms: number, fn: () => void): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      fn();
    }, ms);
    this.timers.add(timer);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
