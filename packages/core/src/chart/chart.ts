import { EventEmitter } from '../events/emitter.js';
import { Timeline } from '../model/timeline.js';
import type {
  LogicalRange,
  SeriesColumnsInput,
  SeriesData,
  SeriesType,
  Size,
  TimeRange,
  Unsubscribe,
} from '../model/types.js';
import type {
  ChartFormatters,
  ChartOptions,
  ChartOptionsInput,
  InteractionOptions,
} from '../options/chart-options.js';
import { defaultChartOptions } from '../options/chart-options.js';
import type { SeriesOptions, SeriesOptionsInput } from '../options/series-options.js';
import { validateChartOptions, validatePriceScaleOptions } from '../options/validate.js';
import type { ChartPlugin, PaneLayerCoordinates } from '../plugins/plugin.js';
import { PluginHost } from '../plugins/plugin-host.js';
import type { CustomSeriesView } from '../series/custom.js';
import { createCustomDefinition } from '../series/custom.js';
import type { Canvas2DSurface } from '../render/backend.js';
import { canvas2dBackend } from '../render/canvas2d-backend.js';
import { TextWidthCache, fontString } from '../render/draw-utils.js';
import { FrameScheduler, Invalidate } from '../render/scheduler.js';
import type { InvalidateMask } from '../render/scheduler.js';
import type { PriceScale, PriceScaleOptions } from '../scales/price-scale.js';
import type { TimeScaleOptions } from '../scales/time-scale.js';
import { TimeScale } from '../scales/time-scale.js';
import { TimeTickGenerator } from '../scales/time-ticks.js';
import { SeriesModel } from '../series/series-model.js';
import type { ChartTheme, ThemeInput } from '../theme/themes.js';
import { resolveTheme } from '../theme/themes.js';
import { TimeFormatter } from '../time/time-format.js';
import { ZonedClock } from '../time/zoned-clock.js';
import { ChartError, isFiniteNumber } from '../utils/errors.js';
import type { DeepPartial } from '../utils/merge.js';
import { deepMerge } from '../utils/merge.js';
import type {
  ChartApi,
  ChartEventMap,
  ChartEventName,
  ContextMenuEvent,
  ContextMenuSeriesHit,
  CrosshairMoveEvent,
  PaneApi,
  PriceScaleApi,
  SeriesApi,
  SeriesColumns,
  TimeScaleApi,
} from './api.js';
import type { HitResult, InteractionHost } from '../interaction/interaction-controller.js';
import { InteractionController } from '../interaction/interaction-controller.js';
import type { ChartLayout } from './layout.js';
import { computeLayout, resizePanes } from './layout.js';
import type { AxisSide } from './pane.js';
import { LEFT_SCALE_ID, Pane, RIGHT_SCALE_ID } from './pane.js';
import type { AxisFrame, CrosshairFrame, FrameState, PaneFrame, SeriesFrame } from './renderer.js';
import {
  axisLabelHeight,
  drawMain,
  drawOverlay,
  priceAxisWidthFor,
  timeAxisHeightFor,
} from './renderer.js';
import { contrastText } from '../render/color.js';
import type { AxisLabel } from '../render/label-layout.js';
import { layoutLabels } from '../render/label-layout.js';
import type { PriceFormatterFn } from '../format/price-format.js';
import type { Point } from '../model/types.js';
import type { PriceLineApi, PriceLineEntry, PriceLineOptions } from '../series/price-line.js';
import { defaultPriceLineOptions } from '../series/price-line.js';
import {
  coordinateFormatter,
  defaultPriceFormatter,
  priceFormatterFor,
  tickFormatter,
} from './scale-format.js';
import { logicalToTime, timeToLogical } from './time-conversion.js';
import { axisLocale, createDigitLocalizer } from '../format/localize.js';

const MAX_PANES = 32;
const DAY = 86_400_000;
const EMPTY_SERIES_DATA: ReadonlyMap<SeriesApi, SeriesData<SeriesType>> = new Map();

/** View state captured before a timeline change (see `ChartImpl.viewAnchor`). */
interface ViewAnchor {
  readonly prevLast: number;
  readonly prevLastTime: number | undefined;
  /** Index of the bar at the right edge when the latest bar is out of view, otherwise -1. */
  readonly edgeIndex: number;
  readonly edgeTime: number;
}

/** Where the crosshair should be: under the pointer, or at a time/price set through the API (sync). */
type CrosshairTarget =
  | { readonly kind: 'pointer'; readonly x: number; readonly y: number }
  | {
      readonly kind: 'api';
      readonly time: number;
      readonly price: number | null;
      readonly pane: number;
    };

let chartCounter = 0;

class SeriesApiImpl<T extends SeriesType> implements SeriesApi<T> {
  constructor(
    private readonly chart: ChartImpl,
    readonly model: SeriesModel<T>,
  ) {}

  get id(): string {
    return this.model.id;
  }

  get type(): T {
    return this.model.type;
  }

  setData(data: readonly SeriesData<T>[]): void {
    this.chart.setSeriesData(this.model, data);
  }

  setColumns(columns: SeriesColumnsInput): void {
    this.chart.setSeriesColumns(this.model, columns);
  }

  update(point: SeriesData<T>): void {
    this.chart.updateSeries(this.model, point);
  }

  data(): SeriesData<T>[] {
    const out: SeriesData<T>[] = [];
    for (let i = 0; i < this.model.store.length; i++) out.push(this.model.dataAt(i)!);
    return out;
  }

  columns(): SeriesColumns {
    const store = this.model.store;
    const n = store.length;
    const fields: Record<string, Float64Array> = {};
    store.fields.forEach((field, i) => {
      fields[field] = store.columnAt(i).slice(0, n);
    });
    return { length: n, times: store.times.slice(0, n), fields };
  }

  dataAt(time: number): SeriesData<T> | undefined {
    const index = this.model.store.indexOfTime(time);
    return index < 0 ? undefined : this.model.dataAt(index);
  }

  lastPoint(): SeriesData<T> | undefined {
    return this.model.dataAt(this.model.store.length - 1);
  }

  length(): number {
    return this.model.store.length;
  }

  applyOptions(options: SeriesOptionsInput<T>): void {
    this.chart.applySeriesOptions(this.model, options);
  }

  options(): Readonly<SeriesOptions<T>> {
    return this.model.options;
  }

  setPriceFormatter(formatter: PriceFormatterFn | null): void {
    this.chart.setSeriesFormatter(this.model, formatter);
  }

  createPriceLine(options: Partial<PriceLineOptions> & { price: number }): PriceLineApi {
    return this.chart.createPriceLine(this.model, options);
  }

  priceLines(): readonly PriceLineApi[] {
    return this.model.priceLines.map((entry) => entry.api);
  }

  priceScale(): PriceScaleApi {
    return this.chart.priceScale(this.model.options.priceScaleId, this.model.options.pane);
  }

  priceToCoordinate(price: number): number | null {
    const y = this.chart.scaleOf(this.model).priceToCoordinate(price);
    return Number.isFinite(y) ? y : null;
  }

  coordinateToPrice(y: number): number | null {
    const price = this.chart.scaleOf(this.model).coordinateToPrice(y);
    return Number.isFinite(price) ? price : null;
  }
}

/** Internal chart implementation. Users only see `ChartApi`. */
class ChartImpl implements ChartApi {
  readonly id: string;
  private _destroyed = false;
  private readonly container: HTMLElement;
  private readonly root: HTMLDivElement;
  private readonly mainSurface: Canvas2DSurface;
  private readonly overlaySurface: Canvas2DSurface;
  private _options: ChartOptions;
  private _theme: ChartTheme;
  private formatters: ChartFormatters = {};
  private readonly timeline = new Timeline();
  private readonly _timeScale: TimeScale;
  private readonly _panes: Pane[] = [];
  private readonly models: SeriesModel[] = [];
  private readonly apis = new Map<SeriesModel, SeriesApiImpl<SeriesType>>();
  private seriesCounter = 0;
  private readonly emitter: EventEmitter<ChartEventMap>;
  private readonly scheduler: FrameScheduler;
  private readonly interaction: InteractionController;
  private readonly plugins: PluginHost;
  private clock!: ZonedClock;
  private timeFormatter!: TimeFormatter;
  /** Rewrites ASCII digits into the locale's (`localization.localizeNumbers`), or null. */
  private digits: ((text: string) => string) | null = null;
  private readonly tickGenerator: TimeTickGenerator;
  private readonly textCache = new TextWidthCache();
  private _size: Size = { width: 0, height: 0 };
  private readonly axisWidths: Record<AxisSide, number> = { left: 0, right: 0 };
  /** Pane heights set by an in-progress separator drag, until the next layout. */
  private paneHeightsOverride: number[] | null = null;
  private frame: FrameState | null = null;
  private crosshairPos: CrosshairTarget | null = null;
  private crosshairFrame: CrosshairFrame | null = null;
  private crosshairDirty = false;
  private crosshairWasActive = false;
  private lastVisibleRange: LogicalRange | null = null;
  private readyEmitted = false;
  private sizingCleanup: (() => void) | null = null;
  private pixelRatioCleanup: (() => void) | null = null;

  constructor(
    container: HTMLElement,
    options: ChartOptionsInput | undefined,
    formatters: ChartFormatters | undefined,
  ) {
    if (!container || typeof container.appendChild !== 'function' || !container.ownerDocument) {
      throw new ChartError('createChart() expects a DOM element as its first argument');
    }
    this.id = `chart-${++chartCounter}`;
    this.container = container;
    this._options = validateChartOptions(deepMerge(defaultChartOptions, options));
    this._theme = resolveTheme(this._options.theme);
    this.formatters = { ...formatters };
    this.emitter = new EventEmitter<ChartEventMap>((error, event) =>
      this.reportError(error, `listener:${String(event)}`),
    );

    const doc = container.ownerDocument;
    this.root = doc.createElement('div');
    this.root.setAttribute('data-market-chart', this.id);
    this.root.dir = this._options.localization.direction;
    const style = this.root.style;
    style.position = 'relative';
    style.overflow = 'hidden';
    style.userSelect = 'none';
    style.setProperty('-webkit-user-select', 'none');
    container.appendChild(this.root);
    this.mainSurface = canvas2dBackend.createSurface(this.root, 'main');
    this.overlaySurface = canvas2dBackend.createSurface(this.root, 'overlay');

    this._timeScale = new TimeScale(this.timeline, this._options.timeScale, () =>
      this.onViewportChange(),
    );
    this._panes.push(new Pane(0, this._options.rightPriceScale, this._options.leftPriceScale));
    this.setupClock();
    this.tickGenerator = new TimeTickGenerator(this.clock, this.timeFormatter);
    this.scheduler = new FrameScheduler((mask) => this.renderFrame(mask));
    this.plugins = new PluginHost(
      this,
      (error, source) => this.reportError(error, source),
      (surface) => this.invalidate(surface === 'overlay' ? Invalidate.Overlay : Invalidate.All),
      (pane) => this.frame?.layout.panes[pane] ?? null,
    );
    this.interaction = new InteractionController(
      this.overlaySurface.element,
      this.createInteractionHost(),
    );
    this.applyAccessibility();
    this.setupSizing();
    this.watchPixelRatio();
    this.invalidate(Invalidate.All);
  }

  // ───────────────────────────── public API ─────────────────────────────

  get destroyed(): boolean {
    return this._destroyed;
  }

  addSeries<T extends SeriesType>(type: T, options?: SeriesOptionsInput<T>): SeriesApi<T> {
    this.assertAlive();
    const model = new SeriesModel(
      `${this.id}-series-${++this.seriesCounter}`,
      type,
      options ?? ({} as SeriesOptionsInput<T>),
      this._theme,
    );
    return this.attach(model);
  }

  addCustomSeries(
    view: CustomSeriesView,
    options?: SeriesOptionsInput<'custom'>,
  ): SeriesApi<'custom'> {
    this.assertAlive();
    if (
      !view ||
      typeof view.paint !== 'function' ||
      (view.kind !== 'ohlc' && view.kind !== 'value')
    ) {
      throw new ChartError(
        "addCustomSeries expects a view with kind 'ohlc' | 'value' and a paint() function",
      );
    }
    const model = new SeriesModel(
      `${this.id}-series-${++this.seriesCounter}`,
      'custom',
      options ?? {},
      this._theme,
      createCustomDefinition(view),
    );
    return this.attach(model);
  }

  private attach<T extends SeriesType>(model: SeriesModel<T>): SeriesApi<T> {
    const paneIndex = this.validatePaneIndex(model.options.pane);
    const pane = this.ensurePane(paneIndex);
    pane.series.push(model);
    pane.scale(model.options.priceScaleId);
    this.models.push(model);
    this.compactPanes();
    const api = new SeriesApiImpl(this, model);
    this.apis.set(model, api as unknown as SeriesApiImpl<SeriesType>);
    this.timeline.rebuild(this.stores());
    this.invalidate(Invalidate.All);
    this.emitter.emit('seriesAdded', { series: api });
    return api;
  }

  removeSeries(series: SeriesApi): void {
    this.assertAlive();
    const model = this.modelOf(series);
    const anchor = this.viewAnchor();
    const pane = this._panes[model.options.pane];
    if (pane) {
      pane.series.splice(pane.series.indexOf(model), 1);
      pane.pruneScales();
    }
    this.models.splice(this.models.indexOf(model), 1);
    this.apis.delete(model);
    this.timeline.remove(model.store);
    this.timeline.rebuild(this.stores());
    this.afterTimelineChange(anchor);
    this.compactPanes();
    this.markCrosshairDirty();
    this.invalidate(Invalidate.All);
    this.emitter.emit('seriesRemoved', { seriesId: model.id });
  }

  series(): readonly SeriesApi[] {
    return this.models.map((m) => this.apis.get(m)!);
  }

  applyOptions(input: ChartOptionsInput): void {
    this.assertAlive();
    const prev = this._options;
    const next = validateChartOptions(deepMerge(prev, input));
    this.commitOptions(prev, next);
  }

  options(): Readonly<ChartOptions> {
    return this._options;
  }

  setTheme(theme: ThemeInput): void {
    this.assertAlive();
    const prev = this._options;
    this.commitOptions(prev, validateChartOptions({ ...prev, theme }));
  }

  setLocale(locale: string): void {
    this.assertAlive();
    if (typeof locale !== 'string' || !locale)
      throw new ChartError('setLocale() expects a locale such as "fa-IR"');
    if (locale === this._options.localization.locale) return;
    this.applyOptions({ localization: { locale } });
  }

  getLocale(): string {
    return this._options.localization.locale;
  }

  setDirection(direction: 'ltr' | 'rtl'): void {
    this.assertAlive();
    if (direction === this._options.localization.direction) return;
    this.applyOptions({ localization: { direction } });
  }

  getDirection(): 'ltr' | 'rtl' {
    return this._options.localization.direction;
  }

  theme(): ChartTheme {
    return this._theme;
  }

  setFormatters(formatters: ChartFormatters): void {
    this.assertAlive();
    this.formatters = { ...formatters };
    this.markCrosshairDirty();
    this.invalidate(Invalidate.All);
  }

  timeScale(): TimeScaleApi {
    this.assertAlive();
    const ts = this._timeScale;
    const timeline = this.timeline;
    const hasData = (): boolean => timeline.length > 0;
    return {
      applyOptions: (patch: DeepPartial<TimeScaleOptions>) =>
        this.applyOptions({ timeScale: patch }),
      options: () => this._options.timeScale,
      fitContent: () => ts.fitContent(),
      scrollToRealtime: () => ts.scrollToRealtime(),
      reset: () => ts.reset(),
      scrollToTime: (time: number) => {
        const logical = timeToLogical(timeline, time);
        if (logical === null) return;
        const half = ts.width / ts.barSpacing / 2;
        ts.setVisibleLogicalRange({ from: logical - half, to: logical + half });
      },
      getVisibleLogicalRange: () => (hasData() && ts.width > 0 ? ts.visibleLogicalRange() : null),
      setVisibleLogicalRange: (range: LogicalRange) => ts.setVisibleLogicalRange(range),
      getVisibleRange: () => ts.visibleTimeRange(),
      setVisibleRange: (range: TimeRange) => ts.setVisibleRange(range),
      barSpacing: () => ts.barSpacing,
      rightOffset: () => ts.rightOffset,
      timeToCoordinate: (time: number) => {
        const logical = timeToLogical(timeline, time);
        return logical === null ? null : ts.indexToX(logical);
      },
      coordinateToLogical: (x: number) => ts.xToLogical(x),
      logicalToCoordinate: (logical: number) => ts.indexToX(logical),
      timeToLogical: (time: number) => timeToLogical(timeline, time),
      logicalToTime: (logical: number) => logicalToTime(timeline, logical),
      coordinateToTime: (x: number) =>
        hasData() ? logicalToTime(timeline, ts.xToLogical(x)) : null,
      width: () => ts.width,
    };
  }

  priceScale(id: string = RIGHT_SCALE_ID, paneIndex = 0): PriceScaleApi {
    this.assertAlive();
    if (typeof id !== 'string' || id.length === 0)
      throw new ChartError('priceScale id must be a non-empty string');
    const pane = this._panes[paneIndex];
    if (!pane)
      throw new ChartError(
        `pane ${paneIndex} does not exist (chart has ${this._panes.length} pane(s))`,
      );
    return {
      id,
      pane: paneIndex,
      applyOptions: (patch: DeepPartial<PriceScaleOptions>) => {
        this.assertAlive();
        const resolved = deepMerge(pane.scale(id).options, patch);
        validatePriceScaleOptions(resolved, `priceScale("${id}")`);
        pane.applyScaleOptions(id, patch);
        this.invalidate(Invalidate.All);
        this.emitter.emit('priceScaleChange', { pane: paneIndex, priceScaleId: id });
      },
      options: () => pane.scale(id).options,
      width: () => {
        const layout = this.frame?.layout;
        if (!layout) return 0;
        return id === RIGHT_SCALE_ID
          ? layout.rightAxisWidth
          : id === LEFT_SCALE_ID
            ? layout.leftAxisWidth
            : 0;
      },
    };
  }

  panes(): readonly PaneApi[] {
    this.assertAlive();
    return this._panes.map((pane) => ({
      index: pane.index,
      stretchFactor: () => pane.stretchFactor,
      setStretchFactor: (factor: number) => {
        if (!isFiniteNumber(factor) || factor <= 0)
          throw new ChartError('stretch factor must be a positive number');
        pane.stretchFactor = factor;
        this.invalidate(Invalidate.All);
      },
      height: () => pane.rect.height,
    }));
  }

  fitContent(): void {
    this.assertAlive();
    this._timeScale.fitContent();
  }

  resize(width: number, height: number): void {
    this.assertAlive();
    if (!isFiniteNumber(width) || !isFiniteNumber(height) || width < 0 || height < 0) {
      throw new ChartError(`resize() expects non-negative numbers, got ${width}×${height}`);
    }
    this.applyOptions({ autoSize: false, width, height });
  }

  size(): Size {
    return this._size;
  }

  on<K extends ChartEventName>(
    event: K,
    listener: (payload: ChartEventMap[K]) => void,
  ): Unsubscribe {
    if (this._destroyed) return () => undefined;
    return this.emitter.on(event, listener);
  }

  off<K extends ChartEventName>(event: K, listener: (payload: ChartEventMap[K]) => void): void {
    this.emitter.off(event, listener);
  }

  use(plugin: ChartPlugin): void {
    this.assertAlive();
    this.plugins.install(plugin);
    this.emitter.emit('pluginInstalled', { id: plugin.id });
  }

  removePlugin(id: string): void {
    this.assertAlive();
    if (this.plugins.remove(id)) this.emitter.emit('pluginRemoved', { id });
  }

  hasPlugin(id: string): boolean {
    return this.plugins.has(id);
  }

  setCrosshairPosition(time: number, price: number | null = null, pane = 0): void {
    this.assertAlive();
    if (!isFiniteNumber(time))
      throw new ChartError(
        `setCrosshairPosition: time must be a finite number, got ${String(time)}`,
      );
    if (price !== null && !isFiniteNumber(price))
      throw new ChartError('setCrosshairPosition: price must be a finite number or null');
    if (!Number.isInteger(pane) || pane < 0)
      throw new ChartError('setCrosshairPosition: pane must be a non-negative integer');
    this.crosshairPos = { kind: 'api', time, price, pane };
    this.markCrosshairDirty();
    this.invalidate(Invalidate.Overlay);
  }

  clearCrosshair(): void {
    if (this._destroyed || this.crosshairPos === null) return;
    this.crosshairPos = null;
    this.markCrosshairDirty();
    this.invalidate(Invalidate.Overlay);
  }

  render(): void {
    this.assertAlive();
    this.scheduler.invalidate(Invalidate.All);
    this.scheduler.flush();
  }

  takeScreenshot(): HTMLCanvasElement {
    this.render();
    const canvas = this.root.ownerDocument.createElement('canvas');
    canvas.width = this.mainSurface.bitmapWidth;
    canvas.height = this.mainSurface.bitmapHeight;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(this.mainSurface.element as HTMLCanvasElement, 0, 0);
      ctx.drawImage(this.overlaySurface.element as HTMLCanvasElement, 0, 0);
    }
    return canvas;
  }

  element(): HTMLElement {
    return this.root;
  }

  destroy(): void {
    if (this._destroyed) return;
    this.emitter.emit('destroy', { chart: this });
    this.plugins.destroyAll();
    this._destroyed = true;
    this.scheduler.destroy();
    this.interaction.destroy();
    this.sizingCleanup?.();
    this.pixelRatioCleanup?.();
    this.sizingCleanup = null;
    this.pixelRatioCleanup = null;
    this.emitter.clear();
    this.mainSurface.destroy();
    this.overlaySurface.destroy();
    this.root.remove();
    this.models.length = 0;
    this.apis.clear();
    this.frame = null;
  }

  // ───────────────────────────── series internals (used by SeriesApiImpl) ─────────────────────────────

  setSeriesData<T extends SeriesType>(model: SeriesModel<T>, data: readonly SeriesData<T>[]): void {
    this.replaceSeriesData(model, () => model.setData(data));
  }

  setSeriesColumns<T extends SeriesType>(model: SeriesModel<T>, columns: SeriesColumnsInput): void {
    this.replaceSeriesData(model, () => model.setColumns(columns));
  }

  private replaceSeriesData<T extends SeriesType>(
    model: SeriesModel<T>,
    replace: () => void,
  ): void {
    this.assertSeries(model);
    const anchor = this.viewAnchor();
    replace();
    this.timeline.rebuild(this.stores());
    this.afterTimelineChange(anchor);
    this.markCrosshairDirty();
    this.invalidate(Invalidate.Main | Invalidate.Overlay);
    this.emitter.emit('dataChanged', { series: this.apis.get(model)!, kind: 'set' });
  }

  updateSeries<T extends SeriesType>(model: SeriesModel<T>, point: SeriesData<T>): void {
    this.assertSeries(model);
    const prevLast = this.timeline.lastIndex;
    const prevVersion = this.timeline.version;
    // Cheap (no allocation beyond one small object); only consulted when the timeline changes.
    const anchor = this.viewAnchor();
    const result = model.update(point);
    if (result.kind === 'appended') {
      if (!this.timeline.appendFrom(model.store)) this.timeline.rebuild(this.stores());
    } else if (result.kind === 'inserted') {
      this.timeline.rebuild(this.stores());
    }
    // A rebuild (insertion, or an append whose time lies inside the timeline) may shift existing indices.
    if (this.timeline.lastIndex !== prevLast || this.timeline.version !== prevVersion)
      this.afterTimelineChange(anchor);
    this.markCrosshairDirty();
    this.invalidate(Invalidate.Main | Invalidate.Overlay);
    const time = model.store.times[result.index]!;
    this.emitter.emit('dataChanged', {
      series: this.apis.get(model)!,
      kind: 'update',
      update: { kind: result.kind, time },
    });
  }

  applySeriesOptions<T extends SeriesType>(
    model: SeriesModel<T>,
    patch: SeriesOptionsInput<T>,
  ): void {
    this.assertSeries(model);
    const prevPane = model.options.pane;
    model.applyOptions(patch, this._theme);
    const nextPane = this.validatePaneIndex(model.options.pane);
    if (nextPane !== prevPane) {
      const old = this._panes[prevPane]!;
      old.series.splice(old.series.indexOf(model), 1);
      old.pruneScales();
      this.ensurePane(nextPane).series.push(model);
    }
    const pane = this._panes[nextPane]!;
    pane.scale(model.options.priceScaleId);
    pane.pruneScales();
    this.compactPanes();
    this.markCrosshairDirty();
    this.invalidate(Invalidate.All);
  }

  setSeriesFormatter(model: SeriesModel, formatter: PriceFormatterFn | null): void {
    this.assertSeries(model);
    model.setCustomFormatter(formatter);
    this.markCrosshairDirty();
    this.invalidate(Invalidate.All);
  }

  createPriceLine(
    model: SeriesModel,
    input: Partial<PriceLineOptions> & { price: number },
  ): PriceLineApi {
    this.assertSeries(model);
    const validate = (o: PriceLineOptions): PriceLineOptions => {
      if (!isFiniteNumber(o.price))
        throw new ChartError(`price line price must be a finite number, got ${String(o.price)}`);
      if (!isFiniteNumber(o.lineWidth) || o.lineWidth <= 0)
        throw new ChartError('price line lineWidth must be positive');
      if (o.color !== null && typeof o.color !== 'string')
        throw new ChartError('price line color must be a string or null');
      if (!isFiniteNumber(o.axisLabelPriority))
        throw new ChartError('price line axisLabelPriority must be a finite number');
      return { ...o, title: String(o.title) };
    };
    let removed = false;
    const entry: PriceLineEntry = {
      options: validate({ ...defaultPriceLineOptions, ...input }),
      api: {
        applyOptions: (patch) => {
          if (removed) return;
          entry.options = validate({ ...entry.options, ...patch });
          this.invalidate(Invalidate.All);
        },
        options: () => entry.options,
        remove: () => {
          if (removed) return;
          removed = true;
          const index = model.priceLines.indexOf(entry);
          if (index >= 0) model.priceLines.splice(index, 1);
          if (!this._destroyed) this.invalidate(Invalidate.All);
        },
      },
    };
    model.priceLines.push(entry);
    this.invalidate(Invalidate.All);
    return entry.api;
  }

  scaleOf(model: SeriesModel): PriceScale {
    this.assertSeries(model);
    return this._panes[model.options.pane]!.scale(model.options.priceScaleId);
  }

  // ───────────────────────────── lifecycle internals ─────────────────────────────

  private assertAlive(): void {
    if (this._destroyed) throw new ChartError('this chart has been destroyed');
  }

  private assertSeries(model: SeriesModel): void {
    this.assertAlive();
    if (!this.apis.has(model))
      throw new ChartError(`series "${model.id}" has been removed from the chart`);
  }

  private modelOf(series: SeriesApi): SeriesModel {
    const model = series instanceof SeriesApiImpl ? (series.model as SeriesModel) : undefined;
    if (!model || !this.apis.has(model))
      throw new ChartError('series does not belong to this chart');
    return model;
  }

  private stores(): SeriesModel['store'][] {
    return this.models.map((m) => m.store);
  }

  private validatePaneIndex(index: number): number {
    if (!Number.isInteger(index) || index < 0 || index >= MAX_PANES) {
      throw new ChartError(
        `pane must be an integer between 0 and ${MAX_PANES - 1}, got ${String(index)}`,
      );
    }
    return index;
  }

  private ensurePane(index: number): Pane {
    while (this._panes.length <= index) {
      this._panes.push(
        new Pane(this._panes.length, this._options.rightPriceScale, this._options.leftPriceScale),
      );
    }
    return this._panes[index]!;
  }

  /**
   * Removes empty panes (pane 0 always stays) and renumbers the rest, updating each series' `pane`
   * option. Removing an indicator pane in the middle therefore collapses it instead of leaving a gap.
   */
  private compactPanes(): void {
    const kept = this._panes.filter((pane, i) => i === 0 || pane.series.length > 0);
    if (kept.length === this._panes.length) return;
    this._panes.length = 0;
    kept.forEach((pane, i) => {
      pane.index = i;
      for (const model of pane.series) {
        if (model.options.pane !== i) model.applyOptions({ pane: i } as never, this._theme);
      }
      this._panes.push(pane);
    });
  }

  /**
   * Captures, before a timeline change, what keeps the view in place afterwards: the time of the last
   * bar and — when the latest bar is scrolled out of view — the time of the bar at the right edge.
   * Times, not indices: indices of existing bars shift when timestamps are inserted before them.
   */
  private viewAnchor(): ViewAnchor {
    const timeline = this.timeline;
    const prevLast = timeline.lastIndex;
    const ts = this._timeScale;
    let edgeIndex = -1;
    // rightOffset < -0.5: the latest bar's centre is right of the pane's right edge.
    if (prevLast >= 0 && ts.width > 0 && ts.rightOffset < -0.5) {
      const edge = Math.floor(ts.visibleLogicalRange().to - 0.5);
      edgeIndex = Math.min(prevLast, Math.max(0, edge));
    }
    return {
      prevLast,
      prevLastTime: timeline.timeAt(prevLast),
      edgeIndex,
      edgeTime: edgeIndex >= 0 ? timeline.timeAt(edgeIndex)! : 0,
    };
  }

  private afterTimelineChange(anchor: ViewAnchor): void {
    const ts = this._timeScale;
    if (anchor.prevLast < 0 || anchor.prevLastTime === undefined || this.timeline.length === 0) {
      ts.handleTimelineChange(-1);
      return;
    }
    if (anchor.edgeIndex >= 0) {
      // Exact index when the edge bar still exists, otherwise its interpolated position.
      const exact = this.timeline.indexOf(anchor.edgeTime);
      const logical = exact >= 0 ? exact : timeToLogical(this.timeline, anchor.edgeTime);
      if (logical !== null && logical >= 0 && logical <= this.timeline.lastIndex) {
        ts.handleTimelineChange(-1, { barsFromEnd: anchor.prevLast - anchor.edgeIndex, logical });
        return;
      }
      // The viewed times are no longer covered (data replaced by another range): start over.
      ts.handleTimelineChange(-1);
      return;
    }
    const lastIndex = this.timeline.indexOf(anchor.prevLastTime);
    // The latest bar was in view. If its time is gone (the series that held it was shortened or replaced),
    // keep following the new latest bar with the current zoom rather than resetting the view.
    ts.handleTimelineChange(lastIndex >= 0 ? lastIndex : this.timeline.lastIndex);
  }

  private commitOptions(prev: ChartOptions, next: ChartOptions): void {
    this._options = next;
    if (next.theme !== prev.theme) {
      this._theme = resolveTheme(next.theme);
      for (const model of this.models) model.resolve(this._theme);
      this.emitter.emit('themeChanged', { theme: this._theme });
    }
    if (next.localization !== prev.localization) {
      this.setupClock();
      this.tickGenerator.setClock(this.clock, this.timeFormatter);
      this.root.dir = next.localization.direction;
    }
    if (next.timeScale !== prev.timeScale) this._timeScale.applyOptions(next.timeScale);
    if (next.ariaLabel !== prev.ariaLabel || next.interaction !== prev.interaction)
      this.applyAccessibility();
    if (
      next.rightPriceScale !== prev.rightPriceScale ||
      next.leftPriceScale !== prev.leftPriceScale
    ) {
      for (const pane of this._panes)
        pane.setChartScaleOptions(next.rightPriceScale, next.leftPriceScale);
    }
    if (next.autoSize !== prev.autoSize || next.width !== prev.width || next.height !== prev.height)
      this.setupSizing();
    this.markCrosshairDirty();
    this.invalidate(Invalidate.All);
    this.emitter.emit('optionsChanged', { options: next });
    if (next.localization.locale !== prev.localization.locale)
      this.emitter.emit('localeChange', { locale: next.localization.locale });
    if (next.localization.direction !== prev.localization.direction)
      this.emitter.emit('directionChange', { direction: next.localization.direction });
  }

  /** Wraps a label formatter with the locale's digits when `localization.localizeNumbers` is on. */
  private localized<A extends unknown[], R extends string | null>(
    format: (...args: A) => R,
  ): (...args: A) => R {
    const digits = this.digits;
    if (!digits) return format;
    return (...args) => {
      const text = format(...args);
      return (text === null ? text : digits(text)) as R;
    };
  }

  private setupClock(): void {
    const { timeZone, locale, localizeNumbers } = this._options.localization;
    try {
      this.clock = new ZonedClock(timeZone);
      this.digits = localizeNumbers ? createDigitLocalizer(locale) : null;
      this.timeFormatter = new TimeFormatter(
        this.clock,
        axisLocale(locale, localizeNumbers),
        this.digits,
      );
    } catch (error) {
      throw new ChartError(
        `invalid localization (timeZone "${timeZone}", locale "${locale}"): ${String(error)}`,
      );
    }
  }

  private setupSizing(): void {
    this.sizingCleanup?.();
    this.sizingCleanup = null;
    const style = this.root.style;
    if (!this._options.autoSize) {
      style.width = `${this._options.width}px`;
      style.height = `${this._options.height}px`;
      this.setSize(this._options.width, this._options.height);
      return;
    }
    style.width = '100%';
    style.height = '100%';
    const container = this.container;
    const view = container.ownerDocument.defaultView;
    const RO = (view as (Window & { ResizeObserver?: typeof ResizeObserver }) | null)
      ?.ResizeObserver;
    if (RO) {
      const observer = new RO((entries) => {
        const rect = entries[entries.length - 1]?.contentRect;
        if (rect) this.setSize(rect.width, rect.height);
      });
      observer.observe(container);
      this.sizingCleanup = () => observer.disconnect();
    } else if (view) {
      const onResize = (): void => this.setSize(container.clientWidth, container.clientHeight);
      view.addEventListener('resize', onResize);
      this.sizingCleanup = () => view.removeEventListener('resize', onResize);
    }
    this.setSize(container.clientWidth, container.clientHeight);
  }

  private setSize(width: number, height: number): void {
    const w = Math.max(0, Math.floor(width));
    const h = Math.max(0, Math.floor(height));
    if (w === this._size.width && h === this._size.height) return;
    this._size = { width: w, height: h };
    this.invalidate(Invalidate.All);
    this.emitter.emit('resize', this._size);
  }

  private pixelRatio(): number {
    const ratio = this.container.ownerDocument.defaultView?.devicePixelRatio;
    return ratio && ratio > 0 ? ratio : 1;
  }

  private watchPixelRatio(): void {
    this.pixelRatioCleanup?.();
    this.pixelRatioCleanup = null;
    const view = this.container.ownerDocument.defaultView;
    if (!view || typeof view.matchMedia !== 'function') return;
    const query = view.matchMedia(`(resolution: ${this.pixelRatio()}dppx)`);
    if (typeof query.addEventListener !== 'function') return;
    const onChange = (): void => {
      if (this._destroyed) return;
      this.invalidate(Invalidate.All);
      this.watchPixelRatio();
    };
    query.addEventListener('change', onChange);
    this.pixelRatioCleanup = () => query.removeEventListener('change', onChange);
  }

  private applyAccessibility(): void {
    const el = this.overlaySurface.element;
    el.setAttribute('role', 'img');
    el.setAttribute('aria-roledescription', 'interactive chart');
    el.setAttribute('aria-label', this._options.ariaLabel);
    if (this._options.interaction.keyboard) el.setAttribute('tabindex', '0');
    else el.removeAttribute('tabindex');
  }

  private reportError(error: unknown, source: string): void {
    if (source === 'listener:error' || !this.emitter.hasListeners('error')) {
      console.error(`[market-chart] error in ${source}`, error);
      return;
    }
    this.emitter.emit('error', { error, source });
  }

  private invalidate(mask: InvalidateMask): void {
    if (!this._destroyed) this.scheduler.invalidate(mask);
  }

  private onViewportChange(): void {
    this.markCrosshairDirty();
    this.invalidate(Invalidate.Main | Invalidate.Overlay);
  }

  private markCrosshairDirty(): void {
    this.crosshairDirty = true;
  }

  // ───────────────────────────── frame pipeline ─────────────────────────────

  private renderFrame(mask: InvalidateMask): void {
    if (this._destroyed) return;
    const { width, height } = this._size;
    if (width <= 0 || height <= 0) return;
    const pr = this.pixelRatio();
    const needsMain =
      (mask & (Invalidate.Main | Invalidate.Layout)) !== 0 ||
      !this.frame ||
      this.frame.pixelRatio !== pr;
    if (needsMain) {
      const frame = this.buildFrame(pr);
      this.frame = frame;
      this.mainSurface.resize(frame.layout.width, frame.layout.height, pr);
      this.overlaySurface.resize(frame.layout.width, frame.layout.height, pr);
      this.mainSurface.context.direction = this._options.localization.direction;
      drawMain(this.mainSurface.context, frame);
    }
    const frame = this.frame!;
    if (this.crosshairDirty) {
      this.crosshairDirty = false;
      this.crosshairFrame = this.updateCrosshair();
    }
    this.overlaySurface.context.direction = this._options.localization.direction;
    drawOverlay(this.overlaySurface.context, frame, this.crosshairFrame);
    if (needsMain) this.emitVisibleRange();
    if (!this.readyEmitted) {
      this.readyEmitted = true;
      this.emitter.emit('ready', { chart: this });
    }
  }

  private buildFrame(pr: number): FrameState {
    const o = this._options;
    const font = fontString(o.layout.fontSize, o.layout.fontFamily);
    const measureCtx = this.overlaySurface.context;
    const measure = (text: string): number => this.textCache.measure(measureCtx, font, text);
    const timeAxisHeight = o.timeScale.visible ? timeAxisHeightFor(o.layout.fontSize) : 0;
    const show: Record<AxisSide, boolean> = {
      right: this._panes.some((p) => p.rightScale.options.visible),
      left: this._panes.some((p) => p.leftScale.options.visible && p.hasSeriesOn(LEFT_SCALE_ID)),
    };
    const widths = this.axisWidths;
    const initial = priceAxisWidthFor([measure('0000.00')], 0);
    if (widths.right === 0) widths.right = Math.max(initial, o.rightPriceScale.minimumWidth);
    if (widths.left === 0) widths.left = Math.max(initial, o.leftPriceScale.minimumWidth);
    if (this.paneHeightsOverride) {
      this.paneHeightsOverride.forEach((h, i) => {
        const pane = this._panes[i];
        if (pane) pane.stretchFactor = Math.max(1e-3, h);
      });
      this.paneHeightsOverride = null;
    }

    let layout!: ChartLayout;
    let paneFrames!: PaneFrame[];
    const build = (): void => {
      const axes = { left: layout.leftAxisWidth > 0, right: layout.rightAxisWidth > 0 };
      paneFrames = this._panes.map((pane, i) => this.buildPaneFrame(pane, layout.panes[i]!, axes));
    };
    for (let pass = 0; pass < 3; pass++) {
      layout = computeLayout(
        this._size,
        this._panes.map((p) => p.stretchFactor),
        show.left ? widths.left : 0,
        show.right ? widths.right : 0,
        timeAxisHeight,
        o.panes.separatorHeight,
      );
      this._timeScale.setWidth(layout.paneWidth);
      build();
      let changed = false;
      for (const side of ['left', 'right'] as const) {
        if (!show[side]) continue;
        const texts: number[] = [];
        for (const pf of paneFrames) {
          const axis = pf[side];
          if (!axis) continue;
          for (const tick of axis.ticks) texts.push(measure(axis.formatTick(tick.value)));
          for (const label of axis.labels) texts.push(measure(label.text));
        }
        const minimum = (side === 'left' ? o.leftPriceScale : o.rightPriceScale).minimumWidth;
        const needed = priceAxisWidthFor(texts, minimum);
        // Grow immediately; shrink only by a noticeable amount to avoid jitter while scrolling.
        if (needed > widths[side] || widths[side] - needed >= 8) {
          widths[side] = needed;
          changed = true;
        }
      }
      if (!changed) break;
    }
    // A view requested before the first layout is applied only once the pane width is final.
    if (this._timeScale.applyPendingView()) build();

    const showTimeTicks = o.timeScale.visible || o.grid.vertLines.visible;
    const timeTicks = showTimeTicks
      ? this.tickGenerator.ticks(this.timeline, this._timeScale, measure('00:00:00') + 24)
      : [];

    return {
      pixelRatio: pr,
      layout,
      theme: this._theme,
      options: o,
      font,
      timeline: this.timeline,
      timeScale: this._timeScale,
      timeTicks,
      panes: paneFrames,
      plugins: this.plugins,
      coordinates: (paneIndex) => this.layerCoordinates(paneIndex),
    };
  }

  private buildPaneFrame(
    pane: Pane,
    rect: PaneFrame['rect'],
    axes: Record<AxisSide, boolean>,
  ): PaneFrame {
    pane.rect = rect;
    const visible = this._timeScale.visibleIndexRange();
    for (const scale of pane.scales) {
      scale.setHeight(rect.height);
      if (!pane.hasSeriesOn(scale.id)) {
        scale.clearRange();
        continue;
      }
      let min = Infinity;
      let max = -Infinity;
      let base: number | null = null;
      if (visible) {
        for (const model of pane.series) {
          if (model.options.priceScaleId !== scale.id || !model.options.visible) continue;
          const range = model.localRange(this.timeline, visible.from, visible.to, 0);
          if (!range) continue;
          base ??= model.firstValueIn(range.from, range.to);
          if (!model.options.autoscale) continue;
          const extremes = model.autoscale(range.from, range.to);
          if (extremes) {
            if (extremes.min < min) min = extremes.min;
            if (extremes.max > max) max = extremes.max;
          }
          for (const line of model.priceLines) {
            if (!line.options.autoscale) continue;
            if (line.options.price < min) min = line.options.price;
            if (line.options.price > max) max = line.options.price;
          }
        }
      }
      scale.setBase(base);
      if (min <= max) scale.setAutoscaleRange(min, max);
    }

    const series: SeriesFrame[] = pane.series.map((model) => {
      const scale = pane.scale(model.options.priceScaleId);
      return {
        model,
        scale,
        range: visible ? model.localRange(this.timeline, visible.from, visible.to, 1) : null,
        formatPrice: this.localized(priceFormatterFor(scale, model.formatter)),
      };
    });

    const fontSize = this._options.layout.fontSize;
    const tickSpacing = fontSize * 2.6;
    const labelHeight = axisLabelHeight(fontSize);
    const moreCount = this.localized((n: number) => String(n));
    const buildAxis = (side: AxisSide): AxisFrame | null => {
      if (!axes[side]) return null;
      const id = side === 'left' ? LEFT_SCALE_ID : RIGHT_SCALE_ID;
      const scale = pane.axisScale(side);
      const main = pane.mainSeriesOf(id);
      const formatter = main?.formatter ?? defaultPriceFormatter;
      const priceFormat = main?.options.priceFormat;
      const minMove = priceFormat?.type === 'price' ? (priceFormat.minMove ?? 0) : 0;
      const raw: AxisLabel[] = [];
      for (const s of series) {
        const o = s.model.options;
        const last = s.model.lastValueIndex();
        const labelSide: AxisSide = o.priceScaleId === LEFT_SCALE_ID ? 'left' : 'right';
        if (labelSide !== side || !o.visible || !o.lastValueVisible || last < 0 || s.scale.isEmpty)
          continue;
        const price = s.model.valueAt(last);
        const y = s.scale.priceToCoordinate(price);
        if (!Number.isFinite(y) || y < 0 || y > rect.height) continue;
        const color = s.model.colorAt(last);
        raw.push({
          y,
          text: s.formatPrice(price),
          background: color,
          color: contrastText(color),
          priority: 1,
        });
      }
      for (const s of series) {
        const o = s.model.options;
        const labelSide: AxisSide = o.priceScaleId === LEFT_SCALE_ID ? 'left' : 'right';
        if (labelSide !== side || !o.visible || s.scale.isEmpty) continue;
        for (const line of s.model.priceLines) {
          if (!line.options.axisLabelVisible) continue;
          const y = s.scale.priceToCoordinate(line.options.price);
          if (!Number.isFinite(y) || y < 0 || y > rect.height) continue;
          const last = s.model.lastValueIndex();
          const color =
            line.options.color ?? (last >= 0 ? s.model.colorAt(last) : this._theme.lineColor);
          raw.push({
            y,
            text: s.formatPrice(line.options.price),
            background: color,
            color: contrastText(color),
            priority: line.options.axisLabelPriority,
          });
        }
      }
      return {
        side,
        scale,
        ticks: scale.isEmpty ? [] : scale.ticks(tickSpacing, minMove),
        formatTick: this.localized(tickFormatter(scale, formatter)),
        formatCoordinate: this.localized(coordinateFormatter(scale, formatter)),
        // Hundreds of order lines in a small range are thinned; a kept label says how many it stands for.
        labels: layoutLabels(raw, labelHeight, rect.height, 1, { thin: true }).map((label) =>
          label.count > 1
            ? { ...label, text: `${label.text} +${moreCount(label.count - 1)}` }
            : label,
        ),
      };
    };
    const left = buildAxis('left');
    const right = buildAxis('right');
    const gridScale = !pane.rightScale.isEmpty
      ? pane.rightScale
      : !pane.leftScale.isEmpty
        ? pane.leftScale
        : null;
    const gridTicks =
      gridScale === null
        ? []
        : gridScale === pane.rightScale && right
          ? right.ticks
          : gridScale === pane.leftScale && left
            ? left.ticks
            : gridScale.ticks(tickSpacing, 0);
    return { pane, rect, gridTicks, left, right, series };
  }

  private emitVisibleRange(): void {
    if (this.timeline.length === 0 || this._timeScale.width <= 0) return;
    const logical = this._timeScale.visibleLogicalRange();
    const last = this.lastVisibleRange;
    if (last && Math.abs(last.from - logical.from) < 1e-9 && Math.abs(last.to - logical.to) < 1e-9)
      return;
    this.lastVisibleRange = logical;
    this.emitter.emit('visibleRangeChange', { logical, time: this._timeScale.visibleTimeRange() });
  }

  private layerCoordinates(paneIndex: number): PaneLayerCoordinates {
    const pane = this._panes[paneIndex];
    const ts = this._timeScale;
    const timeline = this.timeline;
    const scaleFor = (id: string): PriceScale | null => {
      const scale = pane?.findScale(id) ?? null;
      return scale && !scale.isEmpty ? scale : null;
    };
    const finite = (v: number): number | null => (Number.isFinite(v) ? v : null);
    return {
      timeToX: (time) => {
        const logical = timeToLogical(timeline, time);
        return logical === null ? null : ts.indexToX(logical);
      },
      xToTime: (x) => (timeline.length ? logicalToTime(timeline, ts.xToLogical(x)) : null),
      priceToY: (price, id = RIGHT_SCALE_ID) => {
        const scale = scaleFor(id);
        return scale ? finite(scale.priceToCoordinate(price)) : null;
      },
      yToPrice: (y, id = RIGHT_SCALE_ID) => {
        const scale = scaleFor(id);
        return scale ? finite(scale.coordinateToPrice(y)) : null;
      },
    };
  }

  // ───────────────────────────── crosshair ─────────────────────────────

  /** Region, time, price and series under a chart point, for context menus. */
  private contextMenuInfo(
    x: number,
    y: number,
    host: InteractionHost,
    tolerance: number,
  ): Omit<
    ContextMenuEvent,
    | 'clientX'
    | 'clientY'
    | 'source'
    | 'pointerType'
    | 'button'
    | 'shiftKey'
    | 'ctrlKey'
    | 'altKey'
    | 'metaKey'
    | 'preventDefault'
    | 'defaultPrevented'
  > {
    const hit = host.hitTest(x, y);
    const point = host.describePoint(x, y);
    const frame = this.frame;
    let time: number | null = null;
    let logical: number | null = null;
    if (frame && this.timeline.length > 0 && (hit.region === 'pane' || hit.region === 'timeAxis')) {
      const index = this._timeScale.xToIndex(x - frame.layout.paneLeft);
      if (index >= 0 && index < this.timeline.length) {
        logical = index;
        time = this.timeline.timeAt(index) ?? null;
      }
    }
    let price: number | null = null;
    const series: ContextMenuSeriesHit[] = [];
    const paneFrame = frame && point.pane !== null ? frame.panes[point.pane] : undefined;
    if (paneFrame && !Number.isNaN(point.paneY)) {
      const scale =
        hit.region === 'priceAxis'
          ? paneFrame.pane.axisScale(hit.side ?? 'right')
          : this.primaryScale(paneFrame.pane);
      if (!scale.isEmpty) {
        const value = scale.coordinateToPrice(point.paneY);
        price = Number.isFinite(value) ? value : null;
      }
      if (hit.region === 'pane' && time !== null) {
        for (const s of paneFrame.series) {
          const model = s.model;
          if (!model.options.visible || s.scale.isEmpty) continue;
          const local = model.store.indexOfTime(time);
          if (local < 0) continue;
          const row = model.dataAt(local)!;
          const r = row as { high?: number; low?: number; value?: number };
          let distance: number;
          if (typeof r.high === 'number' && typeof r.low === 'number') {
            const top = s.scale.priceToCoordinate(r.high);
            const bottom = s.scale.priceToCoordinate(r.low);
            const lo = Math.min(top, bottom);
            const hi = Math.max(top, bottom);
            distance =
              point.paneY < lo ? lo - point.paneY : point.paneY > hi ? point.paneY - hi : 0;
          } else if (typeof r.value === 'number') {
            const valueY = s.scale.priceToCoordinate(r.value);
            distance =
              model.type === 'histogram'
                ? point.paneY >= Math.min(valueY, s.scale.priceToCoordinate(0)) - tolerance &&
                  point.paneY <= Math.max(valueY, s.scale.priceToCoordinate(0)) + tolerance
                  ? 0
                  : Number.POSITIVE_INFINITY
                : Math.abs(valueY - point.paneY);
          } else continue;
          if (Number.isFinite(distance) && distance <= tolerance) {
            series.push({ series: this.apis.get(model)!, point: row, distance });
          }
        }
        series.sort((a, b) => a.distance - b.distance);
      }
    }
    return {
      x,
      y,
      region: point.region,
      pane: point.pane,
      paneX: point.paneX,
      paneY: point.paneY,
      side: hit.region === 'priceAxis' ? (hit.side ?? 'right') : null,
      time,
      logical,
      price,
      series,
    };
  }

  private paneAt(y: number): number {
    const layout = this.frame?.layout;
    if (!layout) return -1;
    return layout.panes.findIndex((r) => y >= r.y && y < r.y + r.height);
  }

  /** The scale that drives a pane's crosshair price: right if in use, otherwise left. */
  private primaryScale(pane: Pane): PriceScale {
    return pane.rightScale.isEmpty && !pane.leftScale.isEmpty ? pane.leftScale : pane.rightScale;
  }

  private crosshairEventAt(target: CrosshairTarget | null): {
    event: CrosshairMoveEvent;
    frame: CrosshairFrame | null;
  } {
    const source = target?.kind ?? 'pointer';
    const empty = (point: Point | null): { event: CrosshairMoveEvent; frame: null } => ({
      event: {
        time: null,
        logicalIndex: null,
        point,
        pane: null,
        price: null,
        seriesData: EMPTY_SERIES_DATA,
        source,
      },
      frame: null,
    });
    const frame = this.frame;
    const pointerPoint = target?.kind === 'pointer' ? { x: target.x, y: target.y } : null;
    if (!target || !frame || this.timeline.length === 0 || frame.panes.length === 0)
      return empty(pointerPoint);
    const layout = frame.layout;

    let paneIndex: number;
    let index: number;
    if (target.kind === 'pointer') {
      paneIndex = this.paneAt(target.y);
      if (paneIndex < 0) return empty(pointerPoint);
      index = this._timeScale.xToIndex(target.x - layout.paneLeft);
    } else {
      paneIndex = Math.min(target.pane, frame.panes.length - 1);
      index = this.timeline.nearestIndex(target.time);
    }
    const paneFrame = frame.panes[paneIndex]!;
    const rect = paneFrame.rect;
    const time = this.timeline.timeAt(index)!;
    const x = layout.paneLeft + this._timeScale.indexToX(index);

    const seriesData = new Map<SeriesApi, SeriesData<SeriesType>>();
    for (const model of this.models) {
      const local = model.store.indexOfTime(time);
      if (local >= 0) seriesData.set(this.apis.get(model)!, model.dataAt(local)!);
    }

    const primary = this.primaryScale(paneFrame.pane);
    let y: number | null = null;
    if (target.kind === 'pointer') {
      y = target.y;
      if (this._options.crosshair.mode === 'magnet') {
        const snapTo = paneFrame.series.find(
          (s) =>
            s.model.options.visible && s.scale === primary && s.model.store.indexOfTime(time) >= 0,
        );
        if (snapTo) {
          const snapped = snapTo.scale.priceToCoordinate(
            snapTo.model.valueAt(snapTo.model.store.indexOfTime(time)),
          );
          if (Number.isFinite(snapped)) y = rect.y + snapped;
        }
      }
    } else if (target.price !== null && !primary.isEmpty) {
      const local = primary.priceToCoordinate(target.price);
      if (Number.isFinite(local) && local >= 0 && local <= rect.height) y = rect.y + local;
    }

    const localY = y === null ? null : y - rect.y;
    const price = localY === null || primary.isEmpty ? null : primary.coordinateToPrice(localY);
    const ts = this._options.timeScale;
    const intraday =
      ts.timeVisible === 'auto'
        ? this.timeline.length >= 2 &&
          this.timeline.timeAt(this.timeline.lastIndex)! -
            this.timeline.timeAt(this.timeline.lastIndex - 1)! <
            DAY
        : ts.timeVisible;
    const timeLabel =
      this.formatters.time?.(time) ??
      this.timeFormatter.crosshair(time, intraday, ts.secondsVisible);
    return {
      event: {
        time,
        logicalIndex: index,
        point: pointerPoint ?? (y === null ? null : { x, y }),
        pane: paneIndex,
        price: price !== null && Number.isFinite(price) ? price : null,
        seriesData,
        source,
      },
      frame: {
        x,
        y,
        pane: paneIndex,
        timeLabel,
        priceLabels: {
          left: localY !== null && paneFrame.left ? paneFrame.left.formatCoordinate(localY) : null,
          right:
            localY !== null && paneFrame.right ? paneFrame.right.formatCoordinate(localY) : null,
        },
      },
    };
  }

  private updateCrosshair(): CrosshairFrame | null {
    const { event, frame } = this.crosshairEventAt(this.crosshairPos);
    const active = frame !== null;
    if (active || this.crosshairWasActive) this.emitter.emit('crosshairMove', event);
    this.crosshairWasActive = active;
    return frame;
  }

  // ───────────────────────────── interaction host ─────────────────────────────

  private createInteractionHost(): InteractionHost {
    const ts = (): TimeScale => this._timeScale;
    const scaleOf = (pane: number, side: AxisSide): PriceScale | null =>
      this._panes[pane]?.axisScale(side) ?? null;
    const setAutoScale = (pane: number, side: AxisSide, autoScale: boolean): void => {
      const id = side === 'left' ? LEFT_SCALE_ID : RIGHT_SCALE_ID;
      this._panes[pane]?.applyScaleOptions(id, { autoScale });
      this.emitter.emit('priceScaleChange', { pane, priceScaleId: id });
    };
    const paneX = (x: number): number => x - (this.frame?.layout.paneLeft ?? 0);
    const host: InteractionHost = {
      hitTest: (x, y): HitResult => {
        const layout = this.frame?.layout;
        if (!layout || x < 0 || y < 0 || x > layout.width || y > layout.height)
          return { region: 'none', pane: -1 };
        const { paneLeft, paneWidth } = layout;
        const inPaneX = x >= paneLeft && x < paneLeft + paneWidth;
        if (this._options.interaction.paneResize && layout.panes.length > 1) {
          for (let i = 0; i < layout.panes.length - 1; i++) {
            const r = layout.panes[i]!;
            const bottom = r.y + r.height;
            if (y >= bottom - 3 && y <= bottom + layout.separatorHeight + 3)
              return { region: 'separator', pane: i };
          }
        }
        if (y >= layout.timeAxis.y && layout.timeAxisHeight > 0) {
          return inPaneX ? { region: 'timeAxis', pane: -1 } : { region: 'none', pane: -1 };
        }
        const pane = this.paneAt(y);
        if (pane < 0) return { region: 'none', pane: -1 };
        if (inPaneX) return { region: 'pane', pane };
        return { region: 'priceAxis', pane, side: x < paneLeft ? 'left' : 'right' };
      },
      interactionOptions: (): InteractionOptions => this._options.interaction,
      scrollTime: (dx) => ts().scrollBy(dx),
      zoomTime: (anchorX, factor) => ts().zoom(paneX(anchorX), factor),
      scaleTimeFromRight: (factor) => ts().zoom(ts().width, factor),
      zoomTimeCentre: (factor) => ts().zoom(ts().width / 2, factor),
      scrollBars: (count) => ts().scrollBars(count),
      scrollToStart: () => ts().scrollToStart(),
      scrollToEnd: () => ts().scrollToRealtime(),
      resetTime: () => ts().reset(),
      scalePrice: (pane, side, factor) => {
        const scale = scaleOf(pane, side);
        if (!scale || scale.isEmpty) return;
        if (scale.options.autoScale) setAutoScale(pane, side, false);
        scale.scaleBy(factor);
        this.onViewportChange();
      },
      panPrice: (pane, dy) => {
        if (dy === 0) return false;
        let moved = false;
        for (const side of ['left', 'right'] as const) {
          const scale = scaleOf(pane, side);
          if (!scale || scale.isEmpty || scale.options.autoScale) continue;
          scale.shiftBy(dy);
          moved = true;
        }
        if (moved) this.onViewportChange();
        return moved;
      },
      resetPrice: (pane, side) => {
        setAutoScale(pane, side, true);
        this.onViewportChange();
      },
      resizePane: (pane, dy) => {
        const layout = this.frame?.layout;
        if (!layout || dy === 0) return;
        const heights = this.paneHeightsOverride ?? layout.panes.map((r) => r.height);
        const next = resizePanes(heights, pane, dy, this._options.panes.minHeight);
        this.paneHeightsOverride = next;
        this.invalidate(Invalidate.All);
        this.emitter.emit('paneResize', { heights: next });
      },
      setCrosshair: (x, y) => {
        this.crosshairPos = { kind: 'pointer', x, y };
        this.markCrosshairDirty();
        this.invalidate(Invalidate.Overlay);
      },
      clearCrosshair: () => this.clearCrosshair(),
      click: (x, y) => {
        this.emitter.emit('click', this.crosshairEventAt({ kind: 'pointer', x, y }).event);
      },
      inputHandlers: () => this.plugins.inputHandlers,
      contextMenu: (request) => {
        if (!this.emitter.hasListeners('contextMenu')) return false;
        let prevented = false;
        const event: ContextMenuEvent = {
          ...this.contextMenuInfo(request.x, request.y, host, request.source === 'touch' ? 12 : 6),
          clientX: request.clientX,
          clientY: request.clientY,
          source: request.source,
          pointerType: request.pointerType,
          button: request.source === 'mouse' ? 2 : 0,
          shiftKey: request.shiftKey,
          ctrlKey: request.ctrlKey,
          altKey: request.altKey,
          metaKey: request.metaKey,
          preventDefault: () => {
            prevented = true;
          },
          get defaultPrevented() {
            return prevented;
          },
        };
        this.emitter.emit('contextMenu', event);
        return true;
      },
      describePoint: (x, y) => {
        const hit = host.hitTest(x, y);
        const pane = hit.region === 'pane' || hit.region === 'priceAxis' ? hit.pane : null;
        const rect = pane === null ? null : (this.frame?.layout.panes[pane] ?? null);
        return { region: hit.region, pane, paneX: paneX(x), paneY: rect ? y - rect.y : Number.NaN };
      },
    };
    return host;
  }
}

/**
 * Creates an interactive chart inside `container`.
 *
 * Safe to import on the server: nothing touches the DOM until this function is called.
 *
 * @param container element that hosts the chart; by default the chart follows its size.
 * @param options   chart options (deep-partial; omitted values use defaults).
 * @param formatters non-serialisable formatting hooks.
 */
export function createChart(
  container: HTMLElement,
  options?: ChartOptionsInput,
  formatters?: ChartFormatters,
): ChartApi {
  return new ChartImpl(container, options, formatters);
}
