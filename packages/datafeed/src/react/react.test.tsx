// @vitest-environment jsdom
import { useState } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Chart } from '@market-chart/react';
import type { ChartApi } from '@market-chart/core';
import { installCanvasMock } from '@market-chart/testing';
import { DatafeedSeries } from './index.js';
import type { DatafeedState } from './index.js';
import { createSyntheticDatafeed } from '../synthetic.js';
import { datafeedSource } from '../source.js';

let restore: () => void = () => undefined;
beforeEach(() => {
  restore = installCanvasMock();
});
afterEach(() => restore());

const NOW = Date.UTC(2024, 5, 3, 12, 30);

describe('<DatafeedSeries>', () => {
  it('loads data, switches symbols in place and cleans up', async () => {
    const feed = createSyntheticDatafeed({ now: () => NOW });
    let chart: ChartApi | null = null;
    let latest: DatafeedState | null = null;
    let setSymbol: (s: string) => void = () => undefined;
    let setShown: (v: boolean) => void = () => undefined;
    function App() {
      const [symbol, setSym] = useState('SYN:BTCUSD');
      const [shown, setShow] = useState(true);
      setSymbol = setSym;
      setShown = setShow;
      return (
        <Chart ref={(c) => void (chart = c)} options={{ autoSize: false, width: 600, height: 300 }}>
          {shown ? (
            <DatafeedSeries
              datafeed={feed}
              symbol={symbol}
              interval="1h"
              initialBars={80}
              now={() => NOW}
              onStateChange={(s) => void (latest = s)}
            />
          ) : null}
        </Chart>
      );
    }
    render(<App />);
    await waitFor(() => expect(latest?.status).toBe('ready'));
    expect(chart!.series()).toHaveLength(2); // candles + volume
    expect(latest!.series!.length()).toBe(80);
    const controller = latest!.controller!;
    await act(async () => setSymbol('SYN:ETHUSD'));
    await waitFor(() => expect(latest?.symbolInfo?.symbol).toBe('SYN:ETHUSD'));
    await waitFor(() => expect(latest?.status).toBe('ready'));
    expect(latest!.controller).toBe(controller); // reloaded in place
    expect(latest!.series!.data().at(-1)!.time).toBe(Date.UTC(2024, 5, 3, 12));
    await act(async () => setShown(false));
    expect(chart!.series()).toHaveLength(0);
  });

  it('reports errors', async () => {
    const feed = createSyntheticDatafeed({ now: () => NOW });
    let latest: DatafeedState | null = null;
    render(
      <Chart options={{ autoSize: false, width: 600, height: 300 }}>
        <DatafeedSeries
          datafeed={feed}
          symbol="NOPE"
          interval="1h"
          volumeScaleId={null}
          onStateChange={(s) => void (latest = s)}
        />
      </Chart>,
    );
    await waitFor(() => expect(latest?.status).toBe('error'));
    expect(String((latest!.error as Error).message)).toMatch(/unknown symbol/);
  });
});

describe('<Chart dataSource symbol interval>', () => {
  it('loads the symbol and interval, reloads in place and cleans up', async () => {
    const feed = createSyntheticDatafeed({ now: () => NOW });
    let chart: ChartApi | null = null;
    let latest: DatafeedState | null = null;
    const states: DatafeedState[] = [];
    const source = datafeedSource(feed, {
      initialBars: 80,
      now: () => NOW,
      onStateChange: (s) => {
        latest = s;
        states.push(s);
      },
    });
    let setSymbol: (s: string) => void = () => undefined;
    let setInterval: (s: string) => void = () => undefined;
    let setShown: (v: boolean) => void = () => undefined;
    function App() {
      const [symbol, setSym] = useState('SYN:BTCUSD');
      const [interval, setInt] = useState('1h');
      const [shown, setShow] = useState(true);
      setSymbol = setSym;
      setInterval = setInt;
      setShown = setShow;
      return shown ? (
        <Chart
          ref={(c) => void (chart = c)}
          options={{ autoSize: false, width: 600, height: 300 }}
          dataSource={source}
          symbol={symbol}
          interval={interval}
        />
      ) : null;
    }
    render(<App />);
    await waitFor(() => expect(latest?.status).toBe('ready'));
    expect(chart!.series()).toHaveLength(2); // candles + volume
    expect(latest!.series!.length()).toBe(80);
    const controller = latest!.controller!;
    const series = latest!.series!;
    await act(async () => setSymbol('SYN:ETHUSD'));
    await waitFor(() => expect(latest?.symbolInfo?.symbol).toBe('SYN:ETHUSD'));
    await act(async () => setInterval('4h'));
    await waitFor(() => expect(controller.interval).toBe('4h'));
    await waitFor(() => expect(latest?.status).toBe('ready'));
    // Same controller and series: reloaded in place, not re-created.
    expect(latest!.controller).toBe(controller);
    expect(latest!.series).toBe(series);
    expect(chart!.series()).toHaveLength(2);
    const c = chart!;
    await act(async () => setShown(false));
    expect(c.destroyed).toBe(true);
    expect(controller.status).not.toBe('loading');
  });

  it('waits for both symbol and interval', async () => {
    const feed = createSyntheticDatafeed({ now: () => NOW });
    let chart: ChartApi | null = null;
    render(
      <Chart
        ref={(c) => void (chart = c)}
        options={{ autoSize: false, width: 600, height: 300 }}
        dataSource={datafeedSource(feed)}
        symbol="SYN:BTCUSD"
      />,
    );
    await waitFor(() => expect(chart).not.toBeNull());
    expect(chart!.series()).toHaveLength(0);
  });
});
