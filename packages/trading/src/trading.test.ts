import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRADING_PREFERENCES,
  TradingError,
  defaultLabel,
  defaultTooltip,
  formatQuantity,
  isSafeColor,
  layoutTradingLabels,
  normalizeAlert,
  normalizeMarker,
  normalizeOrder,
  normalizePosition,
  tradingMessagesAr,
  tradingMessagesEn,
  tradingMessagesFa,
  validateTradingPreferences,
} from './index.js';
import type { TradingLabelInput } from './index.js';

const RLO = String.fromCharCode(0x202e);
const NUL = String.fromCharCode(0);
const t = (key: string, values?: Readonly<Record<string, string | number>>) => {
  const text = (tradingMessagesEn as Record<string, string>)[key] ?? key;
  return values ? text.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k])) : text;
};

describe('object validation (security)', () => {
  it('accepts valid orders and fills defaults', () => {
    expect(
      normalizeOrder({ id: 'o1', side: 'buy', type: 'limit', price: 101.5, quantity: 2 }),
    ).toEqual({
      id: 'o1',
      side: 'buy',
      type: 'limit',
      price: 101.5,
      quantity: 2,
      status: 'working',
    });
    expect(normalizeOrder({ id: 7, side: 'sell', price: 1, quantity: 0 }).id).toBe('7');
  });

  it('rejects orders without id, side or finite price and quantity', () => {
    const bad = [
      null,
      [],
      'order',
      { side: 'buy', price: 1, quantity: 1 },
      { id: '', side: 'buy', price: 1, quantity: 1 },
      { id: 'x'.repeat(129), side: 'buy', price: 1, quantity: 1 },
      { id: `a${NUL}b`, side: 'buy', price: 1, quantity: 1 },
      { id: 'a', side: 'long', price: 1, quantity: 1 },
      { id: 'a', side: 'buy', price: Number.NaN, quantity: 1 },
      { id: 'a', side: 'buy', price: Infinity, quantity: 1 },
      { id: 'a', side: 'buy', price: '1', quantity: 1 },
      { id: 'a', side: 'buy', price: 1, quantity: -1 },
    ];
    for (const input of bad)
      expect(() => normalizeOrder(input), JSON.stringify(input)).toThrow(TradingError);
  });

  it('cleans labels: control and bidi characters, length, unknown status, unsafe colours', () => {
    const order = normalizeOrder({
      id: 'o',
      side: 'buy',
      type: `lim${RLO}it`,
      price: 1,
      quantity: 1,
      status: 'hacked',
      label: `<img src=x onerror=alert(1)>${RLO}gpj.exe${NUL}${'x'.repeat(100)}`,
      color: 'red;background:url(javascript:alert(1))',
      meta: { broker: 'keep me' },
    });
    expect(order.status).toBe('working');
    expect(order.type).toBe('lim it');
    expect(order.label!.length).toBeLessThanOrEqual(60);
    expect(order.label).not.toContain(RLO);
    expect(order.label).not.toContain(NUL);
    // Text stays text: the canvas and React render it literally.
    expect(order.label!.startsWith('<img src=x onerror=alert(1)>')).toBe(true);
    expect(order.color).toBeUndefined();
    expect(order.meta).toEqual({ broker: 'keep me' });
  });

  it('accepts only plain CSS colours', () => {
    for (const ok of [
      '#fff',
      '#2962ffcc',
      'rgb(1, 2, 3)',
      'rgba(1,2,3,.5)',
      'hsl(120deg 50% 50%)',
      'teal',
    ])
      expect(isSafeColor(ok), ok).toBe(true);
    for (const bad of ['url(x)', 'red;x', 'expression(alert(1))', '#ggg', '', 'var(--x)', 1])
      expect(isSafeColor(bad), String(bad)).toBe(false);
  });

  it('validates positions, alerts and markers', () => {
    expect(
      normalizePosition({
        id: 'p',
        side: 'buy',
        entryPrice: 100,
        quantity: 3,
        takeProfit: 110,
        stopLoss: null,
        pnl: '+12.50 USD',
        pnlValue: 12.5,
      }),
    ).toEqual({
      id: 'p',
      side: 'buy',
      entryPrice: 100,
      quantity: 3,
      takeProfit: 110,
      pnl: '+12.50 USD',
      pnlValue: 12.5,
    });
    expect(() =>
      normalizePosition({
        id: 'p',
        side: 'buy',
        entryPrice: 1,
        quantity: 1,
        takeProfit: Number.NaN,
      }),
    ).toThrow(TradingError);
    expect(normalizeAlert({ id: 'a', price: 5, active: false })).toEqual({
      id: 'a',
      price: 5,
      active: false,
    });
    expect(() => normalizeAlert({ id: 'a' })).toThrow(TradingError);
    expect(
      normalizeMarker({
        id: 'm',
        price: 5,
        kind: 'liquidation',
        lineStyle: 'zigzag',
        axisLabel: false,
      }),
    ).toEqual({
      id: 'm',
      price: 5,
      kind: 'liquidation',
      axisLabel: false,
    });
  });

  it('validates stored preferences', () => {
    expect(validateTradingPreferences(null)).toEqual(DEFAULT_TRADING_PREFERENCES);
    expect(
      validateTradingPreferences({
        orders: false,
        compact: 'huge',
        lineStyle: 'dotted',
        showPnl: 'yes',
        __proto__: { x: 1 },
      }),
    ).toEqual({ ...DEFAULT_TRADING_PREFERENCES, orders: false, lineStyle: 'dotted' });
    // Application defaults are used for missing or invalid fields.
    expect(
      validateTradingPreferences({}, { ...DEFAULT_TRADING_PREFERENCES, draggable: false })
        .draggable,
    ).toBe(false);
  });
});

describe('labels', () => {
  const input = (patch: Partial<TradingLabelInput>): TradingLabelInput => ({
    kind: 'order',
    part: 'main',
    object: normalizeOrder({
      id: 'o',
      side: 'buy',
      type: 'limit',
      price: 100,
      quantity: 2,
      status: 'pending',
    }),
    price: '100.00',
    compact: false,
    preferences: DEFAULT_TRADING_PREFERENCES,
    ...patch,
  });

  it('formats orders with side, type, quantity and status', () => {
    expect(defaultLabel(input({}), t)).toEqual(['BUY LMT', '2', 'Pending']);
    expect(defaultLabel(input({ compact: true }), t)).toEqual(['B LMT', '2']);
    expect(
      defaultLabel(
        input({
          preferences: { ...DEFAULT_TRADING_PREFERENCES, showQuantity: false, showStatus: false },
        }),
        t,
      ),
    ).toEqual(['BUY LMT']);
    // Without axis labels the price is in the label.
    expect(
      defaultLabel(
        input({ preferences: { ...DEFAULT_TRADING_PREFERENCES, axisLabels: false } }),
        t,
      ),
    ).toContain('100.00');
    // Unknown types are shown as given.
    const custom = normalizeOrder({
      id: 'o',
      side: 'sell',
      type: 'iceberg',
      price: 1,
      quantity: 1,
    });
    expect(defaultLabel(input({ object: custom }), t)[0]).toBe('SELL ICEBERG');
  });

  it('formats positions with the application P&L, and TP/SL lines', () => {
    const position = normalizePosition({
      id: 'p',
      side: 'sell',
      entryPrice: 1,
      quantity: 0.3,
      pnl: '−4.20',
      takeProfit: 0.9,
    });
    expect(defaultLabel(input({ kind: 'position', object: position }), t)).toEqual([
      'SHORT',
      '0.3',
      '−4.20',
    ]);
    expect(
      defaultLabel(input({ kind: 'position', part: 'takeProfit', object: position }), t),
    ).toEqual(['TP']);
    expect(defaultTooltip(input({ kind: 'position', object: position }), t)).toContain(
      'P&L: −4.20',
    );
  });

  it('formats quantities without float noise', () => {
    expect(formatQuantity(0.1 + 0.2)).toBe('0.3');
    expect(formatQuantity(1e-8)).toBe('1e-8');
    expect(formatQuantity(Number.NaN)).toBe('');
  });

  it('has complete Persian and Arabic dictionaries', () => {
    const keys = Object.keys(tradingMessagesEn).sort();
    expect(Object.keys(tradingMessagesFa).sort()).toEqual(keys);
    expect(Object.keys(tradingMessagesAr).sort()).toEqual(keys);
    for (const text of [...Object.values(tradingMessagesFa), ...Object.values(tradingMessagesAr)])
      expect(text.trim().length).toBeGreaterThan(0);
  });
});

describe('label layout', () => {
  it('stacks overlapping labels without overlaps, next to the axis or at the left', () => {
    const boxes = layoutTradingLabels(
      [
        { key: 'a', y: 100, width: 60 },
        { key: 'b', y: 102, width: 40 },
        { key: 'c', y: 104, width: 50 },
        { key: 'd', y: 300, width: 30 },
      ],
      { paneWidth: 500, paneHeight: 400, height: 18, position: 'right' },
    );
    const sorted = [...boxes].sort((x, y) => x.top - y.top);
    for (let i = 1; i < sorted.length; i++)
      expect(sorted[i]!.top).toBeGreaterThanOrEqual(sorted[i - 1]!.top + 18);
    expect(boxes.find((b) => b.key === 'd')!.top).toBe(300 - 9);
    expect(boxes.find((b) => b.key === 'a')!.left).toBe(500 - 60 - 6);
    const left = layoutTradingLabels([{ key: 'a', y: 10, width: 60 }], {
      paneWidth: 500,
      paneHeight: 400,
      height: 18,
      position: 'left',
    });
    expect(left[0]!.left).toBe(6);
  });

  it('keeps labels inside the pane at the bottom edge', () => {
    const boxes = layoutTradingLabels(
      [
        { key: 'a', y: 395, width: 10 },
        { key: 'b', y: 398, width: 10 },
      ],
      { paneWidth: 100, paneHeight: 400, height: 18, position: 'right' },
    );
    expect(Math.max(...boxes.map((b) => b.top + b.height))).toBeLessThanOrEqual(400);
  });
});
