import type {
  LogicalRange,
  Point,
  SeriesColumnsInput,
  SeriesData,
  SeriesType,
  Size,
  TimeRange,
  Unsubscribe,
} from '../model/types.js';
import type { ChartFormatters, ChartOptions, ChartOptionsInput } from '../options/chart-options.js';
import type { SeriesOptions, SeriesOptionsInput } from '../options/series-options.js';
import type { PriceScaleOptions } from '../scales/price-scale.js';
import type { TimeScaleOptions } from '../scales/time-scale.js';
import type { ChartTheme, ThemeInput } from '../theme/themes.js';
import type { DeepPartial } from '../utils/merge.js';
import type { ChartPlugin } from '../plugins/plugin.js';
import type { PriceFormatterFn } from '../format/price-format.js';
import type { CustomSeriesView } from '../series/custom.js';
import type { ChartPointerEvent } from '../interaction/input-handler.js';
import type { PriceLineApi, PriceLineOptions } from '../series/price-line.js';

/** Column copies of a series' data (see `SeriesApi.columns`). */
export interface SeriesColumns {
  readonly length: number;
  /** UTC ms, strictly increasing. */
  readonly times: Float64Array;
  /** One array per field (`open`, `high`, `low`, `close`, `volume` or `value`; custom series: their fields). Missing values are NaN. */
  readonly fields: Readonly<Record<string, Float64Array>>;
}

export interface SeriesApi<T extends SeriesType = SeriesType> {
  readonly id: string;
  readonly type: T;
  /** Replaces all data. Rows must be sorted by strictly increasing `time` (UTC ms). */
  setData(data: readonly SeriesData<T>[]): void;
  /**
   * Replaces all data from columns (typed arrays or number arrays), without an object per point: the fastest
   * way to load large datasets or computed results. Same validation as `setData`.
   */
  setColumns(columns: SeriesColumnsInput): void;
  /**
   * Realtime update: appends a newer point, replaces the point with the same time,
   * or inserts a historical correction.
   */
  update(point: SeriesData<T>): void;
  /** Copy of all data as objects (allocates one object per point; prefer `columns()` for large series). */
  data(): SeriesData<T>[];
  /**
   * Copy of all data as typed-array columns: one memory copy per field instead of one object per point,
   * so reading 1M points takes milliseconds. Safe to keep and modify; the chart is not affected.
   */
  columns(): SeriesColumns;
  /** Point at an exact time, if present. */
  dataAt(time: number): SeriesData<T> | undefined;
  /** Most recent point. */
  lastPoint(): SeriesData<T> | undefined;
  length(): number;
  applyOptions(options: SeriesOptionsInput<T>): void;
  options(): Readonly<SeriesOptions<T>>;
  /**
   * Custom price formatter for this series (axis labels, crosshair). Kept out of `options` so options
   * stay serialisable. Pass null to go back to `priceFormat`.
   */
  setPriceFormatter(formatter: PriceFormatterFn | null): void;
  /** Adds a horizontal line at `price` on this series' scale (levels, alerts, entries). */
  createPriceLine(options: Partial<PriceLineOptions> & { price: number }): PriceLineApi;
  priceLines(): readonly PriceLineApi[];
  priceScale(): PriceScaleApi;
  /** Price → y (CSS px relative to the series' pane), or null if the scale is empty. */
  priceToCoordinate(price: number): number | null;
  coordinateToPrice(y: number): number | null;
}

export interface PriceScaleApi {
  readonly id: string;
  readonly pane: number;
  applyOptions(options: DeepPartial<PriceScaleOptions>): void;
  options(): Readonly<PriceScaleOptions>;
  /** Axis width in CSS px (0 for overlay scales). */
  width(): number;
}

export interface TimeScaleApi {
  applyOptions(options: DeepPartial<TimeScaleOptions>): void;
  options(): Readonly<TimeScaleOptions>;
  fitContent(): void;
  scrollToRealtime(): void;
  /** Restores default bar spacing and right offset. */
  reset(): void;
  /** Scrolls so `time` is centred. */
  scrollToTime(time: number): void;
  getVisibleLogicalRange(): LogicalRange | null;
  setVisibleLogicalRange(range: LogicalRange): void;
  getVisibleRange(): TimeRange | null;
  setVisibleRange(range: TimeRange): void;
  barSpacing(): number;
  rightOffset(): number;
  /** Time → x (CSS px). Interpolates/extrapolates between bars. Null without data. */
  timeToCoordinate(time: number): number | null;
  coordinateToTime(x: number): number | null;
  /** Fractional bar index at x (bar i is centred at logical i). */
  coordinateToLogical(x: number): number;
  logicalToCoordinate(logical: number): number;
  /** Fractional bar index of a time (interpolated between bars, extrapolated beyond the data). Null without data. */
  timeToLogical(time: number): number | null;
  /** Inverse of `timeToLogical`. */
  logicalToTime(logical: number): number | null;
  width(): number;
}

export interface PaneApi {
  readonly index: number;
  /** Relative height weight (default 1). */
  stretchFactor(): number;
  setStretchFactor(factor: number): void;
  /** Height in CSS px from the last layout. */
  height(): number;
}

export interface CrosshairMoveEvent {
  /** Hovered bar time, or null when the crosshair is hidden. */
  readonly time: number | null;
  readonly logicalIndex: number | null;
  /** Pointer position in CSS px relative to the chart. */
  readonly point: Point | null;
  readonly pane: number | null;
  /** Price under the pointer on the pane's right scale. */
  readonly price: number | null;
  /** Data of each series at the hovered time. */
  readonly seriesData: ReadonlyMap<SeriesApi, SeriesData<SeriesType>>;
  /**
   * `pointer` for user input, `api` when set with `setCrosshairPosition`. Synchronisation code should only
   * forward `pointer` events to avoid feedback loops between charts.
   */
  readonly source: 'pointer' | 'api';
}

export interface VisibleRangeChangeEvent {
  readonly logical: LogicalRange;
  readonly time: TimeRange | null;
}

/** What `SeriesApi.update()` did with the point: a new last point, an overwrite, or a historical insertion. */
export type DataUpdateKind = 'appended' | 'replaced' | 'inserted';

export interface DataChangedEvent {
  readonly series: SeriesApi;
  /** `set`: `setData` / `setColumns` replaced everything; `update`: one point via `update()`. */
  readonly kind: 'set' | 'update';
  /**
   * For `kind: 'update'`: which point changed. `replaced` may be an older point (a historical correction),
   * not only the forming bar — compare `time` with the series' last time. Absent for `set`.
   */
  readonly update?: { readonly kind: DataUpdateKind; readonly time: number };
}

/** Series drawn under a context-menu point. */
export interface ContextMenuSeriesHit {
  readonly series: SeriesApi;
  /** Data point at the menu's time. */
  readonly point: SeriesData<SeriesType>;
  /** Vertical distance in CSS px from the drawn value (0 inside a candle or bar body/wick range). */
  readonly distance: number;
}

/**
 * A context-menu request (right-click, touch long-press with `interaction.touchContextMenu`, or the keyboard
 * ContextMenu key / Shift+F10). It describes what is under the point; UI packages decide what to show.
 * Call `preventDefault()` to suppress the browser's own menu (any listener does so implicitly).
 */
export interface ContextMenuEvent extends ChartPointerEvent {
  readonly clientX: number;
  readonly clientY: number;
  readonly source: 'mouse' | 'touch' | 'keyboard';
  /** Price axis side when `region` is `priceAxis`. */
  readonly side: 'left' | 'right' | null;
  /** Bar time and logical index under the point (null outside the data / axes without time). */
  readonly time: number | null;
  readonly logical: number | null;
  /** Price at the point on the pane's primary scale (or on the hit axis). */
  readonly price: number | null;
  /** Series whose value is drawn within a few px of the point, nearest first. */
  readonly series: readonly ContextMenuSeriesHit[];
  /** Suppresses default handling (UI layers use it to mark the menu as taken). */
  preventDefault(): void;
  readonly defaultPrevented: boolean;
}

export interface ChartEventMap {
  ready: { readonly chart: ChartApi };
  /** A context menu was requested (see `ContextMenuEvent`). */
  contextMenu: ContextMenuEvent;
  /** `setLocale` / `localization.locale` changed. */
  localeChange: { readonly locale: string };
  /** `setDirection` / `localization.direction` changed. */
  directionChange: { readonly direction: 'ltr' | 'rtl' };
  resize: Size;
  crosshairMove: CrosshairMoveEvent;
  click: CrosshairMoveEvent;
  visibleRangeChange: VisibleRangeChangeEvent;
  priceScaleChange: { readonly pane: number; readonly priceScaleId: string };
  /** A pane separator was dragged. Heights are CSS px per pane. */
  paneResize: { readonly heights: readonly number[] };
  seriesAdded: { readonly series: SeriesApi };
  seriesRemoved: { readonly seriesId: string };
  dataChanged: DataChangedEvent;
  optionsChanged: { readonly options: Readonly<ChartOptions> };
  themeChanged: { readonly theme: ChartTheme };
  pluginInstalled: { readonly id: string };
  pluginRemoved: { readonly id: string };
  /** Errors caught in listeners, plugins or layers. */
  error: { readonly error: unknown; readonly source: string };
  destroy: { readonly chart: ChartApi };
}

export type ChartEventName = keyof ChartEventMap;

export interface ChartApi {
  readonly id: string;
  addSeries<T extends SeriesType>(type: T, options?: SeriesOptionsInput<T>): SeriesApi<T>;
  /** Adds a plugin-defined chart type rendered by `view.paint`. */
  addCustomSeries(
    view: CustomSeriesView,
    options?: SeriesOptionsInput<'custom'>,
  ): SeriesApi<'custom'>;
  removeSeries(series: SeriesApi): void;
  series(): readonly SeriesApi[];
  applyOptions(options: ChartOptionsInput): void;
  options(): Readonly<ChartOptions>;
  setTheme(theme: ThemeInput): void;
  theme(): ChartTheme;
  /**
   * Locale for axis dates and (with `localization.localizeNumbers`) numbers. Re-labels the axes without
   * recreating the chart; UI translations live in `@market-chart/i18n`.
   */
  setLocale(locale: string): void;
  getLocale(): string;
  /** Direction of canvas text and of the chart element (`dir` attribute). */
  setDirection(direction: 'ltr' | 'rtl'): void;
  getDirection(): 'ltr' | 'rtl';
  setFormatters(formatters: ChartFormatters): void;
  timeScale(): TimeScaleApi;
  /** Price scale `id` (default `'right'`) of pane `pane` (default 0). Overlay scales are created on demand. */
  priceScale(id?: string, pane?: number): PriceScaleApi;
  panes(): readonly PaneApi[];
  /** Shows all data. Shortcut for `timeScale().fitContent()`. */
  fitContent(): void;
  /** Sets an explicit size (CSS px). Disables `autoSize`. */
  resize(width: number, height: number): void;
  size(): Size;
  on<K extends ChartEventName>(
    event: K,
    listener: (payload: ChartEventMap[K]) => void,
  ): Unsubscribe;
  off<K extends ChartEventName>(event: K, listener: (payload: ChartEventMap[K]) => void): void;
  /** Installs a plugin. Throws if the id is taken or a dependency is missing. */
  use(plugin: ChartPlugin): void;
  removePlugin(id: string): void;
  hasPlugin(id: string): boolean;
  /**
   * Shows the crosshair at the bar nearest to `time` in `pane` (default 0). With a `price`, the horizontal
   * line is drawn at that price on the pane's main scale; without one only the vertical line is shown.
   * Emits `crosshairMove` with `source: 'api'`. Intended for synchronising several charts.
   */
  setCrosshairPosition(time: number, price?: number | null, pane?: number): void;
  /** Hides the crosshair. */
  clearCrosshair(): void;
  /** Renders pending changes synchronously. */
  render(): void;
  /** Composites all layers into a new canvas. */
  takeScreenshot(): HTMLCanvasElement;
  /** The element that hosts the chart's canvases. */
  element(): HTMLElement;
  readonly destroyed: boolean;
  destroy(): void;
}
