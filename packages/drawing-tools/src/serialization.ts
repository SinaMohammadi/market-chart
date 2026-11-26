import type { DrawingToolRegistry } from './registry.js';
import { resolveStyle } from './style.js';
import type { Anchor, Drawing } from './types.js';
import { DrawingError } from './types.js';

export const DRAWINGS_SCHEMA_VERSION = 1;

/** Plain-JSON form of all drawings of a chart. */
export interface DrawingsSnapshot {
  readonly version: number;
  readonly drawings: readonly Drawing[];
}

const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

/**
 * Upgrades older snapshots to the current schema. Each step is a pure function from version N to N + 1.
 * Version 1 is the first released schema, so there are no steps yet; the table is the extension point.
 */
const MIGRATIONS: Record<
  number,
  (snapshot: { version: number; drawings: unknown[] }) => { version: number; drawings: unknown[] }
> = {};

export function migrateSnapshot(input: unknown): { version: number; drawings: unknown[] } {
  if (!input || typeof input !== 'object') throw new DrawingError('snapshot must be an object');
  const raw = input as { version?: unknown; drawings?: unknown };
  if (!Array.isArray(raw.drawings)) throw new DrawingError('snapshot.drawings must be an array');
  let version = typeof raw.version === 'number' ? raw.version : 1;
  if (!Number.isInteger(version) || version < 1)
    throw new DrawingError(`invalid snapshot version ${String(raw.version)}`);
  if (version > DRAWINGS_SCHEMA_VERSION) {
    throw new DrawingError(
      `snapshot version ${version} is newer than this library supports (${DRAWINGS_SCHEMA_VERSION})`,
    );
  }
  let snapshot = { version, drawings: raw.drawings as unknown[] };
  while (version < DRAWINGS_SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) throw new DrawingError(`no migration from snapshot version ${version}`);
    snapshot = step(snapshot);
    version = snapshot.version;
  }
  return snapshot;
}

function anchor(value: unknown, i: number): Anchor {
  const a = value as { time?: unknown; price?: unknown } | null;
  if (
    !a ||
    typeof a.time !== 'number' ||
    typeof a.price !== 'number' ||
    !Number.isFinite(a.time) ||
    !Number.isFinite(a.price)
  ) {
    throw new DrawingError(`points[${i}] must be { time, price } with finite numbers`);
  }
  return { time: a.time, price: a.price };
}

/** Validates an untrusted drawing record against the registry. Unknown fields are dropped. */
export function validateDrawing(input: unknown, registry: DrawingToolRegistry): Drawing {
  if (!input || typeof input !== 'object') throw new DrawingError('drawing must be an object');
  const d = input as Record<string, unknown>;
  if (typeof d['id'] !== 'string' || !ID_PATTERN.test(d['id']))
    throw new DrawingError('drawing.id is missing or invalid');
  if (typeof d['type'] !== 'string') throw new DrawingError('drawing.type is missing');
  const tool = registry.get(d['type']);
  if (typeof d['seriesId'] !== 'string' || d['seriesId'].length > 256)
    throw new DrawingError('drawing.seriesId is missing');
  if (!Array.isArray(d['points']) || d['points'].length !== tool.points) {
    throw new DrawingError(`${tool.type} needs exactly ${tool.points} point(s)`);
  }
  const text = d['text'] === undefined ? (tool.defaultText ?? '') : d['text'];
  if (typeof text !== 'string' || text.length > 5000)
    throw new DrawingError('drawing.text must be a string (max 5000 chars)');
  const zIndex = d['zIndex'] === undefined ? 0 : d['zIndex'];
  if (typeof zIndex !== 'number' || !Number.isFinite(zIndex))
    throw new DrawingError('drawing.zIndex must be a finite number');
  const groupId = d['groupId'] ?? null;
  if (groupId !== null && (typeof groupId !== 'string' || !ID_PATTERN.test(groupId)))
    throw new DrawingError('drawing.groupId is invalid');
  return {
    id: d['id'],
    type: tool.type,
    seriesId: d['seriesId'],
    points: d['points'].map(anchor),
    style: resolveStyle(tool, d['style']),
    text,
    locked: d['locked'] === true,
    visible: d['visible'] !== false,
    zIndex,
    groupId,
  };
}
