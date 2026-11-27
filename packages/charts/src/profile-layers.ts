import type {
  ChartApi,
  OhlcBar,
  PaneLayerDrawContext,
  SeriesApi,
  TradingSession,
} from '@market-chart/core';
import type {
  MarketProfileOptions,
  TpoSession,
  VolumeProfile,
  VolumeProfileOptions,
} from './profiles.js';
import { computeMarketProfile, computeVolumeProfile, sessions } from './profiles.js';
import type { Trade } from './types.js';
import { ChartsError } from './types.js';

let counter = 0;

/** Cached OHLCV bars of a series, refreshed when its data changes. */
function barSource(chart: ChartApi, series: SeriesApi): { bars(): OhlcBar[]; dispose(): void } {
  let cache: OhlcBar[] | null = null;
  const off = chart.on('dataChanged', (e) => {
    if (e.series === series) cache = null;
  });
  return {
    bars: () =>
      (cache ??= series
        .data()
        .filter((p): p is OhlcBar => typeof (p as OhlcBar).open === 'number')),
    dispose: off,
  };
}

const sessionIds = new WeakMap<TradingSession, number>();
let nextSessionId = 0;

/** Cache-key part for a session: by identity (its holidays are not visible to JSON). */
function sessionId(session: TradingSession | undefined): number {
  if (!session) return 0;
  let id = sessionIds.get(session);
  if (id === undefined) sessionIds.set(session, (id = ++nextSessionId));
  return id;
}

export interface VolumeProfileLayerOptions extends Omit<VolumeProfileOptions, 'from' | 'to'> {
  /**
   * `visible`: one profile of the visible range; `fixed`: `from`–`to`; `session`: one per trading day of
   * `session` (one per UTC day without it).
   */
  readonly mode: 'visible' | 'fixed' | 'session';
  /** Trading days for `mode: 'session'` (see `createTradingSession`). */
  readonly session?: TradingSession;
  readonly from?: number;
  readonly to?: number;
  /** Width of the largest row as a fraction of the available width (default 0.3 for visible mode, 0.9 otherwise). */
  readonly widthRatio?: number;
  readonly placement?: 'right' | 'left';
  readonly upColor?: string;
  readonly downColor?: string;
  readonly pocColor?: string;
  /** Trades for exact buy/sell volume; without them the series' OHLCV bars are used. */
  readonly trades?: readonly Trade[];
}

export interface ProfileHandle<P, O> {
  update(options: Partial<O>): void;
  /** Profiles computed in the last frame. */
  profiles(): readonly P[];
  remove(): void;
}

/**
 * Draws volume profiles on the series' pane (below the series). Recomputes only when the data, the visible
 * range (visible mode) or the options change.
 */
export function addVolumeProfile(
  chart: ChartApi,
  series: SeriesApi,
  initial: VolumeProfileLayerOptions,
): ProfileHandle<VolumeProfile, VolumeProfileLayerOptions> {
  let options = initial;
  if (options.mode === 'fixed' && (options.from === undefined || options.to === undefined)) {
    throw new ChartsError('fixed mode needs from and to');
  }
  const id = `market-chart/volume-profile/${++counter}`;
  const source = barSource(chart, series);
  let cacheKey = '';
  let cached: VolumeProfile[] = [];
  const compute = (from: number, to: number): VolumeProfile[] => {
    const bars = source.bars();
    const key = `${options.mode}|${from}|${to}|${bars.length}|${bars[bars.length - 1]?.close}|${sessionId(options.session)}|${JSON.stringify({ ...options, trades: options.trades?.length, session: undefined })}`;
    if (key === cacheKey) return cached;
    cacheKey = key;
    const input = (f: number, t: number) => ({
      bars,
      trades: options.trades?.filter((x) => x.time >= f && x.time <= t),
    });
    const opts = { rows: options.rows, rowSize: options.rowSize, valueArea: options.valueArea };
    if (options.mode === 'session') {
      cached = sessions(
        bars.filter((b) => b.time >= from && b.time <= to),
        options.session,
      ).flatMap((group) => {
        const f = group[0]!.time;
        const t = group[group.length - 1]!.time;
        const p = computeVolumeProfile(input(f, t + 1), { ...opts, from: f, to: t });
        return p ? [p] : [];
      });
    } else {
      const p = computeVolumeProfile(input(from, to), { ...opts, from, to });
      cached = p ? [p] : [];
    }
    return cached;
  };

  const draw = (c: PaneLayerDrawContext): void => {
    const range = chart.timeScale().getVisibleRange();
    if (!range) return;
    const from = options.mode === 'fixed' ? options.from! : range.from;
    const to = options.mode === 'fixed' ? options.to! : range.to;
    const scaleId = series.options().priceScaleId;
    const ctx = c.ctx;
    const pr = c.pixelRatio;
    const up = options.upColor ?? 'rgba(38, 166, 154, 0.55)';
    const down = options.downColor ?? 'rgba(239, 83, 80, 0.55)';
    for (const profile of compute(from, to)) {
      let left: number;
      let width: number;
      if (options.mode === 'visible') {
        width = c.width * (options.widthRatio ?? 0.3);
        left = options.placement === 'left' ? 0 : c.width - width;
      } else {
        const x0 = c.timeToX(profile.from);
        const x1 = c.timeToX(profile.to);
        if (x0 === null || x1 === null) continue;
        left = x0;
        width = Math.max(4, (x1 - x0) * (options.widthRatio ?? 0.9));
      }
      const max = Math.max(...profile.rows.map((r) => r.volume)) || 1;
      profile.rows.forEach((row, index) => {
        const yTop = c.priceToY(row.high, scaleId);
        const yBottom = c.priceToY(row.low, scaleId);
        if (yTop === null || yBottom === null) return;
        const inValueArea =
          row.low >= profile.valueAreaLow - 1e-9 && row.high <= profile.valueAreaHigh + 1e-9;
        ctx.globalAlpha = inValueArea ? 1 : 0.45;
        const h = Math.max(1, (yBottom - yTop) * pr - 1);
        const buyW = (row.buy / max) * width;
        const sellW = (row.sell / max) * width;
        const rightToLeft = options.mode === 'visible' && options.placement !== 'left';
        const start = rightToLeft ? left + width : left;
        const dir = rightToLeft ? -1 : 1;
        ctx.fillStyle = up;
        ctx.fillRect(Math.min(start, start + dir * buyW) * pr, yTop * pr, buyW * pr, h);
        ctx.fillStyle = down;
        const s2 = start + dir * buyW;
        ctx.fillRect(Math.min(s2, s2 + dir * sellW) * pr, yTop * pr, sellW * pr, h);
        if (index === profile.pocIndex) {
          ctx.globalAlpha = 1;
          ctx.fillStyle = options.pocColor ?? '#fbc02d';
          const y = ((yTop + yBottom) / 2) * pr;
          ctx.fillRect(left * pr, Math.round(y), width * pr, Math.max(1, Math.round(pr)));
        }
      });
      ctx.globalAlpha = 1;
    }
  };

  chart.use({
    id,
    version: '1.0.0',
    install(ctx) {
      ctx.addPaneLayer({
        get pane() {
          return series.options().pane;
        },
        zOrder: 'below',
        draw,
      });
    },
  });
  return {
    update(patch) {
      options = { ...options, ...patch };
      cacheKey = '';
      chart.render();
    },
    profiles: () => cached,
    remove() {
      source.dispose();
      if (!chart.destroyed && chart.hasPlugin(id)) chart.removePlugin(id);
    },
  };
}

export interface MarketProfileLayerOptions extends MarketProfileOptions {
  readonly fontSize?: number;
  readonly pocColor?: string;
  readonly valueAreaColor?: string;
}

const PERIOD_COLORS = [
  '#2962ff',
  '#00bcd4',
  '#26a69a',
  '#8bc34a',
  '#fbc02d',
  '#ff9800',
  '#ef5350',
  '#ab47bc',
];

/**
 * Draws a market profile (TPO letters) for every session, starting at the session's first bar. When rows
 * are too short for letters, small blocks are drawn instead.
 */
export function addMarketProfile(
  chart: ChartApi,
  series: SeriesApi,
  initial: MarketProfileLayerOptions = {},
): ProfileHandle<TpoSession, MarketProfileLayerOptions> {
  let options = initial;
  const id = `market-chart/market-profile/${++counter}`;
  const source = barSource(chart, series);
  let cacheKey = '';
  let cached: TpoSession[] = [];
  const compute = (): TpoSession[] => {
    const bars = source.bars();
    const key = `${bars.length}|${bars[bars.length - 1]?.close}|${sessionId(options.session)}|${JSON.stringify({ ...options, session: undefined })}`;
    if (key !== cacheKey) {
      cacheKey = key;
      cached = computeMarketProfile(bars, options);
    }
    return cached;
  };
  const draw = (c: PaneLayerDrawContext): void => {
    const scaleId = series.options().priceScaleId;
    const ctx = c.ctx;
    const pr = c.pixelRatio;
    const fontSize = options.fontSize ?? 10;
    const letterWidth = fontSize * 0.75;
    for (const session of compute()) {
      const x0 = c.timeToX(session.start);
      if (x0 === null || x0 > c.width) continue;
      const rowHeight = Math.abs(
        (c.priceToY(session.rowSize, scaleId) ?? 0) - (c.priceToY(0, scaleId) ?? 0),
      );
      const useLetters = rowHeight >= fontSize * 0.8;
      ctx.font = `${fontSize * pr}px monospace`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      // Value area band and initial balance marker.
      const vaTop = c.priceToY(session.valueAreaHigh, scaleId);
      const vaBottom = c.priceToY(session.valueAreaLow, scaleId);
      const longest = Math.max(...session.rows.map((r) => r.letters.length));
      if (vaTop !== null && vaBottom !== null) {
        ctx.fillStyle = options.valueAreaColor ?? 'rgba(41, 98, 255, 0.08)';
        ctx.fillRect(x0 * pr, vaTop * pr, longest * letterWidth * pr, (vaBottom - vaTop) * pr);
      }
      const ibTop = c.priceToY(session.initialBalanceHigh, scaleId);
      const ibBottom = c.priceToY(session.initialBalanceLow, scaleId);
      if (ibTop !== null && ibBottom !== null) {
        ctx.fillStyle = '#fbc02d';
        ctx.fillRect((x0 - 3) * pr, ibTop * pr, Math.max(1, 2 * pr), (ibBottom - ibTop) * pr);
      }
      for (const row of session.rows) {
        const yMid = c.priceToY((row.low + row.high) / 2, scaleId);
        if (yMid === null || yMid < -rowHeight || yMid > c.height + rowHeight) continue;
        const isPoc = session.pocPrice >= row.low && session.pocPrice < row.high;
        for (let k = 0; k < row.letters.length; k++) {
          const letter = row.letters[k]!;
          const period = /[A-Z]/.test(letter)
            ? letter.charCodeAt(0) - 65
            : letter.charCodeAt(0) - 97 + 26;
          ctx.fillStyle = isPoc
            ? (options.pocColor ?? '#fbc02d')
            : PERIOD_COLORS[period % PERIOD_COLORS.length]!;
          const x = (x0 + k * letterWidth) * pr;
          if (useLetters) ctx.fillText(letter, x, yMid * pr);
          else
            ctx.fillRect(
              x,
              (yMid - rowHeight / 2) * pr,
              Math.max(1, (letterWidth - 1) * pr),
              Math.max(1, (rowHeight - 1) * pr),
            );
        }
      }
    }
  };
  chart.use({
    id,
    version: '1.0.0',
    install(ctx) {
      ctx.addPaneLayer({
        get pane() {
          return series.options().pane;
        },
        zOrder: 'above',
        draw,
      });
    },
  });
  return {
    update(patch) {
      options = { ...options, ...patch };
      cacheKey = '';
      chart.render();
    },
    profiles: () => cached,
    remove() {
      source.dispose();
      if (!chart.destroyed && chart.hasPlugin(id)) chart.removePlugin(id);
    },
  };
}
