// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createChart } from '@market-chart/core';
import type { ChartApi, SeriesApi } from '@market-chart/core';
import { DrawingManager } from '@market-chart/drawing-tools';
import { IndicatorManager } from '@market-chart/indicators';
import { HOUR, generateBars, installCanvasMock } from '@market-chart/testing';
import { createI18n } from '@market-chart/i18n';
import { ChartUi, UiPreferencesStore } from './index.js';
import type { LegendItem, MenuEntry } from './index.js';

let restore: () => void = () => undefined;
let container: HTMLDivElement;
let chart: ChartApi;
let candles: SeriesApi<'candlestick'>;
let ui: ChartUi;
let drawings: DrawingManager;
let indicators: IndicatorManager;
const bars = generateBars({ count: 200, interval: HOUR, seed: 21, startPrice: 100 });

beforeEach(() => {
  restore = installCanvasMock();
  container = document.createElement('div');
  document.body.appendChild(container);
  chart = createChart(container, { autoSize: false, width: 800, height: 400 });
  candles = chart.addSeries('candlestick');
  candles.setData(bars);
  drawings = new DrawingManager(chart);
  indicators = new IndicatorManager(chart);
  chart.render();
});

afterEach(() => {
  ui?.destroy();
  indicators.destroy();
  drawings.destroy();
  if (!chart.destroyed) chart.destroy();
  container.remove();
  restore();
});

const overlay = () => [...chart.element().querySelectorAll('canvas')].pop()!;
function rightClick(x: number, y: number): MouseEvent {
  // Chart coordinates → viewport coordinates (jsdom puts everything at 0,0; real browsers do not).
  const rect = overlay().getBoundingClientRect();
  const event = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: rect.left + x,
    clientY: rect.top + y,
    button: 2,
  });
  overlay().dispatchEvent(event);
  return event;
}
const labels = (entries: readonly MenuEntry[]) =>
  entries.map((e) => (e.type === 'item' ? e.label : '—'));
const candleCentre = (index: number) => {
  const bar = bars[index]!;
  return {
    x: chart.timeScale().logicalToCoordinate(index),
    y: candles.priceToCoordinate((bar.high + bar.low) / 2)!,
    bar,
  };
};

describe('ChartUi context menu', () => {
  it('shows chart actions on the background and candle actions on a candle', () => {
    ui = new ChartUi(chart, { capabilities: { drawings, indicators } });
    const range = chart.timeScale().getVisibleLogicalRange()!;
    const index = Math.round((range.from + range.to) / 2);
    rightClick(chart.timeScale().logicalToCoordinate(index), 3);
    expect(ui.menu.state.open).toBe(true);
    expect(ui.menu.state.target?.kind).toBe('chart');
    const background = labels(ui.menu.state.entries);
    expect(background).toContain('Reset chart view');
    expect(background).toContain('Add indicator');
    expect(background).not.toContain('View OHLC');
    // Capabilities the app did not provide are not offered.
    expect(background).not.toContain('Timeframe');
    expect(background).not.toContain('Chart settings…');

    const { x, y, bar } = candleCentre(index);
    rightClick(x, y);
    expect(ui.menu.state.target?.kind).toBe('candlestick');
    const candle = labels(ui.menu.state.entries);
    expect(candle[0]).toBe('View OHLC');
    expect(candle).toContain('Reset chart view'); // general actions follow
    const ohlc = ui.menu.state.entries.find((e) => e.type === 'item' && e.label === 'View OHLC');
    expect(
      ohlc?.type === 'item' && ohlc.children?.map((c) => (c.type === 'item' ? c.label : ''))[3],
    ).toBe(`Close ${bar.close.toFixed(2)}`);
  });

  it('targets drawings, selects them, and runs drawing actions', () => {
    ui = new ChartUi(chart, { capabilities: { drawings, indicators } });
    const a = candleCentre(120);
    const line = drawings.add({
      type: 'horizontal-line',
      seriesId: candles.id,
      points: [{ time: a.bar.time, price: a.bar.high + 5 }],
    });
    chart.render();
    const y = candles.priceToCoordinate(a.bar.high + 5)!;
    rightClick(a.x + 40, y);
    expect(ui.menu.state.target?.kind).toBe('drawing');
    expect(drawings.selection()).toEqual([line.id]);
    const entries = ui.menu.state.entries;
    expect(labels(entries)).toEqual(
      expect.arrayContaining(['Duplicate', 'Lock', 'Hide', 'Bring to front', 'Delete']),
    );
    const lock = entries.findIndex((e) => e.type === 'item' && e.label === 'Lock');
    ui.menu.activate(0, lock);
    expect(drawings.get(line.id)!.locked).toBe(true);
    rightClick(a.x + 40, y);
    expect(labels(ui.menu.state.entries)).toContain('Unlock');
    const del = ui.menu.state.entries.findIndex((e) => e.type === 'item' && e.label === 'Delete');
    ui.menu.activate(0, del);
    expect(drawings.list()).toEqual([]);
  });

  it('targets indicators and moves them between panes', () => {
    ui = new ChartUi(chart, { capabilities: { drawings, indicators } });
    const rsi = indicators.add('rsi', candles);
    chart.render();
    expect(rsi.pane()).toBe(1);
    const series = [...rsi.series().values()][0]!;
    const index = 150;
    const value =
      rsi.valuesAt(bars[index]!.time)['rsi'] ?? Object.values(rsi.valuesAt(bars[index]!.time))[0]!;
    const paneTop = chart.panes()[0]!.height() + chart.options().panes.separatorHeight;
    rightClick(
      chart.timeScale().logicalToCoordinate(index),
      paneTop + series.priceToCoordinate(value!)!,
    );
    expect(ui.menu.state.target?.kind).toBe('indicator');
    expect(ui.menu.state.target?.indicator).toBe(rsi);
    expect(labels(ui.menu.state.entries)).toEqual(
      expect.arrayContaining(['Duplicate', 'Hide', 'Move to', 'Reset settings', 'Remove']),
    );
    const move = ui.menu.state.entries.findIndex((e) => e.type === 'item' && e.label === 'Move to');
    ui.menu.activate(0, move);
    const level = ui.menu.levelEntries(1);
    expect(labels(level)).toEqual(['Main pane', 'Pane 2', '—', 'New pane below']);
    ui.menu.activate(1, 0);
    expect(rsi.pane()).toBe(0);
  });

  it('shows axis actions and changes scales', () => {
    ui = new ChartUi(chart, { capabilities: {} });
    rightClick(790, 100);
    expect(ui.menu.state.target?.kind).toBe('priceAxis');
    expect(labels(ui.menu.state.entries)).toEqual([
      'Reset scale',
      'Auto scale',
      'Invert scale',
      'Scale mode',
      '—',
      'Price labels on the chart',
    ]);
    ui.menu.activate(0, 2);
    expect(chart.priceScale('right').options().invertScale).toBe(true);
    rightClick(300, 395);
    expect(ui.menu.state.target?.kind).toBe('timeAxis');
    expect(labels(ui.menu.state.entries)).toContain('Reset time scale');
  });

  it('registers custom actions, respects visibility, enabled state and user-hidden items', () => {
    const run = vi.fn();
    ui = new ChartUi(chart, { capabilities: { drawings, indicators } });
    ui.contextMenu.register({
      id: 'custom.copy-price',
      label: 'Copy price!',
      icon: 'copy',
      targets: ['candlestick'],
      category: 'point',
      order: 1,
      run,
    });
    ui.contextMenu.register({
      id: 'custom.only-up',
      label: 'Only up bars',
      targets: ['candlestick'],
      isVisible: (ctx) =>
        (ctx.target?.point as { close: number }).close >
        (ctx.target?.point as { open: number }).open,
      run,
    });
    const range = chart.timeScale().getVisibleLogicalRange()!;
    const index = bars.findIndex(
      (b, i) => i > range.from + 5 && i < range.to - 5 && b.close < b.open && b.high - b.low > 0.5,
    );
    const { x, y } = candleCentre(index);
    rightClick(x, y);
    expect(labels(ui.menu.state.entries)[0]).toBe('Copy price!');
    expect(labels(ui.menu.state.entries)).not.toContain('Only up bars');
    ui.contextMenu.setEnabled('custom.copy-price', false);
    rightClick(x, y);
    expect(ui.menu.state.entries[0]).toMatchObject({ disabled: true });
    ui.contextMenu.setHidden('custom.copy-price', true);
    rightClick(x, y);
    expect(labels(ui.menu.state.entries)).not.toContain('Copy price!');
    expect(ui.preferences.get().contextMenu.hidden).toEqual(['custom.copy-price']);
    expect(ui.contextMenu.getActions('candlestick').map((a) => a.id)).toContain(
      'custom.copy-price',
    );
    expect(ui.contextMenu.unregister('custom.copy-price')).toBe(true);
  });
});

describe('ChartUi language and preferences', () => {
  it('switches language from preferences: menus, chart locale and direction follow without recreating the chart', () => {
    const i18n = createI18n();
    const preferences = new UiPreferencesStore({ autoSave: false });
    ui = new ChartUi(chart, { i18n, preferences, capabilities: { drawings, indicators } });
    const element = chart.element();
    preferences.update({ locale: 'fa', localDigits: true });
    expect(i18n.locale).toBe('fa');
    expect(chart.getLocale()).toBe('fa-IR');
    expect(chart.getDirection()).toBe('rtl');
    expect(chart.options().localization.localizeNumbers).toBe(true);
    expect(chart.element()).toBe(element);
    rightClick(400, 3);
    expect(labels(ui.menu.state.entries)).toContain('بازنشانی نمای نمودار');
    expect(ui.menu.state.direction).toBe('rtl');
    preferences.update({ direction: 'ltr' });
    expect(chart.getDirection()).toBe('ltr');
    preferences.update({ locale: 'ar', direction: 'auto' });
    expect(chart.getDirection()).toBe('rtl');
    preferences.update({ theme: 'light' });
    expect(chart.theme().name).toBe('light');
  });

  it('lays out the header and sidebar, and moves actions on request', () => {
    ui = new ChartUi(chart, {
      capabilities: {
        drawings,
        indicators,
        timeframe: { value: () => '1h', options: ['15m', '1h', '1D'], set: () => undefined },
      },
    });
    const header = ui.header();
    const ids = (groups: typeof header.left) =>
      groups.flatMap((g) => g.items.map((i) => i.action.id));
    expect(ids(header.left)).toEqual([
      'chart.timeframe',
      'header.indicators',
      'header.undo',
      'header.redo',
    ]);
    expect(ids(header.right)).toEqual(
      expect.arrayContaining(['chart.theme', 'header.language', 'header.screenshot']),
    );
    const sidebar = ui.sidebar();
    expect(sidebar.map((g) => g.id).slice(0, 3)).toEqual([
      'cursors',
      'tools.lines',
      'tools.shapes',
    ]);
    expect(sidebar.find((g) => g.id === 'tools.fibonacci')!.items).toHaveLength(7);
    ui.setActionVisible('header.undo', false);
    expect(ids(ui.header().left)).not.toContain('header.undo');
    ui.moveAction('header.indicators', { location: 'sidebar', index: 0 });
    expect(ids(ui.header().left)).not.toContain('header.indicators');
    expect(ui.sidebar()[0]!.items[0]!.action.id).toBe('header.indicators');
    // Hidden items keep their place (the settings list shows them): shifting moves past them one by one.
    const order = () =>
      ui
        .placements()
        .filter((i) => i.location === 'header' && i.section === 'left')
        .map((i) => i.action.id);
    expect(order()).toEqual([
      'chart.timeframe',
      'header.drawingTools',
      'header.undo',
      'header.redo',
    ]);
    ui.shiftAction('chart.timeframe', 1);
    expect(order()).toEqual([
      'header.drawingTools',
      'chart.timeframe',
      'header.undo',
      'header.redo',
    ]);
    ui.moveAction('chart.timeframe', { location: 'header', section: 'left', index: 99 });
    expect(ids(ui.header().left)).toEqual(['header.redo', 'chart.timeframe']);
    expect(() => ui.moveAction('header.undo', { location: 'sidebar' })).toThrow(/cannot be placed/);
    ui.preferences.reset();
    expect(ids(ui.header().left)).toEqual([
      'chart.timeframe',
      'header.indicators',
      'header.undo',
      'header.redo',
    ]);
  });

  it('runs shortcuts, respecting enabled state and user overrides', async () => {
    ui = new ChartUi(chart, { capabilities: { drawings, indicators } });
    const a = candleCentre(120);
    drawings.add({
      type: 'horizontal-line',
      seriesId: candles.id,
      points: [{ time: a.bar.time, price: a.bar.close }],
    });
    const key = (
      k: string,
      mods: Partial<{
        ctrlKey: boolean;
        shiftKey: boolean;
        altKey: boolean;
        metaKey: boolean;
      }> = {},
    ) =>
      ui.handleKeyDown({
        key: k,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        metaKey: false,
        ...mods,
      });
    expect(key('z', { ctrlKey: true })).toBe(true);
    await Promise.resolve();
    expect(drawings.list()).toHaveLength(0);
    expect(key('z', { ctrlKey: true, shiftKey: true })).toBe(true);
    await Promise.resolve();
    expect(drawings.list()).toHaveLength(1);
    ui.preferences.update({ shortcuts: { 'header.undo': 'Alt+U' } });
    expect(key('z', { ctrlKey: true })).toBe(false);
    expect(key('u', { altKey: true })).toBe(true);
    expect(key('q')).toBe(false);
  });

  it('cleans up on destroy', () => {
    ui = new ChartUi(chart, { capabilities: { drawings } });
    ui.destroy();
    rightClick(400, 3);
    expect(ui.menu.state.open).toBe(false);
  });
});

describe('legend and price markers', () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const item = (items: readonly LegendItem[], key: string): LegendItem =>
    items.find((i) => i.key === key)!;

  it('shows date, time, OHLC, change, volume and indicator values for the last or hovered bar', () => {
    const vol = chart.addSeries('histogram', {
      priceScaleId: 'volume',
      priceFormat: { type: 'volume' },
    });
    vol.setData(bars.map((b) => ({ time: b.time, value: b.volume ?? 1000 })));
    const sma = indicators.add('sma', candles, { params: { length: 5 } });
    ui = new ChartUi(chart, {
      capabilities: { drawings, indicators, symbol: { value: () => 'SYN:TEST', set: () => {} } },
    });
    const last = bars[bars.length - 1]!;
    const before = bars[bars.length - 2]!;
    const data = ui.legend();
    expect(data.hovered).toBe(false);
    expect(data.time).toBe(last.time);
    expect(data.title).toBe('SYN:TEST');
    expect(data.series).toBe(candles);
    expect(data.timeItems.map((i) => i.key)).toEqual(['date', 'time']);
    expect(item(data.items, 'open').value).toBe(last.open);
    expect(item(data.items, 'high').value).toBe(last.high);
    expect(item(data.items, 'low').value).toBe(last.low);
    expect(item(data.items, 'close').text).toBe(last.close.toFixed(2));
    expect(item(data.items, 'close').trend).toBe(
      last.close >= last.open ? (last.close > last.open ? 'up' : 'flat') : 'down',
    );
    expect(item(data.items, 'change').value).toBeCloseTo(last.close - before.close, 8);
    expect(item(data.items, 'change').text).toMatch(/%\)$/);
    expect(item(data.items, 'volume').value).toBe(last.volume ?? 1000);
    expect(data.indicators).toHaveLength(1);
    expect(data.indicators[0]!.indicator).toBe(sma);
    const expected = bars.slice(-5).reduce((s, b) => s + b.close, 0) / 5;
    expect(data.indicators[0]!.items[0]!.value).toBeCloseTo(expected, 8);

    // The hovered bar replaces the last one.
    const hovered = ui.legend(bars[50]!.time);
    expect(hovered.hovered).toBe(true);
    expect(item(hovered.items, 'open').value).toBe(bars[50]!.open);
  });

  it('follows the legend preferences and the language', () => {
    ui = new ChartUi(chart, { capabilities: { indicators } });
    ui.preferences.update({ legend: { fields: { timestamp: true, open: false, date: false } } });
    let data = ui.legend();
    expect(data.timeItems.map((i) => i.key)).toEqual(['time', 'timestamp']);
    expect(item(data.timeItems, 'timestamp').text).toBe(String(bars[bars.length - 1]!.time));
    expect(data.items.find((i) => i.key === 'open')).toBeUndefined();
    // Translated labels; digits stay Latin, like the axes, until the user asks for local digits.
    ui.preferences.update({ locale: 'fa' });
    data = ui.legend();
    expect(data.items.find((i) => i.key === 'close')!.label).toBe('بسته');
    expect(item(data.items, 'change').text).toMatch(/^[+−]?[\d.,]+ \([+−]?[\d.,]+%\)$/);
    expect(item(data.timeItems, 'time').text).toMatch(/^[\d:]+$/);
    ui.preferences.update({ localDigits: true });
    data = ui.legend();
    expect(item(data.timeItems, 'time').text).toMatch(/^[۰-۹:]+$/);
    expect(item(data.items, 'high')).toMatchObject({ value: bars[bars.length - 1]!.high });
    expect(data.items.find((i) => i.key === 'high')!.label).toBe('سقف');
    expect(item(data.items, 'close').text).toMatch(/^[۰-۹٫٬]+$/);
    expect(item(data.timeItems, 'timestamp').text).toMatch(/^[۰-۹]+$/);
  });

  it('marks the visible high and low and the previous close with price lines', async () => {
    ui = new ChartUi(chart, { capabilities: { drawings, indicators } });
    expect(candles.priceLines()).toHaveLength(0);
    ui.preferences.update({ markers: { highLow: true, previousClose: true } });
    await flush();
    const range = chart.timeScale().getVisibleLogicalRange()!;
    const visible = bars.slice(Math.max(0, Math.ceil(range.from)), Math.floor(range.to) + 1);
    const high = Math.max(...visible.map((b) => b.high));
    const low = Math.min(...visible.map((b) => b.low));
    const prices = candles.priceLines().map((l) => l.options().price);
    expect(prices).toContain(high);
    expect(prices).toContain(low);
    expect(prices).toContain(bars[bars.length - 2]!.close);
    expect(ui.markers.values()).toMatchObject({
      high: { price: high },
      low: { price: low },
      previousClose: bars[bars.length - 2]!.close,
    });
    // Scrolling to older bars moves the high/low lines.
    chart.timeScale().setVisibleLogicalRange({ from: 10, to: 40 });
    chart.render();
    await flush();
    const older = bars.slice(10, 41);
    expect(candles.priceLines().map((l) => l.options().price)).toContain(
      Math.max(...older.map((b) => b.high)),
    );
    // Titles follow the language.
    ui.preferences.update({ locale: 'fa' });
    await flush();
    expect(candles.priceLines().map((l) => l.options().title)).toContain('سقف');
    ui.preferences.update({ markers: { highLow: false, previousClose: false } });
    await flush();
    expect(candles.priceLines()).toHaveLength(0);
    ui.preferences.update({ markers: { highLow: true } });
    await flush();
    ui.destroy();
    expect(candles.priceLines()).toHaveLength(0);
  });

  it('switches the last-price line and axis labels only when the user changes them', async () => {
    candles.applyOptions({ lastValueVisible: false });
    const sma = indicators.add('sma', candles, { params: { length: 5 } });
    ui = new ChartUi(chart, { capabilities: { indicators } });
    await flush();
    // Defaults leave the application's own series options alone.
    expect(candles.options().lastValueVisible).toBe(false);
    expect(candles.options().priceLineVisible).toBe(true);
    ui.preferences.update({ markers: { lastPriceLine: false, indicatorLabels: false } });
    await flush();
    expect(candles.options().priceLineVisible).toBe(false);
    expect([...sma.series().values()].every((s) => !s.options().lastValueVisible)).toBe(true);
    const ema = indicators.add('ema', candles, { params: { length: 9 } });
    await flush();
    expect([...ema.series().values()].every((s) => !s.options().lastValueVisible)).toBe(true);
    ui.preferences.update({ markers: { lastPriceLine: true, indicatorLabels: true } });
    await flush();
    expect(candles.options().priceLineVisible).toBe(true);
    expect([...ema.series().values()].every((s) => s.options().lastValueVisible)).toBe(true);
  });

  it('offers legend and price-label toggles in the chart context menu', async () => {
    ui = new ChartUi(chart, { capabilities: { indicators } });
    rightClick(400, 3);
    const entries = ui.menu.state.entries;
    const legend = entries.find((e) => e.type === 'item' && e.actionId === 'chart.legend');
    const labelsEntry = entries.find(
      (e) => e.type === 'item' && e.actionId === 'chart.priceLabels',
    );
    expect(legend).toBeDefined();
    expect(labelsEntry).toBeDefined();
    ui.menu.close();
    await ui.actions.execute('chart.legend');
    expect(ui.preferences.get().legend.visible).toBe(false);
    const items = ui.registry.get('chart.priceLabels')!.submenu!(ui.context());
    expect(items.map((i) => i.id)).toEqual([
      'highLow',
      'previousClose',
      'lastPriceLine',
      'lastValueLabel',
      'indicatorLabels',
    ]);
    await items[0]!.run!();
    expect(ui.preferences.get().markers.highLow).toBe(true);
  });
});
