// @vitest-environment jsdom
import { useState } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CandlestickSeries, Chart } from '@market-chart/react';
import type { ChartApi, SeriesApi } from '@market-chart/core';
import { HOUR, generateBars, installCanvasMock } from '@market-chart/testing';
import { Indicator } from './index.js';
import type { IndicatorHandle } from '../chart/indicator-manager.js';

let restore: () => void = () => undefined;
beforeEach(() => {
  restore = installCanvasMock();
});
afterEach(() => restore());

const bars = generateBars({ count: 200, interval: HOUR, seed: 9 });

describe('<Indicator>', () => {
  it('adds, updates in place and removes an indicator', async () => {
    let chart: ChartApi | null = null;
    let handle: IndicatorHandle | null = null;
    let setLength: (n: number) => void = () => undefined;
    let setShown: (v: boolean) => void = () => undefined;
    function App() {
      const [source, setSource] = useState<SeriesApi<'candlestick'> | null>(null);
      const [length, setLen] = useState(14);
      const [shown, setShow] = useState(true);
      setLength = setLen;
      setShown = setShow;
      return (
        <Chart
          ref={(c) => {
            chart = c;
          }}
          options={{ autoSize: false, width: 600, height: 400 }}
        >
          <CandlestickSeries data={bars} ref={setSource} />
          {shown ? (
            <Indicator
              type="rsi"
              source={source}
              params={{ length }}
              onReady={(h) => {
                handle = h;
              }}
            />
          ) : null}
        </Chart>
      );
    }
    render(<App />);
    await waitFor(() => expect(handle).not.toBeNull());
    const first = handle!;
    expect(chart!.panes()).toHaveLength(2);
    await act(async () => setLength(21));
    expect(handle).toBe(first);
    expect(first.params()).toEqual({ length: 21, source: 'close' });
    await act(async () => setShown(false));
    expect(first.removed).toBe(true);
    expect(chart!.panes()).toHaveLength(1);
  });
});
