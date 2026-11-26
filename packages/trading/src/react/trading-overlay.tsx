import { useEffect, useRef, useState } from 'react';
import type { ChartApi, SeriesApi } from '@market-chart/core';
import { useChart } from '@market-chart/react';
import type { ChartUi } from '@market-chart/ui';
import { createTradingOverlay } from '../overlay.js';
import type { TradingOverlay as Overlay } from '../overlay.js';
import type {
  PriceMarker,
  TradingAlert,
  TradingOrder,
  TradingOverlayOptions,
  TradingPosition,
} from '../types.js';

const CLEARED = {
  onModify: undefined,
  onCancel: undefined,
  onClosePosition: undefined,
  onSelect: undefined,
  onEdit: undefined,
  onHover: undefined,
  onError: undefined,
  labelFormat: undefined,
  tooltip: undefined,
} as const;

export type UseTradingOverlayOptions = Omit<TradingOverlayOptions, 'ui' | 'series'> & {
  readonly ui?: ChartUi | null;
  readonly series?: SeriesApi | null;
};

/**
 * Creates an overlay for `chart` (null until it exists) and destroys it on unmount. It is recreated when the
 * chart, the UI or the series changes; callbacks and other options are applied on every render, so they may
 * be inline functions.
 */
export function useTradingOverlay(
  chart: ChartApi | null,
  options: UseTradingOverlayOptions = {},
): Overlay | null {
  const { ui, series, ...rest } = options;
  const latest = useRef(rest);
  latest.current = rest;
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  useEffect(() => {
    if (!chart || chart.destroyed) return;
    const instance = createTradingOverlay(chart, {
      ...latest.current,
      ...(ui ? { ui } : {}),
      ...(series ? { series } : {}),
    });
    setOverlay(instance);
    return () => {
      instance.destroy();
      setOverlay(null);
    };
  }, [chart, ui, series]);
  useEffect(() => {
    // Callbacks that are no longer passed are removed (React props semantics).
    if (overlay && !overlay.isDestroyed) overlay.setOptions({ ...CLEARED, ...latest.current });
  });
  return overlay;
}

export interface TradingOverlayProps extends UseTradingOverlayOptions {
  /** Default: the chart of the surrounding `<Chart>`. */
  readonly chart?: ChartApi | null;
  readonly orders?: readonly TradingOrder[];
  readonly positions?: readonly TradingPosition[];
  readonly alerts?: readonly TradingAlert[];
  readonly markers?: readonly PriceMarker[];
  /** Receives the overlay (e.g. for imperative realtime updates with `upsertOrder`). */
  readonly onReady?: (overlay: Overlay | null) => void;
}

/**
 * Shows orders, positions, alerts and markers on the chart. Renders nothing itself: the objects are drawn on
 * the chart's canvas. Arrays are applied when their identity changes (pass new arrays to update).
 */
export function TradingOverlay({
  chart: chartProp,
  orders,
  positions,
  alerts,
  markers,
  onReady,
  ...options
}: TradingOverlayProps) {
  const own = useChart();
  const chart = chartProp === undefined ? own : chartProp;
  const overlay = useTradingOverlay(chart, options);
  const ready = useRef(onReady);
  ready.current = onReady;
  useEffect(() => {
    ready.current?.(overlay);
  }, [overlay]);
  useEffect(() => {
    if (overlay && orders) overlay.setOrders(orders);
  }, [overlay, orders]);
  useEffect(() => {
    if (overlay && positions) overlay.setPositions(positions);
  }, [overlay, positions]);
  useEffect(() => {
    if (overlay && alerts) overlay.setAlerts(alerts);
  }, [overlay, alerts]);
  useEffect(() => {
    if (overlay && markers) overlay.setMarkers(markers);
  }, [overlay, markers]);
  return null;
}
