import type { ChartApi } from '../chart/api.js';
import type { Unsubscribe } from '../model/types.js';

export interface ChartSyncOptions {
  /** Mirror the crosshair (by time) across charts. Default true. */
  crosshair?: boolean;
  /** Keep the visible time range (scroll position and zoom) aligned. Default true. */
  timeRange?: boolean;
}

export interface ChartSync {
  add(chart: ChartApi): void;
  remove(chart: ChartApi): void;
  charts(): readonly ChartApi[];
  setOptions(options: ChartSyncOptions): void;
  destroy(): void;
}

/** Visible ranges closer than this many bars are considered equal (prevents ping-pong between charts). */
const RANGE_TOLERANCE = 1e-3;

/**
 * Keeps several charts in step using only their public APIs.
 *
 * - Crosshair: pointer-driven moves on one chart call `setCrosshairPosition(time)` on the others. Events with
 *   `source: 'api'` are not forwarded, so there are no loops.
 * - Time range: a change of the visible logical range is mapped through time (`logicalToTime` →
 *   `timeToLogical`), so charts with different data (other symbols, gaps) stay aligned by time. Charts whose
 *   range already matches within a tolerance are left alone, which ends the propagation.
 */
export function createChartSync(initial: ChartSyncOptions = {}): ChartSync {
  let options: Required<ChartSyncOptions> = { crosshair: true, timeRange: true, ...initial };
  const entries = new Map<ChartApi, Unsubscribe[]>();

  const others = (chart: ChartApi): ChartApi[] =>
    [...entries.keys()].filter((c) => c !== chart && !c.destroyed);

  const alignTo = (source: ChartApi, target: ChartApi): void => {
    const range = source.timeScale().getVisibleLogicalRange();
    if (!range) return;
    const from = source.timeScale().logicalToTime(range.from);
    const to = source.timeScale().logicalToTime(range.to);
    if (from === null || to === null) return;
    const ts = target.timeScale();
    const tFrom = ts.timeToLogical(from);
    const tTo = ts.timeToLogical(to);
    if (tFrom === null || tTo === null || !(tTo > tFrom)) return;
    const current = ts.getVisibleLogicalRange();
    if (
      current &&
      Math.abs(current.from - tFrom) < RANGE_TOLERANCE &&
      Math.abs(current.to - tTo) < RANGE_TOLERANCE
    )
      return;
    ts.setVisibleLogicalRange({ from: tFrom, to: tTo });
  };

  const attach = (chart: ChartApi): Unsubscribe[] => [
    chart.on('crosshairMove', (e) => {
      if (!options.crosshair || e.source !== 'pointer') return;
      for (const other of others(chart)) {
        if (e.time === null) other.clearCrosshair();
        else other.setCrosshairPosition(e.time);
      }
    }),
    chart.on('visibleRangeChange', () => {
      if (!options.timeRange) return;
      for (const other of others(chart)) alignTo(chart, other);
    }),
    chart.on('destroy', () => sync.remove(chart)),
  ];

  const sync: ChartSync = {
    add(chart) {
      if (entries.has(chart) || chart.destroyed) return;
      const first = [...entries.keys()].find((c) => !c.destroyed);
      entries.set(chart, attach(chart));
      if (first && options.timeRange) alignTo(first, chart);
    },
    remove(chart) {
      const offs = entries.get(chart);
      if (!offs) return;
      entries.delete(chart);
      for (const off of offs) off();
    },
    charts: () => [...entries.keys()],
    setOptions(next) {
      options = { ...options, ...next };
      const first = [...entries.keys()].find((c) => !c.destroyed);
      if (first && options.timeRange) for (const other of others(first)) alignTo(first, other);
    },
    destroy() {
      for (const chart of [...entries.keys()]) sync.remove(chart);
    },
  };
  return sync;
}
