import type { ChartApi, SeriesApi, SeriesOptionsInput, TradingSession } from '@market-chart/core';
import { DatafeedController } from './controller.js';
import type { DatafeedControllerOptions, DatafeedStatus } from './controller.js';
import type { Datafeed, SymbolInfo, Timeframe } from './types.js';

export interface DatafeedSeriesOptions extends Omit<
  DatafeedControllerOptions,
  'datafeed' | 'symbol' | 'interval' | 'volumeSeries'
> {
  /** Also show volume in a histogram on this overlay scale id (`null` = no volume). Default `'volume'`. */
  readonly volumeScaleId?: string | null;
  /** Options of the candlestick series. */
  readonly seriesOptions?: SeriesOptionsInput<'candlestick'>;
  /** Called on every status, symbol and error change. */
  readonly onStateChange?: (state: DatafeedState) => void;
}

export interface DatafeedState {
  readonly status: DatafeedStatus;
  readonly symbolInfo: SymbolInfo | null;
  readonly error: unknown;
  readonly series: SeriesApi<'candlestick'> | null;
  readonly controller: DatafeedController | null;
}

/** The series and controller added to a chart by `attachDatafeed`. */
export interface DatafeedAttachment {
  readonly series: SeriesApi<'candlestick'>;
  readonly volume: SeriesApi<'histogram'> | null;
  readonly controller: DatafeedController;
  /** Current state (also reported through `onStateChange`). */
  state(): DatafeedState;
  /** Loads another symbol or interval into the same series. */
  update(request: { readonly symbol: string; readonly interval: Timeframe }): void;
  /** Stops the controller and removes the series it added. */
  destroy(): void;
}

/**
 * Adds a candlestick series (and a volume histogram) to `chart` and feeds them from `datafeed`. Used by
 * `datafeedSource`, `useDatafeed` and `<DatafeedSeries>`.
 */
export function attachDatafeed(
  chart: ChartApi,
  datafeed: Datafeed,
  request: { readonly symbol: string; readonly interval: Timeframe },
  options: DatafeedSeriesOptions = {},
): DatafeedAttachment {
  const { volumeScaleId = 'volume', seriesOptions, onStateChange, ...rest } = options;
  const series = chart.addSeries('candlestick', seriesOptions);
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
    symbol: request.symbol,
    interval: request.interval,
    volumeSeries: volume,
  });
  let current: DatafeedState = {
    status: controller.status,
    symbolInfo: controller.symbolInfo,
    error: null,
    series,
    controller,
  };
  const report = (next: DatafeedState): void => {
    current = next;
    onStateChange?.(next);
  };
  const sync = (): void =>
    report({
      status: controller.status,
      symbolInfo: controller.symbolInfo,
      error: null,
      series,
      controller,
    });
  const offs = [
    controller.on('status', sync),
    controller.on('symbolResolved', sync),
    controller.on('error', ({ error }) => report({ ...current, status: 'error', error })),
  ];
  let destroyed = false;
  return {
    series,
    volume,
    controller,
    state: () => current,
    update: ({ symbol, interval }) => {
      if (destroyed || (controller.symbol === symbol && controller.interval === interval)) return;
      void controller.setSymbol(symbol, interval);
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      offs.forEach((off) => off());
      controller.destroy();
      if (!chart.destroyed) {
        chart.removeSeries(series);
        if (volume) chart.removeSeries(volume);
      }
    },
  };
}

/**
 * A data source for `<Chart dataSource symbol interval>` from `@market-chart/react`:
 *
 * ```tsx
 * const source = useMemo(() => datafeedSource(feed), [feed]);
 * <Chart dataSource={source} symbol="BTCUSDT" interval="1h" />
 * ```
 *
 * Each connected chart gets a candlestick series (and volume) fed by a `DatafeedController`; changing the
 * symbol or interval reloads in place.
 */
export function datafeedSource(
  datafeed: Datafeed,
  options: DatafeedSeriesOptions = {},
): {
  connect(
    chart: ChartApi,
    request: { readonly symbol: string; readonly interval: string },
  ): DatafeedAttachment;
} {
  return { connect: (chart, request) => attachDatafeed(chart, datafeed, request, options) };
}

/**
 * The controller's trading session as a `ChartUi` capability (`capabilities.session`), so the UI keeps the
 * indicators' session and the user's session time zone in step with the symbol.
 */
export function datafeedSession(controller: DatafeedController): {
  value(): TradingSession | null;
  subscribe(listener: () => void): () => void;
} {
  return {
    value: () => controller.session,
    subscribe: (listener) => controller.on('sessionChange', () => listener()),
  };
}
