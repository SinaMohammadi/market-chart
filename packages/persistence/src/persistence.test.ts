import { describe, expect, it } from 'vitest';
import type { ChartApi } from '@market-chart/core';
import {
  ChartPersistence,
  PersistenceError,
  StorageConflictError,
  StorageQuotaError,
  WorkspaceStore,
  createMemoryStorage,
  createRestStorage,
  createWebStorage,
  parseJson,
  sanitizeJson,
  upsertWatchlist,
  validateChartState,
  validateWorkspace,
  valueProvider,
} from './index.js';
import type {
  ChannelLike,
  PersistenceTimers,
  SerializedChartState,
  WebStorageLike,
  WorkspaceState,
} from './index.js';

async function rejects(
  promise: Promise<unknown>,
  pattern: RegExp | (new (...a: never[]) => Error),
): Promise<unknown> {
  let error: unknown = null;
  try {
    await promise;
  } catch (e) {
    error = e;
  }
  if (pattern instanceof RegExp)
    expect(error === null ? 'resolved' : String((error as Error).message)).toMatch(pattern);
  else expect(error).toBeInstanceOf(pattern);
  return error;
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const state = (
  revision: number,
  extra: Partial<SerializedChartState> = {},
): SerializedChartState => ({
  version: 1,
  revision,
  savedAt: 1000 + revision,
  view: null,
  extensions: {},
  ...extra,
});

describe('schema', () => {
  it('keeps plain data only and drops prototype keys', () => {
    const evil = parseJson(
      '{"a":1,"__proto__":{"polluted":true},"b":{"constructor":{"x":1},"c":[1,"x",null]}}',
    );
    expect(evil).toEqual({ a: 1, b: { c: [1, 'x', null] } });
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    expect(() => sanitizeJson({ f: () => 1 })).toThrow(/unsupported type/);
    expect(() => sanitizeJson({ d: new Date() })).toThrow(/plain object/);
    expect(() => sanitizeJson({ n: Number.NaN })).toThrow(/finite/);
    let deep: unknown = 1;
    for (let i = 0; i < 40; i++) deep = [deep];
    expect(() => sanitizeJson(deep)).toThrow(/deeply/);
    expect(sanitizeJson({ a: undefined, b: 2 })).toEqual({ b: 2 });
  });

  it('migrates version 0 states and rejects newer versions', () => {
    const migrated = validateChartState({ options: { theme: 'dark' }, view: { from: 1, to: 5 } });
    expect(migrated).toMatchObject({
      version: 1,
      revision: 0,
      extensions: {},
      view: { from: 1, to: 5 },
      options: { theme: 'dark' },
    });
    expect(() => validateChartState({ version: 99 })).toThrow(/newer than supported/);
    expect(() => validateChartState({ version: 1, revision: -1 })).toThrow(/revision/);
    expect(() => validateChartState({ version: 1, revision: 0, view: { from: 5, to: 1 } })).toThrow(
      /view/,
    );
    expect(() => validateChartState('nope')).toThrow(/must be an object/);
    expect(() => validateChartState({ version: 1, revision: 0, symbol: 'x'.repeat(500) })).toThrow(
      /symbol/,
    );
  });

  it('validates workspaces', () => {
    const ws = validateWorkspace({
      version: 1,
      revision: 1,
      savedAt: 0,
      id: 'w1',
      name: 'Main',
      layout: '2x1',
      charts: [state(1)],
      activeChart: 0,
      watchlists: [{ id: 'fav', name: 'Favourites', symbols: ['A', 'B'] }],
      preferences: { dark: true },
    });
    expect(ws.charts).toHaveLength(1);
    expect(() =>
      validateWorkspace({ ...ws, charts: Array.from({ length: 65 }, () => state(1)) }),
    ).toThrow(/64/);
    expect(() =>
      validateWorkspace({ ...ws, watchlists: [{ id: 'x', name: 'x', symbols: 'A' }] }),
    ).toThrow(/symbols/);
  });
});

describe('storage adapters', () => {
  it('memory storage detects revision conflicts and lists newest first', async () => {
    const storage = createMemoryStorage();
    await storage.save('a', state(1));
    await storage.save('b', state(3, { name: 'Bee' }));
    const conflict = (await rejects(
      storage.save('a', state(1)),
      StorageConflictError,
    )) as StorageConflictError<SerializedChartState>;
    expect(conflict.remote?.revision).toBe(1);
    await storage.save('a', state(2));
    expect((await storage.load('a'))?.revision).toBe(2);
    expect((await storage.list()).map((m) => m.name)).toEqual(['Bee', 'a']);
    await storage.delete('a');
    expect(await storage.load('a')).toBeNull();
    await rejects(storage.save('../etc', state(1)), /invalid id/);
  });

  it('web storage is lazy, prefixed, indexed and validates on read', async () => {
    const data = new Map<string, string>();
    let resolved = 0;
    const fake: WebStorageLike = {
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
      removeItem: (k) => void data.delete(k),
    };
    const storage = createWebStorage({ storage: () => (resolved++, fake), prefix: 'mc:' });
    expect(resolved).toBe(0);
    await storage.save('one', state(1, { name: 'One' }));
    expect([...data.keys()].sort()).toEqual(['mc:__index', 'mc:one']);
    expect(await storage.list()).toEqual([
      { id: 'one', name: 'One', updatedAt: 1001, revision: 1 },
    ]);
    data.set('mc:bad', '{"version":1,"revision":"x"}');
    await rejects(storage.load('bad'), /revision/);
    data.set('mc:old', '{"options":{"a":1}}');
    expect((await storage.load('old'))?.version).toBe(1);
    await storage.delete('one');
    expect(await storage.list()).toEqual([]);
  });

  it('web storage reports quota errors', async () => {
    const full: WebStorageLike = {
      getItem: () => null,
      setItem: () => {
        throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
      },
      removeItem: () => undefined,
    };
    await rejects(createWebStorage({ storage: () => full }).save('x', state(1)), StorageQuotaError);
  });

  it('web storage fails clearly without localStorage', async () => {
    await rejects(createWebStorage().load('x'), /not available/);
  });

  it('REST storage sends If-Match and turns 409 into a conflict with the remote state', async () => {
    const calls: { url: string; method: string; ifMatch?: string }[] = [];
    let stored: SerializedChartState | null = state(4);
    const fetch = (async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const headers = (init.headers ?? {}) as Record<string, string>;
      calls.push({ url, method, ...(headers['If-Match'] ? { ifMatch: headers['If-Match'] } : {}) });
      const reply = (status: number, body?: unknown) =>
        ({ ok: status < 300, status, text: async () => JSON.stringify(body ?? null) }) as Response;
      if (method === 'PUT') {
        const next = JSON.parse(String(init.body)) as SerializedChartState;
        if (stored && String(stored.revision) !== headers['If-Match']) return reply(409);
        stored = next;
        return reply(204);
      }
      if (method === 'DELETE') return reply(204);
      if (url.endsWith('/layouts'))
        return reply(200, [{ id: 'x', name: 'X', updatedAt: 5, revision: 4 }, { id: '../bad' }]);
      return stored ? reply(200, stored) : reply(404);
    }) as unknown as typeof globalThis.fetch;
    const storage = createRestStorage({
      baseUrl: 'https://api.example.test/layouts/',
      fetch,
      headers: () => ({ Authorization: 'Bearer t' }),
    });
    const conflict = (await rejects(
      storage.save('x', state(2)),
      StorageConflictError,
    )) as StorageConflictError<SerializedChartState>;
    expect(conflict.remote?.revision).toBe(4);
    await storage.save('x', state(5));
    expect(calls.find((c) => c.method === 'PUT' && c.ifMatch === '4')?.url).toBe(
      'https://api.example.test/layouts/x',
    );
    expect(await storage.list()).toEqual([{ id: 'x', name: 'X', updatedAt: 5, revision: 4 }]);
    stored = null;
    expect(await storage.load('x')).toBeNull();
  });
});

// ── ChartPersistence against a minimal chart double ──

function fakeChart(): ChartApi & {
  emit(event: string): void;
  applied: unknown[];
  range: { from: number; to: number } | null;
} {
  const listeners = new Map<string, Set<() => void>>();
  let options: Record<string, unknown> = {
    theme: 'light',
    layout: { fontSize: 12 },
    grid: { visible: true },
    width: 600,
  };
  const chart = {
    applied: [] as unknown[],
    range: { from: 10, to: 20 } as { from: number; to: number } | null,
    options: () => options,
    applyOptions(o: Record<string, unknown>) {
      chart.applied.push(o);
      options = { ...options, ...o };
      chart.emit('optionsChanged');
    },
    on(event: string, fn: () => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
      return () => listeners.get(event)!.delete(fn);
    },
    emit(event: string) {
      for (const fn of [...(listeners.get(event) ?? [])]) fn();
    },
    series: () => [{ length: () => 5 }],
    // Identity mapping between time and logical index; `range` holds the view as bar times.
    timeScale: () => ({
      getVisibleLogicalRange: () =>
        chart.range ? { from: chart.range.from - 0.5, to: chart.range.to + 0.5 } : null,
      setVisibleLogicalRange: (r: { from: number; to: number }) => {
        chart.range = { from: r.from + 0.5, to: r.to - 0.5 };
      },
      timeToLogical: (t: number) => t,
      logicalToTime: (l: number) => l,
    }),
  };
  return chart as never;
}

function manualTimers(): PersistenceTimers & { run(): void; size(): number } {
  const tasks = new Map<number, () => void>();
  let id = 0;
  return {
    setTimeout: (fn) => (tasks.set(++id, fn), id),
    clearTimeout: (h) => void tasks.delete(h as number),
    run() {
      const fns = [...tasks.values()];
      tasks.clear();
      fns.forEach((fn) => fn());
    },
    size: () => tasks.size,
  };
}

/** In-process BroadcastChannel stand-in shared by "tabs". */
function channelBus(): (name: string) => ChannelLike {
  const members = new Set<ChannelLike & { name: string }>();
  return (name) => {
    const ch: ChannelLike & { name: string } = {
      name,
      onmessage: null,
      postMessage(message) {
        for (const other of members)
          if (other !== ch && other.name === name)
            queueMicrotask(() => other.onmessage?.({ data: message }));
      },
      close: () => void members.delete(ch),
    };
    members.add(ch);
    return ch;
  };
}

describe('ChartPersistence', () => {
  it('captures options, view, context and providers, and restores them', async () => {
    const chart = fakeChart();
    let app = { favourite: 'BTC' };
    const p = new ChartPersistence({
      chart,
      storage: createMemoryStorage(),
      id: 'main',
      name: 'Main',
      crossTab: false,
      autoSave: false,
      getContext: () => ({ symbol: 'BTCUSD', interval: '1h' }),
      providers: {
        app: valueProvider(
          () => app,
          (v) => (app = v),
        ),
      },
      now: () => 42,
    });
    const captured = p.capture();
    expect(captured).toMatchObject({
      version: 1,
      name: 'Main',
      symbol: 'BTCUSD',
      interval: '1h',
      view: { from: 10, to: 20 },
      savedAt: 42,
    });
    expect(captured.options).toEqual({
      theme: 'light',
      layout: { fontSize: 12 },
      grid: { visible: true },
    });
    expect(captured.extensions).toEqual({ app: { favourite: 'BTC' } });

    await p.apply({
      ...captured,
      options: { theme: 'dark' },
      view: { from: 1, to: 2 },
      extensions: { app: { favourite: 'ETH' } },
    });
    expect(chart.applied).toEqual([{ theme: 'dark' }]);
    expect(chart.range).toEqual({ from: 1, to: 2 });
    expect(app.favourite).toBe('ETH');
    expect(p.status).toBe('idle'); // applying does not mark the state dirty
    p.destroy();
  });

  it('autosaves after a quiet period and skips unchanged saves', async () => {
    const chart = fakeChart();
    const timers = manualTimers();
    const storage = createMemoryStorage();
    const statuses: string[] = [];
    const p = new ChartPersistence({ chart, storage, id: 'main', crossTab: false, timers });
    p.on('status', ({ status }) => statuses.push(status));
    chart.emit('visibleRangeChange');
    chart.emit('visibleRangeChange');
    expect(p.status).toBe('dirty');
    expect(timers.size()).toBe(1);
    timers.run();
    await flush();
    expect(p.status).toBe('saved');
    expect((await storage.load('main'))?.revision).toBe(1);
    chart.emit('visibleRangeChange'); // nothing actually changed
    timers.run();
    await flush();
    expect((await storage.load('main'))?.revision).toBe(1);
    chart.range = { from: 11, to: 21 };
    chart.emit('visibleRangeChange');
    timers.run();
    await flush();
    expect((await storage.load('main'))?.revision).toBe(2);
    expect(statuses).toEqual([
      'dirty',
      'saving',
      'saved',
      'dirty',
      'saved',
      'dirty',
      'saving',
      'saved',
    ]);
    p.destroy();
    chart.emit('visibleRangeChange');
    expect(timers.size()).toBe(0);
  });

  it('loads stored state and continues from its revision', async () => {
    const storage = createMemoryStorage();
    await storage.save(
      'main',
      state(7, {
        options: { theme: 'dark', layout: { fontSize: 12 }, grid: { visible: true } },
        view: { from: 3, to: 4 },
      }),
    );
    const chart = fakeChart();
    const p = new ChartPersistence({
      chart,
      storage,
      id: 'main',
      crossTab: false,
      autoSave: false,
    });
    expect(await p.load()).toBe(true);
    expect(p.currentRevision).toBe(7);
    expect(chart.range).toEqual({ from: 3, to: 4 });
    await p.save(); // nothing changed since the load: no new revision
    expect((await storage.load('main'))?.revision).toBe(7);
    chart.range = { from: 5, to: 6 };
    await p.save();
    expect((await storage.load('main'))?.revision).toBe(8);
    expect(
      await new ChartPersistence({
        chart: fakeChart(),
        storage,
        id: 'other',
        crossTab: false,
      }).load(),
    ).toBe(false);
  });

  it('reports corrupted stored state as an error', async () => {
    const data = new Map([['market-chart:main', '{"version":1,"revision":"nope"}']]);
    const storage = createWebStorage({
      storage: () => ({
        getItem: (k) => data.get(k) ?? null,
        setItem: () => undefined,
        removeItem: () => undefined,
      }),
    });
    const p = new ChartPersistence({ chart: fakeChart(), storage, id: 'main', crossTab: false });
    const errors: unknown[] = [];
    p.on('error', ({ error }) => errors.push(error));
    expect(await p.load()).toBe(false);
    expect(p.status).toBe('error');
    expect(errors[0]).toBeInstanceOf(PersistenceError);
  });

  it('resolves conflicts with the configured strategy', async () => {
    const make = async (conflict: 'fail' | 'overwrite' | 'reload') => {
      const storage = createMemoryStorage();
      const chart = fakeChart();
      const p = new ChartPersistence({
        chart,
        storage,
        id: 'main',
        crossTab: false,
        autoSave: false,
        conflict,
      });
      await p.save(); // revision 1
      await storage.save(
        'main',
        state(5, { options: { theme: 'remote' }, view: { from: 100, to: 200 } }),
      ); // another device
      chart.range = { from: 50, to: 60 };
      await p.save();
      return { p, storage, chart };
    };
    const failed = await make('fail');
    expect(failed.p.status).toBe('conflict');
    expect((await failed.storage.load('main'))?.revision).toBe(5);

    const overwritten = await make('overwrite');
    expect(overwritten.p.status).toBe('saved');
    const saved = await overwritten.storage.load('main');
    expect(saved?.revision).toBe(6);
    expect(saved?.view).toEqual({ from: 50, to: 60 });

    const reloaded = await make('reload');
    expect(reloaded.p.status).toBe('saved');
    expect(reloaded.chart.range).toEqual({ from: 100, to: 200 });
    expect(reloaded.p.currentRevision).toBe(5);

    const storage = createMemoryStorage();
    const chart = fakeChart();
    const merged = new ChartPersistence({
      chart,
      storage,
      id: 'main',
      crossTab: false,
      autoSave: false,
      conflict: (local, remote) => ({ ...local, options: { ...local.options, ...remote.options } }),
    });
    await merged.save();
    await storage.save('main', state(3, { options: { theme: 'remote' } }));
    chart.range = { from: 1, to: 9 };
    await merged.save();
    const result = await storage.load('main');
    expect(result).toMatchObject({
      revision: 4,
      view: { from: 1, to: 9 },
      options: { theme: 'remote', grid: { visible: true } },
    });
  });

  it('exports and imports JSON safely', async () => {
    const chart = fakeChart();
    const storage = createMemoryStorage();
    const timers = manualTimers();
    const p = new ChartPersistence({ chart, storage, id: 'main', crossTab: false, timers });
    const json = p.exportJson();
    expect(JSON.parse(json).version).toBe(1);
    const imported = await p.importJson(
      JSON.stringify({ ...JSON.parse(json), view: { from: 7, to: 8 }, __proto__: { x: 1 } }),
    );
    expect(imported.view).toEqual({ from: 7, to: 8 });
    expect(chart.range).toEqual({ from: 7, to: 8 });
    expect(p.status).toBe('dirty');
    timers.run();
    await flush();
    expect((await storage.load('main'))?.view).toEqual({ from: 7, to: 8 });
    await rejects(p.importJson('{"version":2}'), /newer than supported/);
    await rejects(p.importJson('not json'), /invalid JSON/);
  });

  it('tells other tabs to reload after a save', async () => {
    const storage = createMemoryStorage();
    const channel = channelBus();
    const chartA = fakeChart();
    const chartB = fakeChart();
    const a = new ChartPersistence({
      chart: chartA,
      storage,
      id: 'main',
      autoSave: false,
      channel,
    });
    const b = new ChartPersistence({
      chart: chartB,
      storage,
      id: 'main',
      autoSave: false,
      channel,
    });
    const other = new ChartPersistence({
      chart: fakeChart(),
      storage,
      id: 'other',
      autoSave: false,
      channel,
    });
    const remote: number[] = [];
    b.on('remoteChange', ({ revision }) => remote.push(revision));
    other.on('remoteChange', ({ revision }) => remote.push(-revision));
    chartA.range = { from: 30, to: 40 };
    await a.save();
    await flush();
    await flush();
    expect(remote).toEqual([1]);
    expect(chartB.range).toEqual({ from: 30, to: 40 });
    expect(b.currentRevision).toBe(1);
    a.destroy();
    b.destroy();
    other.destroy();
  });

  it('rejects bad construction arguments', () => {
    expect(
      () => new ChartPersistence({ chart: fakeChart(), storage: createMemoryStorage(), id: 'a b' }),
    ).toThrow(/invalid id/);
  });
});

describe('WorkspaceStore', () => {
  it('creates, renames, duplicates, exports and imports workspaces', async () => {
    let n = 0;
    const store = new WorkspaceStore(
      createMemoryStorage<WorkspaceState>({ validate: validateWorkspace }),
      {
        now: () => 1000 + n,
        idFactory: () => `ws${++n}`,
      },
    );
    const main = await store.create('Main', { layout: '2x1', charts: [state(1)] });
    expect(main).toMatchObject({ id: 'ws1', name: 'Main', revision: 1, layout: '2x1' });
    const renamed = await store.rename('ws1', 'Trading');
    expect(renamed.revision).toBe(2);
    const copy = await store.duplicate('ws1');
    expect(copy).toMatchObject({ id: 'ws2', name: 'Trading (copy)', revision: 1, layout: '2x1' });
    const withList = upsertWatchlist(renamed, { id: 'fav', name: 'Favourites', symbols: ['A'] });
    const saved = await store.save(withList);
    expect(saved.watchlists).toHaveLength(1);
    await rejects(store.save(withList), StorageConflictError); // stale revision
    const imported = await store.importJson(await store.exportJson('ws1'));
    expect(imported).toMatchObject({ id: 'ws3', name: 'Trading', revision: 1 });
    expect(imported.watchlists).toHaveLength(1);
    expect((await store.list()).map((w) => w.id).sort()).toEqual(['ws1', 'ws2', 'ws3']);
    await store.delete('ws2');
    await rejects(store.rename('ws2', 'x'), /not found/);
    await rejects(store.importJson('{"version":1}'), PersistenceError);
  });
});
