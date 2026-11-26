import { EventEmitter } from '@market-chart/core';
import type { ChartApi, SeriesApi, SeriesType, Unsubscribe } from '@market-chart/core';
import { fillMissingCandles, mergeCandles, normalizeCandles } from './candles.js';
import { alignTime, parseTimeframe } from './timeframe.js';
import type { Candle, Datafeed, SymbolInfo, Timeframe } from './types.js';
import { DatafeedError } from './types.js';

export type DatafeedStatus = 'idle' | 'loading' | 'ready' | 'loading-more' | 'error';

export interface DatafeedControllerOptions {
  readonly datafeed: Datafeed;
  readonly symbol: string;
  readonly interval: Timeframe;
  /** Bars loaded initially (default 300). */
  readonly initialBars?: number;
  /** Bars requested per history page (default 300). */
  readonly chunkBars?: number;
  /** Load more history when fewer than this many bars are left of the visible range (default 10). */
  readonly loadMoreThreshold?: number;
  /** Fill missing bars with flat candles (continuous markets only). */
  readonly fillGaps?: boolean;
  /** Also feed volume into this histogram series. */
  readonly volumeSeries?: SeriesApi<'histogram'> | null;
  readonly volumeColors?: { readonly up: string; readonly down: string };
  /** Apply the symbol's price precision / min move to the series (default true). */
  readonly applySymbolFormat?: boolean;
  /**
   * Keep at most this many bars in memory during long realtime sessions: once 10% more have arrived, the
   * oldest are dropped (only while the oldest bars are off-screen). Scrolling back loads them again.
   */
  readonly maxBars?: number;
  readonly now?: () => number;
}

export interface DatafeedControllerEvents {
  status: { readonly status: DatafeedStatus };
  symbolResolved: { readonly info: SymbolInfo };
  historyLoaded: { readonly bars: number; readonly older: boolean };
  realtime: { readonly candle: Candle };
  /** Old bars were dropped to respect `maxBars`. */
  historyTrimmed: { readonly bars: number };
  error: { readonly error: unknown };
}

const EMPTY_PAGES_BEFORE_GIVING_UP = 3;
/** Largest time a JavaScript Date can represent (±100,000,000 days). */
const MAX_TIME = 8.64e15;

/**
 * Symbol info from an untrusted datafeed response, reduced to well-typed values: strings of at most 256
 * characters, `pricePrecision` an integer in [0, 20], `minMove` > 0, history bounds within the Date range,
 * at most 64 timeframes. Invalid fields are dropped (a bad `pricePrecision` used to make every frame throw).
 */
export function sanitizeSymbolInfo(input: unknown, requested: string): SymbolInfo {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const text = (v: unknown, max = 256): string | undefined =>
    typeof v === 'string' && v.length <= max ? v : undefined;
  const time = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_TIME ? v : undefined;
  const out: { -readonly [K in keyof SymbolInfo]: SymbolInfo[K] } = {
    symbol: text(raw['symbol'], 128) ?? requested,
  };
  for (const key of [
    'name',
    'description',
    'exchange',
    'type',
    'currency',
    'timezone',
    'session',
  ] as const) {
    const v = text(raw[key]);
    if (v !== undefined) out[key] = v;
  }
  const precision = raw['pricePrecision'];
  if (
    typeof precision === 'number' &&
    Number.isInteger(precision) &&
    precision >= 0 &&
    precision <= 20
  )
    out.pricePrecision = precision;
  const minMove = raw['minMove'];
  if (typeof minMove === 'number' && Number.isFinite(minMove) && minMove > 0) out.minMove = minMove;
  const start = time(raw['historyStart']);
  const end = time(raw['historyEnd']);
  if (start !== undefined && (end === undefined || start <= end)) out.historyStart = start;
  if (end !== undefined && (start === undefined || start <= end)) out.historyEnd = end;
  if (Array.isArray(raw['timeframes']))
    out.timeframes = raw['timeframes']
      .filter((t): t is string => typeof t === 'string' && t.length <= 16)
      .slice(0, 64);
  return out;
}

function indexOfTime(candles: readonly Candle[], time: number): number {
  let lo = 0;
  let hi = candles.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const t = candles[mid]!.time;
    if (t === time) return mid;
    if (t < time) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/**
 * Connects a datafeed to a chart series:
 * - resolves the symbol and applies its price format;
 * - subscribes to realtime updates first and buffers them, then loads history, so no update is lost;
 * - applies updates with `series.update` (new bars, the forming bar, and corrections of older bars);
 * - loads older history automatically when the user scrolls near the start;
 * - ignores late responses after the symbol or interval changed.
 */
export class DatafeedController {
  private readonly chart: ChartApi;
  private readonly series: SeriesApi;
  private options: DatafeedControllerOptions;
  private readonly emitter = new EventEmitter<DatafeedControllerEvents>();
  private candles: Candle[] = [];
  private _status: DatafeedStatus = 'idle';
  private _info: SymbolInfo | null = null;
  private generation = 0;
  private unsubscribe: Unsubscribe | null = null;
  private readonly offRange: Unsubscribe;
  private hasMore = true;
  private cursor = Number.NaN;
  private emptyPages = 0;
  private destroyed = false;

  constructor(chart: ChartApi, series: SeriesApi, options: DatafeedControllerOptions) {
    this.chart = chart;
    this.series = series;
    this.options = options;
    this.offRange = chart.on('visibleRangeChange', (e) => {
      if (this._status === 'ready' && e.logical.from < (this.options.loadMoreThreshold ?? 10))
        void this.loadMore();
    });
    void this.load();
  }

  get status(): DatafeedStatus {
    return this._status;
  }

  get symbolInfo(): SymbolInfo | null {
    return this._info;
  }

  get symbol(): string {
    return this.options.symbol;
  }

  get interval(): Timeframe {
    return this.options.interval;
  }

  /** Copy of the loaded candles (oldest first). */
  data(): Candle[] {
    return [...this.candles];
  }

  on<K extends keyof DatafeedControllerEvents>(
    event: K,
    listener: (payload: DatafeedControllerEvents[K]) => void,
  ): Unsubscribe {
    return this.emitter.on(event, listener);
  }

  async setSymbol(symbol: string, interval: Timeframe = this.options.interval): Promise<void> {
    this.options = { ...this.options, symbol, interval };
    await this.load();
  }

  async setInterval(interval: Timeframe): Promise<void> {
    await this.setSymbol(this.options.symbol, interval);
  }

  /** Loads one page of older history. Resolves with the number of bars added. */
  async loadMore(): Promise<number> {
    if (this.destroyed || this._status !== 'ready' || !this.hasMore || !this.candles.length)
      return 0;
    const generation = this.generation;
    const { datafeed, symbol, interval } = this.options;
    const step = parseTimeframe(interval).ms;
    const chunk = this.options.chunkBars ?? 300;
    const to = (Number.isNaN(this.cursor) ? this.candles[0]!.time : this.cursor) - 1;
    const historyStart = this._info?.historyStart;
    if (historyStart !== undefined && to < historyStart) {
      this.hasMore = false;
      return 0;
    }
    const from = Math.max(alignTime(to, interval) - (chunk - 1) * step, historyStart ?? -Infinity);
    this.setStatus('loading-more');
    try {
      const raw = await datafeed.getHistoricalData(symbol, interval, { from, to });
      if (generation !== this.generation || this.stopIfChartGone()) return 0;
      const older = normalizeCandles(raw).candles.filter((c) => c.time < this.candles[0]!.time);
      this.cursor = from;
      if (!older.length) {
        if (++this.emptyPages >= EMPTY_PAGES_BEFORE_GIVING_UP) this.hasMore = false;
      } else this.emptyPages = 0;
      if (older.length) {
        this.candles = mergeCandles(older, this.candles);
        this.push();
      }
      this.setStatus('ready');
      this.emitter.emit('historyLoaded', { bars: older.length, older: true });
      return older.length;
    } catch (error) {
      if (generation === this.generation) this.fail(error);
      return 0;
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.generation++;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.offRange();
    this.emitter.clear();
  }

  /**
   * The chart can be destroyed before the controller (e.g. React runs the chart's layout-effect cleanup
   * before the datafeed's passive-effect cleanup). Realtime ticks or responses arriving in between must not
   * touch the destroyed chart: the controller stops itself instead.
   */
  private stopIfChartGone(): boolean {
    if (!this.chart.destroyed) return false;
    this.destroy();
    return true;
  }

  private setStatus(status: DatafeedStatus): void {
    if (this._status === status) return;
    this._status = status;
    this.emitter.emit('status', { status });
  }

  private fail(error: unknown): void {
    this.setStatus('error');
    this.emitter.emit('error', { error });
  }

  private async load(): Promise<void> {
    if (this.destroyed) return;
    const generation = ++this.generation;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.candles = [];
    this.hasMore = true;
    this.cursor = Number.NaN;
    this.emptyPages = 0;
    this.setStatus('loading');
    const { datafeed, symbol, interval } = this.options;
    try {
      parseTimeframe(interval);
      // Symbol info comes from the network: validate it before it reaches the series or the range maths.
      const info = sanitizeSymbolInfo(await datafeed.resolveSymbol(symbol), symbol);
      if (generation !== this.generation || this.stopIfChartGone()) return;
      this._info = info;
      this.emitter.emit('symbolResolved', { info });
      if (this.options.applySymbolFormat !== false && info.pricePrecision !== undefined) {
        const precision = info.pricePrecision;
        this.series.applyOptions({
          priceFormat: { type: 'price', precision, minMove: info.minMove ?? 10 ** -precision },
        } as never);
      }
      // Subscribe before loading history and buffer, so nothing between the two is lost.
      const buffer: Candle[] = [];
      let live = false;
      this.unsubscribe = datafeed.subscribe(symbol, interval, (update) => {
        if (generation !== this.generation || this.stopIfChartGone()) return;
        const [candle] = normalizeCandles([update]).candles;
        if (!candle) return;
        if (live) this.applyRealtime(candle);
        else buffer.push(candle);
      });
      const now = this.options.now?.() ?? Date.now();
      const end = info.historyEnd !== undefined ? Math.min(now, info.historyEnd) : now;
      const bars = this.options.initialBars ?? 300;
      const step = parseTimeframe(interval).ms;
      const from = Math.max(
        alignTime(end, interval) - (bars - 1) * step,
        info.historyStart ?? -Infinity,
      );
      const raw = await datafeed.getHistoricalData(symbol, interval, { from, to: end });
      if (generation !== this.generation || this.stopIfChartGone()) return;
      this.candles = normalizeCandles(raw).candles;
      this.cursor = from;
      this.push(true);
      live = true;
      for (const candle of buffer) this.applyRealtime(candle);
      this.setStatus('ready');
      this.emitter.emit('historyLoaded', { bars: this.candles.length, older: false });
    } catch (error) {
      if (generation === this.generation)
        this.fail(
          error instanceof DatafeedError ? error : new DatafeedError('loading failed', error),
        );
    }
  }

  private applyRealtime(candle: Candle): void {
    const first = this.candles[0];
    if (first && candle.time < first.time) return; // older than what is loaded: history will bring it
    const last = this.candles[this.candles.length - 1];
    if (!last || candle.time > last.time) {
      if (this.options.fillGaps && last) {
        const filled = fillMissingCandles([last, candle], this.options.interval).slice(1, -1);
        for (const gap of filled) this.appendOrUpdate(gap);
      }
      this.appendOrUpdate(candle);
      this.trimHistory();
    } else {
      // The forming bar is by far the most common case: check it before searching.
      const index =
        candle.time === last.time
          ? this.candles.length - 1
          : indexOfTime(this.candles, candle.time);
      if (index >= 0) this.candles[index] = candle;
      else this.candles = mergeCandles(this.candles, [candle]);
      this.series.update(this.toPoint(candle) as never);
      this.options.volumeSeries?.update(this.toVolume(candle));
    }
    this.emitter.emit('realtime', { candle });
  }

  /** Drops the oldest bars beyond `maxBars` (with 10% slack, so it happens rarely), unless they are visible. */
  private trimHistory(): void {
    const max = this.options.maxBars;
    if (!max || max < 1) return;
    const slack = Math.max(1, Math.floor(max * 0.1));
    const excess = this.candles.length - max;
    if (excess < slack) return;
    const visible = this.chart.timeScale().getVisibleLogicalRange();
    if (visible && visible.from < excess) return; // the user is looking at bars that would go
    this.candles = this.candles.slice(excess);
    this.cursor = Number.NaN;
    this.hasMore = true;
    this.emptyPages = 0;
    this.push();
    this.emitter.emit('historyTrimmed', { bars: excess });
  }

  private appendOrUpdate(candle: Candle): void {
    this.candles.push(candle);
    this.series.update(this.toPoint(candle) as never);
    this.options.volumeSeries?.update(this.toVolume(candle));
  }

  private push(initial = false): void {
    const candles = this.options.fillGaps
      ? fillMissingCandles(this.candles, this.options.interval)
      : this.candles;
    if (this.options.fillGaps) this.candles = candles;
    this.series.setData(candles.map((c) => this.toPoint(c)) as never);
    this.options.volumeSeries?.setData(candles.map((c) => this.toVolume(c)));
    if (initial) this.chart.timeScale().scrollToRealtime();
  }

  private toPoint(c: Candle): unknown {
    const ohlc: readonly SeriesType[] = ['candlestick', 'bar', 'custom'];
    return ohlc.includes(this.series.type) ? c : { time: c.time, value: c.close };
  }

  private toVolume(c: Candle): { time: number; value?: number; color?: string } {
    if (c.volume === undefined) return { time: c.time };
    const colors = this.options.volumeColors ?? {
      up: 'rgba(38, 166, 154, 0.5)',
      down: 'rgba(239, 83, 80, 0.5)',
    };
    return { time: c.time, value: c.volume, color: c.close >= c.open ? colors.up : colors.down };
  }
}

/** Convenience: creates a controller (call `destroy()` when done). */
export function connectDatafeed(
  chart: ChartApi,
  series: SeriesApi,
  options: DatafeedControllerOptions,
): DatafeedController {
  return new DatafeedController(chart, series, options);
}
