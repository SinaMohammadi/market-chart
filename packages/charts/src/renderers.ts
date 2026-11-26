import type {
  ChartApi,
  CustomSeriesData,
  CustomSeriesOptions,
  CustomSeriesPaintContext,
  CustomSeriesView,
  LinePoint,
  OhlcBar,
  SeriesApi,
  SeriesOptionsInput,
} from '@market-chart/core';
import type {
  KagiColumn,
  KagiOptions,
  PointFigureColumn,
  PointFigureOptions,
} from './transforms.js';
import { kagi, pointAndFigure } from './transforms.js';
import type { FootprintBar, OrderBookSnapshot } from './types.js';

type Params = Readonly<Record<string, unknown>>;

function param<T>(options: Readonly<CustomSeriesOptions>, key: string, fallback: T): T {
  const value = (options.params as Params)[key];
  return value === undefined ? fallback : (value as T);
}

function bodyWidth(c: CustomSeriesPaintContext, ratio = 0.8): number {
  return Math.max(1, Math.floor(c.barSpacing * c.pixelRatio * ratio));
}

function wick(c: CustomSeriesPaintContext, i: number, color: string): void {
  const x = Math.round(c.x(i));
  const top = Math.round(c.y(c.data.high(i)));
  const bottom = Math.round(c.y(c.data.low(i)));
  const w = Math.max(1, Math.floor(c.pixelRatio));
  c.ctx.fillStyle = color;
  c.ctx.fillRect(
    x - Math.floor(w / 2),
    Math.min(top, bottom),
    w,
    Math.max(1, Math.abs(bottom - top)),
  );
}

/**
 * Hollow candles: the body is hollow when close > open and filled otherwise; the colour compares the close
 * with the previous close (up colour when it rose).
 */
export function hollowCandlesView(): CustomSeriesView {
  return {
    kind: 'ohlc',
    color: (data, i, o) => (i > 0 && data.close(i) < data.close(i - 1) ? o.downColor : o.upColor),
    paint(c) {
      const { ctx, data, options: o } = c;
      const w = bodyWidth(c);
      const border = Math.max(1, Math.floor(c.pixelRatio));
      for (let i = c.from; i <= c.to; i++) {
        const prev = i > 0 ? data.close(i - 1) : data.open(i);
        const color = data.close(i) >= prev ? o.upColor : o.downColor;
        wick(c, i, color);
        const x = Math.round(c.x(i)) - Math.floor(w / 2);
        const yo = Math.round(c.y(data.open(i)));
        const yc = Math.round(c.y(data.close(i)));
        const top = Math.min(yo, yc);
        const h = Math.max(1, Math.abs(yc - yo));
        ctx.fillStyle = color;
        if (data.close(i) > data.open(i) && w > border * 2 && h > border * 2) {
          // Hollow body: outline only, so the background and grid show through.
          ctx.fillRect(x, top, w, border);
          ctx.fillRect(x, top + h - border, w, border);
          ctx.fillRect(x, top, border, h);
          ctx.fillRect(x + w - border, top, border, h);
        } else ctx.fillRect(x, top, w, h);
      }
    },
  };
}

/** Candles whose width is proportional to volume (relative to the largest visible volume). */
export function volumeCandlesView(): CustomSeriesView {
  return {
    kind: 'ohlc',
    paint(c) {
      const { ctx, data, options: o } = c;
      let max = 0;
      for (let i = c.from; i <= c.to; i++) if (data.volume(i) > max) max = data.volume(i);
      const full = c.barSpacing * c.pixelRatio * 0.95;
      for (let i = c.from; i <= c.to; i++) {
        const color = data.close(i) >= data.open(i) ? o.upColor : o.downColor;
        wick(c, i, color);
        const v = data.volume(i);
        const w = Math.max(
          1,
          Math.round(max > 0 && Number.isFinite(v) ? (full * v) / max : full * 0.5),
        );
        const yo = Math.round(c.y(data.open(i)));
        const yc = Math.round(c.y(data.close(i)));
        ctx.fillStyle = color;
        ctx.fillRect(
          Math.round(c.x(i) - w / 2),
          Math.min(yo, yc),
          w,
          Math.max(1, Math.abs(yc - yo)),
        );
      }
    },
  };
}

/** Data envelope (for the time axis, scaling and crosshair) of Kagi columns. */
export function kagiEnvelope(columns: readonly KagiColumn[]): OhlcBar[] {
  return columns.map((c) => ({
    time: c.time,
    open: c.start,
    close: c.end,
    high: Math.max(c.start, c.end),
    low: Math.min(c.start, c.end),
  }));
}

export interface KagiView extends CustomSeriesView {
  setColumns(columns: readonly KagiColumn[]): void;
}

/** Kagi renderer: thick yang lines (up colour), thin yin lines (down colour), shoulders and waists joined. */
export function kagiView(): KagiView {
  let byTime = new Map<number, KagiColumn>();
  return {
    kind: 'ohlc',
    setColumns(columns) {
      byTime = new Map(columns.map((c) => [c.time, c]));
    },
    color(data, i, o) {
      const column = byTime.get(data.time(i));
      const yangNow = column
        ? column.switchPrice === null
          ? column.yangAtStart
          : !column.yangAtStart
        : true;
      return yangNow ? o.upColor : o.downColor;
    },
    paint(c) {
      const { ctx, data, options: o, pixelRatio: pr } = c;
      const thick = Math.max(2, Math.round(3 * pr));
      const thin = Math.max(1, Math.round(pr));
      const segment = (x0: number, y0: number, x1: number, y1: number, yang: boolean): void => {
        ctx.strokeStyle = yang ? o.upColor : o.downColor;
        ctx.lineWidth = yang ? thick : thin;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      };
      ctx.lineCap = 'square';
      for (let i = c.from; i <= c.to; i++) {
        const column = byTime.get(data.time(i));
        if (!column) continue;
        const x = c.x(i);
        const yStart = c.y(column.start);
        const yEnd = c.y(column.end);
        if (i > 0) {
          const prev = byTime.get(data.time(i - 1));
          if (prev) segment(c.x(i - 1), yStart, x, yStart, column.yangAtStart);
        }
        if (column.switchPrice === null) segment(x, yStart, x, yEnd, column.yangAtStart);
        else {
          const ySwitch = c.y(column.switchPrice);
          segment(x, yStart, x, ySwitch, column.yangAtStart);
          segment(x, ySwitch, x, yEnd, !column.yangAtStart);
        }
      }
    },
  };
}

export function pointFigureEnvelope(columns: readonly PointFigureColumn[]): OhlcBar[] {
  return columns.map((c) => {
    const low = c.low - c.boxSize / 2;
    const high = c.high + c.boxSize / 2;
    return c.direction === 'X'
      ? { time: c.time, open: low, high, low, close: high }
      : { time: c.time, open: high, high, low, close: low };
  });
}

export interface PointFigureView extends CustomSeriesView {
  setColumns(columns: readonly PointFigureColumn[]): void;
}

/** Point & Figure renderer: one X or O per box. */
export function pointFigureView(): PointFigureView {
  let byTime = new Map<number, PointFigureColumn>();
  return {
    kind: 'ohlc',
    setColumns(columns) {
      byTime = new Map(columns.map((c) => [c.time, c]));
    },
    paint(c) {
      const { ctx, data, options: o, pixelRatio: pr } = c;
      ctx.lineWidth = Math.max(1, Math.round(1.5 * pr));
      for (let i = c.from; i <= c.to; i++) {
        const column = byTime.get(data.time(i));
        if (!column) continue;
        const boxPx = Math.abs(c.y(column.low) - c.y(column.low + column.boxSize));
        const size = Math.max(2, Math.min(c.barSpacing * pr * 0.8, boxPx * 0.9)) / 2;
        const x = c.x(i);
        ctx.strokeStyle = column.direction === 'X' ? o.upColor : o.downColor;
        ctx.beginPath();
        const boxes = Math.round((column.high - column.low) / column.boxSize);
        for (let k = 0; k <= boxes; k++) {
          const y = c.y(column.low + k * column.boxSize);
          if (column.direction === 'X') {
            ctx.moveTo(x - size, y - size);
            ctx.lineTo(x + size, y + size);
            ctx.moveTo(x + size, y - size);
            ctx.lineTo(x - size, y + size);
          } else {
            ctx.moveTo(x + size, y);
            ctx.arc(x, y, size, 0, Math.PI * 2);
          }
        }
        ctx.stroke();
      }
    },
  };
}

export interface FootprintView extends CustomSeriesView {
  setBars(bars: readonly FootprintBar[]): void;
}

const IMBALANCE_RATIO = 3;

/**
 * Footprint renderer. Wide bars show `bid × ask` per price with diagonal imbalances highlighted
 * (ask at a price ≥ 3× the bid one tick below, and vice versa); narrow bars show a delta-coloured volume
 * profile next to a thin candle. The point of control (largest volume) of each bar is outlined.
 */
export function footprintView(options: { readonly tickSize: number }): FootprintView {
  let byTime = new Map<number, FootprintBar>();
  return {
    kind: 'ohlc',
    setBars(bars) {
      byTime = new Map(bars.map((b) => [b.time, b]));
    },
    paint(c) {
      const { ctx, data, options: o, pixelRatio: pr } = c;
      const tick = options.tickSize;
      const widthPx = c.barSpacing * pr * 0.9;
      const detailed = c.barSpacing >= 70;
      const font = Math.max(8, Math.min(11, Math.floor(c.barSpacing / 9))) * pr;
      for (let i = c.from; i <= c.to; i++) {
        const bar = byTime.get(data.time(i));
        if (!bar || !bar.levels.length) continue;
        const x = c.x(i);
        const left = x - widthPx / 2;
        const maxVolume = Math.max(...bar.levels.map((l) => l.bid + l.ask));
        const poc = bar.levels.reduce(
          (best, l) => (l.bid + l.ask > best.bid + best.ask ? l : best),
          bar.levels[0]!,
        );
        const byPrice = new Map(bar.levels.map((l) => [Math.round(l.price / tick), l]));
        for (const level of bar.levels) {
          const yTop = c.y(level.price + tick / 2);
          const yBottom = c.y(level.price - tick / 2);
          const h = Math.max(1, yBottom - yTop - 1);
          const total = level.bid + level.ask;
          const delta = level.ask - level.bid;
          const strength = maxVolume > 0 ? total / maxVolume : 0;
          ctx.globalAlpha = 0.25 + 0.6 * strength;
          ctx.fillStyle = delta >= 0 ? o.upColor : o.downColor;
          if (detailed) ctx.fillRect(left, yTop, widthPx, h);
          else ctx.fillRect(x + 2 * pr, yTop, Math.max(1, (widthPx / 2 - 2 * pr) * strength), h);
          ctx.globalAlpha = 1;
          if (detailed && h >= font) {
            const below = byPrice.get(Math.round(level.price / tick) - 1);
            const above = byPrice.get(Math.round(level.price / tick) + 1);
            const buyImbalance =
              below !== undefined && level.ask >= IMBALANCE_RATIO * Math.max(below.bid, 1e-9);
            const sellImbalance =
              above !== undefined && level.bid >= IMBALANCE_RATIO * Math.max(above.ask, 1e-9);
            ctx.font = `${font}px sans-serif`;
            ctx.textBaseline = 'middle';
            const yMid = (yTop + yBottom) / 2;
            ctx.textAlign = 'right';
            ctx.fillStyle = sellImbalance ? o.downColor : '#d1d4dc';
            ctx.fillText(formatSize(level.bid), x - 3 * pr, yMid);
            ctx.textAlign = 'left';
            ctx.fillStyle = buyImbalance ? o.upColor : '#d1d4dc';
            ctx.fillText(formatSize(level.ask), x + 3 * pr, yMid);
          }
          if (level === poc) {
            ctx.strokeStyle = param(o, 'pocColor', '#fbc02d');
            ctx.lineWidth = Math.max(1, pr);
            ctx.strokeRect(
              detailed ? left : x + 2 * pr,
              yTop,
              detailed ? widthPx : (widthPx / 2 - 2 * pr) * strength,
              h,
            );
          }
        }
        if (!detailed) {
          const color = bar.close >= bar.open ? o.upColor : o.downColor;
          wick(c, i, color);
          const yo = Math.round(c.y(bar.open));
          const yc = Math.round(c.y(bar.close));
          ctx.fillStyle = color;
          ctx.fillRect(
            Math.round(x - 2 * pr),
            Math.min(yo, yc),
            Math.max(1, Math.round(3 * pr)),
            Math.max(1, Math.abs(yc - yo)),
          );
        }
      }
    },
  };
}

function formatSize(v: number): string {
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e4) return `${(v / 1e3).toFixed(0)}K`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v >= 10 ? v.toFixed(0) : String(Number(v.toFixed(2)));
}

export interface HeatmapView extends CustomSeriesView {
  setSnapshots(snapshots: readonly OrderBookSnapshot[]): void;
}

/** Colour ramp from deep blue (little liquidity) through cyan and yellow to white (most liquidity). */
export function heatColor(t: number): string {
  const stops: [number, number, number][] = [
    [8, 14, 60],
    [0, 120, 200],
    [0, 200, 200],
    [250, 220, 40],
    [255, 255, 255],
  ];
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const [a, b] = [stops[i]!, stops[i + 1]!];
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)}, ${Math.round(a[1] + (b[1] - a[1]) * f)}, ${Math.round(a[2] + (b[2] - a[2]) * f)})`;
}

/** Mid price of each snapshot: the data envelope of the heatmap series. */
export function heatmapEnvelope(snapshots: readonly OrderBookSnapshot[]): LinePoint[] {
  return snapshots.map((s) => ({
    time: s.time,
    value: ((s.bids[0]?.[0] ?? s.asks[0]?.[0] ?? 0) + (s.asks[0]?.[0] ?? s.bids[0]?.[0] ?? 0)) / 2,
  }));
}

/**
 * Liquidity heatmap: resting size per price level and time, coloured relative to the largest visible size,
 * with the mid price drawn on top.
 */
export function heatmapView(options: { readonly priceStep: number }): HeatmapView {
  let byTime = new Map<number, OrderBookSnapshot>();
  const visibleLevels = (
    data: CustomSeriesData,
    from: number,
    to: number,
  ): { min: number; max: number; maxSize: number } => {
    let min = Infinity;
    let max = -Infinity;
    let maxSize = 0;
    for (let i = from; i <= to; i++) {
      const s = byTime.get(data.time(i));
      if (!s) continue;
      for (const [price, size] of [...s.bids, ...s.asks]) {
        min = Math.min(min, price);
        max = Math.max(max, price);
        maxSize = Math.max(maxSize, size);
      }
    }
    return { min, max, maxSize };
  };
  return {
    kind: 'value',
    setSnapshots(snapshots) {
      byTime = new Map(snapshots.map((s) => [s.time, s]));
    },
    autoscale(data, from, to) {
      const { min, max } = visibleLevels(data, from, to);
      return min <= max ? { min, max } : null;
    },
    paint(c) {
      const { ctx, data, options: o, pixelRatio: pr } = c;
      const { maxSize } = visibleLevels(data, c.from, c.to);
      const w = Math.max(1, Math.ceil(c.barSpacing * pr));
      for (let i = c.from; i <= c.to; i++) {
        const s = byTime.get(data.time(i));
        if (!s) continue;
        const x = Math.round(c.x(i) - w / 2);
        for (const [price, size] of [...s.bids, ...s.asks]) {
          const yTop = Math.round(c.y(price + options.priceStep / 2));
          const yBottom = Math.round(c.y(price - options.priceStep / 2));
          ctx.fillStyle = heatColor(maxSize > 0 ? Math.sqrt(size / maxSize) : 0);
          ctx.fillRect(x, yTop, w, Math.max(1, yBottom - yTop));
        }
      }
      ctx.strokeStyle = o.color;
      ctx.lineWidth = Math.max(1, Math.round(1.5 * pr));
      ctx.beginPath();
      let started = false;
      for (let i = c.from; i <= c.to; i++) {
        const v = data.value(i);
        if (!Number.isFinite(v)) {
          started = false;
          continue;
        }
        if (started) ctx.lineTo(c.x(i), c.y(v));
        else ctx.moveTo(c.x(i), c.y(v));
        started = true;
      }
      ctx.stroke();
    },
  };
}

// ───────────────────────────── one-call helpers ─────────────────────────────

type CustomOptions = SeriesOptionsInput<'custom'>;

export interface DerivedSeries<I> {
  readonly series: SeriesApi<'custom'>;
  /** Recomputes from new input (realtime: call again with the updated input; O(n)). */
  setData(input: I): void;
}

export function addHollowCandleSeries(
  chart: ChartApi,
  options?: CustomOptions,
): SeriesApi<'custom'> {
  return chart.addCustomSeries(hollowCandlesView(), options);
}

export function addVolumeCandleSeries(
  chart: ChartApi,
  options?: CustomOptions,
): SeriesApi<'custom'> {
  return chart.addCustomSeries(volumeCandlesView(), options);
}

export function addKagiSeries(
  chart: ChartApi,
  kagiOptions: KagiOptions,
  options?: CustomOptions,
): DerivedSeries<readonly OhlcBar[]> {
  const view = kagiView();
  const series = chart.addCustomSeries(view, { priceLineVisible: false, ...options });
  return {
    series,
    setData(bars) {
      const columns = kagi(bars, kagiOptions);
      view.setColumns(columns);
      series.setData(kagiEnvelope(columns));
    },
  };
}

export function addPointFigureSeries(
  chart: ChartApi,
  pfOptions: PointFigureOptions,
  options?: CustomOptions,
): DerivedSeries<readonly OhlcBar[]> {
  const view = pointFigureView();
  const series = chart.addCustomSeries(view, { priceLineVisible: false, ...options });
  return {
    series,
    setData(bars) {
      const columns = pointAndFigure(bars, pfOptions);
      view.setColumns(columns);
      series.setData(pointFigureEnvelope(columns));
    },
  };
}

export function addFootprintSeries(
  chart: ChartApi,
  footprintOptions: { readonly tickSize: number },
  options?: CustomOptions,
): DerivedSeries<readonly FootprintBar[]> {
  const view = footprintView(footprintOptions);
  const series = chart.addCustomSeries(view, options);
  return {
    series,
    setData(bars) {
      view.setBars(bars);
      series.setData(
        bars.map(({ time, open, high, low, close, volume }) => ({
          time,
          open,
          high,
          low,
          close,
          volume,
        })),
      );
    },
  };
}

export function addHeatmapSeries(
  chart: ChartApi,
  heatmapOptions: { readonly priceStep: number },
  options?: CustomOptions,
): DerivedSeries<readonly OrderBookSnapshot[]> {
  const view = heatmapView(heatmapOptions);
  const series = chart.addCustomSeries(view, {
    color: '#ffffff',
    priceLineVisible: false,
    ...options,
  });
  return {
    series,
    setData(snapshots) {
      view.setSnapshots(snapshots);
      series.setData(heatmapEnvelope(snapshots));
    },
  };
}
