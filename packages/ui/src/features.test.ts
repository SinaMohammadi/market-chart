// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createChart, roundToTick } from '@market-chart/core';
import type { ChartApi, ContextMenuEvent, SeriesApi } from '@market-chart/core';
import { HOUR, generateBars, installCanvasMock } from '@market-chart/testing';
import {
  ChartUi,
  filterSymbols,
  normalizeSymbolItem,
  orderTicket,
  parseTicketNumber,
  priceActions,
  symbolSearch,
  tickSizeOf,
  validateTicket,
} from './index.js';
import type {
  MenuItemEntry,
  OrderTicketSubmission,
  SymbolItem,
  SymbolSearchRequest,
  TicketField,
  TradingCapability,
} from './index.js';

let restore: () => void = () => undefined;
let container: HTMLDivElement;
let chart: ChartApi;
let candles: SeriesApi<'candlestick'>;
let ui: ChartUi | null = null;
const bars = generateBars({ count: 200, interval: HOUR, seed: 5, startPrice: 100 });
const last = bars[bars.length - 1]!.close;
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  restore = installCanvasMock();
  container = document.createElement('div');
  document.body.appendChild(container);
  chart = createChart(container, { autoSize: false, width: 800, height: 400 });
  candles = chart.addSeries('candlestick', { priceFormat: { type: 'price', minMove: 0.05 } });
  candles.setData(bars);
  chart.render();
});

afterEach(() => {
  ui?.destroy();
  ui = null;
  if (!chart.destroyed) chart.destroy();
  container.remove();
  restore();
});

const LIST: SymbolItem[] = [
  { symbol: 'BTCUSDT', name: 'Bitcoin', exchange: 'Sim Exchange', group: 'crypto' },
  { symbol: 'ETHUSDT', name: 'Ethereum', group: 'crypto' },
  { symbol: 'EURUSD', name: 'Euro / US Dollar', group: 'forex' },
  { symbol: 'ACME', name: 'Acme Corp.', group: 'stocks', description: 'Large-cap listing' },
  { symbol: 'USDJPY', name: 'US Dollar / Yen', group: 'forex' },
];

function staticSource(initial = 'BTCUSDT') {
  let current = initial;
  return {
    value: () => current,
    set: vi.fn((s: string) => {
      current = s;
    }),
    list: () => LIST,
    groups: [
      { id: 'stocks', label: 'Stocks' },
      { id: 'crypto', label: 'Crypto' },
      { id: 'forex', label: 'Forex' },
    ],
  };
}

const items = (entries: readonly unknown[]) =>
  entries.filter((e): e is MenuItemEntry => (e as MenuItemEntry).type === 'item');

describe('rounding', () => {
  it('rounds to the series tick size without float noise', () => {
    expect(roundToTick(101.37, 0.05)).toBe(101.35);
    expect(roundToTick(101.38, 0.05)).toBe(101.4);
    expect(roundToTick(0.1 + 0.2, 0.1)).toBe(0.3);
    expect(roundToTick(5, 0)).toBe(5);
    expect(roundToTick(Number.NaN, 0.01)).toBeNaN();
    expect(tickSizeOf(candles)).toBe(0.05);
    // The default format has minMove 0.01, which wins over precision (the axis rounds to it too).
    expect(
      tickSizeOf(chart.addSeries('line', { priceFormat: { type: 'price', precision: 3 } })),
    ).toBe(0.01);
    expect(
      tickSizeOf(chart.addSeries('line', { priceFormat: { type: 'price', minMove: 0.001 } })),
    ).toBe(0.001);
  });
});

describe('symbol search', () => {
  it('ranks local matches: exact, prefix, name, contains', () => {
    expect(filterSymbols(LIST, 'usd', 10).map((i) => i.symbol)).toEqual([
      'USDJPY',
      'BTCUSDT',
      'ETHUSDT',
      'EURUSD',
    ]);
    expect(filterSymbols(LIST, 'acme corp', 10).map((i) => i.symbol)).toEqual(['ACME']);
    expect(filterSymbols(LIST, 'large-cap', 10).map((i) => i.symbol)).toEqual(['ACME']);
    expect(filterSymbols(LIST, '', 2)).toHaveLength(2);
    expect(filterSymbols(LIST, '', 10, 'forex').map((i) => i.symbol)).toEqual(['EURUSD', 'USDJPY']);
  });

  it('validates items from the application or a server (security)', () => {
    const rlo = String.fromCharCode(0x202e);
    expect(normalizeSymbolItem({ symbol: `BTC${rlo}` })).toBeNull();
    expect(normalizeSymbolItem({ symbol: '' })).toBeNull();
    expect(normalizeSymbolItem(null)).toBeNull();
    const item = normalizeSymbolItem({
      symbol: 'X',
      name: `<img src=x onerror=alert(1)>${rlo}`,
      icon: 'javascript:alert(1)',
      badge: 'b'.repeat(100),
    })!;
    expect(item.name).toBe('<img src=x onerror=alert(1)>');
    expect(item.icon).toBeUndefined();
    expect(item.badge!.length).toBeLessThanOrEqual(16);
    expect(normalizeSymbolItem({ symbol: 'X', icon: 'https://example.test/x.png' })!.icon).toBe(
      'https://example.test/x.png',
    );
  });

  it('filters a static list, navigates with the keyboard, selects and records recents', () => {
    const symbols = staticSource();
    ui = new ChartUi(chart, { capabilities: { symbols }, features: [symbolSearch()] });
    const search = ui.symbols!;
    search.open({ query: 'eth' });
    expect(search.state).toMatchObject({ open: true, status: 'ready', active: 0 });
    expect(search.state.results.map((r) => r.symbol)).toEqual(['ETHUSDT']);
    search.setQuery('usd');
    expect(search.state.results).toHaveLength(4);
    search.handleKey({ key: 'ArrowDown' });
    search.handleKey({ key: 'ArrowDown' });
    expect(search.state.active).toBe(2);
    search.handleKey({ key: 'ArrowUp' });
    expect(search.state.active).toBe(1);
    search.handleKey({ key: 'Enter' });
    expect(symbols.set).toHaveBeenCalledWith(
      'BTCUSDT',
      expect.objectContaining({ symbol: 'BTCUSDT' }),
    );
    expect(search.state.open).toBe(false);
    expect(ui.preferences.get().symbols.recent).toEqual(['BTCUSDT']);
  });

  it('has group tabs (with favorites and recents) in the configured order, and favorites persist', () => {
    ui = new ChartUi(chart, {
      capabilities: { symbols: staticSource() },
      features: [symbolSearch({ groupOrder: ['forex', 'crypto'] })],
    });
    const search = ui.symbols!;
    expect(search.groups().map((g) => g.id)).toEqual([
      'all',
      'favorites',
      'recent',
      'forex',
      'crypto',
      'stocks',
    ]);
    search.toggleFavorite('ACME');
    search.toggleFavorite('EURUSD');
    expect(ui.preferences.get().symbols.favorites).toEqual(['ACME', 'EURUSD']);
    search.open({ group: 'favorites' });
    expect(search.state.results.map((r) => r.symbol)).toEqual(['ACME', 'EURUSD']);
    // Names come from the list.
    expect(search.state.results[0]!.name).toBe('Acme Corp.');
    search.setGroup('forex');
    expect(search.state.results.map((r) => r.symbol)).toEqual(['EURUSD', 'USDJPY']);
    search.toggleFavorite('ACME');
    expect(search.isFavorite('ACME')).toBe(false);
  });

  it('hides favorites and recents when switched off', () => {
    ui = new ChartUi(chart, {
      capabilities: { symbols: staticSource() },
      features: [symbolSearch({ favorites: false, recent: false })],
    });
    expect(ui.symbols!.groups().map((g) => g.id)).toEqual(['all', 'stocks', 'crypto', 'forex']);
    ui.symbols!.toggleFavorite('ACME');
    expect(ui.preferences.get().symbols.favorites).toEqual([]);
  });

  it('debounces server search, aborts stale requests and ignores their answers', async () => {
    vi.useFakeTimers();
    try {
      const calls: {
        query: string;
        request: SymbolSearchRequest;
        resolve: (items: SymbolItem[]) => void;
      }[] = [];
      const symbols = {
        value: () => 'BTCUSDT',
        set: vi.fn(),
        search: (query: string, request: SymbolSearchRequest) =>
          new Promise<SymbolItem[]>((resolve) => calls.push({ query, request, resolve })),
      };
      ui = new ChartUi(chart, {
        capabilities: { symbols },
        features: [symbolSearch({ debounceMs: 200, limit: 3 })],
      });
      const search = ui.symbols!;
      search.open();
      expect(calls).toHaveLength(1);
      expect(calls[0]!.request.limit).toBe(3);
      search.setQuery('b');
      search.setQuery('bt');
      search.setQuery('btc');
      expect(search.state.status).toBe('loading');
      expect(calls).toHaveLength(1);
      expect(calls[0]!.request.signal.aborted).toBe(true);
      vi.advanceTimersByTime(199);
      expect(calls).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(calls.map((c) => c.query)).toEqual(['', 'btc']);
      // The stale first answer arrives late and is ignored.
      calls[0]!.resolve([{ symbol: 'STALE' }]);
      await vi.advanceTimersByTimeAsync(0);
      expect(search.state.status).toBe('loading');
      calls[1]!.resolve([
        { symbol: 'BTCUSDT' },
        { symbol: 'BTCEUR' },
        { symbol: 'bad\u0000' },
        { symbol: 'A' },
        { symbol: 'B' },
      ]);
      await vi.advanceTimersByTimeAsync(0);
      expect(search.state.status).toBe('ready');
      expect(search.state.results.map((r) => r.symbol)).toEqual(['BTCUSDT', 'BTCEUR', 'A']);
      search.close();
      expect(calls[1]!.request.signal.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows errors and retries', async () => {
    let fail = true;
    const symbols = {
      value: () => 'X',
      set: vi.fn(),
      search: async () => {
        if (fail) throw new Error('Server unavailable');
        return [{ symbol: 'X' }];
      },
    };
    ui = new ChartUi(chart, {
      capabilities: { symbols },
      features: [symbolSearch({ debounceMs: 0 })],
    });
    ui.symbols!.open();
    await flush();
    expect(ui.symbols!.state).toMatchObject({ status: 'error', error: 'Server unavailable' });
    fail = false;
    ui.symbols!.retry();
    await flush();
    expect(ui.symbols!.state.status).toBe('ready');
  });

  it('opens with Mod+K or by typing on the chart, per selector mode', () => {
    ui = new ChartUi(chart, {
      capabilities: { symbols: staticSource() },
      features: [symbolSearch({ mode: 'modal' })],
    });
    const key = (k: string, mods: Partial<KeyboardEvent> = {}) =>
      ui!.handleKeyDown({
        key: k,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        ...mods,
      });
    expect(key('k', { ctrlKey: true })).toBe(true);
    expect(ui.symbols!.state).toMatchObject({ open: true, surface: 'modal', query: '' });
    ui.symbols!.close();
    expect(key('e')).toBe(true);
    expect(ui.symbols!.state.query).toBe('e');
    ui.symbols!.close();
    // Shortcuts with modifiers and punctuation are left to the chart.
    expect(key('+')).toBe(false);
    expect(key('e', { altKey: true })).toBe(false);
    ui.symbols!.setMode('none');
    expect(key('e')).toBe(false);
  });

  it('places header actions by mode; the plain select remains without the feature', () => {
    ui = new ChartUi(chart, { capabilities: { symbols: staticSource() } });
    const header = () =>
      ui!
        .placements()
        .filter((i) => i.visible)
        .map((i) => i.action.id);
    expect(header()).toContain('header.symbol');
    ui.destroy();
    ui = new ChartUi(chart, {
      capabilities: { symbols: staticSource() },
      features: [symbolSearch()],
    });
    expect(header()).toContain('symbols.picker');
    expect(header()).not.toContain('symbols.search');
    expect(header()).not.toContain('header.symbol');
    ui.symbols!.setMode('both');
    expect(header()).toEqual(expect.arrayContaining(['symbols.picker', 'symbols.search']));
    ui.symbols!.setMode('custom');
    expect(header()).not.toContain('symbols.picker');
    // Settings offer the modes.
    const field = ui.settings
      .sections()
      .find((s) => s.id === 'symbols')!
      .fields()[0]!;
    expect(field.kind === 'select' && field.options().map((o) => o.value)).toEqual([
      'dropdown',
      'modal',
      'both',
      'custom',
    ]);
  });

  it('keeps the legacy `symbol` capability working as a source', () => {
    const set = vi.fn();
    ui = new ChartUi(chart, {
      capabilities: {
        symbol: {
          value: () => 'A',
          options: () => [
            { value: 'A', label: 'Alpha' },
            { value: 'B', label: 'Beta' },
          ],
          set,
        },
      },
      features: [symbolSearch()],
    });
    ui.symbols!.open({ query: 'beta' });
    expect(ui.symbols!.state.results.map((r) => r.symbol)).toEqual(['B']);
    ui.symbols!.handleKey({ key: 'Enter' });
    expect(set).toHaveBeenCalledWith('B');
  });

  it('adds comparisons in compare mode', async () => {
    const add = vi.fn();
    ui = new ChartUi(chart, {
      capabilities: { symbols: staticSource(), compare: { add } },
      features: [symbolSearch()],
    });
    await ui.execute('header.compare', 'header');
    expect(ui.symbols!.state).toMatchObject({ open: true, purpose: 'compare', surface: 'modal' });
    await ui.symbols!.select(LIST[2]!);
    expect(add).toHaveBeenCalledWith(LIST[2]);
  });

  it('removes everything it added when uninstalled', () => {
    ui = new ChartUi(chart, {
      capabilities: { symbols: staticSource() },
      features: [symbolSearch()],
    });
    expect(ui.actions.get('symbols.picker')).toBeDefined();
    ui.removeFeature('symbols');
    expect(ui.symbols).toBeNull();
    expect(ui.actions.get('symbols.picker')).toBeUndefined();
    expect(ui.settings.sections()).toHaveLength(0);
  });
});

// ───────────────────────────── price actions ─────────────────────────────

function contextEvent(
  chartX: number,
  chartY: number,
  source: 'mouse' | 'touch' = 'mouse',
): ContextMenuEvent {
  const price = candles.coordinateToPrice(chartY);
  return {
    x: chartX,
    y: chartY,
    clientX: chartX,
    clientY: chartY,
    region: 'pane',
    pane: 0,
    paneX: chartX,
    paneY: chartY,
    pointerType: source === 'touch' ? 'touch' : 'mouse',
    button: 2,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    source,
    side: null,
    time: bars[150]!.time,
    logical: 150,
    price,
    series: [],
    defaultPrevented: false,
    preventDefault: () => undefined,
  };
}

const trading = (
  submit: TradingCapability['submit'] = vi.fn(async () => ({ ok: true, message: 'Accepted #1' })),
): TradingCapability => ({
  submit,
  simulatedLabel: 'SIMULATED',
});

describe('price actions', () => {
  it('lists "At this price" actions first in the context menu, with the rounded price', () => {
    const alerts = { create: vi.fn() };
    ui = new ChartUi(chart, {
      capabilities: { alerts, trading: trading() },
      features: [priceActions(), orderTicket()],
    });
    const target = ui.targets.resolve(contextEvent(300, 120));
    const ctx = ui.context(target, 'contextMenu');
    const steps = ctx.price!.price / 0.05;
    expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-9);
    expect(ctx.price!.price).toBe(roundToTick(target.price!, 0.05));
    expect(ctx.price!.side).toBe(ctx.price!.price < last ? 'below' : 'above');
    const labels = items(ui.contextMenu.entriesFor(target)).map((e) => e.label);
    const formatted = ctx.price!.formatted;
    const expected =
      ctx.price!.side === 'above'
        ? [`Buy stop at ${formatted}`, `Sell limit at ${formatted}`]
        : [`Buy limit at ${formatted}`, `Sell stop at ${formatted}`];
    expect(labels.slice(0, 5)).toEqual([
      ...expected,
      `Order at ${formatted}`,
      `Create alert at ${formatted}`,
      `Copy price ${formatted}`,
    ]);
    // The duplicate point alert is replaced by the price action.
    expect(labels.filter((l) => l.startsWith('Create alert'))).toHaveLength(1);
  });

  it('offers nothing new without the feature (the app keeps the current behaviour)', () => {
    ui = new ChartUi(chart, { capabilities: { alerts: { create: vi.fn() } } });
    const target = ui.targets.resolve(contextEvent(300, 120));
    expect(ui.context(target, 'contextMenu').price).toBeNull();
    const labels = items(ui.contextMenu.entriesFor(target)).map((e) => e.label);
    expect(labels.some((l) => l.startsWith('Buy'))).toBe(false);
    expect(labels.some((l) => l.startsWith('Create alert'))).toBe(true);
  });

  it('respects switched-off entry points', () => {
    ui = new ChartUi(chart, {
      capabilities: { alerts: { create: vi.fn() } },
      features: [priceActions({ contextMenu: false, axisButton: false, touch: false })],
    });
    const target = ui.targets.resolve(contextEvent(300, 120));
    expect(
      items(ui.contextMenu.entriesFor(target)).some((e) => e.label.startsWith('Create alert at')),
    ).toBe(false);
    chart.setCrosshairPosition(bars[150]!.time, last);
    expect(ui.priceActions!.button()).toBeNull();
  });

  it('runs custom actions with the price context, dynamic labels and submenus', async () => {
    const run = vi.fn();
    ui = new ChartUi(chart, { features: [priceActions({ builtins: false })] });
    ui.priceActions!.register({
      id: 'app.measure',
      label: 'Measure from {price}',
      submenu: (ctx) => [
        { id: 'a', label: `From ${ctx.price!.formatted}`, run: () => run(ctx.price) },
      ],
    });
    const price = ui.priceActions!.contextAt({ price: 101.234, pane: 0, source: 'api' })!;
    expect(price.price).toBe(101.25);
    const [entry] = items(ui.priceActions!.entries(price));
    expect(entry!.label).toBe('Measure from 101.25');
    const child = entry!.children![0] as MenuItemEntry;
    expect(child.type).toBe('item');
    await child.run!();
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ price: 101.25, source: 'api' }));
  });

  it('shows the "+" button at the crosshair and opens the same menu there', () => {
    ui = new ChartUi(chart, {
      capabilities: { alerts: { create: vi.fn() } },
      features: [priceActions()],
    });
    const changes = vi.fn();
    ui.priceActions!.on('button', changes);
    // Programmatic crosshairs (sync) do not show the button.
    chart.setCrosshairPosition(bars[150]!.time, last);
    chart.render();
    expect(ui.priceActions!.button()).toBeNull();
    const overlay = chart
      .element()
      .querySelector<HTMLCanvasElement>('canvas[data-layer="overlay"]')!;
    const Ctor = ((globalThis as { PointerEvent?: typeof PointerEvent }).PointerEvent ??
      MouseEvent) as typeof PointerEvent;
    overlay.dispatchEvent(
      new Ctor('pointermove', {
        clientX: 300,
        clientY: 150,
        bubbles: true,
        pointerType: 'mouse',
        pointerId: 1,
      }),
    );
    chart.render();
    const state = ui.priceActions!.button();
    expect(state).not.toBeNull();
    expect(state!.y).toBe(150);
    expect(state!.axisX).toBe(800 - chart.priceScale('right').width());
    expect(state!.price.source).toBe('axisButton');
    expect(ui.priceActions!.openMenu(10, 10, state!.price)).toBe(true);
    expect(items(ui.menu.state.entries).map((e) => e.label)[0]).toMatch(/^Create alert at /);
    // Users can hide it.
    ui.preferences.update({ trade: { axisButton: false } });
    expect(ui.priceActions!.button()).toBeNull();
    overlay.dispatchEvent(
      new Ctor('pointermove', {
        clientX: 310,
        clientY: 160,
        bubbles: true,
        pointerType: 'mouse',
        pointerId: 1,
      }),
    );
    chart.render();
    expect(ui.priceActions!.button()).toBeNull();
  });

  it('runs shortcuts at the crosshair price only when enabled', () => {
    const create = vi.fn();
    const key = { key: 'a', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false };
    ui = new ChartUi(chart, { capabilities: { alerts: { create } }, features: [priceActions()] });
    chart.setCrosshairPosition(bars[150]!.time, last);
    chart.render();
    expect(ui.handleKeyDown(key)).toBe(false);
    ui.destroy();
    ui = new ChartUi(chart, {
      capabilities: { alerts: { create } },
      features: [priceActions({ shortcuts: true })],
    });
    expect(ui.handleKeyDown(key)).toBe(false); // no crosshair yet
    chart.setCrosshairPosition(bars[150]!.time, last);
    chart.render();
    expect(ui.handleKeyDown(key)).toBe(true);
    const price = ((create.mock.calls[0] as unknown[])[0] as { price: number }).price;
    expect(Math.abs(price - last)).toBeLessThanOrEqual(0.05);
    expect(price).toBe(roundToTick(price, 0.05));
  });

  it('opens the price menu on touch long-press, with the full menu one tap away', () => {
    ui = new ChartUi(chart, {
      capabilities: { alerts: { create: vi.fn() } },
      features: [priceActions()],
    });
    const event = contextEvent(300, 120, 'touch');
    (ui as unknown as { onContextMenu(e: ContextMenuEvent): void }).onContextMenu(event);
    const labels = items(ui.menu.state.entries).map((e) => e.label);
    expect(labels[0]).toMatch(/^Create alert at/);
    expect(labels[labels.length - 1]).toBe('More chart actions…');
    items(ui.menu.state.entries).pop()!.run!();
    expect(items(ui.menu.state.entries).map((e) => e.label)).toContain('Reset chart view');
  });
});

// ───────────────────────────── order ticket ─────────────────────────────

describe('order ticket', () => {
  it('parses numbers in Latin, Persian and Arabic digits', () => {
    expect(parseTicketNumber('1,234.5')).toBe(1234.5);
    expect(parseTicketNumber('۱۲۳٫۵')).toBe(123.5);
    expect(parseTicketNumber('١٢٣')).toBe(123);
    expect(parseTicketNumber('−2')).toBe(-2);
    for (const bad of ['', 'abc', '1.2.3', '1e', '0x10', null])
      expect(parseTicketNumber(bad)).toBeNaN();
  });

  it('validates fields declared by the application', () => {
    const fields: TicketField[] = [
      { id: 'side', label: 'Side', kind: 'side', required: true },
      { id: 'price', label: 'Price', kind: 'price', required: true },
      { id: 'quantity', label: 'Qty', kind: 'number', required: true, min: 1, max: 10 },
      { id: 'tif', label: 'TIF', kind: 'select', options: [{ value: 'gtc', label: 'GTC' }] },
      {
        id: 'stop',
        label: 'Stop',
        kind: 'price',
        required: true,
        visible: (v) => v['type'] === 'stopLimit',
      },
      {
        id: 'note',
        label: 'Note',
        kind: 'text',
        maxLength: 5,
        validate: (v) => (v === 'nope' ? 'No' : null),
      },
    ];
    expect(
      validateTicket(
        fields,
        { side: 'buy', price: 1.05, quantity: 2, tif: 'gtc', note: 'ok' },
        0.05,
      ),
    ).toEqual({});
    expect(
      validateTicket(
        fields,
        { side: 'hold', price: 1.07, quantity: 20, tif: 'ioc', note: 'nope' },
        0.05,
      ),
    ).toEqual({
      side: 'order.error.invalid',
      price: 'order.error.tick',
      quantity: 'order.error.max',
      tif: 'order.error.invalid',
      note: 'No',
    });
    expect(
      validateTicket(fields, { side: 'buy', price: null, quantity: Number.NaN }, 0),
    ).toMatchObject({
      price: 'order.error.required',
      quantity: 'order.error.number',
    });
    expect(
      validateTicket(fields, { type: 'stopLimit', side: 'buy', price: 1, quantity: 1 }, 0),
    ).toMatchObject({
      stop: 'order.error.required',
    });
  });

  it('goes idle → confirming → submitting → accepted, prefilled from the price action', async () => {
    let resolve!: (r: { ok: boolean; message?: string }) => void;
    const submit = vi.fn(
      () => new Promise<{ ok: boolean; message?: string }>((r) => (resolve = r)),
    );
    ui = new ChartUi(chart, {
      capabilities: { trading: trading(submit), symbols: staticSource('ACME') },
      features: [priceActions(), orderTicket()],
    });
    const price = ui.priceActions!.contextAt({ price: last - 3, pane: 0, source: 'contextMenu' })!;
    await ui.priceActions!.run('price.buy', price);
    const ticket = ui.orderTicket!;
    expect(ticket.state).toMatchObject({
      open: true,
      side: 'buy',
      type: 'limit',
      status: 'idle',
      simulated: 'SIMULATED',
    });
    expect(ticket.state.values).toMatchObject({
      side: 'buy',
      type: 'limit',
      price: price.price,
      quantity: 1,
    });
    await ticket.submit();
    expect(ticket.state.status).toBe('confirming');
    expect(submit).not.toHaveBeenCalled();
    const sending = ticket.confirm();
    expect(ticket.state.status).toBe('submitting');
    // Double submission is refused while pending.
    await ticket.submit();
    await ticket.confirm();
    expect(submit).toHaveBeenCalledOnce();
    const submission = (submit.mock.calls[0] as unknown as [OrderTicketSubmission])[0];
    expect(submission).toMatchObject({
      side: 'buy',
      type: 'limit',
      symbol: 'ACME',
      values: { price: price.price, quantity: 1 },
    });
    resolve({ ok: true, message: 'Order 42 accepted' });
    await sending;
    expect(ticket.state).toMatchObject({ status: 'accepted', message: 'Order 42 accepted' });
    // No automatic resubmission: an accepted ticket needs a change first.
    await ticket.submit();
    expect(ticket.state.status).toBe('accepted');
    ticket.setValue('quantity', '۳');
    expect(ticket.state).toMatchObject({ status: 'idle', values: { quantity: 3 } });
  });

  it('shows rejections and thrown errors as plain text, without retrying', async () => {
    const submit = vi.fn(async () => {
      throw new Error('Insufficient margin\u0000');
    });
    ui = new ChartUi(chart, {
      capabilities: { trading: { submit, allowSkipConfirmation: true } },
      features: [orderTicket()],
    });
    ui.preferences.update({ trade: { confirmOrders: false } });
    const ticket = ui.orderTicket!;
    ticket.open({ side: 'sell', price: null, values: { price: 100 } });
    expect(ticket.confirmationRequired()).toBe(false);
    await ticket.submit();
    expect(ticket.state).toMatchObject({ status: 'rejected', message: 'Insufficient margin' });
    expect(submit).toHaveBeenCalledOnce();
  });

  it('always confirms unless the application allows skipping it', () => {
    ui = new ChartUi(chart, { capabilities: { trading: trading() }, features: [orderTicket()] });
    ui.preferences.update({ trade: { confirmOrders: false } });
    expect(ui.orderTicket!.confirmationRequired()).toBe(true);
    // No setting is offered either.
    expect(ui.settings.sections().flatMap((s) => s.fields())).toHaveLength(0);
  });

  it('blocks invalid values and steps prices by the tick size', async () => {
    const submit = vi.fn(async () => ({ ok: true }));
    ui = new ChartUi(chart, {
      capabilities: { trading: trading(submit) },
      features: [orderTicket()],
    });
    const ticket = ui.orderTicket!;
    ticket.open({ side: 'buy', values: { price: 100 } });
    ticket.setValue('quantity', '0');
    expect(ticket.errors()).toEqual({ quantity: 'Must be greater than zero' });
    await ticket.submit();
    expect(ticket.state.status).toBe('idle');
    expect(submit).not.toHaveBeenCalled();
    ticket.step('price', 1);
    expect(ticket.state.values['price']).toBe(100.05);
  });
});
