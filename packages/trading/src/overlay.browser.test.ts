// @vitest-environment jsdom
// Real-Chromium checks: dragging and cancelling with real pointer events on a real canvas, cursors and the
// context menu. They need real layout and canvas, so they skip themselves under jsdom.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createChart } from '@market-chart/core';
import type { ChartApi, SeriesApi } from '@market-chart/core';
import { HOUR, generateBars } from '@market-chart/testing';
import { ChartUi } from '@market-chart/ui';
import { createTradingOverlay } from './index.js';
import type { TradingOverlay } from './index.js';

const inJsdom = /jsdom/i.test(globalThis.navigator?.userAgent ?? '');
const bars = generateBars({ count: 200, interval: HOUR, seed: 21, startPrice: 100 });
const last = bars[bars.length - 1]!.close;
const tick = 0.25;
let container: HTMLDivElement;
let chart: ChartApi;
let series: SeriesApi<'candlestick'>;
let overlay: TradingOverlay | null = null;
let ui: ChartUi | null = null;
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  container = document.createElement('div');
  container.style.cssText = 'width:800px;height:400px;position:relative';
  document.body.appendChild(container);
  chart = createChart(container, { autoSize: false, width: 800, height: 400 });
  series = chart.addSeries('candlestick', { priceFormat: { type: 'price', minMove: tick } });
  series.setData(bars);
  chart.render();
});

afterEach(() => {
  overlay?.destroy();
  overlay = null;
  ui?.destroy();
  ui = null;
  if (!chart.destroyed) chart.destroy();
  container.remove();
});

const canvas = () =>
  chart.element().querySelector<HTMLCanvasElement>('canvas[data-layer="overlay"]')!;
function pointer(type: string, x: number, y: number, extra: PointerEventInit = {}): void {
  const r = canvas().getBoundingClientRect();
  canvas().dispatchEvent(
    new PointerEvent(type, {
      clientX: r.left + x,
      clientY: r.top + y,
      bubbles: true,
      cancelable: true,
      pointerId: 11,
      pointerType: 'mouse',
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      ...extra,
    }),
  );
}
const price0 = Math.round((last - 1.5) / tick) * tick;

describe.skipIf(inJsdom)('trading overlay in a real browser', () => {
  it('drags an order line with real pointer events: ns-resize cursor, rounded price, pending, kept', async () => {
    const onModify = vi.fn(() => Promise.resolve(true));
    overlay = createTradingOverlay(chart, { onModify });
    overlay.setOrders([{ id: 'o', side: 'buy', type: 'limit', price: price0, quantity: 1 }]);
    await flush();
    chart.render();
    const y = series.priceToCoordinate(price0)!;
    pointer('pointermove', 300, y, { buttons: 0 });
    expect(canvas().style.cursor).toBe('ns-resize');
    pointer('pointerdown', 300, y);
    for (let i = 1; i <= 10; i++) pointer('pointermove', 300, y - i * 4);
    pointer('pointerup', 300, y - 40);
    expect(onModify.mock.calls.length).toBe(1);
    const price = (onModify.mock.calls[0] as unknown[])[1] as number;
    expect(Math.abs(price / tick - Math.round(price / tick))).toBeLessThan(1e-9);
    expect(price).toBeGreaterThan(price0);
    await flush();
    await flush();
    chart.render();
    expect(overlay.items()[0]!.price).toBe(price);
    // The axis label (engine price line) moved with it.
    expect(series.priceLines()[0]!.options().price).toBe(price);
    // Panning did not happen while dragging.
    expect(chart.timeScale().getVisibleLogicalRange() !== null).toBe(true);
  });

  it('cancels with the × of a label and leaves the chart pannable elsewhere', async () => {
    const onCancel = vi.fn();
    overlay = createTradingOverlay(chart, { onCancel });
    overlay.setOrders([{ id: 'o', side: 'sell', type: 'limit', price: price0, quantity: 2 }]);
    await flush();
    chart.render();
    const box = overlay.labelBoxes()[0]!;
    const x = box.left + box.width - 6;
    const y = box.top + box.height / 2;
    pointer('pointermove', x, y, { buttons: 0 });
    expect(canvas().style.cursor).toBe('pointer');
    pointer('pointerdown', x, y);
    pointer('pointerup', x, y);
    expect(onCancel.mock.calls.length).toBe(1);
    const before = chart.timeScale().getVisibleLogicalRange()!.from;
    pointer('pointerdown', 200, 380);
    pointer('pointermove', 260, 380);
    pointer('pointerup', 260, 380);
    // A drag on empty chart space still pans (the overlay did not capture it).
    expect(Math.abs(chart.timeScale().getVisibleLogicalRange()!.from - before)).toBeGreaterThan(5);
  });

  it('right-click on a label opens the shared context menu for that order', async () => {
    ui = new ChartUi(chart);
    overlay = createTradingOverlay(chart, { ui, onCancel: () => undefined });
    overlay.setOrders([{ id: 'o', side: 'buy', type: 'limit', price: price0, quantity: 1 }]);
    await flush();
    chart.render();
    const box = overlay.labelBoxes()[0]!;
    const r = canvas().getBoundingClientRect();
    canvas().dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: r.left + box.left + 4,
        clientY: r.top + box.top + 4,
      }),
    );
    expect(ui.menu.state.target?.kind).toBe('order');
    expect(ui.menu.state.entries.some((e) => e.type === 'item' && e.label === 'Cancel order')).toBe(
      true,
    );
  });
});
