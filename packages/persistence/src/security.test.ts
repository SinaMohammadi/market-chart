import { describe, expect, it } from 'vitest';
import {
  ChartPersistence,
  createMemoryStorage,
  createRestStorage,
  createWebStorage,
  parseJson,
  validateLayoutMetadata,
  validateWorkspace,
} from './index.js';
import type { ChannelLike, SerializedChartState, WebStorageLike } from './index.js';

async function errorOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'resolved';
  } catch (error) {
    return String((error as Error).message);
  }
}

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

function fakeChart() {
  const applied: Record<string, unknown>[] = [];
  const chart = {
    applied,
    options: () => ({ theme: 'light' }),
    applyOptions: (o: Record<string, unknown>) => void applied.push(o),
    on: () => () => undefined,
    series: () => [],
    timeScale: () => ({
      getVisibleLogicalRange: () => null,
      setVisibleLogicalRange: () => undefined,
      timeToLogical: () => null,
      logicalToTime: () => null,
    }),
  };
  return chart;
}

function memoryWebStorage(): WebStorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe('ChartPersistence.apply (security)', () => {
  it('applies only the persisted option groups, never size or host settings', async () => {
    const chart = fakeChart();
    const p = new ChartPersistence({
      chart: chart as never,
      storage: createMemoryStorage(),
      id: 'main',
      crossTab: false,
      autoSave: false,
    });
    await p.apply(
      state(1, {
        options: {
          theme: 'dark',
          width: 1e9,
          height: 1e9,
          autoSize: false,
          panes: { separatorHeight: 500 },
          grid: { visible: false },
        },
      }),
    );
    expect(chart.applied).toEqual([{ theme: 'dark', grid: { visible: false } }]);
    p.destroy();
  });
});

describe('cross-tab messages (security)', () => {
  it('ignores malformed channel messages', async () => {
    let channel: ChannelLike | null = null;
    const storage = createMemoryStorage();
    let loads = 0;
    const counting = { ...storage, load: async (id: string) => (loads++, storage.load(id)) };
    const p = new ChartPersistence({
      chart: fakeChart() as never,
      storage: counting,
      id: 'main',
      autoSave: false,
      channel: () =>
        (channel = { postMessage: () => undefined, close: () => undefined, onmessage: null }),
    });
    for (const data of [
      null,
      'saved',
      [],
      { type: 'saved', id: 'main', revision: Number.NaN, origin: 'x' },
      { type: 'saved', id: 'main', revision: Infinity, origin: 'x' },
      { type: 'saved', id: 'main', revision: 1.5, origin: 'x' },
      { type: 'saved', id: 'main', revision: -1, origin: 'x' },
      { type: 'saved', id: 'main', revision: 5, origin: { evil: 1 } },
      { type: 'saved', id: 'other', revision: 5, origin: 'x' },
    ])
      channel!.onmessage?.({ data });
    await new Promise((r) => setTimeout(r, 0));
    expect(loads).toBe(0);
    channel!.onmessage?.({ data: { type: 'saved', id: 'main', revision: 5, origin: 'x' } });
    await new Promise((r) => setTimeout(r, 0));
    expect(loads).toBe(1);
    p.destroy();
  });
});

describe('Web Storage index (security)', () => {
  it('lists only valid entries from a tampered index', async () => {
    const s = memoryWebStorage();
    s.setItem(
      'mc:__index',
      JSON.stringify({
        good: { id: 'good', name: 'Good', updatedAt: 2, revision: 1 },
        spoof: { id: 'other', name: 'Mismatched key' },
        long: { id: 'long', name: 'x'.repeat(100_000), updatedAt: 'soon', revision: -4 },
        '../evil': { id: '../evil' },
        list: [1, 2],
      }),
    );
    const storage = createWebStorage({ storage: () => s, prefix: 'mc:' });
    const list = await storage.list();
    expect(list.map((m) => m.id).sort()).toEqual(['good', 'long']);
    const long = list.find((m) => m.id === 'long')!;
    expect(long.name).toHaveLength(256);
    expect(long.updatedAt).toBe(0);
    expect(long.revision).toBe(0);
  });
  it('validateLayoutMetadata', () => {
    expect(validateLayoutMetadata({ id: '__proto__' })).toEqual({
      id: '__proto__',
      name: '__proto__',
      updatedAt: 0,
      revision: 0,
    });
    expect(validateLayoutMetadata('x')).toBeNull();
  });
});

describe('REST storage (security)', () => {
  const reply = (status: number, body?: unknown, extra: Partial<Response> = {}): Response =>
    ({
      ok: status < 300,
      status,
      text: async () => JSON.stringify(body ?? null),
      ...extra,
    }) as Response;

  it('sends an explicit credentials mode and encodes ids', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const storage = createRestStorage({
      baseUrl: 'https://api.example.test/layouts',
      fetch: (async (url: string, init: RequestInit) => (
        seen.push({ url, init }),
        reply(404)
      )) as never,
    });
    await storage.load('a:b.c');
    expect(seen[0]!.url).toBe('https://api.example.test/layouts/a%3Ab.c');
    expect(seen[0]!.init.credentials).toBe('same-origin');
    const omit = createRestStorage({
      baseUrl: '/l',
      credentials: 'include',
      fetch: (async (_u: string, init: RequestInit) => (
        seen.push({ url: '', init }),
        reply(404)
      )) as never,
    });
    await omit.load('x');
    expect(seen[1]!.init.credentials).toBe('include');
    expect(await errorOf(storage.load('../../admin'))).toMatch(/invalid id/);
  });

  it('keeps tokens in the base URL out of error messages', async () => {
    const storage = createRestStorage({
      baseUrl: 'https://user:pw@api.example.test/layouts?token=TOP-SECRET',
      fetch: (async () => reply(500)) as never,
    });
    for (const p of [
      storage.load('x'),
      storage.save('x', state(1)),
      storage.list(),
      storage.delete('x'),
    ])
      expect(await errorOf(p)).not.toMatch(/TOP-SECRET|pw@/);
  });

  it('rejects oversized responses and times out', async () => {
    const big = createRestStorage({
      baseUrl: '/l',
      maxResponseBytes: 100,
      fetch: (async () => reply(200, state(1, { name: 'x'.repeat(500) }))) as never,
    });
    expect(await errorOf(big.load('x'))).toMatch(/larger than 100 bytes/);
    const slow = createRestStorage({
      baseUrl: '/l',
      timeoutMs: 10,
      fetch: ((_u: string, init: RequestInit) =>
        new Promise((_resolve, reject) =>
          init.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
        )) as never,
    });
    expect(await errorOf(slow.load('x'))).toMatch(/GET \/l\/x failed/);
  });

  it('validates listing entries', async () => {
    const storage = createRestStorage({
      baseUrl: '/l',
      fetch: (async () =>
        reply(200, [
          { id: 'a', name: 'x'.repeat(1000) },
          { id: 'b c' },
          null,
          { id: 'c', revision: 'NaN' },
        ])) as never,
    });
    const list = await storage.list();
    expect(list.map((m) => m.id)).toEqual(['a', 'c']);
    expect(list[0]!.name).toHaveLength(256);
  });
});

describe('schema limits (security)', () => {
  it('parseJson refuses oversized text', () => {
    expect(() => parseJson('[1,2,3]', { maxBytes: 3 })).toThrow(/larger than 3 bytes/);
    expect(parseJson('[1]')).toEqual([1]);
  });
  it('workspace grids are bounded', () => {
    const ws = (layout: unknown) => ({ version: 1, id: 'w', name: 'W', layout, charts: [] });
    for (const layout of [
      { columns: 1e9, rows: 1e9 },
      { columns: -1, rows: 2 },
      { columns: 0, rows: 1 },
      { columns: 9, rows: 1 },
    ])
      expect(() => validateWorkspace(ws(layout))).toThrow(/between 1 and 8/);
    expect(validateWorkspace(ws({ columns: 3, rows: 2 })).layout).toEqual({ columns: 3, rows: 2 });
  });
});
