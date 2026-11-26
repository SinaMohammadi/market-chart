/**
 * `@market-chart/datafeed/react` — `<DatafeedSeries>` and `useDatafeed` (client-only entry).
 */
import { useEffect, useRef, useState } from 'react';
import { useChart } from '@market-chart/react';
import type { SeriesApi, SeriesOptionsInput } from '@market-chart/core';
import { DatafeedController } from '../controller.js';
import type { DatafeedControllerOptions, DatafeedStatus } from '../controller.js';
import type { Datafeed, SymbolInfo, Timeframe } from '../types.js';

export interface UseDatafeedOptions extends Omit<
  DatafeedControllerOptions,
  'datafeed' | 'symbol' | 'interval' | 'volumeSeries'
> {
  /** Also show volume in a histogram on this overlay scale id (`null` = no volume). Default `'volume'`. */
  readonly volumeScaleId?: string | null;
}

export interface DatafeedState {
  readonly status: DatafeedStatus;
  readonly symbolInfo: SymbolInfo | null;
  readonly error: unknown;
  readonly series: SeriesApi<'candlestick'> | null;
  readonly controller: DatafeedController | null;
}

/**
 * Adds a candlestick series (and a volume histogram) to the surrounding `<Chart>` and feeds it from the
 * datafeed. Changing `symbol` or `interval` reloads in place.
 */
export function useDatafeed(
  datafeed: Datafeed,
  symbol: string,
  interval: Timeframe,
  options: UseDatafeedOptions = {},
): DatafeedState {
  const chart = useChart();
  const [state, setState] = useState<DatafeedState>({
    status: 'idle',
    symbolInfo: null,
    error: null,
    series: null,
    controller: null,
  });
  const latest = useRef(options);
  latest.current = options;
  const controllerRef = useRef<DatafeedController | null>(null);

  useEffect(() => {
    if (!chart) return;
    const { volumeScaleId = 'volume', ...rest } = latest.current;
    const series = chart.addSeries('candlestick');
    const volume =
      volumeScaleId === null
        ? null
        : chart.addSeries('histogram', {
            priceScaleId: volumeScaleId,
            priceFormat: { type: 'volume' },
            lastValueVisible: false,
            priceLineVisible: false,
          });
    if (volume)
      chart.priceScale(volumeScaleId!).applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    const controller = new DatafeedController(chart, series, {
      ...rest,
      datafeed,
      symbol,
      interval,
      volumeSeries: volume,
    });
    controllerRef.current = controller;
    const sync = (): void =>
      setState({
        status: controller.status,
        symbolInfo: controller.symbolInfo,
        error: null,
        series,
        controller,
      });
    const offs = [
      controller.on('status', sync),
      controller.on('symbolResolved', sync),
      controller.on('error', ({ error }) => setState((s) => ({ ...s, status: 'error', error }))),
    ];
    sync();
    return () => {
      offs.forEach((off) => off());
      controller.destroy();
      controllerRef.current = null;
      if (!chart.destroyed) {
        chart.removeSeries(series);
        if (volume) chart.removeSeries(volume);
      }
    };
    // Symbol and interval changes are applied in place by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart, datafeed]);

  useEffect(() => {
    const controller = controllerRef.current;
    if (controller && (controller.symbol !== symbol || controller.interval !== interval))
      void controller.setSymbol(symbol, interval);
  }, [symbol, interval]);

  return state;
}

export interface DatafeedSeriesProps extends UseDatafeedOptions {
  readonly datafeed: Datafeed;
  readonly symbol: string;
  readonly interval: Timeframe;
  readonly seriesOptions?: SeriesOptionsInput<'candlestick'>;
  readonly onStateChange?: (state: DatafeedState) => void;
}

/** Declarative form of `useDatafeed`. Renders nothing. */
export function DatafeedSeries({
  datafeed,
  symbol,
  interval,
  seriesOptions,
  onStateChange,
  ...options
}: DatafeedSeriesProps): null {
  const state = useDatafeed(datafeed, symbol, interval, options);
  const callback = useRef(onStateChange);
  callback.current = onStateChange;
  useEffect(() => {
    if (state.series && seriesOptions) state.series.applyOptions(seriesOptions);
  }, [state.series, seriesOptions]);
  useEffect(() => {
    callback.current?.(state);
  }, [state]);
  return null;
}
