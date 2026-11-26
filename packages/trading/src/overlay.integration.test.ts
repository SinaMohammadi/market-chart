// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createChart } from '@market-chart/core';
import type { ChartApi, SeriesApi } from '@market-chart/core';
import {
  HOUR,
  clearDrawnTexts,
  drawnTexts,
  generateBars,
  installCanvasMock,
} from '@market-chart/testing';
import { ChartUi } from '@market-chart/ui';
import type { MenuItemEntry } from '@market-chart/ui';
import { createTradingOverlay } from './index.js';
import type { TradingOrder, TradingOverlay } from './index.js';

let restore: () => void = () => undefined;
let container: HTMLDivElement;
let chart: ChartApi;
let candles: SeriesApi<'candlestick'>;
let overlay: TradingOverlay | null = null;
let ui: ChartUi | null = null;
const bars = generateBars({ count: 200, interval: HOUR, seed: 7, startPrice: 100 });
const last = bars[bars.length - 1]!.close;
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  restore = installCanvasMock();
  container = document.createElement('div');
  document.body.appendChild(container);
  chart = createChart(container, { autoSize: false, width: 800, height: 400 });
  candles = chart.addSeries('candlestick', { priceFormat: { type: 'price', minMove: 0.25 } });
  candles.setData(bars);
  chart.render();
});

afterEach(() => {
  overlay?.destroy();
  overlay = null;
  ui?.destroy();
  ui = null;
  if (!chart.destroyed) chart.destroy();
  container.remove();
  restore();
});

const canvas = (layer: string): HTMLCanvasElement =>
  chart.element().querySelector(`canvas[data-layer="${layer}"]`)!;

function pointer(
  type: string,
  p: { x: number; y: number },
  extra: Record<string, unknown> = {},
): void {
  const el = canvas('overlay');
  const rect = el.getBoundingClientRect();
  const Ctor = ((globalThis as { PointerEvent?: typeof PointerEvent }).PointerEvent ??
    MouseEvent) as typeof PointerEvent;
  el.dispatchEvent(
    new Ctor(type, {
      clientX: rect.left + p.x,
      clientY: rect.top + p.y,
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerId: 5,
      pointerType: 'mouse',
      ...extra,
    }),
  );
}

const order = (patch: Partial<TradingOrder> = {}): TradingOrder => ({
  id: 'o1',
  side: 'buy',
  type: 'limit',
  price: Math.round((last - 2) * 4) / 4,
  quantity: 2,
  ...patch,
});

async function render(): Promise<void> {
  await flush();
  chart.render();
}

const boxOf = (key: string) => {
  const i = overlay!.labelBoxes().find((b) => b.key === key);
  if (!i) throw new Error(`no label for ${key}`);
  return i;
};
const yOf = (price: number) => candles.priceToCoordinate(price)!;

describe('display', () => {
  it('draws labels and gives every line an axis label through the price-line API', async () => {
    overlay = createTradingOverlay(chart);
    overlay.setOrders([
      order(),
      order({ id: 'o2', side: 'sell', price: last + 3, status: 'pending' }),
    ]);
    overlay.setPositions([
      {
        id: 'p',
        side: 'buy',
        entryPrice: last - 1,
        quantity: 1,
        takeProfit: last + 5,
        stopLoss: last - 5,
        pnl: '+3.10',
      },
    ]);
    overlay.setAlerts([{ id: 'a', price: last + 1 }]);
    overlay.addMarker({ id: 'm', price: last - 4, label: 'Liq.' });
    // Filled orders are not drawn.
    overlay.upsertOrder(order({ id: 'gone', status: 'filled' }));
    clearDrawnTexts(canvas('main').getContext('2d')!);
    await render();
    expect(
      overlay
        .items()
        .map((i) => i.key)
        .sort(),
    ).toEqual(
      [
        'alert:a',
        'marker:m',
        'order:o1',
        'order:o2',
        'position:p',
        'position:p:stopLoss',
        'position:p:takeProfit',
      ].sort(),
    );
    expect(candles.priceLines()).toHaveLength(7);
    for (const line of candles.priceLines())
      expect(line.options()).toMatchObject({ lineVisible: false, axisLabelVisible: true });
    const texts = drawnTexts(canvas('main').getContext('2d')!).map((t) => t.text);
    for (const text of [
      'BUY LMT',
      'SELL LMT',
      'Pending',
      'LONG',
      '+3.10',
      'TP',
      'SL',
      'ALERT',
      'Liq.',
    ])
      expect(texts, text).toContain(text);
    // Pending orders use the pending colour.
    expect(overlay.items().find((i) => i.key === 'order:o2')!.pending).toBe(true);
  });

  it('batches any number of updates into one rebuild', async () => {
    overlay = createTradingOverlay(chart);
    const changes = vi.fn();
    overlay.on('change', changes);
    for (let i = 0; i < 1000; i++)
      overlay.upsertOrder(order({ id: `o${i}`, price: last - 10 + i / 100 }));
    for (let i = 0; i < 1000; i++)
      overlay.upsertOrder(order({ id: `o${i}`, price: last - 10 + i / 100, status: 'partial' }));
    expect(changes).not.toHaveBeenCalled();
    await flush();
    expect(changes).toHaveBeenCalledTimes(1);
    expect(overlay.items()).toHaveLength(1000);
  });

  it('keeps lines at their price when panning, zooming and moving the series to another pane', async () => {
    overlay = createTradingOverlay(chart);
    overlay.setOrders([order()]);
    await render();
    expect(boxOf('order:o1').y).toBeCloseTo(yOf(order().price), 5);
    chart.timeScale().setVisibleLogicalRange({ from: 20, to: 120 });
    chart.priceScale('right').applyOptions({ autoScale: false });
    chart.render();
    expect(boxOf('order:o1').y).toBeCloseTo(yOf(order().price), 5);
    chart
      .addSeries('line', { pane: 1 })
      .setData(bars.map((b) => ({ time: b.time, value: b.close })));
    candles.applyOptions({ pane: 1 });
    await render();
    expect(
      overlay.hitTest(1, boxOf('order:o1').left + 2, boxOf('order:o1').top + 2)?.item.key,
    ).toBe('order:o1');
    expect(overlay.hitTest(0, boxOf('order:o1').left + 2, boxOf('order:o1').top + 2)).toBeNull();
  });

  it('follows the preferences and validates application defaults', async () => {
    const changes: unknown[] = [];
    overlay = createTradingOverlay(chart, {
      defaults: { showQuantity: false },
      onPreferencesChange: (p) => changes.push(p),
    });
    overlay.setOrders([order()]);
    overlay.setAlerts([{ id: 'a', price: last }]);
    await render();
    expect(overlay.preferences().showQuantity).toBe(false);
    overlay.setPreferences({ orders: false, axisLabels: false });
    await render();
    expect(overlay.items().map((i) => i.key)).toEqual(['alert:a']);
    expect(candles.priceLines()).toHaveLength(0);
    expect(changes).toHaveLength(1);
    overlay.resetPreferences();
    await render();
    expect(overlay.items()).toHaveLength(2);
  });

  it('drops invalid objects from bulk updates and reports them', async () => {
    const onError = vi.fn();
    overlay = createTradingOverlay(chart, { onError });
    overlay.setOrders([
      order(),
      { id: 'bad', side: 'buy', price: Number.NaN, quantity: 1 } as TradingOrder,
    ]);
    await render();
    expect(overlay.items()).toHaveLength(1);
    expect(onError).toHaveBeenCalledOnce();
    expect(() => overlay!.upsertOrder({ ...order(), side: 'long' as 'buy' })).toThrow(/side/);
  });

  it('draws application labels as plain text without control or bidi characters', async () => {
    overlay = createTradingOverlay(chart);
    const rlo = String.fromCharCode(0x202e);
    overlay.setOrders([order({ label: `<b onclick=x>${rlo}evil` })]);
    clearDrawnTexts(canvas('main').getContext('2d')!);
    await render();
    const texts = drawnTexts(canvas('main').getContext('2d')!).map((t) => t.text);
    expect(texts).toContain('<b onclick=x> evil');
    expect(texts.join('')).not.toContain(rlo);
  });

  it('cleans up its lines and plugin on destroy', async () => {
    overlay = createTradingOverlay(chart);
    overlay.setOrders([order()]);
    await render();
    expect(candles.priceLines()).toHaveLength(1);
    overlay.destroy();
    expect(candles.priceLines()).toHaveLength(0);
    overlay = null;
  });
});

describe('interaction', () => {
  it('drags a line to a rounded price; pending until onModify resolves, then keeps it', async () => {
    let resolve!: (ok: boolean) => void;
    const onModify = vi.fn(() => new Promise<boolean>((r) => (resolve = r)));
    overlay = createTradingOverlay(chart, { onModify });
    const o = order();
    overlay.setOrders([o]);
    await render();
    const y = yOf(o.price);
    pointer('pointermove', { x: 300, y });
    pointer('pointerdown', { x: 300, y });
    pointer('pointermove', { x: 300, y: y - 20 });
    pointer('pointermove', { x: 300, y: y - 40 });
    pointer('pointerup', { x: 300, y: y - 40 });
    expect(onModify).toHaveBeenCalledOnce();
    const [object, price, info] = onModify.mock.calls[0]! as unknown as [
      TradingOrder,
      number,
      unknown,
    ];
    expect(object.id).toBe('o1');
    expect(info).toEqual({ kind: 'order', id: 'o1', part: 'main' });
    expect(price % 0.25).toBeCloseTo(0, 9);
    expect(price).toBeGreaterThan(o.price);
    await render();
    const pending = overlay.items()[0]!;
    expect(pending.pending).toBe(true);
    expect(pending.draggable).toBe(false);
    expect(pending.price).toBe(price);
    expect(candles.priceLines()[0]!.options().price).toBe(price);
    resolve(true);
    await render();
    expect(overlay.items()[0]!).toMatchObject({ pending: false, price });
    // Newer data from the application wins over the accepted price.
    overlay.upsertOrder(order({ price: o.price + 1 }));
    await render();
    expect(overlay.items()[0]!.price).toBe(o.price + 1);
  });

  it('snaps back when onModify rejects, and reports the reason', async () => {
    const onError = vi.fn();
    overlay = createTradingOverlay(chart, {
      onModify: () => Promise.reject(new Error('Rejected by the broker')),
      onError,
    });
    const o = order();
    overlay.setOrders([o]);
    await render();
    const y = yOf(o.price);
    pointer('pointerdown', { x: 300, y });
    pointer('pointermove', { x: 300, y: y + 30 });
    pointer('pointerup', { x: 300, y: y + 30 });
    await render();
    await render();
    expect(overlay.items()[0]!.price).toBe(o.price);
    expect((onError.mock.calls[0] as unknown[])[0]).toBeInstanceOf(Error);
  });

  it('does not drag without onModify, read-only objects or when the user switched dragging off', async () => {
    const onSelect = vi.fn();
    overlay = createTradingOverlay(chart, { onSelect });
    overlay.setOrders([order()]);
    await render();
    expect(overlay.items()[0]!.draggable).toBe(false);
    const box = boxOf('order:o1');
    pointer('pointerdown', { x: box.left + 4, y: box.top + 4 });
    pointer('pointerup', { x: box.left + 4, y: box.top + 4 });
    expect(onSelect).toHaveBeenCalledOnce();
    expect(overlay.selected()).toBe('order:o1');
    overlay.setOptions({ onModify: () => undefined });
    overlay.upsertOrder(order({ id: 'ro', draggable: false }));
    await render();
    expect(overlay.items().find((i) => i.key === 'order:o1')!.draggable).toBe(true);
    expect(overlay.items().find((i) => i.key === 'order:ro')!.draggable).toBe(false);
    overlay.setPreferences({ draggable: false });
    await render();
    expect(overlay.items().every((i) => !i.draggable)).toBe(true);
  });

  it('drags take-profit and stop-loss lines of a position', async () => {
    const onModify = vi.fn(() => true);
    overlay = createTradingOverlay(chart, { onModify });
    overlay.setPositions([
      { id: 'p', side: 'buy', entryPrice: last, quantity: 1, takeProfit: last + 4 },
    ]);
    await render();
    expect(overlay.items().find((i) => i.key === 'position:p')!.draggable).toBe(false);
    const y = yOf(last + 4);
    pointer('pointerdown', { x: 200, y });
    pointer('pointermove', { x: 200, y: y - 25 });
    pointer('pointerup', { x: 200, y: y - 25 });
    expect((onModify.mock.calls[0] as unknown[])[2]).toEqual({
      kind: 'position',
      id: 'p',
      part: 'takeProfit',
    });
  });

  it('cancels through the × button and closes positions only when the application handles it', async () => {
    const onCancel = vi.fn(() => Promise.resolve());
    overlay = createTradingOverlay(chart, { onCancel });
    overlay.setOrders([order()]);
    overlay.setPositions([{ id: 'p', side: 'buy', entryPrice: last + 6, quantity: 1 }]);
    await render();
    expect(overlay.items().find((i) => i.key === 'position:p')!.cancellable).toBe(false);
    const box = boxOf('order:o1');
    const x = box.left + box.width - 5;
    const y = box.top + box.height / 2;
    expect(overlay.hitTest(0, x, y)?.area).toBe('cancel');
    pointer('pointerdown', { x, y });
    pointer('pointerup', { x, y });
    expect(onCancel).toHaveBeenCalledOnce();
    expect((onCancel.mock.calls[0] as unknown[])[1]).toEqual({
      kind: 'order',
      id: 'o1',
      part: 'main',
    });
    // Pressing × and releasing elsewhere does nothing.
    await render();
    pointer('pointerdown', { x, y });
    pointer('pointerup', { x: x - 200, y: y + 80 });
    expect(onCancel).toHaveBeenCalledOnce();
    const onClosePosition = vi.fn();
    overlay.setOptions({ onClosePosition });
    await render();
    await overlay.cancel('position:p');
    expect(onClosePosition).toHaveBeenCalledWith(expect.objectContaining({ id: 'p' }));
  });

  it('opens edit on double-click and reports hover', async () => {
    const onEdit = vi.fn();
    const onHover = vi.fn();
    overlay = createTradingOverlay(chart, { onEdit, onHover });
    overlay.setAlerts([{ id: 'a', price: last }]);
    await render();
    const y = yOf(last);
    pointer('pointermove', { x: 100, y });
    expect(onHover).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'a' }), {
      kind: 'alert',
      id: 'a',
      part: 'main',
    });
    pointer('pointermove', { x: 100, y: y + 60 });
    expect(onHover).toHaveBeenLastCalledWith(null, null);
    canvas('overlay').dispatchEvent(
      new MouseEvent('dblclick', {
        bubbles: true,
        clientX: canvas('overlay').getBoundingClientRect().left + 100,
        clientY: canvas('overlay').getBoundingClientRect().top + y,
      }),
    );
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), {
      kind: 'alert',
      id: 'a',
      part: 'main',
    });
  });
});

describe('chart UI integration', () => {
  function rightClick(x: number, y: number): void {
    const el = canvas('overlay');
    const rect = el.getBoundingClientRect();
    el.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + x,
        clientY: rect.top + y,
        button: 2,
      }),
    );
  }

  it('resolves order targets in the shared context menu and runs their actions after confirmation', async () => {
    ui = new ChartUi(chart);
    const onCancel = vi.fn();
    const onEdit = vi.fn();
    overlay = createTradingOverlay(chart, { ui, onCancel, onEdit });
    overlay.setOrders([order()]);
    await render();
    const box = boxOf('order:o1');
    rightClick(box.left + 4, box.top + 4);
    const state = ui.menu.state;
    expect(state.open).toBe(true);
    expect(state.target?.kind).toBe('order');
    expect(state.target?.object).toMatchObject({ type: 'order', id: 'o1' });
    const labels = state.entries
      .filter((e): e is MenuItemEntry => e.type === 'item')
      .map((e) => e.label);
    expect(labels).toEqual(
      expect.arrayContaining(['Modify…', 'Cancel order', 'Hide orders', 'Trading settings…']),
    );
    const index = state.entries.findIndex((e) => e.type === 'item' && e.label === 'Cancel order');
    ui.menu.activate(0, index);
    expect(ui.menu.state.confirm?.message).toBe('Cancel this order?');
    expect(onCancel).not.toHaveBeenCalled();
    ui.menu.confirm(true);
    await flush();
    expect(onCancel).toHaveBeenCalledOnce();
    // Elsewhere on the chart the usual menu opens.
    rightClick(100, 380);
    expect(ui.menu.state.target?.kind).not.toBe('order');
  });

  it('stores preferences in the UI preferences, validated, and adds object-tree and settings sections', async () => {
    ui = new ChartUi(chart);
    overlay = createTradingOverlay(chart, { ui, onCancel: () => undefined });
    overlay.setOrders([order()]);
    await render();
    overlay.setPreferences({ showStatus: false });
    expect(ui.preferences.get().extensions['trading']).toEqual({ showStatus: false });
    // Tampered stored values fall back to the defaults.
    ui.preferences.update({
      extensions: { trading: { orders: 'no', lineStyle: 'zigzag', showStatus: false } },
    });
    expect(overlay.preferences()).toMatchObject({
      orders: true,
      lineStyle: 'dashed',
      showStatus: false,
    });
    const section = ui.objectTree.sections().find((s) => s.id === 'trading.orders')!;
    const [row] = section.items();
    expect(row).toMatchObject({ id: 'order:o1', label: 'Buy limit' });
    expect(row!.actions!.map((a) => a.id)).toEqual(['cancel']);
    row!.select!();
    expect(overlay.selected()).toBe('order:o1');
    const settings = ui.settings.sections().find((s) => s.id === 'trading')!;
    const toggle = settings.fields().find((f) => f.id === 'trading.orders')!;
    expect(toggle.kind).toBe('toggle');
    if (toggle.kind === 'toggle') toggle.set(false);
    await render();
    expect(overlay.items()).toHaveLength(0);
    // Removing the overlay removes its sections and actions.
    overlay.destroy();
    overlay = null;
    expect(ui.objectTree.sections()).toHaveLength(0);
    expect(ui.actions.get('trading.cancelOrder')).toBeUndefined();
  });

  it('translates labels with the UI language (Persian)', async () => {
    ui = new ChartUi(chart);
    ui.i18n.setLocale('fa');
    overlay = createTradingOverlay(chart, { ui });
    overlay.setOrders([order()]);
    clearDrawnTexts(canvas('main').getContext('2d')!);
    await render();
    const texts = drawnTexts(canvas('main').getContext('2d')!).map((t) => t.text);
    expect(texts).toContain('خرید محدود');
  });
});
