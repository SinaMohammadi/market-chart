import { useContext, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type {
  ChartApi,
  ChartEventMap,
  ChartEventName,
  CrosshairMoveEvent,
  LogicalRange,
  Size,
  TimeRange,
} from '@market-chart/core';
import { ChartContext, ChartRegistryContext } from './context.js';

/**
 * The chart of the surrounding `<Chart>`, or — with an id — a chart registered in `<ChartProvider>`.
 * Null during SSR and before mount.
 */
export function useChart(chartId?: string): ChartApi | null {
  const own = useContext(ChartContext);
  const registry = useContext(ChartRegistryContext);
  if (chartId === undefined) return own;
  return registry?.get(chartId) ?? null;
}

/** Subscribes to a chart event for the component's lifetime. The handler may change between renders. */
export function useChartEvent<K extends ChartEventName>(
  event: K,
  handler: (payload: ChartEventMap[K]) => void,
  chart: ChartApi | null = null,
): void {
  const contextChart = useContext(ChartContext);
  const target = chart ?? contextChart;
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    if (!target) return;
    return target.on(event, (payload) => latest.current(payload));
  }, [target, event]);
}

/**
 * Subscribes a component to chart events with `useSyncExternalStore` (tearing-free in concurrent React).
 * `read` derives the snapshot from the chart and the event payload (undefined for the initial read).
 */
function useChartStore<T>(
  chart: ChartApi | null,
  eventsKey: string,
  read: (chart: ChartApi, payload: unknown) => T,
  initial: T,
): T {
  const cache = useRef<{ chart: ChartApi | null; value: T }>({ chart: null, value: initial });
  const readRef = useRef(read);
  readRef.current = read;
  const subscribe = useMemo(
    () =>
      (onChange: () => void): (() => void) => {
        if (!chart || chart.destroyed) return () => undefined;
        const offs = eventsKey.split('|').map((event) =>
          chart.on(event as ChartEventName, (payload: unknown) => {
            cache.current = { chart, value: readRef.current(chart, payload) };
            onChange();
          }),
        );
        return () => offs.forEach((off) => off());
      },
    [chart, eventsKey],
  );
  const getSnapshot = (): T => {
    if (cache.current.chart !== chart) {
      cache.current = {
        chart,
        value: chart && !chart.destroyed ? readRef.current(chart, undefined) : initial,
      };
    }
    return cache.current.value;
  };
  return useSyncExternalStore(subscribe, getSnapshot, () => initial);
}

/** Latest crosshair event, or null when hidden. Re-renders on every pointer move: keep the consumer small. */
export function useCrosshair(chart?: ChartApi | null): CrosshairMoveEvent | null {
  const contextChart = useContext(ChartContext);
  const target = chart === undefined ? contextChart : chart;
  return useChartStore<CrosshairMoveEvent | null>(
    target,
    'crosshairMove',
    (_c, payload) => {
      const event = payload as CrosshairMoveEvent | undefined;
      return event && event.time !== null ? event : null;
    },
    null,
  );
}

export interface ChartViewState {
  readonly visibleLogicalRange: LogicalRange | null;
  readonly visibleTimeRange: TimeRange | null;
  readonly size: Size;
}

const EMPTY_VIEW: ChartViewState = {
  visibleLogicalRange: null,
  visibleTimeRange: null,
  size: { width: 0, height: 0 },
};

/** Visible range and size, updated when they change. */
export function useChartState(chart?: ChartApi | null): ChartViewState {
  const contextChart = useContext(ChartContext);
  const target = chart === undefined ? contextChart : chart;
  return useChartStore<ChartViewState>(
    target,
    'visibleRangeChange|resize',
    (c) => ({
      visibleLogicalRange: c.timeScale().getVisibleLogicalRange(),
      visibleTimeRange: c.timeScale().getVisibleRange(),
      size: c.size(),
    }),
    EMPTY_VIEW,
  );
}
