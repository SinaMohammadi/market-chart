// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createChart } from '@market-chart/core';
import type { ChartApi, SeriesApi } from '@market-chart/core';
import { HOUR, generateBars, installCanvasMock } from '@market-chart/testing';
import { DrawingManager, MAX_LOADED_DRAWINGS } from './manager.js';
import { builtInTools } from './tools/index.js';
import type { Anchor } from './types.js';

let restore: () => void = () => undefined;
let container: HTMLDivElement;
let chart: ChartApi;
let candles: SeriesApi<'candlestick'>;
let manager: DrawingManager;
const bars = generateBars({ count: 200, interval: HOUR, seed: 4 });

beforeEach(() => {
  restore = installCanvasMock();
  container = document.createElement('div');
  document.body.appendChild(container);
  chart = createChart(container, { autoSize: false, width: 800, height: 500 });
  candles = chart.addSeries('candlestick');
  candles.setData(bars);
  chart.timeScale().setVisibleLogicalRange({ from: 100, to: 199 });
  chart.render();
  manager = new DrawingManager(chart);
});

afterEach(() => {
  if (!chart.destroyed) chart.destroy();
  container.remove();
  restore();
});

const overlay = (): HTMLElement => chart.element().querySelector('canvas[data-layer="overlay"]')!;

/** Chart coordinates of a bar index and price (pane 0 starts at y = 0, no left axis). */
function at(bar: number, price: number): { x: number; y: number } {
  return { x: chart.timeScale().logicalToCoordinate(bar), y: candles.priceToCoordinate(price)! };
}

function pointer(
  type: string,
  p: { x: number; y: number },
  extra: Record<string, unknown> = {},
): void {
  const el = overlay();
  const rect = el.getBoundingClientRect();
  const Ctor = (globalThis as { PointerEvent?: typeof MouseEvent }).PointerEvent ?? MouseEvent;
  const init = {
    clientX: rect.left + p.x,
    clientY: rect.top + p.y,
    bubbles: true,
    button: 0,
    pointerId: 3,
    pointerType: 'mouse',
    ...extra,
  };
  el.dispatchEvent(new Ctor(type, init));
}

function click(p: { x: number; y: number }, extra: Record<string, unknown> = {}): void {
  pointer('pointerdown', p, extra);
  pointer('pointerup', p, extra);
}

function drag(
  from: { x: number; y: number },
  to: { x: number; y: number },
  extra: Record<string, unknown> = {},
): void {
  pointer('pointerdown', from, extra);
  pointer('pointermove', { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, extra);
  pointer('pointermove', to, extra);
  pointer('pointerup', to, extra);
}

function key(k: string, extra: Record<string, unknown> = {}): void {
  overlay().dispatchEvent(
    new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }),
  );
}

const mid = (bar: number) => {
  const b = bars[bar]!;
  return (b.high + b.low) / 2;
};

describe('DrawingManager', () => {
  it('creates a trend line with two clicks, snapped to bars, and returns to the cursor', () => {
    manager.setActiveTool('trend-line');
    click(at(120.3, mid(120)));
    pointer('pointermove', at(150, mid(150)));
    click(at(150, mid(150)));
    const [line] = manager.list();
    expect(line!.type).toBe('trend-line');
    expect(line!.points[0]!.time).toBe(bars[120]!.time);
    expect(line!.points[1]!.time).toBe(bars[150]!.time);
    expect(line!.points[1]!.price).toBeCloseTo(mid(150), 0);
    expect(manager.activeTool()).toBeNull();
    expect(manager.selection()).toEqual([line!.id]);
    chart.render();
  });

  it('creates a rectangle by dragging and does not pan the chart', () => {
    const before = chart.timeScale().getVisibleLogicalRange()!;
    manager.setActiveTool('rectangle');
    drag(at(110, mid(110)), at(130, mid(130)));
    expect(manager.list()).toHaveLength(1);
    expect(chart.timeScale().getVisibleLogicalRange()!.from).toBeCloseTo(before.from, 6);
  });

  it('places three-point tools with clicks', () => {
    manager.setActiveTool('parallel-channel');
    click(at(110, mid(110)));
    click(at(140, mid(140)));
    expect(manager.list()).toHaveLength(0);
    click(at(125, mid(125) * 1.01));
    expect(manager.list()[0]!.points).toHaveLength(3);
  });

  it('creates one-click position tools', () => {
    manager.setActiveTool('long-position');
    click(at(150, mid(150)));
    const [position] = manager.list();
    expect(position!.points).toHaveLength(3);
    expect(position!.points[1]!.price).toBeGreaterThan(position!.points[0]!.price);
  });

  it('selects, moves with undo/redo, and deletes with the keyboard', () => {
    const line = manager.add({
      type: 'trend-line',
      points: [
        { time: bars[120]!.time, price: mid(120) },
        { time: bars[150]!.time, price: mid(150) },
      ],
    });
    chart.render();
    const start = at(135, (mid(120) + mid(150)) / 2);
    drag(start, { x: start.x + chart.timeScale().barSpacing() * 10, y: start.y });
    const moved = manager.get(line.id)!;
    expect(moved.points[0]!.time).toBe(bars[130]!.time);
    expect(manager.canUndo()).toBe(true);
    key('z', { ctrlKey: true });
    expect(manager.get(line.id)!.points[0]!.time).toBe(bars[120]!.time);
    key('z', { ctrlKey: true, shiftKey: true });
    expect(manager.get(line.id)!.points[0]!.time).toBe(bars[130]!.time);
    manager.select([line.id]);
    key('Delete');
    expect(manager.list()).toHaveLength(0);
    key('z', { ctrlKey: true });
    expect(manager.list()).toHaveLength(1);
  });

  it('edits a single anchor by dragging its handle', () => {
    const line = manager.add({
      type: 'trend-line',
      points: [
        { time: bars[120]!.time, price: mid(120) },
        { time: bars[150]!.time, price: mid(150) },
      ],
    });
    manager.select([line.id]);
    chart.render();
    drag(at(150, mid(150)), at(170, mid(150)));
    const edited = manager.get(line.id)!;
    expect(edited.points[0]!.time).toBe(bars[120]!.time);
    expect(edited.points[1]!.time).toBe(bars[170]!.time);
  });

  it('on touch: larger handles, and a long press opens the context menu instead of moving', () => {
    vi.useFakeTimers();
    try {
      chart.applyOptions({ interaction: { touchContextMenu: true } });
      const menus: { paneX: number; paneY: number; pane: number | null; source: string }[] = [];
      chart.on('contextMenu', (e) => menus.push(e));
      const line = manager.add({
        type: 'trend-line',
        points: [
          { time: bars[120]!.time, price: mid(120) },
          { time: bars[150]!.time, price: mid(150) },
        ],
      });
      manager.select([line.id]);
      chart.render();
      // jsdom has no PointerEvent: mark mouse events as touches.
      const touch = (type: string, p: { x: number; y: number }) => {
        const el = overlay();
        const rect = el.getBoundingClientRect();
        const event = new MouseEvent(type, {
          clientX: rect.left + p.x,
          clientY: rect.top + p.y,
          bubbles: true,
        });
        Object.defineProperty(event, 'pointerType', { value: 'touch' });
        Object.defineProperty(event, 'pointerId', { value: 9 });
        el.dispatchEvent(event);
      };
      // 12 px beside the end handle: out of reach for a mouse, within reach of a finger.
      const end = at(150, mid(150));
      expect(manager.drawingAt({ pane: 0, paneX: end.x + 12, paneY: end.y })).toBeNull();
      expect(
        manager.drawingAt({ pane: 0, paneX: end.x + 12, paneY: end.y, pointerType: 'touch' })
          ?.handle,
      ).toBe(1);
      touch('pointerdown', { x: end.x + 12, y: end.y });
      touch('pointermove', { x: end.x + 12, y: end.y + 60 });
      touch('pointerup', { x: end.x + 12, y: end.y + 60 });
      const edited = manager.get(line.id)!;
      expect(edited.points[1]!.price).not.toBe(mid(150));
      // Holding a finger on the line opens the menu at that point and leaves the line where it was.
      const before = edited.points;
      const a = at(120, before[0]!.price);
      const b = { x: at(150, 0).x, y: candles.priceToCoordinate(before[1]!.price)! };
      const onLine = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      touch('pointerdown', onLine);
      touch('pointermove', { x: onLine.x + 2, y: onLine.y + 1 });
      vi.advanceTimersByTime(500);
      expect(menus).toHaveLength(1);
      expect(menus[0]!.source).toBe('touch');
      expect(manager.drawingAt({ ...menus[0]!, pointerType: 'touch' })?.drawing.id).toBe(line.id);
      expect(manager.get(line.id)!.points).toEqual(before);
      touch('pointerup', { x: onLine.x + 2, y: onLine.y + 1 });
      expect(manager.get(line.id)!.points).toEqual(before);
      expect(manager.selection()).toEqual([line.id]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not move locked drawings but still selects them', () => {
    const line = manager.add({
      type: 'horizontal-line',
      points: [{ time: bars[120]!.time, price: mid(140) }],
      locked: true,
    });
    chart.render();
    drag(at(140, mid(140)), at(140, mid(140) * 1.02));
    expect(manager.get(line.id)!.points[0]!.price).toBe(mid(140));
    expect(manager.selection()).toEqual([line.id]);
  });

  it('moves grouped drawings together', () => {
    const a = manager.add({
      type: 'horizontal-line',
      points: [{ time: bars[120]!.time, price: mid(140) }],
    });
    const b = manager.add({
      type: 'vertical-line',
      points: [{ time: bars[160]!.time, price: mid(160) }],
    });
    manager.group([a.id, b.id]);
    manager.select([]);
    chart.render();
    const start = at(130, mid(140));
    drag(start, { x: start.x + chart.timeScale().barSpacing() * 5, y: start.y });
    expect(manager.get(b.id)!.points[0]!.time).toBe(bars[165]!.time);
  });

  it('snaps to OHLC with the strong magnet', () => {
    manager.setMagnet('strong');
    manager.setActiveTool('horizontal-ray');
    const bar = bars[140]!;
    click(at(140, bar.high + (bar.high - bar.low) * 0.05));
    expect(manager.list()[0]!.points[0]!.price).toBe(bar.high);
  });

  it('copies and pastes with new ids, shifted right', () => {
    const line = manager.add({
      type: 'ray',
      points: [
        { time: bars[120]!.time, price: mid(120) },
        { time: bars[130]!.time, price: mid(130) },
      ],
    });
    manager.select([line.id]);
    key('c', { ctrlKey: true });
    key('v', { ctrlKey: true });
    const all = manager.list();
    expect(all).toHaveLength(2);
    expect(all[1]!.id).not.toBe(line.id);
    expect(all[1]!.points[0]!.time).toBe(bars[125]!.time);
    expect(manager.selection()).toEqual([all[1]!.id]);
  });

  it('asks the app to edit text for text tools', () => {
    const onEdit = vi.fn();
    manager.on('textEdit', onEdit);
    manager.setActiveTool('text');
    click(at(140, mid(140)));
    expect(onEdit).toHaveBeenCalledTimes(1);
    const id = manager.list()[0]!.id;
    manager.setText(id, 'Breakout');
    expect(manager.get(id)!.text).toBe('Breakout');
  });

  it('serialises, loads with validation and maps series ids', () => {
    manager.add({
      type: 'fib-retracement',
      points: [
        { time: bars[110]!.time, price: mid(110) },
        { time: bars[150]!.time, price: mid(150) },
      ],
      style: { lineColor: '#ff0000' },
    });
    manager.add({ type: 'note', points: [{ time: bars[140]!.time, price: mid(140) }], text: 'hi' });
    const json = JSON.parse(JSON.stringify(manager.serialize()));
    json.drawings[0].seriesId = 'old-series';
    json.drawings[1].seriesId = 'old-series';
    json.drawings.push({ id: 'broken', type: 'trend-line', seriesId: 'old-series', points: [] });
    manager.clear();
    const result = manager.load(json, {
      resolveSeriesId: (id) => (id === 'old-series' ? candles.id : undefined),
    });
    expect(result.loaded).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(manager.list()[0]!.style.lineColor).toBe('#ff0000');
    expect(manager.list()[1]!.text).toBe('hi');
    expect(() => manager.load({ version: 7, drawings: [] })).toThrow(/newer/);
  });

  it('caps the number of drawings loaded from an untrusted snapshot (security)', () => {
    const drawing = (i: number) => ({
      id: `n${i}`,
      type: 'horizontal-line',
      seriesId: candles.id,
      points: [{ time: bars[100]!.time, price: mid(100) + i }],
    });
    const result = manager.load(
      { version: 1, drawings: Array.from({ length: 30 }, (_, i) => drawing(i)) },
      { maxDrawings: 10 },
    );
    expect(result.loaded).toBe(10);
    expect(result.errors[0]).toMatch(/only the first 10/);
    expect(manager.list()).toHaveLength(10);
    // Large collections must not overflow the stack when the next z-index is computed.
    const many = manager.load({
      version: 1,
      drawings: Array.from({ length: MAX_LOADED_DRAWINGS + 5 }, (_, i) => drawing(i)),
    });
    expect(many.loaded).toBe(MAX_LOADED_DRAWINGS);
    expect(() => manager.add(drawing(999_999) as never)).not.toThrow();
  });

  it('cancels drawing with Escape', () => {
    manager.setActiveTool('trend-line');
    click(at(120, mid(120)));
    key('Escape');
    expect(manager.activeTool()).toBeNull();
    expect(manager.list()).toHaveLength(0);
  });

  it('renders every tool and removes drawings with their series', () => {
    const anchors: Anchor[] = [110, 130, 120, 150, 140, 170].map((b) => ({
      time: bars[b]!.time,
      price: mid(b),
    }));
    const errors = vi.fn();
    manager.on('error', errors);
    for (const tool of builtInTools)
      manager.add({ type: tool.type, points: anchors.slice(0, tool.points), text: 'x' });
    manager.select(manager.list().map((d) => d.id));
    chart.render();
    expect(errors).toHaveBeenCalledTimes(0);
    expect(manager.list()).toHaveLength(builtInTools.length);
    chart.removeSeries(candles);
    expect(manager.list()).toHaveLength(0);
    expect(manager.canUndo()).toBe(false);
  });

  it('orders drawings and hides them', () => {
    const a = manager.add({
      type: 'rectangle',
      points: [
        { time: bars[110]!.time, price: mid(110) },
        { time: bars[130]!.time, price: mid(130) },
      ],
    });
    const b = manager.add({
      type: 'rectangle',
      points: [
        { time: bars[115]!.time, price: mid(115) },
        { time: bars[135]!.time, price: mid(135) },
      ],
    });
    manager.bringToFront([a.id]);
    expect(manager.list().map((d) => d.id)).toEqual([b.id, a.id]);
    manager.sendToBack([a.id]);
    expect(manager.list().map((d) => d.id)).toEqual([a.id, b.id]);
    manager.setVisible(false, [b.id]);
    expect(manager.get(b.id)!.visible).toBe(false);
    chart.render();
  });
});
