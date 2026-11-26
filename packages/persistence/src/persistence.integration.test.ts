// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChart } from '@market-chart/core';
import type { ChartApi } from '@market-chart/core';
import { DrawingManager } from '@market-chart/drawing-tools';
import { IndicatorManager } from '@market-chart/indicators';
import { HOUR, generateBars, installCanvasMock } from '@market-chart/testing';
import {
  ChartPersistence,
  StorageConflictError,
  createIndexedDbStorage,
  createLocalStorage,
  createMemoryStorage,
  defaultSeriesResolver,
  drawingsProvider,
  indicatorsProvider,
} from './index.js';
import type { SerializedChartState } from './index.js';

let restore: () => void = () => undefined;
let container: HTMLDivElement;
const charts: ChartApi[] = [];
const bars = generateBars({ count: 200, interval: HOUR, seed: 6 });
const unique = (): string => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

function make(): ChartApi {
  const chart = createChart(container, { autoSize: false, width: 600, height: 300 });
  charts.push(chart);
  return chart;
}

async function waitFor(check: () => boolean, ms = 3000): Promise<void> {
  const start = performance.now();
  while (!check()) {
    if (performance.now() - start > ms) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 5));
  }
}

const state = (
  revision: number,
  extra: Partial<SerializedChartState> = {},
): SerializedChartState => ({
  version: 1,
  revision,
  savedAt: revision,
  view: null,
  extensions: {},
  ...extra,
});

beforeEach(() => {
  restore = installCanvasMock();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  for (const chart of charts.splice(0)) if (!chart.destroyed) chart.destroy();
  container.remove();
  restore();
});

// jsdom has no IndexedDB; these run in real browsers.
describe.skipIf(typeof indexedDB === 'undefined')('IndexedDB storage', () => {
  it('saves, loads, lists, detects conflicts and deletes', async () => {
    const dbName = unique();
    const storage = createIndexedDbStorage({ dbName });
    await storage.save('a', state(1, { name: 'A' }));
    await storage.save('b', state(2, { name: 'B' }));
    expect((await storage.load('a'))?.name).toBe('A');
    let conflict: unknown = null;
    try {
      await storage.save('a', state(1));
    } catch (e) {
      conflict = e;
    }
    expect(conflict).toBeInstanceOf(StorageConflictError);
    expect((conflict as StorageConflictError<SerializedChartState>).remote?.revision).toBe(1);
    await storage.save('a', state(3, { name: 'A2' }));
    expect((await storage.list()).map((m) => m.name)).toEqual(['A2', 'B']);
    await storage.delete('b');
    expect(await storage.load('b')).toBeNull();

    // A corrupted record is skipped by list() and rejected by load().
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onsuccess = () => {
        const tx = req.result.transaction('states', 'readwrite');
        tx.objectStore('states').put({ version: 1, revision: 'x' }, 'bad');
        tx.oncomplete = () => (req.result.close(), resolve());
        tx.onerror = () => reject(tx.error);
      };
    });
    expect((await storage.list()).map((m) => m.id)).toEqual(['a']);
    let loadError: unknown = null;
    try {
      await storage.load('bad');
    } catch (e) {
      loadError = e;
    }
    expect(String((loadError as Error).message)).toMatch(/revision/);
  });
});

describe('ChartPersistence with a real chart', () => {
  it('round-trips options, view, indicators and drawings to a new chart', async () => {
    const storage =
      typeof indexedDB === 'undefined'
        ? createMemoryStorage()
        : createIndexedDbStorage({ dbName: unique() });
    const a = make();
    const candles = a.addSeries('candlestick');
    candles.setData(bars);
    a.applyOptions({ grid: { vertLines: { visible: false } } } as never);
    a.render();
    a.timeScale().setVisibleRange({ from: bars[50]!.time, to: bars[120]!.time });
    a.render();
    const indicators = new IndicatorManager(a);
    indicators.add('rsi', candles, { params: { length: 10 } });
    indicators.add('sma', candles, { params: { length: 20 } });
    const drawings = new DrawingManager(a);
    drawings.add({
      type: 'trend-line',
      points: [
        { time: bars[60]!.time, price: bars[60]!.close },
        { time: bars[90]!.time, price: bars[90]!.close },
      ],
    });

    const pa = new ChartPersistence({
      chart: a,
      storage,
      id: 'layout',
      crossTab: false,
      autoSave: false,
      providers: {
        indicators: indicatorsProvider(indicators, defaultSeriesResolver(a)),
        drawings: drawingsProvider(
          drawings,
          (id) => a.series().find((s) => s.id === id)?.id ?? a.series()[0]?.id,
        ),
      },
      getContext: () => ({ symbol: 'SYN', interval: '1h' }),
    });
    const expectedView = a.timeScale().getVisibleLogicalRange()!;
    await pa.save();
    const saved = await storage.load('layout');
    expect(saved).toMatchObject({ revision: 1, symbol: 'SYN', interval: '1h' });
    expect((saved!.extensions['indicators'] as unknown[]).length).toBe(2);

    // A fresh chart (new page): providers restore before data exists; the view is applied once data arrives.
    const b = make();
    const bCandles = b.addSeries('candlestick');
    const bIndicators = new IndicatorManager(b);
    const bDrawings = new DrawingManager(b);
    const pb = new ChartPersistence({
      chart: b,
      storage,
      id: 'layout',
      crossTab: false,
      autoSave: false,
      providers: {
        indicators: indicatorsProvider(bIndicators, defaultSeriesResolver(b)),
        drawings: drawingsProvider(bDrawings, () => bCandles.id),
      },
    });
    expect(await pb.load()).toBe(true);
    expect(
      bIndicators
        .serialize()
        .map((c) => c.type)
        .sort(),
    ).toEqual(['rsi', 'sma']);
    expect(bDrawings.serialize().drawings).toHaveLength(1);
    expect(bDrawings.serialize().drawings[0]!.seriesId).toBe(bCandles.id);
    expect(b.options().grid.vertLines.visible).toBe(false);
    bCandles.setData(bars);
    await Promise.resolve(); // the stored range is applied a microtask after data arrives
    b.render();
    b.render(); // a second frame: the restored view must not drift
    const view = b.timeScale().getVisibleLogicalRange()!;
    expect(view.from).toBeCloseTo(expectedView.from, 6);
    expect(view.to).toBeCloseTo(expectedView.to, 6);
    expect(b.timeScale().getVisibleRange()).toEqual(a.timeScale().getVisibleRange());
    pa.destroy();
    pb.destroy();
  });

  it('autosaves after chart changes and reports status', async () => {
    const id = unique();
    const storage = createLocalStorage({ prefix: `${id}:` });
    const chart = make();
    chart.addSeries('line').setData(bars.map((b) => ({ time: b.time, value: b.close })));
    const statuses: string[] = [];
    const p = new ChartPersistence({ chart, storage, id: 'main', crossTab: false, debounceMs: 20 });
    p.on('status', ({ status }) => statuses.push(status));
    chart.render();
    chart.timeScale().setVisibleLogicalRange({ from: 10, to: 80 });
    chart.render();
    await waitFor(() => p.status === 'saved');
    expect(statuses.slice(0, 3)).toEqual(['dirty', 'saving', 'saved']);
    expect(localStorage.getItem(`${id}:main`)).toMatch(/"revision":1/);
    expect(JSON.parse(localStorage.getItem(`${id}:__index`)!)).toMatchObject({
      main: { revision: 1 },
    });
    p.destroy();
    localStorage.removeItem(`${id}:main`);
    localStorage.removeItem(`${id}:__index`);
  });

  it('syncs other tabs through BroadcastChannel', async () => {
    const id = unique();
    const storage = createLocalStorage({ prefix: `${id}:` });
    const tabA = make();
    const tabB = make();
    for (const chart of [tabA, tabB])
      chart.addSeries('line').setData(bars.map((b) => ({ time: b.time, value: b.close })));
    tabA.render();
    tabB.render();
    const pa = new ChartPersistence({ chart: tabA, storage, id: 'main', autoSave: false });
    const pb = new ChartPersistence({ chart: tabB, storage, id: 'main', autoSave: false });
    expect(await pa.load()).toBe(false);
    expect(await pb.load()).toBe(false);
    tabB.render(); // a frame that changes nothing must not block the reload
    tabA.timeScale().setVisibleRange({ from: bars[20]!.time, to: bars[60]!.time });
    tabA.render();
    await pa.save();
    await waitFor(() => pb.currentRevision === 1);
    tabB.render();
    expect(tabB.timeScale().getVisibleLogicalRange()).toEqual(
      tabA.timeScale().getVisibleLogicalRange(),
    );
    // Saving the reloaded state again must reproduce the same view (no widening on round trips).
    expect(pb.capture().view).toEqual(pa.capture().view);
    pa.destroy();
    pb.destroy();
    localStorage.removeItem(`${id}:main`);
    localStorage.removeItem(`${id}:__index`);
  });
});
