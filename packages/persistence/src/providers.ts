import type { ChartApi, SeriesApi, Unsubscribe } from '@market-chart/core';
import type { StateProvider } from './chart-persistence.js';
import { PersistenceError } from './types.js';

/**
 * Structural view of `IndicatorManager` (from `@market-chart/indicators`), so this package does not depend
 * on it.
 */
export interface IndicatorManagerLike {
  serialize(): unknown[];
  restore(configs: never, resolveSource: (seriesId: string) => SeriesApi | undefined): unknown;
  clear(): void;
  on(event: 'added' | 'removed' | 'changed', listener: () => void): Unsubscribe;
}

/** Structural view of `DrawingManager` (from `@market-chart/drawing-tools`). */
export interface DrawingManagerLike {
  serialize(): unknown;
  load(
    snapshot: unknown,
    options?: { resolveSeriesId?: (storedId: string) => string | undefined; replace?: boolean },
  ): unknown;
  on(event: 'change', listener: () => void): Unsubscribe;
}

/**
 * Maps a stored series id to a series of the current chart: the same id when it still exists, otherwise the
 * first series (ids are only stable within one page session).
 */
export function defaultSeriesResolver(
  chart: ChartApi,
): (storedId: string) => SeriesApi | undefined {
  return (storedId) => chart.series().find((s) => s.id === storedId) ?? chart.series()[0];
}

export function indicatorsProvider(
  manager: IndicatorManagerLike,
  resolveSource: (storedSeriesId: string) => SeriesApi | undefined,
): StateProvider {
  return {
    capture: () => manager.serialize(),
    restore(data) {
      if (!Array.isArray(data)) throw new PersistenceError('indicators state must be an array');
      manager.clear();
      manager.restore(data as never, resolveSource);
    },
    subscribe(onChange) {
      const offs = (['added', 'removed', 'changed'] as const).map((e) => manager.on(e, onChange));
      return () => offs.forEach((off) => off());
    },
  };
}

export function drawingsProvider(
  manager: DrawingManagerLike,
  resolveSeriesId?: (storedId: string) => string | undefined,
): StateProvider {
  return {
    capture: () => manager.serialize(),
    restore(data) {
      manager.load(data, { replace: true, ...(resolveSeriesId ? { resolveSeriesId } : {}) });
    },
    subscribe: (onChange) => manager.on('change', onChange),
  };
}

/** A provider for arbitrary application state kept in a getter/setter pair (must be plain JSON). */
export function valueProvider<T>(
  get: () => T,
  set: (value: T) => void,
  subscribe?: (onChange: () => void) => Unsubscribe,
): StateProvider {
  return { capture: get, restore: (data) => set(data as T), ...(subscribe ? { subscribe } : {}) };
}
