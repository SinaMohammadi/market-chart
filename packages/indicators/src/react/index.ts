/**
 * `@market-chart/indicators/react` — React bindings (client-only entry).
 * Use inside `<Chart>` from `@market-chart/react`.
 */
import { useEffect, useRef, useState } from 'react';
import { useChart } from '@market-chart/react';
import type { ChartApi, SeriesApi } from '@market-chart/core';
import { getIndicatorManager } from '../chart/indicator-manager.js';
import type {
  IndicatorHandle,
  IndicatorManager,
  IndicatorStyle,
} from '../chart/indicator-manager.js';

/** The indicator manager of the surrounding `<Chart>` (or of `chart`). Null before mount. */
export function useIndicatorManager(chart?: ChartApi | null): IndicatorManager | null {
  const contextChart = useChart();
  const target = chart === undefined ? contextChart : chart;
  return target && !target.destroyed ? getIndicatorManager(target) : null;
}

export interface UseIndicatorOptions {
  params?: Readonly<Record<string, unknown>>;
  style?: IndicatorStyle;
  visible?: boolean;
}

function stableKey(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/**
 * Adds indicator `type` computed from `source` for the component's lifetime.
 * Parameter/style/visibility changes are applied in place (no re-creation); compared by value.
 */
export function useIndicator(
  type: string,
  source: SeriesApi | null,
  options: UseIndicatorOptions = {},
): IndicatorHandle | null {
  const manager = useIndicatorManager();
  const [handle, setHandle] = useState<IndicatorHandle | null>(null);
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    if (!manager || !source) return;
    const created = manager.add(type, source, latest.current);
    setHandle(created);
    return () => {
      if (!created.removed) created.remove();
      setHandle(null);
    };
  }, [manager, source, type]);

  const paramsKey = stableKey(options.params);
  const styleKey = stableKey(options.style);
  const applied = useRef<{
    handle: IndicatorHandle | null;
    params: string;
    style: string;
    visible: boolean | undefined;
  }>({
    handle: null,
    params: paramsKey,
    style: styleKey,
    visible: options.visible,
  });
  useEffect(() => {
    if (!handle) return;
    const state = applied.current;
    if (state.handle !== handle) {
      applied.current = {
        handle,
        params: paramsKey,
        style: styleKey,
        visible: latest.current.visible,
      };
      return;
    }
    if (state.params !== paramsKey && latest.current.params)
      handle.setParams(latest.current.params);
    if (state.style !== styleKey && latest.current.style) handle.setStyle(latest.current.style);
    if (state.visible !== latest.current.visible && latest.current.visible !== undefined)
      handle.setVisible(latest.current.visible);
    applied.current = {
      handle,
      params: paramsKey,
      style: styleKey,
      visible: latest.current.visible,
    };
  }, [handle, paramsKey, styleKey, options.visible]);

  return handle;
}

export interface IndicatorProps extends UseIndicatorOptions {
  type: string;
  source: SeriesApi | null;
  /** Receives the handle once created (and null on removal). */
  onReady?: (indicator: IndicatorHandle | null) => void;
}

/** Declarative form of `useIndicator`. Renders nothing. */
export function Indicator({ type, source, onReady, ...options }: IndicatorProps): null {
  const handle = useIndicator(type, source, options);
  const callback = useRef(onReady);
  callback.current = onReady;
  useEffect(() => {
    callback.current?.(handle);
  }, [handle]);
  return null;
}
