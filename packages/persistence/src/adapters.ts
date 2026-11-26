import { ResponseTooLargeError, readTextLimited, redactUrl } from '@market-chart/core';
import { parseJson, validateChartState, validateLayoutMetadata } from './schema.js';
import type {
  ChartLayoutMetadata,
  SerializedChartState,
  StorageAdapter,
  Versioned,
} from './types.js';
import { PersistenceError, StorageConflictError, StorageQuotaError } from './types.js';

export interface AdapterOptions<T> {
  /** Validates stored data on read (default: chart state validation). */
  readonly validate?: (raw: unknown) => T;
}

const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

function checkId(id: string): void {
  if (typeof id !== 'string' || !ID_PATTERN.test(id))
    throw new PersistenceError(`invalid id "${String(id)}"`);
}

function metadata(id: string, state: Versioned): ChartLayoutMetadata {
  return { id, name: state.name ?? id, updatedAt: state.savedAt, revision: state.revision };
}

function checkRevision<T extends Versioned>(existing: T | null, next: T): void {
  if (existing && existing.revision >= next.revision) throw new StorageConflictError(existing);
}

function defaultValidate<T>(options: AdapterOptions<T>): (raw: unknown) => T {
  return options.validate ?? ((raw) => validateChartState(raw) as unknown as T);
}

/** In-memory storage (tests, SSR, ephemeral sessions). Values are stored as JSON copies. */
export function createMemoryStorage<T extends Versioned = SerializedChartState>(
  options: AdapterOptions<T> = {},
): StorageAdapter<T> {
  const validate = defaultValidate(options);
  const items = new Map<string, string>();
  return {
    async save(id, state) {
      checkId(id);
      const raw = items.get(id);
      checkRevision(raw ? validate(parseJson(raw)) : null, state);
      items.set(id, JSON.stringify(state));
    },
    async load(id) {
      checkId(id);
      const raw = items.get(id);
      return raw ? validate(parseJson(raw)) : null;
    },
    async delete(id) {
      items.delete(id);
    },
    async list() {
      return [...items]
        .map(([id, raw]) => metadata(id, validate(parseJson(raw))))
        .sort((a, b) => b.updatedAt - a.updatedAt);
    },
  };
}

/** Minimal Web Storage surface (`localStorage`, `sessionStorage`, or a test double). */
export interface WebStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface WebStorageOptions<T> extends AdapterOptions<T> {
  /** Resolved lazily, on first use, so importing this module never touches browser storage. */
  readonly storage?: () => WebStorageLike;
  readonly prefix?: string;
}

function isQuotaError(error: unknown): boolean {
  const e = error as { name?: string; code?: number } | null;
  return (
    !!e &&
    (e.name === 'QuotaExceededError' ||
      e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      e.code === 22 ||
      e.code === 1014)
  );
}

/**
 * Web Storage adapter. Keeps a small index of metadata under `<prefix>__index` so `list()` does not parse
 * every saved state. Quota errors surface as `StorageQuotaError`.
 */
export function createWebStorage<T extends Versioned = SerializedChartState>(
  options: WebStorageOptions<T> = {},
): StorageAdapter<T> {
  const validate = defaultValidate(options);
  const prefix = options.prefix ?? 'market-chart:';
  const resolve =
    options.storage ??
    (() => {
      const s = (globalThis as { localStorage?: WebStorageLike }).localStorage;
      if (!s) throw new PersistenceError('localStorage is not available in this environment');
      return s;
    });
  const indexKey = `${prefix}__index`;
  // The index lives in storage other scripts (or a user) can edit: keep only valid entries under their own id.
  const readIndex = (s: WebStorageLike): Record<string, ChartLayoutMetadata> => {
    const raw = s.getItem(indexKey);
    if (!raw) return {};
    try {
      const parsed = parseJson(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const out: Record<string, ChartLayoutMetadata> = Object.create(null) as Record<
        string,
        ChartLayoutMetadata
      >;
      for (const [key, value] of Object.entries(parsed)) {
        const m = validateLayoutMetadata(value);
        if (m && m.id === key) out[key] = m;
      }
      return out;
    } catch {
      return {};
    }
  };
  const write = (s: WebStorageLike, key: string, value: string): void => {
    try {
      s.setItem(key, value);
    } catch (error) {
      throw isQuotaError(error)
        ? new StorageQuotaError(error)
        : new PersistenceError('storage write failed', error);
    }
  };
  return {
    async save(id, state) {
      checkId(id);
      const s = resolve();
      const raw = s.getItem(prefix + id);
      checkRevision(raw ? validate(parseJson(raw)) : null, state);
      write(s, prefix + id, JSON.stringify(state));
      const index = readIndex(s);
      index[id] = metadata(id, state);
      write(s, indexKey, JSON.stringify(index));
    },
    async load(id) {
      checkId(id);
      const raw = resolve().getItem(prefix + id);
      return raw ? validate(parseJson(raw)) : null;
    },
    async delete(id) {
      checkId(id);
      const s = resolve();
      s.removeItem(prefix + id);
      const { [id]: _removed, ...index } = readIndex(s);
      write(s, indexKey, JSON.stringify(index));
    },
    async list() {
      return Object.values(readIndex(resolve())).sort((a, b) => b.updatedAt - a.updatedAt);
    },
  };
}

/** `localStorage` adapter (resolved lazily). */
export function createLocalStorage<T extends Versioned = SerializedChartState>(
  options: Omit<WebStorageOptions<T>, 'storage'> = {},
): StorageAdapter<T> {
  return createWebStorage({
    ...options,
    storage: () => {
      const s = (globalThis as { localStorage?: WebStorageLike }).localStorage;
      if (!s) throw new PersistenceError('localStorage is not available in this environment');
      return s;
    },
  });
}

/** `sessionStorage` adapter (resolved lazily). */
export function createSessionStorage<T extends Versioned = SerializedChartState>(
  options: Omit<WebStorageOptions<T>, 'storage'> = {},
): StorageAdapter<T> {
  return createWebStorage({
    ...options,
    storage: () => {
      const s = (globalThis as { sessionStorage?: WebStorageLike }).sessionStorage;
      if (!s) throw new PersistenceError('sessionStorage is not available in this environment');
      return s;
    },
  });
}

export interface IndexedDbOptions<T> extends AdapterOptions<T> {
  readonly dbName?: string;
  readonly storeName?: string;
  /** Resolved lazily (default: `globalThis.indexedDB`). */
  readonly indexedDB?: () => IDBFactory;
}

function request<R>(req: IDBRequest<R>): Promise<R> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** IndexedDB adapter: larger quota than Web Storage and asynchronous. The database opens on first use. */
export function createIndexedDbStorage<T extends Versioned = SerializedChartState>(
  options: IndexedDbOptions<T> = {},
): StorageAdapter<T> {
  const validate = defaultValidate(options);
  const dbName = options.dbName ?? 'market-chart';
  const storeName = options.storeName ?? 'states';
  let db: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> => {
    if (db) return db;
    const factory = options.indexedDB?.() ?? (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    if (!factory)
      return Promise.reject(new PersistenceError('IndexedDB is not available in this environment'));
    db = new Promise((resolve, reject) => {
      const req = factory.open(dbName, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(storeName))
          req.result.createObjectStore(storeName);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        db = null;
        reject(new PersistenceError('could not open IndexedDB', req.error));
      };
    });
    return db;
  };
  const store = async (mode: IDBTransactionMode): Promise<IDBObjectStore> =>
    (await open()).transaction(storeName, mode).objectStore(storeName);
  return {
    async save(id, state) {
      checkId(id);
      const db = await open();
      // Read and write in one transaction so the revision check is atomic.
      const tx = db.transaction(storeName, 'readwrite');
      const s = tx.objectStore(storeName);
      const existing = (await request(s.get(id))) as unknown;
      try {
        checkRevision(existing ? validate(existing) : null, state);
      } catch (error) {
        tx.abort();
        throw error;
      }
      try {
        await request(s.put(JSON.parse(JSON.stringify(state)), id));
      } catch (error) {
        throw isQuotaError(error)
          ? new StorageQuotaError(error)
          : new PersistenceError('IndexedDB write failed', error);
      }
    },
    async load(id) {
      checkId(id);
      const raw = (await request((await store('readonly')).get(id))) as unknown;
      return raw ? validate(raw) : null;
    },
    async delete(id) {
      checkId(id);
      await request((await store('readwrite')).delete(id));
    },
    async list() {
      const s = await store('readonly');
      const [keys, values] = await Promise.all([request(s.getAllKeys()), request(s.getAll())]);
      const out: ChartLayoutMetadata[] = [];
      values.forEach((raw, i) => {
        try {
          out.push(metadata(String(keys[i]), validate(raw)));
        } catch {
          // Skip corrupted records instead of failing the whole listing.
        }
      });
      return out.sort((a, b) => b.updatedAt - a.updatedAt);
    },
  };
}

export interface RestStorageOptions<T> extends AdapterOptions<T> {
  /** e.g. `https://api.example.com/layouts` → GET/PUT/DELETE `<baseUrl>/<id>`, GET `<baseUrl>` lists. */
  readonly baseUrl: string;
  readonly fetch?: typeof fetch;
  readonly headers?: Record<string, string> | (() => Record<string, string>);
  /**
   * Cookie / HTTP-auth mode (default `'same-origin'`, sent explicitly). Use `'include'` only when a trusted
   * cross-origin layout service authenticates with cookies.
   */
  readonly credentials?: RequestCredentials;
  /** Abort a request after this many ms (default 15000). */
  readonly timeoutMs?: number;
  /** Largest accepted response body in bytes (default 20 MiB). */
  readonly maxResponseBytes?: number;
}

/**
 * REST adapter for a backend that stores states per id. Writes send `If-Match: <previous revision>`; a
 * `409`/`412` response becomes a `StorageConflictError` carrying the server's current state.
 */
export function createRestStorage<T extends Versioned = SerializedChartState>(
  options: RestStorageOptions<T>,
): StorageAdapter<T> {
  const validate = defaultValidate(options);
  const base = options.baseUrl.replace(/\/+$/, '');
  const doFetch = (): typeof fetch => {
    const f = options.fetch ?? (globalThis.fetch?.bind(globalThis) as typeof fetch | undefined);
    if (!f) throw new PersistenceError('fetch is not available; pass options.fetch');
    return f;
  };
  const headers = (): Record<string, string> => ({
    'Content-Type': 'application/json',
    ...(typeof options.headers === 'function' ? options.headers() : options.headers),
  });
  const url = (id: string): string => `${base}/${encodeURIComponent(id)}`;
  // Messages carry the URL without query string or credentials (tokens are often put there).
  const where = (target: string): string => redactUrl(target);
  const maxBytes = options.maxResponseBytes ?? 20 * 1024 * 1024;
  const request = async (target: string, init: RequestInit = {}): Promise<Response> => {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => controller?.abort(), options.timeoutMs ?? 15_000);
    try {
      return await doFetch()(target, {
        ...init,
        headers: { ...headers(), ...(init.headers as Record<string, string> | undefined) },
        credentials: options.credentials ?? 'same-origin',
        ...(controller ? { signal: controller.signal } : {}),
      });
    } catch (error) {
      throw new PersistenceError(`${init.method ?? 'GET'} ${where(target)} failed`, error);
    } finally {
      clearTimeout(timer);
    }
  };
  const body = async (res: Response, target: string): Promise<unknown> => {
    try {
      return parseJson(await readTextLimited(res, maxBytes), { maxBytes });
    } catch (error) {
      throw error instanceof ResponseTooLargeError
        ? new PersistenceError(
            `response of ${where(target)} is larger than ${maxBytes} bytes`,
            error,
          )
        : error;
    }
  };
  const load = async (id: string): Promise<T | null> => {
    checkId(id);
    const res = await request(url(id));
    if (res.status === 404) return null;
    if (!res.ok) throw new PersistenceError(`GET ${where(url(id))} failed with ${res.status}`);
    return validate(await body(res, url(id)));
  };
  return {
    async save(id, state) {
      checkId(id);
      const res = await request(url(id), {
        method: 'PUT',
        headers: { 'If-Match': String(state.revision - 1) },
        body: JSON.stringify(state),
      });
      if (res.status === 409 || res.status === 412)
        throw new StorageConflictError(await load(id).catch(() => null));
      if (!res.ok) throw new PersistenceError(`PUT ${where(url(id))} failed with ${res.status}`);
    },
    load,
    async delete(id) {
      checkId(id);
      const res = await request(url(id), { method: 'DELETE' });
      if (!res.ok && res.status !== 404)
        throw new PersistenceError(`DELETE ${where(url(id))} failed with ${res.status}`);
    },
    async list() {
      const res = await request(base);
      if (!res.ok) throw new PersistenceError(`GET ${where(base)} failed with ${res.status}`);
      const raw = await body(res, base);
      if (!Array.isArray(raw)) throw new PersistenceError('list response must be an array');
      return raw.flatMap((m) => {
        const item = validateLayoutMetadata(m);
        return item ? [item] : [];
      });
    },
  };
}
