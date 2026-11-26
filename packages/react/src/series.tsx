import { forwardRef, useContext, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { ForwardedRef, ReactNode, Ref } from 'react';
import type { SeriesApi, SeriesData, SeriesOptionsInput, SeriesType } from '@market-chart/core';
import { ChartContext } from './context.js';
import { applySeriesData } from './data-diff.js';

export interface SeriesProps<T extends SeriesType> {
  type: T;
  /** Series data sorted by time. Immutable appends/last-bar replacements are applied incrementally. */
  data?: readonly SeriesData<T>[];
  /** Series options. Pass a stable (memoised) object; a new identity re-applies the options. */
  options?: SeriesOptionsInput<T>;
  children?: ReactNode;
}

/**
 * Hook form of `<Series>`: adds a series to the surrounding `<Chart>` for the component's lifetime.
 * Returns the series API (null until the chart has mounted).
 */
export function useSeries<T extends SeriesType>(
  type: T,
  data?: readonly SeriesData<T>[],
  options?: SeriesOptionsInput<T>,
): SeriesApi<T> | null {
  const chart = useContext(ChartContext);
  const [series, setSeries] = useState<SeriesApi<T> | null>(null);
  const initialOptions = useRef(options);
  initialOptions.current = options;

  useEffect(() => {
    if (!chart) return;
    const created = chart.addSeries(type, initialOptions.current);
    setSeries(created);
    return () => {
      if (!chart.destroyed && chart.series().includes(created)) chart.removeSeries(created);
      setSeries(null);
    };
  }, [chart, type]);

  // What has been pushed into which series instance. A new instance (type change, remount) starts empty.
  const applied = useRef<{
    series: SeriesApi<T> | null;
    options: SeriesOptionsInput<T> | undefined;
    data: readonly SeriesData<T>[] | undefined;
  }>({ series: null, options: undefined, data: undefined });

  useEffect(() => {
    if (!series) return;
    const state = applied.current;
    if (state.series !== series) {
      // Creation already used the current options.
      applied.current = { series, options, data: undefined };
      return;
    }
    if (state.options === options) return;
    state.options = options;
    if (options) series.applyOptions(options);
  }, [series, options]);

  useEffect(() => {
    if (!series || !data) return;
    const state = applied.current;
    applySeriesData(series, state.series === series ? state.data : undefined, data);
    applied.current = { ...state, series, data };
  }, [series, data]);

  return series;
}

function SeriesInner<T extends SeriesType>(
  { type, data, options, children }: SeriesProps<T>,
  ref: ForwardedRef<SeriesApi<T> | null>,
) {
  const series = useSeries(type, data, options);
  useImperativeHandle(ref, () => series as SeriesApi<T>, [series]);
  return <>{children}</>;
}

/** Declarative series. Use the typed aliases (`<CandlestickSeries>` …) for better inference. */
export const Series = forwardRef(SeriesInner) as <T extends SeriesType>(
  props: SeriesProps<T> & { ref?: Ref<SeriesApi<T> | null> },
) => ReturnType<typeof SeriesInner>;

type TypedSeriesProps<T extends SeriesType> = Omit<SeriesProps<T>, 'type'> & {
  ref?: Ref<SeriesApi<T> | null>;
};

function typed<T extends SeriesType>(type: T, displayName: string) {
  const component = forwardRef<SeriesApi<T> | null, Omit<SeriesProps<T>, 'type'>>((props, ref) => (
    <Series<T> {...props} type={type} ref={ref} />
  ));
  component.displayName = displayName;
  return component as unknown as (props: TypedSeriesProps<T>) => ReturnType<typeof SeriesInner>;
}

export const CandlestickSeries = typed('candlestick', 'CandlestickSeries');
export const BarSeries = typed('bar', 'BarSeries');
export const LineSeries = typed('line', 'LineSeries');
export const AreaSeries = typed('area', 'AreaSeries');
export const BaselineSeries = typed('baseline', 'BaselineSeries');
export const HistogramSeries = typed('histogram', 'HistogramSeries');
