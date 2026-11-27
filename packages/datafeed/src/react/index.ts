/**
 * `@market-chart/datafeed/react` — `<DatafeedSeries>` and `useDatafeed` (client-only entry).
 *
 * For the simplest case, `<Chart dataSource={datafeedSource(feed)} symbol interval>` (from the main entry)
 * needs neither.
 */
import { useEffect, useRef, useState } from 'react';
import { useChart } from '@market-chart/react';
import type { SeriesOptionsInput } from '@market-chart/core';
import { attachDatafeed } from '../source.js';
import type { DatafeedAttachment, DatafeedSeriesOptions, DatafeedState } from '../source.js';
import type { Datafeed, Timeframe } from '../types.js';

export type { DatafeedState } from '../source.js';

export type UseDatafeedOptions = Omit<DatafeedSeriesOptions, 'seriesOptions' | 'onStateChange'>;

const IDLE: DatafeedState = {
  status: 'idle',
  symbolInfo: null,
  error: null,
  series: null,
  controller: null,
};

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
  const [state, setState] = useState<DatafeedState>(IDLE);
  const latest = useRef({ options, symbol, interval });
  latest.current = { options, symbol, interval };
  const attachment = useRef<DatafeedAttachment | null>(null);

  useEffect(() => {
    if (!chart) return;
    const { options: o, symbol: s, interval: i } = latest.current;
    const attached = attachDatafeed(
      chart,
      datafeed,
      { symbol: s, interval: i },
      { ...o, onStateChange: setState },
    );
    attachment.current = attached;
    setState(attached.state());
    return () => {
      attachment.current = null;
      attached.destroy();
    };
  }, [chart, datafeed]);

  // Symbol and interval changes are applied in place.
  useEffect(() => {
    attachment.current?.update({ symbol, interval });
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
