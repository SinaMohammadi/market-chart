// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChart } from '@market-chart/core';
import type { ChartApi, ContextMenuEvent } from '@market-chart/core';
import { clearDrawnTexts, drawnTexts, installCanvasMock } from '../canvas-mock.js';
import { DAY, HOUR, generateBars } from '../synthetic.js';

let restore: () => void = () => undefined;
let container: HTMLDivElement;
let chart: ChartApi;
const bars = generateBars({ count: 200, interval: HOUR, seed: 12, startPrice: 1234.5 });

beforeEach(() => {
  restore = installCanvasMock();
  container = document.createElement('div');
  document.body.appendChild(container);
  chart = createChart(container, { autoSize: false, width: 600, height: 300 });
});

afterEach(() => {
  if (!chart.destroyed) chart.destroy();
  container.remove();
  restore();
});

const canvases = () => [...chart.element().querySelectorAll('canvas')] as HTMLCanvasElement[];
const texts = (canvas: HTMLCanvasElement) => drawnTexts(canvas.getContext('2d')!);

/** These read text drawn on the recording canvas mock (jsdom); real browsers draw on a real canvas. */
const fakeCanvas = /jsdom/i.test(globalThis.navigator?.userAgent ?? '');

describe('locale and direction API', () => {
  it('switches locale and direction without recreating the chart, with events', () => {
    const series = chart.addSeries('candlestick');
    series.setData(bars);
    const events: string[] = [];
    chart.on('localeChange', (e) => events.push(`locale:${e.locale}`));
    chart.on('directionChange', (e) => events.push(`dir:${e.direction}`));
    const element = chart.element();
    chart.setLocale('fa-IR');
    chart.setDirection('rtl');
    chart.setLocale('fa-IR'); // no-op
    expect(chart.getLocale()).toBe('fa-IR');
    expect(chart.getDirection()).toBe('rtl');
    expect(element.dir).toBe('rtl');
    expect(chart.element()).toBe(element);
    expect(series.length()).toBe(200);
    expect(events).toEqual(['locale:fa-IR', 'dir:rtl']);
    expect(() => chart.setLocale('')).toThrow(/setLocale/);
    expect(() => chart.applyOptions({ localization: { direction: 'up' as never } })).toThrow(
      /direction/,
    );
  });
});

describe.skipIf(!fakeCanvas)('locale-aware canvas text', () => {
  it('uses Latin digits and the Gregorian calendar by default, locale digits on request', () => {
    chart
      .addSeries('candlestick')
      .setData(generateBars({ count: 200, interval: DAY, seed: 3, startPrice: 1234.5 }));
    chart.timeScale().fitContent();
    chart.applyOptions({ localization: { locale: 'fa-IR' } });
    chart.render();
    const main = canvases()[0]!;
    const before = texts(main).map((t) => t.text);
    expect(before.some((t) => /\d/.test(t))).toBe(true);
    expect(before.some((t) => /[۰-۹]/.test(t))).toBe(false);
    // Gregorian month names in Persian ("مارس" = March), not Solar Hijri ones ("فروردین", "اسفند").
    expect(before).toContain('مارس');
    expect(before.some((t) => t.includes('فروردین') || t.includes('اسفند'))).toBe(false);
    clearDrawnTexts(main.getContext('2d')!);
    chart.applyOptions({ localization: { localizeNumbers: true } });
    chart.render();
    const after = texts(main).map((t) => t.text);
    expect(after.some((t) => /[۰-۹]/.test(t))).toBe(true);
    expect(after.filter((t) => /^[\d.,\s-]+$/.test(t))).toEqual([]);
  });

  it('draws canvas text with the chart direction; titles start at the reading-direction edge', () => {
    const series = chart.addSeries('line');
    series.setData(bars.map((b) => ({ time: b.time, value: b.close })));
    series.createPriceLine({ price: bars[150]!.close, title: 'هدف' });
    chart.setDirection('rtl');
    chart.render();
    const title = texts(canvases()[0]!).find((t) => t.text === 'هدف')!;
    expect(title.direction).toBe('rtl');
    expect(title.textAlign).toBe('right');
    expect(title.x).toBeGreaterThan(300);
    chart.setDirection('ltr');
    clearDrawnTexts(canvases()[0]!.getContext('2d')!);
    chart.render();
    const ltr = texts(canvases()[0]!).find((t) => t.text === 'هدف')!;
    expect(ltr.textAlign).toBe('left');
    expect(ltr.x).toBeLessThan(50);
  });
});

describe('contextMenu event', () => {
  const overlay = () => canvases()[canvases().length - 1]!;
  const rightClick = (x: number, y: number) => {
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
  };

  it('keeps the browser menu when nobody listens', () => {
    chart.addSeries('candlestick').setData(bars);
    chart.render();
    expect(rightClick(200, 100).defaultPrevented).toBe(false);
  });

  it('describes pane points with time, price and the series under the pointer', () => {
    const candles = chart.addSeries('candlestick');
    candles.setData(bars);
    chart.render();
    const events: ContextMenuEvent[] = [];
    chart.on('contextMenu', (e) => events.push(e));
    // Point at the middle of a visible candle.
    const range = chart.timeScale().getVisibleLogicalRange()!;
    const index = Math.round((range.from + range.to) / 2);
    const bar = bars[index]!;
    const x = chart.timeScale().logicalToCoordinate(index);
    const y = candles.priceToCoordinate((bar.high + bar.low) / 2)!;
    const native = rightClick(x, y);
    expect(native.defaultPrevented).toBe(true);
    const e = events[0]!;
    expect(e.region).toBe('pane');
    expect(e.pane).toBe(0);
    expect(e.source).toBe('mouse');
    expect(e.time).toBe(bar.time);
    expect(e.price!).toBeGreaterThanOrEqual(bar.low);
    expect(e.price!).toBeLessThanOrEqual(bar.high);
    expect(e.series[0]?.series).toBe(candles);
    expect(e.series[0]?.distance).toBe(0);
    expect(e.series[0]?.point).toMatchObject({ time: bar.time, close: bar.close });
    // Far above the candle: background, no series hit.
    rightClick(x, 2);
    expect(events[1]!.series).toEqual([]);
  });

  it('reports the price and time axes', () => {
    chart.addSeries('candlestick').setData(bars);
    chart.render();
    const events: ContextMenuEvent[] = [];
    chart.on('contextMenu', (e) => events.push(e));
    rightClick(595, 100);
    rightClick(200, 295);
    expect(events.map((e) => [e.region, e.side])).toEqual([
      ['priceAxis', 'right'],
      ['timeAxis', null],
    ]);
    expect(events[0]!.price).not.toBeNull();
  });

  it('opens from the keyboard (ContextMenu key and Shift+F10)', () => {
    chart.addSeries('candlestick').setData(bars);
    chart.render();
    const sources: string[] = [];
    chart.on('contextMenu', (e) => sources.push(`${e.source}:${e.region}`));
    const key = (init: KeyboardEventInit) => {
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
      overlay().dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(key({ key: 'ContextMenu' })).toBe(true);
    expect(key({ key: 'F10', shiftKey: true })).toBe(true);
    expect(sources).toEqual(['keyboard:pane', 'keyboard:pane']);
  });
});
