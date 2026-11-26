import type {
  ChartLayoutMetadata,
  SerializedChartState,
  Watchlist,
  WorkspaceState,
} from './types.js';
import { PersistenceError } from './types.js';

export const CHART_STATE_VERSION = 1;
export const WORKSPACE_VERSION = 1;

const MAX_DEPTH = 32;
const MAX_STRING = 200_000;
const MAX_ITEMS = 200_000;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
/** Default limit of `parseJson` (stored layouts are far smaller; Web Storage itself holds about 5 MB). */
export const MAX_JSON_BYTES = 20 * 1024 * 1024;
const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

/**
 * Deep-copies untrusted JSON-like data, keeping only plain data: finite numbers, strings, booleans, null,
 * arrays and plain objects. Functions, symbols, class instances, `__proto__`/`constructor`/`prototype` keys
 * and absurdly large or deep values are rejected. Imported configuration can therefore never carry code
 * or pollute prototypes.
 */
export function sanitizeJson(value: unknown, path = '$', depth = 0): unknown {
  if (depth > MAX_DEPTH) throw new PersistenceError(`${path} is nested too deeply`);
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new PersistenceError(`${path} must be a finite number`);
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > MAX_STRING) throw new PersistenceError(`${path} is too long`);
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ITEMS) throw new PersistenceError(`${path} has too many items`);
    return value.map((v, i) => sanitizeJson(v, `${path}[${i}]`, depth + 1));
  }
  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value) as unknown;
    if (proto !== Object.prototype && proto !== null)
      throw new PersistenceError(`${path} must be a plain object`);
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_KEYS.has(key)) continue;
      const v = (value as Record<string, unknown>)[key];
      if (v === undefined) continue;
      out[key] = sanitizeJson(v, `${path}.${key}`, depth + 1);
    }
    return out;
  }
  throw new PersistenceError(`${path} has unsupported type ${typeof value}`);
}

/**
 * JSON.parse that drops dangerous keys while parsing and refuses text longer than `maxBytes` (default 20 MiB,
 * counted in UTF-16 code units), so an imported or stored blob cannot exhaust memory.
 */
export function parseJson(text: string, options: { readonly maxBytes?: number } = {}): unknown {
  if (typeof text !== 'string') throw new PersistenceError('expected JSON text');
  const max = options.maxBytes ?? MAX_JSON_BYTES;
  if (text.length > max) throw new PersistenceError(`JSON is larger than ${max} bytes`);
  try {
    return JSON.parse(text, (key, value: unknown) => (FORBIDDEN_KEYS.has(key) ? undefined : value));
  } catch (error) {
    throw new PersistenceError('invalid JSON', error);
  }
}

type Migration = (state: Record<string, unknown>) => Record<string, unknown>;

/**
 * Version N → N + 1 steps. Version 0 is how early drafts were stored (no `version`, `revision` or `extensions`).
 * Add a step here whenever the schema changes, and bump the version constant.
 */
const CHART_MIGRATIONS: Record<number, Migration> = {
  0: (s) => ({
    ...s,
    version: 1,
    revision: typeof s['revision'] === 'number' ? s['revision'] : 0,
    extensions: s['extensions'] ?? {},
  }),
};
const WORKSPACE_MIGRATIONS: Record<number, Migration> = {};

function migrate(
  input: unknown,
  current: number,
  steps: Record<number, Migration>,
  what: string,
): Record<string, unknown> {
  const clean = sanitizeJson(input);
  if (!clean || typeof clean !== 'object' || Array.isArray(clean))
    throw new PersistenceError(`${what} must be an object`);
  let state = clean as Record<string, unknown>;
  let version = typeof state['version'] === 'number' ? state['version'] : 0;
  if (!Number.isInteger(version) || version < 0)
    throw new PersistenceError(`${what} has an invalid version`);
  if (version > current)
    throw new PersistenceError(
      `${what} version ${version} is newer than supported (${current}); update the library`,
    );
  while (version < current) {
    const step = steps[version];
    if (!step) throw new PersistenceError(`no migration for ${what} version ${version}`);
    state = step(state);
    version = state['version'] as number;
  }
  return state;
}

const str = (v: unknown, name: string, max = 256): string => {
  if (typeof v !== 'string' || v.length > max)
    throw new PersistenceError(`${name} must be a string of at most ${max} characters`);
  return v;
};
const optStr = (v: unknown, name: string, max = 256): string | undefined =>
  v === undefined ? undefined : str(v, name, max);
const int = (v: unknown, name: string): number => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0)
    throw new PersistenceError(`${name} must be a non-negative integer`);
  return v;
};
const obj = (v: unknown, name: string): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v))
    throw new PersistenceError(`${name} must be an object`);
  return v as Record<string, unknown>;
};

function chartState(s: Record<string, unknown>): SerializedChartState {
  const view = s['view'];
  let parsedView: SerializedChartState['view'] = null;
  if (view !== undefined && view !== null) {
    const v = obj(view, 'view');
    if (typeof v['from'] !== 'number' || typeof v['to'] !== 'number' || !(v['to'] >= v['from'])) {
      throw new PersistenceError('view must be { from, to } with from <= to');
    }
    parsedView = { from: v['from'], to: v['to'] };
  }
  const out: { -readonly [K in keyof SerializedChartState]: SerializedChartState[K] } = {
    version: CHART_STATE_VERSION,
    revision: int(s['revision'] ?? 0, 'revision'),
    savedAt: typeof s['savedAt'] === 'number' ? s['savedAt'] : 0,
    view: parsedView,
    extensions: s['extensions'] === undefined ? {} : obj(s['extensions'], 'extensions'),
  };
  const name = optStr(s['name'], 'name');
  const symbol = optStr(s['symbol'], 'symbol', 128);
  const interval = optStr(s['interval'], 'interval', 16);
  if (name !== undefined) out.name = name;
  if (symbol !== undefined) out.symbol = symbol;
  if (interval !== undefined) out.interval = interval;
  if (s['options'] !== undefined) out.options = obj(s['options'], 'options');
  return out;
}

/** Validates (and migrates) an untrusted chart state. */
export function validateChartState(input: unknown): SerializedChartState {
  return chartState(migrate(input, CHART_STATE_VERSION, CHART_MIGRATIONS, 'chart state'));
}

function watchlist(input: unknown, i: number): Watchlist {
  const w = obj(input, `watchlists[${i}]`);
  const symbols = w['symbols'];
  if (!Array.isArray(symbols) || symbols.length > 5000)
    throw new PersistenceError(`watchlists[${i}].symbols must be an array`);
  return {
    id: str(w['id'], `watchlists[${i}].id`, 128),
    name: str(w['name'], `watchlists[${i}].name`),
    symbols: symbols.map((s, k) => str(s, `watchlists[${i}].symbols[${k}]`, 128)),
  };
}

/** Validates (and migrates) an untrusted workspace, including every chart in it. */
export function validateWorkspace(input: unknown): WorkspaceState {
  const s = migrate(input, WORKSPACE_VERSION, WORKSPACE_MIGRATIONS, 'workspace');
  const charts = s['charts'] ?? [];
  if (!Array.isArray(charts) || charts.length > 64)
    throw new PersistenceError('charts must be an array of at most 64 chart states');
  const layout = s['layout'] ?? '1';
  if (typeof layout !== 'string') {
    const l = obj(layout, 'layout');
    const columns = l['columns'];
    const rows = l['rows'];
    // A stored grid of 1e9 × 1e9 cells would make the layout component try to render them all.
    if (
      typeof columns !== 'number' ||
      typeof rows !== 'number' ||
      !Number.isInteger(columns) ||
      !Number.isInteger(rows) ||
      columns < 1 ||
      rows < 1 ||
      columns > 8 ||
      rows > 8
    )
      throw new PersistenceError('layout grid needs integer columns and rows between 1 and 8');
  } else str(layout, 'layout', 16);
  const watchlists = s['watchlists'] ?? [];
  if (!Array.isArray(watchlists)) throw new PersistenceError('watchlists must be an array');
  const parsedCharts = charts.map((c) => validateChartState(c));
  const active = int(s['activeChart'] ?? 0, 'activeChart');
  return {
    version: WORKSPACE_VERSION,
    revision: int(s['revision'] ?? 0, 'revision'),
    savedAt: typeof s['savedAt'] === 'number' ? s['savedAt'] : 0,
    id: str(s['id'], 'id', 128),
    name: str(s['name'] ?? 'Workspace', 'name'),
    layout: layout as WorkspaceState['layout'],
    charts: parsedCharts,
    activeChart: Math.min(active, Math.max(0, parsedCharts.length - 1)),
    watchlists: watchlists.map(watchlist),
    preferences: s['preferences'] === undefined ? {} : obj(s['preferences'], 'preferences'),
  };
}

/**
 * One entry of a layout listing from untrusted storage (a Web Storage index, a REST response): a valid id, a
 * name of at most 256 characters, finite numbers. Returns null for anything else.
 */
export function validateLayoutMetadata(input: unknown): ChartLayoutMetadata | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const m = input as Record<string, unknown>;
  const id = m['id'];
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) return null;
  const name = typeof m['name'] === 'string' ? m['name'].slice(0, 256) : id;
  const updatedAt = Number(m['updatedAt']);
  const revision = Number(m['revision']);
  return {
    id,
    name,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
    revision: Number.isSafeInteger(revision) && revision >= 0 ? revision : 0,
  };
}
