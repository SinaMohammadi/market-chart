import { describe, expect, it } from 'vitest';
import {
  buildUrl,
  createRestDatafeed,
  createSseDatafeed,
  createWebSocketDatafeed,
  sanitizeSymbolInfo,
} from './index.js';
import type { EventSourceLike, SocketLike, Timers } from './index.js';

const MIN = 60_000;
const T0 = Date.UTC(2024, 0, 1);

async function errorOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'resolved';
  } catch (error) {
    return String((error as Error).message);
  }
}

function manualTimers(): Timers & { advance(ms: number): void; pending(): number } {
  let now = 0;
  let id = 0;
  const tasks = new Map<number, { at: number; fn: () => void; every?: number }>();
  return {
    setTimeout: (fn, ms) => (tasks.set(++id, { at: now + ms, fn }), id),
    clearTimeout: (h) => void tasks.delete(h as number),
    setInterval: (fn, ms) => (tasks.set(++id, { at: now + ms, fn, every: ms }), id),
    clearInterval: (h) => void tasks.delete(h as number),
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...tasks.entries()]
          .filter(([, t]) => t.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at;
        if (next[1].every) next[1].at += next[1].every;
        else tasks.delete(next[0]);
        next[1].fn();
      }
      now = end;
    },
    pending: () => tasks.size,
  };
}

describe('REST datafeed (security)', () => {
  const ok = (body: unknown, extra: Partial<Response> = {}): Response =>
    ({ ok: true, status: 200, json: async () => body, ...extra }) as Response;

  it('sends an explicit credentials mode (same-origin by default, configurable)', async () => {
    const seen: RequestInit[] = [];
    const fetch = (async (_url: string, init: RequestInit) => (seen.push(init), ok([]))) as never;
    await createRestDatafeed({ history: () => '/h', fetch }).getHistoricalData('X', '1m', {
      from: T0,
      to: T0,
    });
    await createRestDatafeed({ history: () => '/h', fetch, credentials: 'omit' }).getHistoricalData(
      'X',
      '1m',
      { from: T0, to: T0 },
    );
    expect(seen.map((i) => i.credentials)).toEqual(['same-origin', 'omit']);
  });

  it('keeps API keys in the query string out of error messages', async () => {
    const feed = createRestDatafeed({
      history: () => 'https://api.example.test/candles?apikey=TOP-SECRET&s=X',
      retries: 0,
      fetch: (async () => ({ ok: false, status: 403, json: async () => null })) as never,
    });
    const message = await errorOf(feed.getHistoricalData('X', '1m', { from: T0, to: T0 }));
    expect(message).toMatch(/HTTP 403 for https:\/\/api\.example\.test\/candles\?…/);
    expect(message).not.toMatch(/TOP-SECRET/);
    const network = createRestDatafeed({
      history: () => '/candles?token=TOP-SECRET',
      retries: 0,
      fetch: (async () => {
        throw new TypeError('offline');
      }) as never,
    });
    expect(await errorOf(network.getHistoricalData('X', '1m', { from: T0, to: T0 }))).not.toMatch(
      /TOP-SECRET/,
    );
  });

  it('rejects responses larger than maxResponseBytes without retrying', async () => {
    let calls = 0;
    const feed = createRestDatafeed({
      history: () => '/h',
      maxResponseBytes: 50,
      fetch: (async () => (
        calls++,
        { ok: true, status: 200, text: async () => JSON.stringify(new Array(100).fill(1)) }
      )) as never,
    });
    expect(await errorOf(feed.getHistoricalData('X', '1m', { from: T0, to: T0 }))).toMatch(
      /larger than 50 bytes/,
    );
    expect(calls).toBe(1);
  });

  it('refuses to split a range into a storm of requests', async () => {
    let calls = 0;
    const feed = createRestDatafeed({
      history: () => '/h',
      maxBarsPerRequest: 1,
      fetch: (async () => (calls++, ok([]))) as never,
    });
    expect(await errorOf(feed.getHistoricalData('X', '1m', { from: 0, to: T0 }))).toMatch(
      /more than 1000 requests/,
    );
    expect(calls).toBe(0);
  });

  it('validates search results', async () => {
    const feed = createRestDatafeed({
      history: () => '/h',
      search: (q) => buildUrl('/search', { q }),
      fetch: (async () =>
        ok([{ symbol: 'A' }, { symbol: 5 }, null, 'x', { name: 'no symbol' }])) as never,
    });
    expect(await feed.searchSymbols!('a')).toEqual([{ symbol: 'A' }]);
    const bad = createRestDatafeed({
      history: () => '/h',
      search: () => '/search',
      fetch: (async () => ok({ evil: true })) as never,
    });
    expect(await errorOf(bad.searchSymbols!('a'))).toMatch(/not an array/);
  });

  it('URLs built with buildUrl cannot be redirected by a hostile symbol', async () => {
    const urls: string[] = [];
    const feed = createRestDatafeed({
      history: ({ symbol, interval, from, to }) =>
        buildUrl('/api/{symbol}/candles', { symbol, tf: interval, from, to }),
      fetch: (async (url: string) => (urls.push(url), ok([]))) as never,
    });
    await feed.getHistoricalData('../admin?x=1', '1m', { from: T0, to: T0 });
    expect(urls[0]).toBe(`/api/..%2Fadmin%3Fx%3D1/candles?tf=1m&from=${T0}&to=${T0}`);
  });
});

class Socket implements SocketLike {
  static all: Socket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(readonly url: string) {
    Socket.all.push(this);
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
}

describe('WebSocket datafeed (security)', () => {
  const make = (timers: Timers, extra: object = {}) =>
    createWebSocketDatafeed({
      url: 'wss://x.test/ws',
      WebSocket: Socket,
      timers,
      subscribeMessage: (symbol, interval) => ({ symbol, interval }),
      parseMessage: (m) => {
        const msg = m as { s: string; i: string; k: unknown };
        return msg?.k ? [{ symbol: msg.s, interval: msg.i, candle: msg.k }] : null;
      },
      reconnect: { initialDelayMs: 100, maxDelayMs: 10_000, jitter: 0 },
      ...extra,
    });

  it('keeps backing off when the server accepts and immediately drops connections', () => {
    Socket.all = [];
    const timers = manualTimers();
    const feed = make(timers);
    feed.subscribe('BTC', '1m', () => undefined);
    const delays: number[] = [];
    for (let i = 0; i < 5; i++) {
      const ws = Socket.all.at(-1)!;
      ws.open();
      ws.close();
      let waited = 0;
      while (Socket.all.length === i + 1) {
        timers.advance(1);
        waited++;
      }
      delays.push(waited);
    }
    // Before the fix every reconnect happened after 100 ms (the counter reset on open).
    expect(delays).toEqual([100, 200, 400, 800, 1600]);
    feed.destroy();
    expect(timers.pending()).toBe(0);
  });

  it('resets the backoff once a connection proved healthy', () => {
    Socket.all = [];
    const timers = manualTimers();
    const feed = make(timers);
    feed.subscribe('BTC', '1m', () => undefined);
    Socket.all[0]!.open();
    Socket.all[0]!.close();
    timers.advance(100);
    Socket.all[1]!.open();
    Socket.all[1]!.onmessage?.({ data: '{"hello":1}' });
    Socket.all[1]!.close();
    timers.advance(99);
    expect(Socket.all).toHaveLength(2);
    timers.advance(1);
    expect(Socket.all).toHaveLength(3);
    feed.destroy();
  });

  it('adds jitter to reconnect delays', () => {
    Socket.all = [];
    const timers = manualTimers();
    const feed = make(timers, {
      reconnect: { initialDelayMs: 1000, jitter: 0.5 },
      random: () => 1,
    });
    feed.subscribe('BTC', '1m', () => undefined);
    Socket.all[0]!.close();
    timers.advance(499);
    expect(Socket.all).toHaveLength(1);
    timers.advance(1);
    expect(Socket.all).toHaveLength(2);
    feed.destroy();
  });

  it('drops oversized messages before parsing them', () => {
    Socket.all = [];
    const timers = manualTimers();
    const got: unknown[] = [];
    const feed = make(timers, { maxMessageBytes: 100 });
    feed.subscribe('BTC', '1m', (c) => got.push(c));
    Socket.all[0]!.open();
    const candle = { s: 'BTC', i: '1m', k: [T0, 1, 1, 1, 1] };
    Socket.all[0]!.onmessage?.({ data: JSON.stringify({ ...candle, pad: 'x'.repeat(200) }) });
    Socket.all[0]!.onmessage?.({ data: JSON.stringify(candle) });
    expect(got).toHaveLength(1);
    feed.destroy();
  });

  it('resubscribes symbols containing "|" exactly as given', () => {
    Socket.all = [];
    const timers = manualTimers();
    const feed = make(timers);
    feed.subscribe('EXCH|SYM.A', '1D', () => undefined);
    Socket.all[0]!.open();
    expect(Socket.all[0]!.sent).toEqual(['{"symbol":"EXCH|SYM.A","interval":"1D"}']);
    feed.destroy();
  });
});

describe('SSE datafeed (security)', () => {
  it('drops oversized events', () => {
    const sources: EventSourceLike[] = [];
    class Source implements EventSourceLike {
      onmessage: ((ev: { data: string }) => void) | null = null;
      onerror: ((ev: unknown) => void) | null = null;
      constructor() {
        sources.push(this);
      }
      close(): void {}
    }
    const got: unknown[] = [];
    const feed = createSseDatafeed({ url: () => '/sse', EventSource: Source, maxMessageBytes: 64 });
    feed.subscribe('X', '1m', (c) => got.push(c));
    sources[0]!.onmessage!({ data: JSON.stringify([T0, 1, 1, 1, 1, 'x'.repeat(100)]) });
    sources[0]!.onmessage!({ data: JSON.stringify([T0 + MIN, 1, 1, 1, 1]) });
    expect(got).toHaveLength(1);
  });
});

describe('sanitizeSymbolInfo (security)', () => {
  it('drops values that would break formatting or range maths', () => {
    const info = sanitizeSymbolInfo(
      {
        symbol: 'BTC',
        name: 'x'.repeat(10_000),
        pricePrecision: 1e9,
        minMove: -1,
        historyStart: 'yesterday',
        historyEnd: 1e300,
        timeframes: ['1m', 5, 'x'.repeat(100)],
        exchange: 'EXAMPLE-EX',
      },
      'BTC',
    );
    expect(info).toEqual({ symbol: 'BTC', exchange: 'EXAMPLE-EX', timeframes: ['1m'] });
    expect(sanitizeSymbolInfo(null, 'ETH')).toEqual({ symbol: 'ETH' });
    expect(
      sanitizeSymbolInfo({ symbol: 'A', historyStart: 10, historyEnd: 5, pricePrecision: 4 }, 'A'),
    ).toEqual({ symbol: 'A', pricePrecision: 4 });
  });
});

describe('imports (security)', () => {
  it('drops candles outside the Date range or with absurd values', async () => {
    const { normalizeCandles } = await import('./index.js');
    const r = normalizeCandles([
      [1e17, 1, 1, 1, 1],
      [T0, 1e300, 1e300, 1e300, 1e300],
      { time: T0 + MIN, close: 5, volume: 1e300 },
      [T0 + 2 * MIN, 1, 2, 0.5, 1.5],
    ]);
    expect(r.dropped).toBe(2);
    expect(r.candles).toHaveLength(2);
    expect(r.candles[0]).not.toHaveProperty('volume');
    expect(() => new Date(r.candles[0]!.time).toISOString()).not.toThrow();
  });

  it('enforces byte and row limits on CSV, JSON and files', async () => {
    const { parseCandleFile, parseCsv, parseJsonCandles } = await import('./index.js');
    const csv = `time,close\n${Array.from({ length: 50 }, (_, i) => `${T0 + i * MIN},1`).join('\n')}`;
    expect(() => parseCsv(csv, { maxRows: 10 })).toThrow(/more than 10 rows/);
    expect(() => parseCsv(csv, { maxBytes: 100 })).toThrow(/larger than 100 bytes/);
    expect(parseCsv(csv).candles).toHaveLength(50);
    const json = JSON.stringify(Array.from({ length: 20 }, (_, i) => [T0 + i * MIN, 1, 1, 1, 1]));
    expect(() => parseJsonCandles(json, { maxRows: 5 })).toThrow(/more than 5 rows/);
    expect(() => parseJsonCandles(json, { maxBytes: 10 })).toThrow(/larger than 10 bytes/);
    let read = false;
    const huge = { name: 'a.csv', size: 10 ** 12, text: async () => ((read = true), csv) };
    expect(await errorOf(parseCandleFile(huge))).toMatch(/larger than/);
    expect(read).toBe(false);
  });

  it('parses malformed CSV rows without throwing', async () => {
    const { parseCsv } = await import('./index.js');
    const r = parseCsv(
      'time,open,high,low,close\n"unterminated,1,2\nNaN,1,1,1,1\nInfinity,1,1,1,1\n,,,,\n',
    );
    expect(r.candles).toHaveLength(0);
    expect(r.dropped).toBe(4);
  });
});
