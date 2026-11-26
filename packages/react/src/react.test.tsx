// @vitest-environment jsdom
import { StrictMode, createRef, useMemo, useState } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChartApi, LinePoint, OhlcBar, SeriesApi } from '@market-chart/core';
import { DAY, barsToLine, generateBars, installCanvasMock } from '@market-chart/testing';
import {
  CandlestickSeries,
  Chart,
  ChartProvider,
  LineSeries,
  useChart,
  useChartState,
} from './index.js';
import { StaticChart } from './ssr/index.js';

let restore: () => void = () => undefined;
beforeEach(() => {
  restore = installCanvasMock();
});
afterEach(() => restore());

const bars = generateBars({ count: 200, interval: DAY, seed: 3 });
const options = { autoSize: false, width: 500, height: 300 } as const;

describe('<Chart>', () => {
  it('creates the engine after mount and exposes it through the ref', async () => {
    const ref: { current: ChartApi | null } = { current: null };
    const onReady = vi.fn();
    const { container } = render(
      <Chart ref={ref} options={options} onReady={onReady}>
        <CandlestickSeries data={bars} />
      </Chart>,
    );
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    expect(ref.current!.series()).toHaveLength(1);
    expect(ref.current!.series()[0]!.length()).toBe(200);
    expect(container.querySelectorAll('canvas')).toHaveLength(2);
  });

  it('destroys the engine on unmount', async () => {
    const ref: { current: ChartApi | null } = { current: null };
    const { unmount } = render(<Chart ref={ref} options={options} />);
    await waitFor(() => expect(ref.current).not.toBeNull());
    const chart = ref.current!;
    unmount();
    expect(chart.destroyed).toBe(true);
  });

  it('survives StrictMode double effects with a single chart', async () => {
    const { container } = render(
      <StrictMode>
        <Chart options={options}>
          <LineSeries data={barsToLine(bars)} />
        </Chart>
      </StrictMode>,
    );
    await waitFor(() => expect(container.querySelectorAll('[data-market-chart]')).toHaveLength(1));
  });

  it('applies appended data incrementally', async () => {
    let seriesRef: SeriesApi<'candlestick'> | null = null;
    let push: (bar: OhlcBar) => void = () => undefined;
    function Live() {
      const [data, setData] = useState<OhlcBar[]>(bars);
      push = (bar) => setData((prev) => [...prev, bar]);
      return (
        <Chart options={options}>
          <CandlestickSeries
            data={data}
            ref={(s) => {
              seriesRef = s;
            }}
          />
        </Chart>
      );
    }
    render(<Live />);
    await waitFor(() => expect(seriesRef).not.toBeNull());
    const setData = vi.spyOn(seriesRef!, 'setData');
    const last = bars[bars.length - 1]!;
    act(() => push({ time: last.time + DAY, open: 1, high: 2, low: 0.5, close: 1.5 }));
    await waitFor(() => expect(seriesRef!.length()).toBe(201));
    expect(setData).toHaveBeenCalledTimes(0);
  });

  it('shares charts through ChartProvider and reports view state', async () => {
    const seen: (ChartApi | null)[] = [];
    function Toolbar() {
      const chart = useChart('main');
      seen.push(chart);
      return null;
    }
    function State() {
      const state = useChartState();
      return <span data-testid="width">{state.size.width}</span>;
    }
    const line: LinePoint[] = barsToLine(bars);
    const { getByTestId } = render(
      <ChartProvider>
        <Toolbar />
        <Chart chartId="main" options={options}>
          <LineSeries data={line} />
          <State />
        </Chart>
      </ChartProvider>,
    );
    await waitFor(() => expect(seen[seen.length - 1]).not.toBeNull());
    await waitFor(() => expect(getByTestId('width').textContent).toBe('500'));
  });

  it('keeps multiple charts independent', async () => {
    const refs = [createRef<ChartApi | null>(), createRef<ChartApi | null>()];
    render(
      <>
        <Chart ref={refs[0]} options={options}>
          <LineSeries data={barsToLine(bars)} />
        </Chart>
        <Chart ref={refs[1]} options={options} />
      </>,
    );
    await waitFor(() => expect(refs[1]!.current).not.toBeNull());
    expect(refs[0]!.current!.series()).toHaveLength(1);
    expect(refs[1]!.current!.series()).toHaveLength(0);
  });

  it('memoised options are not re-applied on re-render', async () => {
    const ref: { current: ChartApi | null } = { current: null };
    function Host({ label }: { label: string }) {
      const memo = useMemo(() => ({ ...options }), []);
      return <Chart ref={ref} options={memo} aria-label={label} />;
    }
    const { rerender } = render(<Host label="a" />);
    await waitFor(() => expect(ref.current).not.toBeNull());
    const apply = vi.spyOn(ref.current!, 'applyOptions');
    rerender(<Host label="b" />);
    expect(apply).toHaveBeenCalledTimes(0);
  });
});

describe('StaticChart hydration', () => {
  it('hydrates without mismatches', async () => {
    const element = <StaticChart type="area" data={barsToLine(bars)} height={100} showLastValue />;
    const container = document.createElement('div');
    container.innerHTML = renderToString(element);
    document.body.appendChild(container);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await act(async () => {
      hydrateRoot(container, element);
    });
    expect(errors).toHaveBeenCalledTimes(0);
    errors.mockRestore();
    container.remove();
  });
});
