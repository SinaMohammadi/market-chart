import { describe, expect, it } from 'vitest';
import {
  CandleAggregator,
  alignTime,
  composeDatafeed,
  createRestDatafeed,
  createSseDatafeed,
  createStaticDatafeed,
  createSyntheticDatafeed,
  createWebSocketDatafeed,
  fillMissingCandles,
  isMultipleOf,
  mergeCandles,
  nextBarTime,
  normalizeCandles,
  parseCsv,
  parseJsonCandles,
  parseTimeframe,
  resampleCandles,
  toTimestamp,
} from './index.js';
import type { Candle, SocketLike, Timers } from './index.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2024, 0, 1); // a Monday

async function rejects(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  let error: unknown = null;
  try {
    await promise;
  } catch (e) {
    error = e;
  }
  expect(error === null ? 'resolved' : String((error as Error).message)).toMatch(pattern);
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Manual clock: timers fire only when `advance` is called. */
function fakeTimers(): Timers & {
  now: number;
  advance(ms: number): Promise<void>;
  pending(): number;
} {
  let id = 0;
  const tasks = new Map<number, { at: number; fn: () => void; every?: number }>();
  const clock = {
    now: 0,
    setTimeout: (fn: () => void, ms: number) => (tasks.set(++id, { at: clock.now + ms, fn }), id),
    clearTimeout: (h: unknown) => void tasks.delete(h as number),
    setInterval: (fn: () => void, ms: number) => (
      tasks.set(++id, { at: clock.now + ms, fn, every: ms }),
      id
    ),
    clearInterval: (h: unknown) => void tasks.delete(h as number),
    pending: () => tasks.size,
    async advance(ms: number) {
      const end = clock.now + ms;
      for (;;) {
        await flush();
        const next = [...tasks.entries()]
          .filter(([, t]) => t.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [key, task] = next;
        clock.now = task.at;
        if (task.every) task.at += task.every;
        else tasks.delete(key);
        task.fn();
      }
      clock.now = end;
      await flush();
    },
  };
  return clock;
}

const bar = (time: number, close: number, volume?: number): Candle => ({
  time,
  open: close,
  high: close,
  low: close,
  close,
  ...(volume !== undefined ? { volume } : {}),
});

describe('timeframes', () => {
  it('parses intervals', () => {
    expect(parseTimeframe('5m')).toEqual({ count: 5, unit: 'm', ms: 5 * MIN });
    expect(parseTimeframe('60').ms).toBe(HOUR);
    expect(parseTimeframe('1d').unit).toBe('D');
    expect(parseTimeframe('W').ms).toBe(7 * DAY);
    expect(() => parseTimeframe('5x')).toThrow(/invalid timeframe/);
    expect(() => parseTimeframe('0m')).toThrow(/invalid timeframe/);
  });

  it('aligns to bar open times (Monday weeks, calendar months)', () => {
    expect(alignTime(T0 + 7 * MIN, '5m')).toBe(T0 + 5 * MIN);
    expect(alignTime(Date.UTC(2024, 0, 4, 12), '1W')).toBe(T0);
    expect(alignTime(Date.UTC(2024, 1, 20), '1M')).toBe(Date.UTC(2024, 1, 1));
    expect(alignTime(Date.UTC(2024, 4, 20), '3M')).toBe(Date.UTC(2024, 3, 1));
    expect(nextBarTime(Date.UTC(2024, 0, 31), '1M')).toBe(Date.UTC(2024, 1, 1));
    expect(nextBarTime(T0, '1h')).toBe(T0 + HOUR);
  });

  it('knows which timeframes can be built from others', () => {
    expect(isMultipleOf('15m', '5m')).toBe(true);
    expect(isMultipleOf('7m', '5m')).toBe(false);
    expect(isMultipleOf('1M', '1D')).toBe(true);
    expect(isMultipleOf('1D', '1M')).toBe(false);
  });
});

describe('candle normalisation', () => {
  it('converts timestamps', () => {
    expect(toTimestamp(1704067200)).toBe(T0);
    expect(toTimestamp(T0)).toBe(T0);
    expect(toTimestamp('2024-01-01')).toBe(T0);
    expect(toTimestamp('2024-01-01 00:00')).toBe(T0);
    expect(toTimestamp('2024-01-01T01:00:00+01:00')).toBe(T0);
    expect(toTimestamp('1704067200')).toBe(T0);
    expect(toTimestamp(new Date(T0))).toBe(T0);
    expect(Number.isNaN(toTimestamp('nope'))).toBe(true);
  });

  it('accepts objects and arrays, sorts, dedupes and widens high/low', () => {
    const result = normalizeCandles([
      { t: 1704070800, o: '2', h: '3', l: '1', c: '2.5', v: '10' },
      [T0, 1, 1.5, 0.5, 1.2],
      { time: T0, open: 1, high: 2, low: 0.5, close: 1.1 },
      { time: T0 + 2 * HOUR, open: 5, high: 4, low: 6, close: 5 },
      { time: 'bad', close: 1 },
      null,
    ]);
    expect(result.dropped).toBe(2);
    expect(result.duplicates).toBe(1);
    expect(result.candles.map((c) => c.time)).toEqual([T0, T0 + HOUR, T0 + 2 * HOUR]);
    expect(result.candles[0]!.close).toBe(1.1);
    expect(result.candles[1]).toEqual({
      time: T0 + HOUR,
      open: 2,
      high: 3,
      low: 1,
      close: 2.5,
      volume: 10,
    });
    expect(result.candles[2]).toMatchObject({ high: 5, low: 5 });
  });

  it('merges, resamples and fills gaps', () => {
    const merged = mergeCandles(
      [bar(T0, 1), bar(T0 + MIN, 2)],
      [bar(T0 + MIN, 3), bar(T0 + 2 * MIN, 4)],
    );
    expect(merged.map((c) => c.close)).toEqual([1, 3, 4]);

    const minutes = [1, 2, 3, 4, 5, 6].map((p, i) => ({
      time: T0 + i * MIN,
      open: p,
      high: p + 1,
      low: p - 1,
      close: p,
      volume: 1,
    }));
    const fives = resampleCandles(minutes, '5m');
    expect(fives).toEqual([
      { time: T0, open: 1, high: 6, low: 0, close: 5, volume: 5 },
      { time: T0 + 5 * MIN, open: 6, high: 7, low: 5, close: 6, volume: 1 },
    ]);

    const filled = fillMissingCandles([bar(T0, 1), bar(T0 + 3 * MIN, 2)], '1m');
    expect(filled.map((c) => c.time)).toEqual([T0, T0 + MIN, T0 + 2 * MIN, T0 + 3 * MIN]);
    expect(filled[1]).toEqual({ time: T0 + MIN, open: 1, high: 1, low: 1, close: 1, volume: 0 });
  });

  it('aggregates ticks into candles', () => {
    const agg = new CandleAggregator('1m');
    agg.push({ time: T0 + 1000, price: 10, size: 1 });
    agg.push({ time: T0 + 2000, price: 12, size: 2 });
    const c = agg.push({ time: T0 + 3000, price: 9 });
    expect(c).toEqual({ time: T0, open: 10, high: 12, low: 9, close: 9, volume: 3 });
    expect(agg.push({ time: T0 + MIN, price: 11 })).toMatchObject({
      time: T0 + MIN,
      open: 11,
      volume: 0,
    });
    expect(() => agg.push({ time: T0, price: 1 })).toThrow(/time order/);
  });
});

describe('file parsing', () => {
  it('parses CSV with headers, quotes, comments and detected delimiters', () => {
    const csv =
      '﻿# exported\nDate;Open;High;Low;Close;Volume\n2024-01-02;"1.5";2;1;1.8;100\n2024-01-01;1;2;0.5;1.5;\n';
    const result = parseCsv(csv);
    expect(result.candles).toHaveLength(2);
    expect(result.candles[0]).toEqual({ time: T0, open: 1, high: 2, low: 0.5, close: 1.5 });
    expect(result.candles[1]!.volume).toBe(100);
  });

  it('parses CSV without a header and with explicit columns', () => {
    expect(parseCsv(`${T0},1,2,0,1.5,7`).candles[0]).toEqual({
      time: T0,
      open: 1,
      high: 2,
      low: 0,
      close: 1.5,
      volume: 7,
    });
    const custom = parseCsv('when,price\n2024-01-01,5', {
      columns: { time: 'when', close: 'price' },
    });
    expect(custom.candles[0]).toMatchObject({ time: T0, close: 5 });
  });

  it('parses JSON arrays and wrapped responses', () => {
    expect(parseJsonCandles(`[[${T0},1,2,0,1]]`).candles).toHaveLength(1);
    expect(parseJsonCandles({ candles: [{ time: T0, close: 1 }] }).candles).toHaveLength(1);
    expect(() => parseJsonCandles('{"x":1}')).toThrow();
  });
});

describe('static datafeed', () => {
  const minutes = Array.from({ length: 30 }, (_, i) => bar(T0 + i * MIN, 100 + i, 1));

  it('serves ranges and resamples to larger timeframes', async () => {
    const feed = createStaticDatafeed({
      ABC: { candles: minutes, timeframe: '1m', info: { name: 'Abc' } },
    });
    expect((await feed.resolveSymbol('ABC')).name).toBe('Abc');
    expect(
      await feed.getHistoricalData('ABC', '1m', { from: T0 + 5 * MIN, to: T0 + 9 * MIN }),
    ).toHaveLength(5);
    const fifteens = await feed.getHistoricalData('ABC', '15m', { from: T0, to: T0 + DAY });
    expect(fifteens.map((c) => c.volume)).toEqual([15, 15]);
    await rejects(feed.getHistoricalData('ABC', '90s', { from: T0, to: T0 + DAY }), /cannot build/);
    await rejects(feed.resolveSymbol('NOPE'), /unknown symbol/);
    expect(await feed.searchSymbols!('ab')).toHaveLength(1);
  });

  it('pushes realtime bars to base and aggregated subscribers', () => {
    const feed = createStaticDatafeed({ ABC: { candles: minutes, timeframe: '1m' } });
    const base: Candle[] = [];
    const agg: Candle[] = [];
    const off = feed.subscribe('ABC', '1m', (c) => base.push(c));
    feed.subscribe('ABC', '15m', (c) => agg.push(c));
    feed.push('ABC', bar(T0 + 30 * MIN, 200, 4));
    expect(base[0]!.close).toBe(200);
    expect(agg[0]).toMatchObject({ time: T0 + 30 * MIN, close: 200, volume: 4 });
    off();
    feed.push('ABC', bar(T0 + 31 * MIN, 201, 1));
    expect(base).toHaveLength(1);
    expect(agg[1]).toMatchObject({ time: T0 + 30 * MIN, close: 201, volume: 5 });
  });
});

describe('REST datafeed', () => {
  const json = (status: number, body: unknown): Response =>
    ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

  it('splits long ranges into chunks and merges them', async () => {
    const urls: string[] = [];
    const feed = createRestDatafeed({
      history: (r) => `/h?s=${r.symbol}&from=${r.from}&to=${r.to}`,
      maxBarsPerRequest: 10,
      fetch: (async (url: string) => {
        urls.push(url);
        const [, from, to] = /from=(\d+)&to=(\d+)/.exec(url)!.map(Number);
        const rows = [];
        for (let t = from!; t <= to!; t += MIN) rows.push([t, 1, 1, 1, 1]);
        return json(200, { data: rows });
      }) as unknown as typeof fetch,
    });
    const candles = await feed.getHistoricalData('X', '1m', { from: T0, to: T0 + 24 * MIN });
    expect(urls).toHaveLength(3);
    expect(candles).toHaveLength(25);
  });

  it('retries 5xx and 429 with backoff, but not 4xx', async () => {
    const timers = fakeTimers();
    let calls = 0;
    const feed = createRestDatafeed({
      history: () => '/h',
      timers,
      retries: 2,
      fetch: (async () =>
        ++calls < 3
          ? json(calls === 1 ? 503 : 429, null)
          : json(200, [[T0, 1, 1, 1, 1]])) as unknown as typeof fetch,
    });
    const pending = feed.getHistoricalData('X', '1m', { from: T0, to: T0 });
    await timers.advance(300);
    await timers.advance(600);
    expect(await pending).toHaveLength(1);
    expect(calls).toBe(3);

    let notFound = 0;
    const fatal = createRestDatafeed({
      history: () => '/h',
      timers,
      fetch: (async () => (notFound++, json(404, null))) as unknown as typeof fetch,
    });
    await rejects(fatal.getHistoricalData('X', '1m', { from: T0, to: T0 }), /HTTP 404/);
    expect(notFound).toBe(1);
  });

  it('rejects responses that are not candle arrays', async () => {
    const feed = createRestDatafeed({
      history: () => '/h',
      fetch: (async () => json(200, { nope: 1 })) as unknown as typeof fetch,
    });
    await rejects(feed.getHistoricalData('X', '1m', { from: T0, to: T0 }), /not an array/);
  });
});

class FakeSocket implements SocketLike {
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
    this.onclose?.({});
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  drop(): void {
    this.readyState = 3;
    this.onclose?.({});
  }
}

describe('WebSocket datafeed', () => {
  const make = (timers: Timers) =>
    createWebSocketDatafeed({
      url: 'wss://example.test/ws',
      WebSocket: FakeSocket,
      timers,
      subscribeMessage: (symbol, interval) => ({ op: 'sub', symbol, interval }),
      unsubscribeMessage: (symbol, interval) => ({ op: 'unsub', symbol, interval }),
      parseMessage: (m) => {
        const msg = m as { s: string; i: string; k: unknown };
        return msg && msg.k ? [{ symbol: msg.s, interval: msg.i, candle: msg.k }] : null;
      },
      heartbeat: { message: 'ping', intervalMs: 10_000 },
      reconnect: { initialDelayMs: 100, maxDelayMs: 1000 },
    });

  it('shares one socket, refcounts subscriptions and routes messages', () => {
    FakeSocket.instances = [];
    const timers = fakeTimers();
    const feed = make(timers);
    const a: Candle[] = [];
    const b: Candle[] = [];
    const offA = feed.subscribe('BTC', '1m', (c) => a.push(c));
    const offB = feed.subscribe('BTC', '1m', (c) => b.push(c));
    expect(FakeSocket.instances).toHaveLength(1);
    const ws = FakeSocket.instances[0]!;
    ws.open();
    expect(ws.sent).toEqual(['{"op":"sub","symbol":"BTC","interval":"1m"}']);
    ws.onmessage?.({ data: JSON.stringify({ s: 'BTC', i: '1m', k: [T0, 1, 2, 0, 1.5] }) });
    ws.onmessage?.({ data: 'not json' });
    ws.onmessage?.({ data: JSON.stringify({ s: 'ETH', i: '1m', k: [T0, 1, 2, 0, 1.5] }) });
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    offA();
    expect(ws.sent).toHaveLength(1);
    offB();
    expect(ws.sent[1]).toBe('{"op":"unsub","symbol":"BTC","interval":"1m"}');
    expect(feed.status()).toBe('closed');
  });

  it('reconnects with backoff and resubscribes', async () => {
    FakeSocket.instances = [];
    const timers = fakeTimers();
    const statuses: string[] = [];
    const feed = createWebSocketDatafeed({
      url: 'wss://example.test/ws',
      WebSocket: FakeSocket,
      timers,
      subscribeMessage: (symbol) => `sub:${symbol}`,
      parseMessage: () => null,
      // Exact delays: no jitter in this test (the jitter has its own test).
      reconnect: { initialDelayMs: 100, jitter: 0 },
      onStatus: (s) => statuses.push(s),
    });
    feed.subscribe('BTC', '1m', () => undefined);
    FakeSocket.instances[0]!.open();
    FakeSocket.instances[0]!.drop();
    expect(feed.status()).toBe('reconnecting');
    await timers.advance(99);
    expect(FakeSocket.instances).toHaveLength(1);
    await timers.advance(1);
    expect(FakeSocket.instances).toHaveLength(2);
    FakeSocket.instances[1]!.drop();
    await timers.advance(199);
    expect(FakeSocket.instances).toHaveLength(2);
    await timers.advance(1);
    FakeSocket.instances[2]!.open();
    expect(FakeSocket.instances[2]!.sent).toEqual(['sub:BTC']);
    expect(statuses).toContain('open');
    feed.destroy();
    expect(feed.status()).toBe('closed');
    expect(timers.pending()).toBe(0);
  });

  it('sends heartbeats while open', async () => {
    FakeSocket.instances = [];
    const timers = fakeTimers();
    const feed = make(timers);
    feed.subscribe('BTC', '1m', () => undefined);
    FakeSocket.instances[0]!.open();
    await timers.advance(20_000);
    expect(FakeSocket.instances[0]!.sent.filter((m) => m === 'ping')).toHaveLength(2);
    feed.destroy();
  });
});

describe('synthetic datafeed', () => {
  const NOW = Date.UTC(2024, 5, 3, 12, 30);

  it('is deterministic and consistent across pages and intervals', async () => {
    const feed = createSyntheticDatafeed({ now: () => NOW });
    const all = await feed.getHistoricalData('SYN:BTCUSD', '1h', {
      from: NOW - 100 * HOUR,
      to: NOW,
    });
    const again = await createSyntheticDatafeed({ now: () => NOW }).getHistoricalData(
      'SYN:BTCUSD',
      '1h',
      {
        from: NOW - 50 * HOUR,
        to: NOW,
      },
    );
    expect(again).toEqual(all.slice(-again.length));
    for (const c of all) {
      expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open, c.close));
      expect(c.low).toBeLessThanOrEqual(Math.min(c.open, c.close));
    }
    for (let i = 1; i < all.length; i++) expect(all[i]!.open).toBe(all[i - 1]!.close);
    expect(all[all.length - 1]!.time).toBe(alignTime(NOW, '1h'));
    const daily = await feed.getHistoricalData('SYN:BTCUSD', '1D', {
      from: NOW - 3 * DAY,
      to: NOW,
    });
    expect(daily[daily.length - 1]!.close).toBe(all[all.length - 1]!.close);
    expect(feed.requests).toBe(2);
  });

  it('respects history start, weekends and gaps', async () => {
    const feed = createSyntheticDatafeed({ now: () => NOW });
    const info = await feed.resolveSymbol('SYN:EXAMPLE');
    expect(info.session).not.toBe('24x7');
    const days = await feed.getHistoricalData('SYN:EXAMPLE', '1D', {
      from: NOW - 14 * DAY,
      to: NOW,
    });
    expect(days.every((c) => ![0, 6].includes(new Date(c.time).getUTCDay()))).toBe(true);
    expect(
      await feed.getHistoricalData('SYN:EXAMPLE', '1D', { from: 0, to: info.historyStart! - 1 }),
    ).toHaveLength(0);
    const gappy = createSyntheticDatafeed({ now: () => NOW, gapRatio: 0.3 });
    const bars = await gappy.getHistoricalData('SYN:BTCUSD', '1m', {
      from: NOW - 999 * MIN,
      to: NOW,
    });
    expect(bars.length).toBeLessThan(900);
    expect(bars.length).toBeGreaterThan(500);
    await rejects(feed.resolveSymbol('NOPE'), /unknown symbol/);
  });

  it('streams the forming bar on the same path', async () => {
    const timers = fakeTimers();
    timers.now = NOW;
    const feed = createSyntheticDatafeed({ now: () => timers.now, timers, tickMs: 1000 });
    const updates: Candle[] = [];
    const off = feed.subscribe('SYN:ETHUSD', '1m', (c) => updates.push(c));
    await timers.advance(65_000);
    off();
    expect(updates).toHaveLength(65);
    expect(new Set(updates.map((u) => u.time)).size).toBe(2);
    expect(updates[updates.length - 1]!.close).toBe(feed.priceAt('SYN:ETHUSD', timers.now));
    expect(timers.pending()).toBe(0);
  });
});

describe('SSE and composed datafeeds', () => {
  class FakeSource {
    static last: FakeSource | null = null;
    onmessage: ((ev: { data: string }) => void) | null = null;
    onerror: ((ev: unknown) => void) | null = null;
    closed = false;
    listeners = new Map<string, (ev: { data: string }) => void>();
    constructor(readonly url: string) {
      FakeSource.last = this;
    }
    close(): void {
      this.closed = true;
    }
    addEventListener(type: string, listener: (ev: { data: string }) => void): void {
      this.listeners.set(type, listener);
    }
  }

  it('parses events, ignores bad ones and closes on unsubscribe', () => {
    const feed = createSseDatafeed({ url: (s, i) => `/sse/${s}/${i}`, EventSource: FakeSource });
    const got: Candle[] = [];
    const off = feed.subscribe('BTC', '1m', (c) => got.push(c));
    const source = FakeSource.last!;
    expect(source.url).toBe('/sse/BTC/1m');
    source.onmessage?.({
      data: JSON.stringify({ time: T0, open: 1, high: 2, low: 0, close: 1.5 }),
    });
    source.onmessage?.({ data: '{broken' });
    source.onmessage?.({ data: JSON.stringify({ time: 'x', close: 1 }) });
    expect(got).toHaveLength(1);
    off();
    expect(source.closed).toBe(true);
  });

  it('listens to named events with a custom parser', () => {
    const feed = createSseDatafeed({
      url: () => '/sse',
      eventName: 'bar',
      parse: (d) => d.split(',').map(Number),
      EventSource: FakeSource,
    });
    const got: Candle[] = [];
    feed.subscribe('BTC', '1m', (c) => got.push(c));
    FakeSource.last!.listeners.get('bar')!({ data: `${T0},1,2,0,1.5` });
    expect(got[0]).toMatchObject({ time: T0, close: 1.5 });
  });

  it('composes history and realtime sources', async () => {
    const history = createStaticDatafeed({
      ABC: { candles: [bar(T0, 1)], timeframe: '1m', info: { name: 'Abc' } },
    });
    const realtime = createSseDatafeed({ url: () => '/sse', EventSource: FakeSource });
    const feed = composeDatafeed({ history, realtime });
    expect((await feed.resolveSymbol('ABC')).name).toBe('Abc');
    expect(await feed.getHistoricalData('ABC', '1m', { from: T0, to: T0 })).toHaveLength(1);
    const got: Candle[] = [];
    feed.subscribe('ABC', '1m', (c) => got.push(c));
    FakeSource.last!.onmessage?.({ data: JSON.stringify([T0 + MIN, 1, 1, 1, 1]) });
    expect(got).toHaveLength(1);
    await rejects(
      createSseDatafeed({ url: () => '/sse', EventSource: FakeSource }).getHistoricalData(
        'A',
        '1m',
        { from: 0, to: 1 },
      ),
      /no history source/,
    );
  });
});
