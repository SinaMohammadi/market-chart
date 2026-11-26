import { EventEmitter, createPriceFormatter } from '@market-chart/core';
import type {
  ChartApi,
  ChartInputHandler,
  ChartKeyEvent,
  ChartPluginContext,
  ChartPointerEvent,
  PaneLayerDrawContext,
  PriceFormatterFn,
  SeriesApi,
  TimeScaleApi,
  Unsubscribe,
} from '@market-chart/core';
import type { DrawingChange } from './history.js';
import { DrawingHistory } from './history.js';
import type { DrawingToolRegistry } from './registry.js';
import { createDefaultToolRegistry } from './registry.js';
import type { DrawingsSnapshot } from './serialization.js';
import { DRAWINGS_SCHEMA_VERSION, migrateSnapshot, validateDrawing } from './serialization.js';
import { baseStyle, resolveStyle, sanitizeStyle } from './style.js';
import { project } from './tools/common.js';
import type {
  Anchor,
  Drawing,
  DrawingDataAccess,
  DrawingStyle,
  DrawingToolDefinition,
  DrawingView,
  Point,
} from './types.js';
import { DrawingError } from './types.js';

export type MagnetMode = 'off' | 'weak' | 'strong';

export interface DrawingManagerOptions {
  registry?: DrawingToolRegistry;
  magnet?: MagnetMode;
  /** Keep the tool active after a drawing is finished (default: return to the cursor). */
  keepToolActive?: boolean;
}

/** Input for `add()`. `seriesId` defaults to the first series of pane 0. */
export interface DrawingInput {
  readonly type: string;
  readonly points: readonly Anchor[];
  readonly seriesId?: string;
  readonly style?: Partial<DrawingStyle>;
  readonly text?: string;
  readonly locked?: boolean;
  readonly visible?: boolean;
  readonly zIndex?: number;
  readonly groupId?: string | null;
  readonly id?: string;
}

export type DrawingPatch = Partial<
  Pick<Drawing, 'points' | 'text' | 'locked' | 'visible' | 'zIndex' | 'groupId' | 'seriesId'>
> & {
  readonly style?: Partial<DrawingStyle>;
};

export interface DrawingManagerEvents {
  change: { readonly drawings: readonly Drawing[] };
  selectionChange: { readonly ids: readonly string[] };
  toolChange: { readonly tool: string | null };
  historyChange: { readonly canUndo: boolean; readonly canRedo: boolean };
  /** A text tool was created or double-clicked: show an editor and call `setText`. */
  textEdit: { readonly id: string };
  magnetChange: { readonly mode: MagnetMode };
  error: { readonly error: unknown };
}

interface Draft {
  readonly tool: DrawingToolDefinition;
  readonly series: SeriesApi;
  readonly pane: number;
  points: Anchor[];
  placing: number;
  pressX: number;
  pressY: number;
  initialPress: boolean;
}

interface Gesture {
  readonly kind: 'move' | 'handle';
  readonly ids: readonly string[];
  readonly handle: number;
  readonly series: SeriesApi;
  readonly pane: number;
  readonly startLogical: number;
  readonly startPrice: number;
  readonly before: ReadonlyMap<string, Drawing>;
  moved: boolean;
}

const HANDLE_RADIUS = 5;
const PASTE_OFFSET_BARS = 5;

let managerCounter = 0;

/** Default cap on drawings accepted by one `load()` (untrusted snapshots). */
export const MAX_LOADED_DRAWINGS = 5000;

/**
 * Interactive drawings on a chart: creation by click-click or drag, selection, moving, handle editing,
 * magnet snapping, copy/paste, z-order, locking, grouping, undo/redo and validated persistence.
 *
 * Built on the public chart API: input arrives through a plugin input handler, rendering through pane
 * layers (`above` for resting drawings, `top` for the one being drawn or dragged, so dragging only
 * repaints the overlay surface).
 */
export class DrawingManager {
  readonly chart: ChartApi;
  readonly registry: DrawingToolRegistry;
  private readonly drawings = new Map<string, Drawing>();
  private _selection: string[] = [];
  private _tool: string | null = null;
  private _magnet: MagnetMode;
  private readonly keepToolActive: boolean;
  private draft: Draft | null = null;
  private gesture: Gesture | null = null;
  private hovered: string | null = null;
  private readonly history = new DrawingHistory();
  private clipboard: Drawing[] = [];
  private ctx: ChartPluginContext | null = null;
  private readonly layerPanes = new Set<number>();
  private readonly emitter = new EventEmitter<DrawingManagerEvents>();
  private readonly dataVersions = new Map<string, number>();
  /**
   * Data-derived values per drawing. `probes` are (time, logical index) pairs of the first and last data
   * points the computation read: derived values are in logical coordinates, which shift when any series
   * inserts or removes timestamps before or inside the range, so a cached value is only reused while
   * those points are still at the same logical positions.
   */
  private readonly derivedCache = new Map<
    string,
    { drawing: Drawing; version: number; value: unknown; probes: readonly number[] }
  >();
  private readonly formatters = new WeakMap<object, PriceFormatterFn>();
  private idCounter = 0;
  private readonly pluginId: string;
  private destroyed = false;

  constructor(chart: ChartApi, options: DrawingManagerOptions = {}) {
    this.chart = chart;
    this.registry = options.registry ?? createDefaultToolRegistry();
    this._magnet = options.magnet ?? 'off';
    this.keepToolActive = options.keepToolActive ?? false;
    this.pluginId = `market-chart/drawings/${++managerCounter}`;
    chart.use({
      id: this.pluginId,
      version: '1.0.0',
      // An arrow function keeps `this` bound to the manager.
      install: (ctx) => {
        this.ctx = ctx;
        ctx.addInputHandler(this.inputHandler);
        this.ensureLayers();
        ctx.on('seriesAdded', () => this.ensureLayers());
        ctx.on('seriesRemoved', ({ seriesId }) => this.onSeriesRemoved(seriesId));
        ctx.on('dataChanged', ({ series }) => {
          this.dataVersions.set(series.id, (this.dataVersions.get(series.id) ?? 0) + 1);
        });
        ctx.on('destroy', () => this.destroy());
      },
    });
  }

  // ───────────────────────────── public API ─────────────────────────────

  on<K extends keyof DrawingManagerEvents>(
    event: K,
    listener: (payload: DrawingManagerEvents[K]) => void,
  ): Unsubscribe {
    return this.emitter.on(event, listener);
  }

  tools(): DrawingToolDefinition[] {
    return this.registry.list();
  }

  activeTool(): string | null {
    return this._tool;
  }

  /** Selects a tool for the next drawing, or `null` for the cursor (select / move). */
  setActiveTool(type: string | null): void {
    this.assertAlive();
    if (type !== null) this.registry.get(type);
    this.draft = null;
    if (this._tool === type) return;
    this._tool = type;
    this.emitter.emit('toolChange', { tool: type });
    this.redraw('overlay');
  }

  magnet(): MagnetMode {
    return this._magnet;
  }

  setMagnet(mode: MagnetMode): void {
    if (!['off', 'weak', 'strong'].includes(mode))
      throw new DrawingError('magnet must be off, weak or strong');
    this._magnet = mode;
    this.emitter.emit('magnetChange', { mode });
  }

  list(): Drawing[] {
    return this.sorted();
  }

  get(id: string): Drawing | undefined {
    return this.drawings.get(id);
  }

  /**
   * Top-most visible drawing at a pane point (and the handle index when the point is on a handle of a selected
   * drawing). Accepts any pointer-like event, e.g. the core `contextMenu` event.
   */
  drawingAt(point: {
    readonly pane: number | null;
    readonly paneX: number;
    readonly paneY: number;
    readonly pointerType?: string;
  }): { readonly drawing: Drawing; readonly handle: number | null } | null {
    return this.hitTest({
      x: point.paneX,
      y: point.paneY,
      region: 'pane',
      pane: point.pane,
      paneX: point.paneX,
      paneY: point.paneY,
      pointerType: point.pointerType ?? 'mouse',
      button: 0,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
    });
  }

  add(input: DrawingInput): Drawing {
    this.assertAlive();
    const drawing = this.build(input);
    this.apply([{ id: drawing.id, before: null, after: drawing }], true);
    return drawing;
  }

  update(id: string, patch: DrawingPatch): Drawing {
    this.assertAlive();
    const current = this.drawings.get(id);
    if (!current) throw new DrawingError(`drawing "${id}" not found`);
    const next = this.patched(current, patch);
    this.apply([{ id, before: current, after: next }], true);
    return next;
  }

  setText(id: string, text: string): void {
    this.update(id, { text });
  }

  remove(ids: string | readonly string[]): void {
    const list = typeof ids === 'string' ? [ids] : ids;
    const changes = list.flatMap((id) => {
      const d = this.drawings.get(id);
      return d ? [{ id, before: d, after: null }] : [];
    });
    this.apply(changes, true);
  }

  clear(): void {
    this.remove([...this.drawings.keys()]);
  }

  selection(): readonly string[] {
    return this._selection;
  }

  select(ids: readonly string[]): void {
    const next = [...new Set(ids.filter((id) => this.drawings.has(id)))];
    if (next.length === this._selection.length && next.every((id, i) => id === this._selection[i]))
      return;
    this._selection = next;
    this.emitter.emit('selectionChange', { ids: next });
    this.redraw();
  }

  deleteSelected(): void {
    const ids = this._selection.filter((id) => !this.drawings.get(id)?.locked);
    this.remove(ids);
  }

  copy(ids: readonly string[] = this._selection): void {
    this.clipboard = ids.flatMap((id) => {
      const d = this.drawings.get(id);
      return d ? [d] : [];
    });
  }

  /** Pastes copied drawings a few bars to the right and selects them. Returns the new drawings. */
  /** True when `copy()` has put something on the drawing clipboard. */
  canPaste(): boolean {
    return this.clipboard.length > 0;
  }

  paste(): Drawing[] {
    this.assertAlive();
    if (!this.clipboard.length) return [];
    const ts = this.chart.timeScale();
    const groups = new Map<string, string>();
    let z = this.maxZ();
    const created = this.clipboard.map((d) => {
      const groupId = d.groupId
        ? (groups.get(d.groupId) ?? groups.set(d.groupId, this.nextId('group')).get(d.groupId)!)
        : null;
      return {
        ...d,
        id: this.nextId(d.type),
        groupId,
        zIndex: ++z,
        points: d.points.map((p) => this.shiftAnchor(ts, p, PASTE_OFFSET_BARS, 0)),
      };
    });
    this.apply(
      created.map((d) => ({ id: d.id, before: null, after: d })),
      true,
    );
    this.clipboard = created;
    this.select(created.map((d) => d.id));
    return created;
  }

  bringToFront(ids: readonly string[] = this._selection): void {
    let z = this.maxZ();
    this.apply(
      this.restack(ids, () => ++z),
      true,
    );
  }

  sendToBack(ids: readonly string[] = this._selection): void {
    let z = Math.min(0, ...[...this.drawings.values()].map((d) => d.zIndex));
    this.apply(
      this.restack([...ids].reverse(), () => --z),
      true,
    );
  }

  /** Groups drawings so they are selected and moved together. Returns the group id. */
  group(ids: readonly string[] = this._selection): string {
    if (ids.length < 2) throw new DrawingError('a group needs at least two drawings');
    const groupId = this.nextId('group');
    this.apply(this.patchMany(ids, { groupId }), true);
    return groupId;
  }

  ungroup(ids: readonly string[] = this._selection): void {
    this.apply(this.patchMany(ids, { groupId: null }), true);
  }

  setLocked(locked: boolean, ids: readonly string[] = this._selection): void {
    this.apply(this.patchMany(ids, { locked }), true);
  }

  setVisible(visible: boolean, ids: readonly string[] = this._selection): void {
    this.apply(this.patchMany(ids, { visible }), true);
  }

  canUndo(): boolean {
    return this.history.canUndo;
  }

  canRedo(): boolean {
    return this.history.canRedo;
  }

  undo(): void {
    const changes = this.history.undo();
    if (changes) this.apply(changes, false);
  }

  redo(): void {
    const changes = this.history.redo();
    if (changes) this.apply(changes, false);
  }

  serialize(): DrawingsSnapshot {
    return {
      version: DRAWINGS_SCHEMA_VERSION,
      drawings: JSON.parse(JSON.stringify(this.sorted())) as Drawing[],
    };
  }

  /**
   * Loads drawings from an (untrusted) snapshot. Each drawing is validated; invalid ones are skipped and
   * reported in `errors`. `resolveSeriesId` maps stored series ids to the current chart's series.
   * With `replace` (default) existing drawings are removed first. The load is one undo step.
   * At most `maxDrawings` (default 5000) are loaded; drawings beyond that are reported in `errors`, so a
   * hostile or corrupted snapshot cannot freeze the page with hundreds of thousands of shapes.
   */
  load(
    snapshot: unknown,
    options: {
      resolveSeriesId?: (storedId: string) => string | undefined;
      replace?: boolean;
      maxDrawings?: number;
    } = {},
  ): { loaded: number; errors: string[] } {
    this.assertAlive();
    const migrated = migrateSnapshot(snapshot);
    const errors: string[] = [];
    const max = options.maxDrawings ?? MAX_LOADED_DRAWINGS;
    if (migrated.drawings.length > max) {
      errors.push(
        `snapshot has ${migrated.drawings.length} drawings; only the first ${max} were loaded`,
      );
      migrated.drawings = migrated.drawings.slice(0, max);
    }
    const changes: DrawingChange[] =
      options.replace === false
        ? []
        : [...this.drawings.values()].map((d) => ({ id: d.id, before: d, after: null }));
    const taken = new Set(options.replace === false ? this.drawings.keys() : []);
    let loaded = 0;
    migrated.drawings.forEach((raw, i) => {
      try {
        let drawing = validateDrawing(raw, this.registry);
        const seriesId = options.resolveSeriesId
          ? options.resolveSeriesId(drawing.seriesId)
          : drawing.seriesId;
        if (!seriesId || !this.seriesById(seriesId))
          throw new DrawingError(`series "${drawing.seriesId}" is not on this chart`);
        if (taken.has(drawing.id)) drawing = { ...drawing, id: this.nextId(drawing.type) };
        taken.add(drawing.id);
        drawing = { ...drawing, seriesId };
        const existing = changes.find((c) => c.id === drawing.id);
        if (existing)
          changes.splice(changes.indexOf(existing), 1, {
            id: drawing.id,
            before: existing.before,
            after: drawing,
          });
        else
          changes.push({
            id: drawing.id,
            before: this.drawings.get(drawing.id) ?? null,
            after: drawing,
          });
        loaded++;
      } catch (error) {
        errors.push(`drawings[${i}]: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    this.apply(changes, true);
    return { loaded, errors };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (!this.chart.destroyed && this.chart.hasPlugin(this.pluginId))
      this.chart.removePlugin(this.pluginId);
    this.emitter.clear();
    this.drawings.clear();
    managers.delete(this.chart);
  }

  // ───────────────────────────── model helpers ─────────────────────────────

  private assertAlive(): void {
    if (this.destroyed) throw new DrawingError('drawing manager has been destroyed');
  }

  private nextId(prefix: string): string {
    let id: string;
    do id = `${prefix}-${++this.idCounter}`;
    while (this.drawings.has(id));
    return id;
  }

  private maxZ(): number {
    // A loop, not `Math.max(...spread)`: spreading a very large collection overflows the call stack.
    let max = 0;
    for (const d of this.drawings.values()) if (d.zIndex > max) max = d.zIndex;
    return max;
  }

  private sorted(): Drawing[] {
    return [...this.drawings.values()].sort((a, b) => a.zIndex - b.zIndex);
  }

  private seriesById(id: string): SeriesApi | undefined {
    return this.chart.series().find((s) => s.id === id);
  }

  private defaultSeries(pane = 0): SeriesApi | undefined {
    return this.chart.series().find((s) => s.options().pane === pane);
  }

  private themedBase(): DrawingStyle {
    return { ...baseStyle, textColor: this.chart.theme().textColor };
  }

  private validatePoints(tool: DrawingToolDefinition, points: readonly Anchor[]): Anchor[] {
    if (!Array.isArray(points) || points.length !== tool.points)
      throw new DrawingError(`${tool.type} needs exactly ${tool.points} point(s)`);
    return points.map((p, i) => {
      if (!p || !Number.isFinite(p.time) || !Number.isFinite(p.price))
        throw new DrawingError(`points[${i}] must have finite time and price`);
      return { time: p.time, price: p.price };
    });
  }

  private build(input: DrawingInput): Drawing {
    if (!input || typeof input !== 'object')
      throw new DrawingError('drawing input must be an object');
    const tool = this.registry.get(input.type);
    const series =
      input.seriesId !== undefined ? this.seriesById(input.seriesId) : this.defaultSeries();
    if (!series)
      throw new DrawingError(
        input.seriesId
          ? `series "${input.seriesId}" is not on this chart`
          : 'the chart has no series to attach drawings to',
      );
    if (input.id !== undefined && (typeof input.id !== 'string' || this.drawings.has(input.id)))
      throw new DrawingError(`id "${String(input.id)}" is invalid or taken`);
    const text = input.text ?? tool.defaultText ?? '';
    if (typeof text !== 'string') throw new DrawingError('text must be a string');
    return {
      id: input.id ?? this.nextId(tool.type),
      type: tool.type,
      seriesId: series.id,
      points: this.validatePoints(tool, input.points),
      style: resolveStyle(tool, input.style, this.themedBase()),
      text,
      locked: input.locked ?? false,
      visible: input.visible ?? true,
      zIndex: input.zIndex ?? this.maxZ() + 1,
      groupId: input.groupId ?? null,
    };
  }

  private patched(current: Drawing, patch: DrawingPatch): Drawing {
    if (!patch || typeof patch !== 'object') throw new DrawingError('patch must be an object');
    const tool = this.registry.get(current.type);
    const next: { -readonly [K in keyof Drawing]: Drawing[K] } = { ...current };
    if (patch.points !== undefined) next.points = this.validatePoints(tool, patch.points);
    if (patch.style !== undefined) next.style = { ...current.style, ...sanitizeStyle(patch.style) };
    if (patch.text !== undefined) {
      if (typeof patch.text !== 'string') throw new DrawingError('text must be a string');
      next.text = patch.text;
    }
    if (patch.locked !== undefined) next.locked = Boolean(patch.locked);
    if (patch.visible !== undefined) next.visible = Boolean(patch.visible);
    if (patch.zIndex !== undefined) {
      if (!Number.isFinite(patch.zIndex)) throw new DrawingError('zIndex must be finite');
      next.zIndex = patch.zIndex;
    }
    if (patch.groupId !== undefined) next.groupId = patch.groupId;
    if (patch.seriesId !== undefined) {
      if (!this.seriesById(patch.seriesId))
        throw new DrawingError(`series "${patch.seriesId}" is not on this chart`);
      next.seriesId = patch.seriesId;
    }
    return next;
  }

  private patchMany(ids: readonly string[], patch: DrawingPatch): DrawingChange[] {
    return ids.flatMap((id) => {
      const d = this.drawings.get(id);
      return d ? [{ id, before: d, after: this.patched(d, patch) }] : [];
    });
  }

  private restack(ids: readonly string[], nextZ: () => number): DrawingChange[] {
    return this.sorted()
      .filter((d) => ids.includes(d.id))
      .map((d) => ({ id: d.id, before: d, after: { ...d, zIndex: nextZ() } }));
  }

  /** Applies changes to the model, optionally recording them as one undo step. */
  private apply(changes: readonly DrawingChange[], record: boolean): void {
    if (!changes.length) return;
    for (const change of changes) {
      if (change.after) this.drawings.set(change.id, change.after);
      else this.drawings.delete(change.id);
      this.derivedCache.delete(change.id);
    }
    if (record) this.history.push(changes);
    const removedSelected = this._selection.filter((id) => !this.drawings.has(id));
    if (removedSelected.length) this.select(this._selection.filter((id) => this.drawings.has(id)));
    this.emitter.emit('change', { drawings: this.sorted() });
    this.emitter.emit('historyChange', {
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
    });
    this.redraw();
  }

  private onSeriesRemoved(seriesId: string): void {
    const orphaned = [...this.drawings.values()].filter((d) => d.seriesId === seriesId);
    if (!orphaned.length) return;
    // Their anchors can no longer be mapped; drop them and forget history that could restore them.
    this.apply(
      orphaned.map((d) => ({ id: d.id, before: d, after: null })),
      false,
    );
    this.history.clear();
    this.emitter.emit('historyChange', { canUndo: false, canRedo: false });
  }

  private shiftAnchor(ts: TimeScaleApi, anchor: Anchor, bars: number, price: number): Anchor {
    const logical = ts.timeToLogical(anchor.time);
    const time = logical === null ? anchor.time : (ts.logicalToTime(logical + bars) ?? anchor.time);
    return { time, price: anchor.price + price };
  }

  // ───────────────────────────── geometry & data access ─────────────────────────────

  private formatterFor(series: SeriesApi): PriceFormatterFn {
    const options = series.options();
    let formatter = this.formatters.get(options);
    if (!formatter) {
      formatter = createPriceFormatter(options.priceFormat);
      this.formatters.set(options, formatter);
    }
    return formatter;
  }

  private view(
    series: SeriesApi,
    width: number,
    height: number,
    ts: TimeScaleApi = this.chart.timeScale(),
  ): DrawingView {
    const nan = (v: number | null): number => (v === null ? Number.NaN : v);
    return {
      width,
      height,
      barSpacing: ts.barSpacing(),
      timeToX: (time) => {
        const logical = ts.timeToLogical(time);
        return logical === null ? Number.NaN : ts.logicalToCoordinate(logical);
      },
      xToTime: (x) => nan(ts.logicalToTime(ts.coordinateToLogical(x))),
      priceToY: (price) => nan(series.priceToCoordinate(price)),
      yToPrice: (y) => nan(series.coordinateToPrice(y)),
      timeToLogical: (time) => nan(ts.timeToLogical(time)),
      logicalToTime: (logical) => nan(ts.logicalToTime(logical)),
      logicalToX: (logical) => ts.logicalToCoordinate(logical),
      formatPrice: this.formatterFor(series),
    };
  }

  /**
   * Values of `series` between two times, read bar by bar along the chart's timeline (by time, so other
   * series' timestamps never shift them): O(m log n) for the m bars in range, without copying the series.
   * Pushes (time, logical) of the first and last point read onto `probes`.
   */
  private dataAccess(series: SeriesApi, probes: number[]): DrawingDataAccess {
    return {
      values: (from, to) => {
        const logical: number[] = [];
        const value: number[] = [];
        const ts = this.chart.timeScale();
        const last = series.lastPoint();
        const a = ts.timeToLogical(from);
        const b = last ? ts.timeToLogical(Math.min(to, last.time)) : null;
        if (a === null || b === null) return { logical, value };
        for (let i = Math.max(0, Math.ceil(a)); i <= Math.floor(b); i++) {
          const time = ts.logicalToTime(i);
          if (time === null || time < from) continue;
          const p = series.dataAt(time) as { close?: number; value?: number } | undefined;
          const v = p?.close ?? p?.value;
          if (typeof v !== 'number' || !Number.isFinite(v)) continue;
          logical.push(i);
          value.push(v);
        }
        if (logical.length) {
          probes.push(ts.logicalToTime(logical[0]!)!, logical[0]!);
          probes.push(
            ts.logicalToTime(logical[logical.length - 1]!)!,
            logical[logical.length - 1]!,
          );
        }
        return { logical, value };
      },
    };
  }

  private derived(drawing: Drawing, tool: DrawingToolDefinition, series: SeriesApi): unknown {
    if (!tool.compute) return undefined;
    const version = this.dataVersions.get(series.id) ?? 0;
    const cached = this.derivedCache.get(drawing.id);
    if (cached && cached.drawing === drawing && cached.version === version) {
      const ts = this.chart.timeScale();
      let valid = true;
      for (let k = 0; k < cached.probes.length && valid; k += 2)
        valid = ts.timeToLogical(cached.probes[k]!) === cached.probes[k + 1]!;
      if (valid) return cached.value;
    }
    const probes: number[] = [];
    const value = tool.compute(drawing, this.dataAccess(series, probes));
    this.derivedCache.set(drawing.id, { drawing, version, value, probes });
    return value;
  }

  // ───────────────────────────── rendering ─────────────────────────────

  private redraw(surface: 'all' | 'overlay' = 'all'): void {
    if (this.destroyed || !this.ctx) return;
    this.ensureLayers();
    this.ctx.requestRedraw(surface);
  }

  private ensureLayers(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const panes = this.chart.panes().length;
    for (let pane = 0; pane < panes; pane++) {
      if (this.layerPanes.has(pane)) continue;
      this.layerPanes.add(pane);
      ctx.addPaneLayer({ pane, zOrder: 'above', draw: (c) => this.drawLayer(c, pane, false) });
      ctx.addPaneLayer({ pane, zOrder: 'top', draw: (c) => this.drawLayer(c, pane, true) });
    }
  }

  private activeIds(): Set<string> {
    return new Set(this.gesture?.ids ?? []);
  }

  private drawLayer(c: PaneLayerDrawContext, pane: number, active: boolean): void {
    const ctx = c.ctx;
    const ts = this.chart.timeScale();
    const activeIds = this.activeIds();
    const views = new Map<string, DrawingView>();
    const viewFor = (series: SeriesApi): DrawingView => {
      let v = views.get(series.id);
      if (!v) views.set(series.id, (v = this.view(series, c.width, c.height, ts)));
      return v;
    };
    ctx.save();
    ctx.scale(c.pixelRatio, c.pixelRatio);
    for (const drawing of this.sorted()) {
      if (!drawing.visible || activeIds.has(drawing.id) !== active) continue;
      const series = this.seriesById(drawing.seriesId);
      if (!series || series.options().pane !== pane || !this.registry.has(drawing.type)) continue;
      this.paint(ctx, drawing, this.registry.get(drawing.type), viewFor(series), series);
    }
    const draft = this.draft;
    if (active && draft && draft.pane === pane) {
      const preview: Drawing = {
        id: '__draft__',
        type: draft.tool.type,
        seriesId: draft.series.id,
        points: draft.points,
        style: resolveStyle(draft.tool, undefined, this.themedBase()),
        text: draft.tool.defaultText ?? '',
        locked: false,
        visible: true,
        zIndex: Infinity,
        groupId: null,
      };
      this.paint(ctx, preview, draft.tool, viewFor(draft.series), draft.series, true);
    }
    ctx.restore();
  }

  private paint(
    ctx: CanvasRenderingContext2D,
    drawing: Drawing,
    tool: DrawingToolDefinition,
    view: DrawingView,
    series: SeriesApi,
    isDraft = false,
  ): void {
    const selected = this._selection.includes(drawing.id);
    ctx.save();
    try {
      const derived =
        isDraft && tool.compute
          ? tool.compute(drawing, this.dataAccess(series, []))
          : this.derived(drawing, tool, series);
      tool.draw(ctx, drawing, view, { selected, hovered: this.hovered === drawing.id }, derived);
    } catch (error) {
      this.emitter.emit('error', { error });
    } finally {
      ctx.restore();
    }
    if (selected || isDraft) {
      try {
        this.paintHandles(ctx, drawing, tool, view);
      } catch (error) {
        this.emitter.emit('error', { error });
      }
    }
  }

  private handlePoints(drawing: Drawing, tool: DrawingToolDefinition, view: DrawingView): Point[] {
    return tool.handles?.(drawing, view) ?? project(drawing, view);
  }

  private paintHandles(
    ctx: CanvasRenderingContext2D,
    drawing: Drawing,
    tool: DrawingToolDefinition,
    view: DrawingView,
  ): void {
    ctx.save();
    ctx.setLineDash([]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = drawing.style.lineColor;
    ctx.fillStyle = drawing.locked ? drawing.style.lineColor : this.chart.theme().background;
    for (const p of this.handlePoints(drawing, tool, view)) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, HANDLE_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  // ───────────────────────────── input ─────────────────────────────

  private paneSize(pane: number): { width: number; height: number; top: number } | null {
    const rect = this.ctx?.paneRect(pane);
    return rect ? { width: rect.width, height: rect.height, top: rect.y } : null;
  }

  private seriesInPane(pane: number): SeriesApi | undefined {
    return this.defaultSeries(pane);
  }

  /** Bar-snapped (and optionally magnet-snapped) anchor under the pointer, in `pane` coordinates. */
  private anchorAt(
    e: ChartPointerEvent,
    series: SeriesApi,
    pane: number,
    magnet = true,
  ): Anchor | null {
    const size = this.paneSize(pane);
    if (!size) return null;
    const ts = this.chart.timeScale();
    const y = e.y - size.top;
    const logical = Math.round(ts.coordinateToLogical(e.paneX));
    const time = ts.logicalToTime(logical);
    let price = series.coordinateToPrice(y);
    if (time === null || price === null) return null;
    if (magnet && this._magnet !== 'off') price = this.snapPrice(series, time, y, price);
    return { time, price };
  }

  private snapPrice(series: SeriesApi, time: number, y: number, price: number): number {
    const point = series.dataAt(time) as
      { open?: number; high?: number; low?: number; close?: number; value?: number } | undefined;
    if (!point) return price;
    const candidates = [point.open, point.high, point.low, point.close, point.value].filter(
      (v): v is number => typeof v === 'number',
    );
    let best = price;
    let bestDistance = Infinity;
    for (const v of candidates) {
      const cy = series.priceToCoordinate(v);
      if (cy === null) continue;
      const dist = Math.abs(cy - y);
      if (dist < bestDistance) {
        bestDistance = dist;
        best = v;
      }
    }
    return this._magnet === 'strong' || bestDistance <= 15 ? best : price;
  }

  /** Top-most drawing (or handle of a selected drawing) under the pointer. */
  private hitTest(e: ChartPointerEvent): { drawing: Drawing; handle: number | null } | null {
    if (e.pane === null || Number.isNaN(e.paneY)) return null;
    const size = this.paneSize(e.pane);
    if (!size) return null;
    const tolerance = e.pointerType === 'touch' ? 12 : 6;
    const ts = this.chart.timeScale();
    const p = { x: e.paneX, y: e.paneY };
    const candidates = this.sorted().reverse();
    const inPane = (d: Drawing): SeriesApi | null => {
      const series = this.seriesById(d.seriesId);
      return series && d.visible && series.options().pane === e.pane && this.registry.has(d.type)
        ? series
        : null;
    };
    for (const d of candidates) {
      if (!this._selection.includes(d.id)) continue;
      const series = inPane(d);
      if (!series) continue;
      const tool = this.registry.get(d.type);
      const handles = this.handlePoints(d, tool, this.view(series, size.width, size.height, ts));
      const index = handles.findIndex(
        (h) => Math.hypot(h.x - p.x, h.y - p.y) <= HANDLE_RADIUS + tolerance / 2,
      );
      if (index >= 0) return { drawing: d, handle: index };
    }
    for (const d of candidates) {
      const series = inPane(d);
      if (!series) continue;
      const tool = this.registry.get(d.type);
      const view = this.view(series, size.width, size.height, ts);
      try {
        if (tool.distance(d, view, p.x, p.y, this.derived(d, tool, series)) <= tolerance)
          return { drawing: d, handle: null };
      } catch (error) {
        this.emitter.emit('error', { error });
      }
    }
    return null;
  }

  private withGroup(drawing: Drawing): string[] {
    if (!drawing.groupId) return [drawing.id];
    return [...this.drawings.values()]
      .filter((d) => d.groupId === drawing.groupId)
      .map((d) => d.id);
  }

  private finishDraft(): void {
    const draft = this.draft;
    if (!draft) return;
    this.draft = null;
    const drawing = this.build({
      type: draft.tool.type,
      seriesId: draft.series.id,
      points: draft.points.slice(0, draft.tool.points),
    });
    this.apply([{ id: drawing.id, before: null, after: drawing }], true);
    this.select([drawing.id]);
    if (!this.keepToolActive) this.setActiveTool(null);
    if (draft.tool.editableText) this.emitter.emit('textEdit', { id: drawing.id });
  }

  private readonly inputHandler: ChartInputHandler = {
    pointerDown: (e) => this.onPointerDown(e),
    pointerMove: (e) => this.onPointerMove(e),
    pointerUp: (e) => this.onPointerUp(e),
    pointerCancel: () => this.onPointerCancel(),
    hover: (e) => this.onHover(e),
    doubleClick: (e) => this.onDoubleClick(e),
    keyDown: (e) => this.onKeyDown(e),
  };

  private onPointerDown(e: ChartPointerEvent): boolean {
    if (this.destroyed || (e.pointerType === 'mouse' && e.button !== 0)) return false;
    if (this._tool) {
      const draft = this.draft;
      if (draft) {
        const anchor = this.anchorAt(e, draft.series, draft.pane);
        if (anchor) draft.points[draft.placing] = anchor;
        draft.pressX = e.x;
        draft.pressY = e.y;
        draft.initialPress = false;
        this.redraw('overlay');
        return true;
      }
      if (e.region !== 'pane' || e.pane === null) return false;
      const series = this.seriesInPane(e.pane);
      const size = this.paneSize(e.pane);
      if (!series || !size) return false;
      const anchor = this.anchorAt(e, series, e.pane);
      if (!anchor) return false;
      const tool = this.registry.get(this._tool);
      const seeded = tool.seed?.(anchor, this.view(series, size.width, size.height)) ?? [anchor];
      this.draft = {
        tool,
        series,
        pane: e.pane,
        points:
          seeded.length >= tool.points
            ? seeded.slice(0, tool.points)
            : [...seeded, seeded[seeded.length - 1]!],
        placing: Math.min(seeded.length, tool.points),
        pressX: e.x,
        pressY: e.y,
        initialPress: true,
      };
      if (seeded.length >= tool.points) this.finishDraft();
      else this.redraw('overlay');
      return true;
    }
    if (e.region !== 'pane') return false;
    const hit = this.hitTest(e);
    if (!hit) {
      if (!e.shiftKey && this._selection.length) this.select([]);
      return false;
    }
    const ids = this.withGroup(hit.drawing);
    if (e.shiftKey) {
      const selected = this._selection.includes(hit.drawing.id);
      this.select(
        selected ? this._selection.filter((id) => !ids.includes(id)) : [...this._selection, ...ids],
      );
    } else if (!this._selection.includes(hit.drawing.id)) {
      this.select(ids);
    }
    const moving = hit.handle !== null ? [hit.drawing.id] : this._selection;
    if (moving.some((id) => this.drawings.get(id)?.locked)) return true;
    const series = this.seriesById(hit.drawing.seriesId)!;
    const size = this.paneSize(e.pane!)!;
    this.gesture = {
      kind: hit.handle !== null ? 'handle' : 'move',
      ids: moving,
      handle: hit.handle ?? -1,
      series,
      pane: e.pane!,
      startLogical: this.chart.timeScale().coordinateToLogical(e.paneX),
      startPrice: series.coordinateToPrice(e.y - size.top) ?? Number.NaN,
      before: new Map(moving.map((id) => [id, this.drawings.get(id)!])),
      moved: false,
    };
    return true;
  }

  private onPointerMove(e: ChartPointerEvent): void {
    const draft = this.draft;
    if (draft) {
      const anchor = this.anchorAt(e, draft.series, draft.pane);
      if (anchor) draft.points[draft.placing] = anchor;
      this.redraw('overlay');
      return;
    }
    const g = this.gesture;
    if (!g) return;
    const size = this.paneSize(g.pane);
    if (!size) return;
    const ts = this.chart.timeScale();
    if (!g.moved) {
      g.moved = true;
      this.redraw(); // move the dragged drawings to the top layer
    }
    if (g.kind === 'handle') {
      const id = g.ids[0]!;
      const before = g.before.get(id)!;
      const tool = this.registry.get(before.type);
      const anchor = this.anchorAt(e, g.series, g.pane);
      if (!anchor) return;
      const view = this.view(g.series, size.width, size.height, ts);
      const points =
        tool.moveHandle?.(before.points, g.handle, anchor, view) ??
        before.points.map((p, i) => (i === g.handle ? anchor : p));
      this.drawings.set(id, { ...this.drawings.get(id)!, points });
    } else {
      const bars = Math.round(ts.coordinateToLogical(e.paneX) - g.startLogical);
      const price = g.series.coordinateToPrice(e.y - size.top);
      const dp = price === null ? 0 : price - g.startPrice;
      for (const id of g.ids) {
        const before = g.before.get(id)!;
        const shift = before.seriesId === g.series.id ? dp : 0;
        this.drawings.set(id, {
          ...this.drawings.get(id)!,
          points: before.points.map((p) => this.shiftAnchor(ts, p, bars, shift)),
        });
      }
    }
    for (const id of g.ids) this.derivedCache.delete(id);
    this.redraw('overlay');
  }

  private onPointerUp(e: ChartPointerEvent): void {
    const draft = this.draft;
    if (draft) {
      const moved = Math.hypot(e.x - draft.pressX, e.y - draft.pressY) > 4;
      if (!draft.initialPress || moved) {
        const anchor = this.anchorAt(e, draft.series, draft.pane);
        if (anchor) draft.points[draft.placing] = anchor;
        draft.placing++;
        if (draft.placing >= draft.tool.points) {
          this.finishDraft();
          return;
        }
        draft.points.push({ ...draft.points[draft.placing - 1]! });
      }
      this.redraw('overlay');
      return;
    }
    const g = this.gesture;
    if (!g) return;
    this.gesture = null;
    if (g.moved) {
      const changes = g.ids.map((id) => ({
        id,
        before: g.before.get(id)!,
        after: this.drawings.get(id)!,
      }));
      this.history.push(changes);
      this.emitter.emit('change', { drawings: this.sorted() });
      this.emitter.emit('historyChange', {
        canUndo: this.history.canUndo,
        canRedo: this.history.canRedo,
      });
    }
    this.redraw();
  }

  private onPointerCancel(): void {
    const g = this.gesture;
    if (g) {
      for (const [id, d] of g.before) this.drawings.set(id, d);
      this.gesture = null;
    }
    this.draft = null;
    this.redraw();
  }

  private onHover(e: ChartPointerEvent): string | null {
    if (this.draft) {
      const anchor = this.anchorAt(e, this.draft.series, this.draft.pane);
      if (anchor) this.draft.points[this.draft.placing] = anchor;
      this.redraw('overlay');
      return 'crosshair';
    }
    if (this._tool) return e.region === 'pane' ? 'crosshair' : null;
    const hit = e.region === 'pane' ? this.hitTest(e) : null;
    const id = hit?.drawing.id ?? null;
    if (id !== this.hovered) {
      this.hovered = id;
      this.redraw();
    }
    if (!hit) return null;
    if (hit.handle !== null) return 'pointer';
    return hit.drawing.locked ? 'default' : 'move';
  }

  private onDoubleClick(e: ChartPointerEvent): boolean {
    if (this._tool || e.region !== 'pane') return false;
    const hit = this.hitTest(e);
    if (!hit) return false;
    if (this.registry.get(hit.drawing.type).editableText)
      this.emitter.emit('textEdit', { id: hit.drawing.id });
    return true;
  }

  private onKeyDown(k: ChartKeyEvent): boolean {
    const mod = k.ctrlKey || k.metaKey;
    const key = k.key.toLowerCase();
    if (key === 'escape') {
      if (this.draft || this._tool) {
        this.draft = null;
        this.setActiveTool(null);
        return true;
      }
      if (this._selection.length) {
        this.select([]);
        return true;
      }
      return false;
    }
    if ((key === 'delete' || key === 'backspace') && !mod) {
      if (!this._selection.length) return false;
      this.deleteSelected();
      return true;
    }
    if (!mod) return false;
    if (key === 'z' && !k.shiftKey) {
      this.undo();
      return true;
    }
    if ((key === 'z' && k.shiftKey) || key === 'y') {
      this.redo();
      return true;
    }
    if (key === 'c' && this._selection.length) {
      this.copy();
      return true;
    }
    if (key === 'v' && this.clipboard.length) {
      this.paste();
      return true;
    }
    return false;
  }
}

const managers = new WeakMap<ChartApi, DrawingManager>();

/** The chart's shared drawing manager (created on first use, destroyed with the chart). */
export function getDrawingManager(
  chart: ChartApi,
  options?: DrawingManagerOptions,
): DrawingManager {
  let manager = managers.get(chart);
  if (!manager) {
    manager = new DrawingManager(chart, options);
    managers.set(chart, manager);
  }
  return manager;
}
