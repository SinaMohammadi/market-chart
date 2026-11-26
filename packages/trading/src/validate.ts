import { safeText } from '@market-chart/core';
import type { LineStyle } from '@market-chart/core';
import type {
  OrderStatus,
  PriceMarker,
  TradingAlert,
  TradingOrder,
  TradingPosition,
  TradingPreferences,
} from './types.js';

export class TradingError extends Error {
  constructor(message: string) {
    super(`[market-chart/trading] ${message}`);
    this.name = 'TradingError';
  }
}

/** Most objects of one kind the overlay accepts (more are dropped and reported). */
export const MAX_TRADING_OBJECTS = 10_000;

const STATUSES: readonly OrderStatus[] = [
  'pending',
  'working',
  'partial',
  'filled',
  'cancelled',
  'rejected',
];
const LINE_STYLES: readonly LineStyle[] = ['solid', 'dashed', 'dotted'];

/**
 * CSS colours accepted for objects: hex, rgb(a)/hsl(a) with plain numbers, or a named colour. Anything else is
 * ignored (the default colour is used), so application data cannot smuggle other syntax into the canvas.
 */
const COLOR = /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla)\([0-9\s.,%deg/]{1,60}\)|[a-z]{3,24})$/i;

export function isSafeColor(value: unknown): value is string {
  return typeof value === 'string' && COLOR.test(value);
}

function id(value: unknown, what: string): string {
  if (typeof value !== 'string' && typeof value !== 'number')
    throw new TradingError(`${what} needs a string id`);
  const text = String(value);
  if (!text || text.length > 128 || safeText(text, 128) !== text)
    throw new TradingError(`${what} id must be 1–128 characters without control characters`);
  return text;
}

function finite(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new TradingError(`${what} must be a finite number, got ${String(value)}`);
  return value;
}

function optionalPrice(value: unknown, what: string): number | null {
  if (value === undefined || value === null) return null;
  return finite(value, what);
}

function side(value: unknown, what: string): 'buy' | 'sell' {
  if (value !== 'buy' && value !== 'sell')
    throw new TradingError(`${what} side must be "buy" or "sell"`);
  return value;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function obj(input: unknown, what: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new TradingError(`${what} must be an object`);
  return input as Record<string, unknown>;
}

/** Copies the optional common fields that passed validation. */
function common(raw: Record<string, unknown>, out: Record<string, unknown>): void {
  const label = safeText(raw['label'], 60);
  if (label) out['label'] = label;
  if (isSafeColor(raw['color'])) out['color'] = raw['color'];
  for (const key of ['draggable', 'cancellable'] as const) {
    const value = bool(raw[key]);
    if (value !== undefined) out[key] = value;
  }
  if ('meta' in raw) out['meta'] = raw['meta'];
}

/**
 * Validates an order from the application (or a server): id, side, finite price and non-negative quantity
 * are required; texts are cleaned and bounded; unknown colours are dropped. Throws `TradingError`.
 */
export function normalizeOrder(input: unknown): TradingOrder {
  const raw = obj(input, 'order');
  const out: Record<string, unknown> = {
    id: id(raw['id'], 'order'),
    side: side(raw['side'], 'order'),
    type: safeText(raw['type'] ?? 'limit', 24) || 'limit',
    price: finite(raw['price'], 'order price'),
    quantity: finite(raw['quantity'], 'order quantity'),
    status: STATUSES.includes(raw['status'] as OrderStatus) ? raw['status'] : 'working',
  };
  if ((out['quantity'] as number) < 0)
    throw new TradingError('order quantity must not be negative');
  common(raw, out);
  return out as unknown as TradingOrder;
}

export function normalizePosition(input: unknown): TradingPosition {
  const raw = obj(input, 'position');
  const out: Record<string, unknown> = {
    id: id(raw['id'], 'position'),
    side: side(raw['side'], 'position'),
    entryPrice: finite(raw['entryPrice'], 'position entryPrice'),
    quantity: finite(raw['quantity'], 'position quantity'),
  };
  if ((out['quantity'] as number) < 0)
    throw new TradingError('position quantity must not be negative');
  const tp = optionalPrice(raw['takeProfit'], 'position takeProfit');
  const sl = optionalPrice(raw['stopLoss'], 'position stopLoss');
  if (tp !== null) out['takeProfit'] = tp;
  if (sl !== null) out['stopLoss'] = sl;
  const pnl = safeText(raw['pnl'], 32);
  if (pnl) out['pnl'] = pnl;
  if (typeof raw['pnlValue'] === 'number' && Number.isFinite(raw['pnlValue']))
    out['pnlValue'] = raw['pnlValue'];
  common(raw, out);
  delete out['cancellable'];
  return out as unknown as TradingPosition;
}

export function normalizeAlert(input: unknown): TradingAlert {
  const raw = obj(input, 'alert');
  const out: Record<string, unknown> = {
    id: id(raw['id'], 'alert'),
    price: finite(raw['price'], 'alert price'),
  };
  const active = bool(raw['active']);
  if (active !== undefined) out['active'] = active;
  common(raw, out);
  return out as unknown as TradingAlert;
}

export function normalizeMarker(input: unknown): PriceMarker {
  const raw = obj(input, 'marker');
  const out: Record<string, unknown> = {
    id: id(raw['id'], 'marker'),
    price: finite(raw['price'], 'marker price'),
  };
  const kind = safeText(raw['kind'], 32);
  if (kind) out['kind'] = kind;
  if (LINE_STYLES.includes(raw['lineStyle'] as LineStyle)) out['lineStyle'] = raw['lineStyle'];
  const axisLabel = bool(raw['axisLabel']);
  if (axisLabel !== undefined) out['axisLabel'] = axisLabel;
  common(raw, out);
  return out as unknown as PriceMarker;
}

export const DEFAULT_TRADING_PREFERENCES: TradingPreferences = {
  orders: true,
  positions: true,
  alerts: true,
  markers: true,
  draggable: true,
  showQuantity: true,
  showPnl: true,
  showStatus: true,
  axisLabels: true,
  compact: 'auto',
  lineStyle: 'dashed',
};

/** Validates stored or imported preferences; invalid fields take the defaults. */
export function validateTradingPreferences(
  input: unknown,
  defaults: TradingPreferences = DEFAULT_TRADING_PREFERENCES,
): TradingPreferences {
  const raw =
    input && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const out: Record<string, unknown> = { ...defaults };
  for (const key of [
    'orders',
    'positions',
    'alerts',
    'markers',
    'draggable',
    'showQuantity',
    'showPnl',
    'showStatus',
    'axisLabels',
  ] as const) {
    if (typeof raw[key] === 'boolean') out[key] = raw[key];
  }
  if (raw['compact'] === 'auto' || raw['compact'] === 'always' || raw['compact'] === 'never')
    out['compact'] = raw['compact'];
  if (LINE_STYLES.includes(raw['lineStyle'] as LineStyle)) out['lineStyle'] = raw['lineStyle'];
  return out as unknown as TradingPreferences;
}
