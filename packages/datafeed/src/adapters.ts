import { ResponseTooLargeError, readJsonLimited, redactUrl } from '@market-chart/core';
import type { Unsubscribe } from '@market-chart/core';
import { mergeCandles, normalizeCandles, resampleCandles } from './candles.js';
import { alignTime, isMultipleOf, nextBarTime, parseTimeframe } from './timeframe.js';
import type { Candle, CandleUpdate, Datafeed, SymbolInfo, Timeframe, TimeRange } from './types.js';
import { DatafeedError } from './types.js';

/** Timer functions, injectable for tests. */
export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export const defaultTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};

type Listener = (candle: CandleUpdate) => void;

/** Fan-out of realtime candles to subscribers, keyed by symbol and interval. */
class SubscriptionHub {
  // The key is only a lookup key; the symbol and interval are kept as given (a symbol may contain "|").
  private readonly listeners = new Map<
    string,
    { symbol: string; interval: Timeframe; set: Set<Listener> }
  >();

  static key(symbol: string, interval: Timeframe): string {
    return JSON.stringify([symbol, interval]);
  }

  add(
    symbol: string,
    interval: Timeframe,
    listener: Listener,
  ): { first: boolean; remove: () => boolean } {
    const key = SubscriptionHub.key(symbol, interval);
    let entry = this.listeners.get(key);
    const first = !entry;
    if (!entry) this.listeners.set(key, (entry = { symbol, interval, set: new Set() }));
    const set = entry.set;
    set.add(listener);
    let active = true;
    return {
      first,
      remove: () => {
        if (!active) return false;
        active = false;
        set.delete(listener);
        if (set.size) return false;
        this.listeners.delete(key);
        return true;
      },
    };
  }

  emit(symbol: string, interval: Timeframe, candle: CandleUpdate): void {
    for (const listener of [
      ...(this.listeners.get(SubscriptionHub.key(symbol, interval))?.set ?? []),
    ]) {
      try {
        listener(candle);
      } catch (error) {
        console.error('[market-chart/datafeed] subscriber threw', error);
      }
    }
  }

  keys(): [string, Timeframe][] {
    return [...this.listeners.values()].map((e) => [e.symbol, e.interval]);
  }

  has(symbol: string, interval: Timeframe): boolean {
    return this.listeners.has(SubscriptionHub.key(symbol, interval));
  }

  get size(): number {
    return this.listeners.size;
  }
}

// ───────────────────────────── static ─────────────────────────────

export interface StaticSymbolData {
  readonly info?: Partial<SymbolInfo>;
  /** Base candles (sorted or not; they are normalised). */
  readonly candles: readonly unknown[];
  /** Timeframe of `candles`. Larger multiples are resampled on request. */
  readonly timeframe: Timeframe;
}

export interface StaticDatafeed extends Datafeed {
  /** Feeds a realtime candle of the base timeframe; subscribers of larger timeframes get the aggregated bar. */
  push(symbol: string, candle: Candle): void;
  setCandles(symbol: string, candles: readonly unknown[]): void;
}

/** In-memory datafeed for fixtures, imported files and tests. No network. */
export function createStaticDatafeed(
  symbols: Readonly<Record<string, StaticSymbolData>>,
): StaticDatafeed {
  const store = new Map<
    string,
    {
      info: SymbolInfo;
      candles: Candle[];
      timeframe: Timeframe;
      resampled: Map<Timeframe, Candle[]>;
    }
  >();
  const hub = new SubscriptionHub();
  const set = (symbol: string, data: StaticSymbolData): void => {
    parseTimeframe(data.timeframe);
    const candles = normalizeCandles(data.candles).candles;
    store.set(symbol, {
      // The data range is known, so loading can start at its end (e.g. an imported file from years ago).
      info: {
        symbol,
        ...(candles.length
          ? { historyStart: candles[0]!.time, historyEnd: candles[candles.length - 1]!.time }
          : {}),
        ...data.info,
      },
      candles,
      timeframe: data.timeframe,
      resampled: new Map(),
    });
  };
  for (const [symbol, data] of Object.entries(symbols)) set(symbol, data);
  const entry = (symbol: string) => {
    const e = store.get(symbol);
    if (!e) throw new DatafeedError(`unknown symbol "${symbol}"`);
    return e;
  };
  const candlesFor = (symbol: string, interval: Timeframe): Candle[] => {
    const e = entry(symbol);
    if (interval === e.timeframe) return e.candles;
    if (!isMultipleOf(interval, e.timeframe)) {
      throw new DatafeedError(`${symbol}: cannot build ${interval} bars from ${e.timeframe} data`);
    }
    let r = e.resampled.get(interval);
    if (!r) e.resampled.set(interval, (r = resampleCandles(e.candles, interval)));
    return r;
  };
  return {
    async searchSymbols(query) {
      const q = query.trim().toLowerCase();
      return [...store.values()]
        .map((e) => e.info)
        .filter(
          (i) => i.symbol.toLowerCase().includes(q) || (i.name ?? '').toLowerCase().includes(q),
        );
    },
    async resolveSymbol(symbol) {
      return entry(symbol).info;
    },
    async getHistoricalData(symbol, interval, range: TimeRange) {
      return candlesFor(symbol, interval).filter((c) => c.time >= range.from && c.time <= range.to);
    },
    subscribe(symbol, interval, callback): Unsubscribe {
      entry(symbol);
      return hub.add(symbol, interval, callback).remove as Unsubscribe;
    },
    push(symbol, candle) {
      const e = entry(symbol);
      const [normalized] = normalizeCandles([candle]).candles;
      if (!normalized) throw new DatafeedError('invalid candle');
      // Realtime pushes are almost always the forming or the next bar: O(1) instead of a full merge.
      const lastTime = e.candles.length ? e.candles[e.candles.length - 1]!.time : -Infinity;
      if (normalized.time === lastTime) e.candles[e.candles.length - 1] = normalized;
      else if (normalized.time > lastTime) e.candles.push(normalized);
      else e.candles = mergeCandles(e.candles, [normalized]);
      e.resampled.clear();
      if (e.info.historyEnd !== undefined && normalized.time > e.info.historyEnd)
        e.info = { ...e.info, historyEnd: normalized.time };
      for (const [s, interval] of hub.keys()) {
        if (s !== symbol) continue;
        if (interval === e.timeframe) hub.emit(symbol, interval, normalized);
        else if (isMultipleOf(interval, e.timeframe)) {
          const start = alignTime(normalized.time, interval);
          // Only the bars of this bucket: binary-search its start instead of scanning every candle.
          const end = nextBarTime(start, interval);
          let lo = 0;
          let hi = e.candles.length;
          while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (e.candles[mid]!.time < start) lo = mid + 1;
            else hi = mid;
          }
          const members: Candle[] = [];
          for (let i = lo; i < e.candles.length && e.candles[i]!.time < end; i++)
            members.push(e.candles[i]!);
          const bucket = resampleCandles(members, interval);
          if (bucket[0]) hub.emit(symbol, interval, bucket[0]);
        }
      }
    },
    setCandles(symbol, candles) {
      const e = entry(symbol);
      // The data range is recomputed from the new candles.
      const { historyStart: _start, historyEnd: _end, ...info } = e.info;
      set(symbol, { info, candles, timeframe: e.timeframe });
    },
  };
}

// ───────────────────────────── REST ─────────────────────────────

export interface HistoryRequest {
  readonly symbol: string;
  readonly interval: Timeframe;
  readonly from: number;
  readonly to: number;
}

export interface RestDatafeedOptions {
  /** URL for a history request. */
  history(request: HistoryRequest): string;
  /** Extracts candle rows from the response (default: the response itself or its candles/data/bars array). */
  parseHistory?(json: unknown, request: HistoryRequest): readonly unknown[];
  resolve?(symbol: string): string;
  parseSymbol?(json: unknown, symbol: string): SymbolInfo;
  search?(query: string): string;
  parseSearch?(json: unknown): SymbolInfo[];
  /** Split long ranges into requests of at most this many bars. */
  maxBarsPerRequest?: number;
  headers?: Record<string, string> | (() => Record<string, string>);
  /**
   * Cookie / HTTP-auth mode of every request (default `'same-origin'`, the browser default, now sent
   * explicitly). Use `'include'` only for a trusted cross-origin API that needs cookies.
   */
  credentials?: RequestCredentials;
  fetch?: typeof fetch;
  retries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  /** Largest accepted response body in bytes (default 64 MiB); larger responses fail without retry. */
  maxResponseBytes?: number;
  /** Most requests one `getHistoricalData` call may split a range into (default 1000). */
  maxRequestsPerRange?: number;
  /** Realtime source (e.g. a WebSocket datafeed); without it `subscribe` is a no-op. */
  realtime?: Pick<Datafeed, 'subscribe'>;
  timers?: Timers;
}

/** Default response-size limit of the REST datafeed. */
export const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
/** Default size limit of one WebSocket or SSE message. */
export const DEFAULT_MAX_MESSAGE_BYTES = 4 * 1024 * 1024;

/** Search results from an untrusted response: objects with a string `symbol`, at most 1000 of them. */
function searchResults(json: unknown): SymbolInfo[] {
  if (!Array.isArray(json)) throw new DatafeedError('search response is not an array');
  return json
    .filter(
      (i): i is SymbolInfo =>
        !!i && typeof i === 'object' && typeof (i as { symbol?: unknown }).symbol === 'string',
    )
    .slice(0, 1000);
}

function defaultRows(json: unknown): readonly unknown[] {
  if (Array.isArray(json)) return json;
  if (json && typeof json === 'object') {
    const o = json as Record<string, unknown>;
    const rows = o['candles'] ?? o['data'] ?? o['bars'] ?? o['klines'];
    if (Array.isArray(rows)) return rows;
  }
  throw new DatafeedError('history response is not an array of candles');
}

/**
 * Generic REST datafeed: you describe URLs and response shapes, it handles chunking, retries
 * (network errors, 429 and 5xx with exponential backoff), timeouts and normalisation.
 */
export function createRestDatafeed(options: RestDatafeedOptions): Datafeed {
  const timers = options.timers ?? defaultTimers;
  const doFetch = options.fetch ?? (globalThis.fetch?.bind(globalThis) as typeof fetch | undefined);
  const retries = options.retries ?? 2;
  const maxBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const sleep = (ms: number) => new Promise<void>((resolve) => timers.setTimeout(resolve, ms));

  async function getJson(url: string): Promise<unknown> {
    if (!doFetch) throw new DatafeedError('fetch is not available; pass options.fetch');
    let attempt = 0;
    for (;;) {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = timers.setTimeout(() => controller?.abort(), options.timeoutMs ?? 10_000);
      try {
        const headers = typeof options.headers === 'function' ? options.headers() : options.headers;
        const response = await doFetch(url, {
          headers,
          credentials: options.credentials ?? 'same-origin',
          signal: controller?.signal,
        });
        // Error messages carry the URL without its query string: API keys often live there.
        if (response.status === 429 || response.status >= 500)
          throw new DatafeedError(`HTTP ${response.status} for ${redactUrl(url)}`, response.status);
        if (!response.ok)
          throw Object.assign(new DatafeedError(`HTTP ${response.status} for ${redactUrl(url)}`), {
            fatal: true,
          });
        try {
          return await readJsonLimited(response, maxBytes);
        } catch (error) {
          throw Object.assign(
            new DatafeedError(
              error instanceof ResponseTooLargeError
                ? `response of ${redactUrl(url)} is larger than ${maxBytes} bytes`
                : `invalid JSON from ${redactUrl(url)}`,
              error,
            ),
            { fatal: true },
          );
        }
      } catch (error) {
        if ((error as { fatal?: boolean }).fatal || attempt >= retries) {
          throw error instanceof DatafeedError
            ? error
            : new DatafeedError(`request failed: ${redactUrl(url)}`, error);
        }
        await sleep((options.retryDelayMs ?? 300) * 2 ** attempt);
        attempt++;
      } finally {
        timers.clearTimeout(timer);
      }
    }
  }

  return {
    async searchSymbols(query) {
      if (!options.search) return [];
      const json = await getJson(options.search(query));
      return options.parseSearch ? options.parseSearch(json) : searchResults(json);
    },
    async resolveSymbol(symbol) {
      if (!options.resolve) return { symbol };
      const json = await getJson(options.resolve(symbol));
      return options.parseSymbol
        ? options.parseSymbol(json, symbol)
        : { symbol, ...(json as Partial<SymbolInfo>) };
    },
    async getHistoricalData(symbol, interval, range) {
      const step = parseTimeframe(interval).ms;
      const max = options.maxBarsPerRequest;
      const chunks: HistoryRequest[] = [];
      if (max && max > 0) {
        // A huge range (or a tiny maxBarsPerRequest) must not turn into a storm of requests.
        const limit = options.maxRequestsPerRange ?? 1000;
        if ((range.to - range.from + 1) / (max * step) > limit)
          throw new DatafeedError(
            `range would need more than ${limit} requests; raise maxBarsPerRequest or maxRequestsPerRange`,
          );
        for (let from = range.from; from <= range.to; from += max * step) {
          chunks.push({ symbol, interval, from, to: Math.min(range.to, from + max * step - 1) });
        }
      } else chunks.push({ symbol, interval, from: range.from, to: range.to });
      let all: Candle[] = [];
      for (const request of chunks) {
        const json = await getJson(options.history(request));
        const rows = options.parseHistory ? options.parseHistory(json, request) : defaultRows(json);
        all = mergeCandles(all, normalizeCandles(rows).candles);
      }
      return all.filter((c) => c.time >= range.from && c.time <= range.to);
    },
    subscribe(symbol, interval, callback) {
      return options.realtime
        ? options.realtime.subscribe(symbol, interval, callback)
        : () => undefined;
    },
  };
}

// ───────────────────────────── WebSocket ─────────────────────────────

export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

/** Minimal WebSocket surface used here (matches the browser API). */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export interface WebSocketDatafeedOptions {
  url: string | (() => string);
  /** Source of symbols and history (e.g. a REST datafeed). */
  history?: Datafeed;
  subscribeMessage(symbol: string, interval: Timeframe): unknown;
  unsubscribeMessage?(symbol: string, interval: Timeframe): unknown;
  /** Extracts candle updates from a message (already JSON-parsed when it was JSON). */
  parseMessage(
    message: unknown,
  ): readonly { symbol: string; interval: Timeframe; candle: unknown }[] | null;
  heartbeat?: { message: unknown; intervalMs: number };
  /**
   * Exponential backoff. `jitter` (0–1, default 0.5) randomises each delay down to `(1 - jitter)` of it, so
   * thousands of clients do not reconnect in lock-step after a server restart. The attempt counter resets
   * only after a message arrives or the connection stays open for `maxDelayMs`, so a server that accepts and
   * immediately drops connections is not hammered at the initial delay forever.
   */
  reconnect?: {
    initialDelayMs?: number;
    maxDelayMs?: number;
    maxAttempts?: number;
    jitter?: number;
  };
  /** Messages larger than this are dropped unparsed (default 4 MiB, counted in UTF-16 code units). */
  maxMessageBytes?: number;
  /** Random source for the backoff jitter (tests). */
  random?: () => number;
  WebSocket?: new (url: string) => SocketLike;
  timers?: Timers;
  onStatus?(status: ConnectionStatus): void;
}

export interface WebSocketDatafeed extends Datafeed {
  status(): ConnectionStatus;
  destroy(): void;
}

/**
 * WebSocket realtime datafeed with one shared connection, reference-counted subscriptions, re-subscription
 * after reconnects, exponential backoff and an optional heartbeat. The socket opens with the first
 * subscription and closes when the last one is removed.
 */
export function createWebSocketDatafeed(options: WebSocketDatafeedOptions): WebSocketDatafeed {
  const timers = options.timers ?? defaultTimers;
  const Socket =
    options.WebSocket ?? (globalThis as { WebSocket?: new (url: string) => SocketLike }).WebSocket;
  const hub = new SubscriptionHub();
  let socket: SocketLike | null = null;
  let status: ConnectionStatus = 'idle';
  let attempts = 0;
  let reconnectHandle: unknown = null;
  let heartbeatHandle: unknown = null;
  let stableHandle: unknown = null;
  let destroyed = false;
  const initialDelay = options.reconnect?.initialDelayMs ?? 500;
  const maxDelay = options.reconnect?.maxDelayMs ?? 15_000;
  const maxAttempts = options.reconnect?.maxAttempts ?? Infinity;
  const jitter = Math.min(1, Math.max(0, options.reconnect?.jitter ?? 0.5));
  const random = options.random ?? Math.random;
  const maxMessage = options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES;
  const clearStable = (): void => {
    if (stableHandle !== null) timers.clearTimeout(stableHandle);
    stableHandle = null;
  };

  const setStatus = (next: ConnectionStatus): void => {
    status = next;
    options.onStatus?.(next);
  };
  const encode = (message: unknown): string =>
    typeof message === 'string' ? message : JSON.stringify(message);
  const send = (message: unknown): void => {
    if (socket && socket.readyState === 1) socket.send(encode(message));
  };
  const stopHeartbeat = (): void => {
    if (heartbeatHandle !== null) timers.clearInterval(heartbeatHandle);
    heartbeatHandle = null;
  };

  const connect = (): void => {
    if (destroyed || socket || !hub.size) return;
    if (!Socket) throw new DatafeedError('WebSocket is not available; pass options.WebSocket');
    setStatus(attempts ? 'reconnecting' : 'connecting');
    const url = typeof options.url === 'function' ? options.url() : options.url;
    const ws = new Socket(url);
    socket = ws;
    ws.onopen = () => {
      setStatus('open');
      clearStable();
      stableHandle = timers.setTimeout(() => {
        stableHandle = null;
        attempts = 0;
      }, maxDelay);
      for (const [symbol, interval] of hub.keys()) send(options.subscribeMessage(symbol, interval));
      if (options.heartbeat)
        heartbeatHandle = timers.setInterval(
          () => send(options.heartbeat!.message),
          options.heartbeat.intervalMs,
        );
    };
    ws.onmessage = (event) => {
      let message: unknown = event.data;
      if (typeof message === 'string' && message.length > maxMessage) return;
      attempts = 0;
      if (typeof message === 'string' && /^\s*[[{]/.test(message)) {
        try {
          message = JSON.parse(message);
        } catch {
          return;
        }
      }
      let updates: ReturnType<WebSocketDatafeedOptions['parseMessage']>;
      try {
        updates = options.parseMessage(message);
      } catch {
        return;
      }
      for (const update of updates ?? []) {
        const [candle] = normalizeCandles([update.candle]).candles;
        if (candle) hub.emit(update.symbol, update.interval, candle);
      }
    };
    ws.onclose = () => {
      stopHeartbeat();
      clearStable();
      if (socket === ws) socket = null;
      if (destroyed || !hub.size) {
        setStatus('closed');
        return;
      }
      if (attempts >= maxAttempts) {
        setStatus('closed');
        return;
      }
      const delay = Math.round(
        Math.min(maxDelay, initialDelay * 2 ** attempts) * (1 - jitter * random()),
      );
      attempts++;
      setStatus('reconnecting');
      reconnectHandle = timers.setTimeout(() => {
        reconnectHandle = null;
        connect();
      }, delay);
    };
    ws.onerror = () => {
      // The close event follows and handles reconnection.
    };
  };

  const history = (): Datafeed => {
    if (!options.history) throw new DatafeedError('this WebSocket datafeed has no history source');
    return options.history;
  };

  return {
    searchSymbols: (query) => options.history?.searchSymbols?.(query) ?? Promise.resolve([]),
    resolveSymbol: (symbol) =>
      options.history ? history().resolveSymbol(symbol) : Promise.resolve({ symbol }),
    getHistoricalData: async (symbol, interval, range) =>
      history().getHistoricalData(symbol, interval, range),
    subscribe(symbol, interval, callback) {
      if (destroyed) throw new DatafeedError('datafeed destroyed');
      const { first, remove } = hub.add(symbol, interval, callback);
      if (first) {
        if (socket && socket.readyState === 1) send(options.subscribeMessage(symbol, interval));
        else connect();
      }
      return () => {
        if (!remove()) return;
        if (options.unsubscribeMessage) send(options.unsubscribeMessage(symbol, interval));
        if (!hub.size && socket) {
          const ws = socket;
          socket = null;
          stopHeartbeat();
          clearStable();
          ws.close();
          setStatus('closed');
        }
      };
    },
    status: () => status,
    destroy() {
      destroyed = true;
      if (reconnectHandle !== null) timers.clearTimeout(reconnectHandle);
      stopHeartbeat();
      clearStable();
      socket?.close();
      socket = null;
      setStatus('closed');
    },
  };
}

// ───────────────────────────── SSE ─────────────────────────────

export interface EventSourceLike {
  onmessage: ((ev: { data: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  close(): void;
  addEventListener?(type: string, listener: (ev: { data: string }) => void): void;
}

export interface SseDatafeedOptions {
  url(symbol: string, interval: Timeframe): string;
  /** Extracts a candle from an event's data (default: JSON.parse). */
  parse?(data: string): unknown;
  /** Named event to listen to (default: unnamed `message` events). */
  eventName?: string;
  history?: Datafeed;
  EventSource?: new (url: string) => EventSourceLike;
  /** Events larger than this are dropped unparsed (default 4 MiB, counted in UTF-16 code units). */
  maxMessageBytes?: number;
}

/** Server-Sent Events realtime datafeed (the browser's EventSource reconnects by itself). */
export function createSseDatafeed(options: SseDatafeedOptions): Datafeed {
  const Source =
    options.EventSource ??
    (globalThis as { EventSource?: new (url: string) => EventSourceLike }).EventSource;
  const history = (): Datafeed => {
    if (!options.history) throw new DatafeedError('this SSE datafeed has no history source');
    return options.history;
  };
  return {
    searchSymbols: (query) => options.history?.searchSymbols?.(query) ?? Promise.resolve([]),
    resolveSymbol: (symbol) =>
      options.history ? history().resolveSymbol(symbol) : Promise.resolve({ symbol }),
    getHistoricalData: async (symbol, interval, range) =>
      history().getHistoricalData(symbol, interval, range),
    subscribe(symbol, interval, callback) {
      if (!Source)
        throw new DatafeedError('EventSource is not available; pass options.EventSource');
      const source = new Source(options.url(symbol, interval));
      const maxMessage = options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES;
      const handle = (event: { data: string }): void => {
        if (typeof event.data !== 'string' || event.data.length > maxMessage) return;
        let raw: unknown;
        try {
          raw = options.parse ? options.parse(event.data) : JSON.parse(event.data);
        } catch {
          return;
        }
        const [candle] = normalizeCandles([raw]).candles;
        if (candle) callback(candle);
      };
      if (options.eventName && source.addEventListener)
        source.addEventListener(options.eventName, handle);
      else source.onmessage = handle;
      return () => source.close();
    },
  };
}

/** Uses one datafeed for symbols/history and another for realtime updates. */
export function composeDatafeed(parts: {
  history: Datafeed;
  realtime: Pick<Datafeed, 'subscribe'>;
}): Datafeed {
  return {
    searchSymbols: (query) => parts.history.searchSymbols?.(query) ?? Promise.resolve([]),
    resolveSymbol: (symbol) => parts.history.resolveSymbol(symbol),
    getHistoricalData: (symbol, interval, range) =>
      parts.history.getHistoricalData(symbol, interval, range),
    subscribe: (symbol, interval, callback) => parts.realtime.subscribe(symbol, interval, callback),
  };
}
