import { createContext } from 'react';
import type { ChartApi, ChartSync } from '@market-chart/core';

/** The chart owned by the nearest `<Chart>`; null until it has mounted on the client. */
export const ChartContext = createContext<ChartApi | null>(null);

/** Charts registered in the nearest `<ChartProvider>`, by `chartId`. */
export const ChartRegistryContext = createContext<ReadonlyMap<string, ChartApi> | null>(null);

/** Sync group of the nearest `<ChartLayout>`; charts inside join it automatically (unless `sync={false}`). */
export const ChartSyncContext = createContext<ChartSync | null>(null);

export type RegisterChart = (id: string, chart: ChartApi) => () => void;

/**
 * Stable registration callback of the nearest `<ChartProvider>`. Kept in its own context so that
 * registering (which changes the map) never re-triggers the registering effect.
 */
export const ChartRegisterContext = createContext<RegisterChart | null>(null);
