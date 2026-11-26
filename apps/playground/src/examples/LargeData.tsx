import { useRef, useState } from 'react';
import { Chart } from '@market-chart/react';
import type { ChartApi, OhlcBar, SeriesApi } from '@market-chart/core';
import { IndicatorManager } from '@market-chart/indicators';
import { MINUTE, generateBars } from '@market-chart/testing';

const SIZES = [100_000, 500_000, 1_000_000] as const;

interface Row {
  readonly label: string;
  readonly value: string;
}

const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));

function stats(samples: number[]): string {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
  return `p50 ${at(50).toFixed(2)} ms · p95 ${at(95).toFixed(2)} ms · max ${sorted[sorted.length - 1]!.toFixed(2)} ms`;
}

function heapMb(): number | null {
  const memory = (performance as { memory?: { usedJSHeapSize: number } }).memory;
  return memory ? memory.usedJSHeapSize / 2 ** 20 : null;
}

/**
 * Real-canvas measurements on this machine: load time, frame times while panning and zooming (rendering
 * included, measured synchronously inside animation frames), and sustained realtime throughput with and
 * without indicators. Synthetic data.
 */
export function LargeDataExample() {
  const [chart, setChart] = useState<ChartApi | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const data = useRef<{ series: SeriesApi<'candlestick'>; bars: OhlcBar[] } | null>(null);

  const add = (label: string, value: string) => setRows((r) => [...r, { label, value }]);

  const load = async (count: number) => {
    if (!chart) return;
    setRunning(true);
    setRows([]);
    await nextFrame();
    const bars = generateBars({
      count,
      interval: MINUTE,
      startPrice: 30_000,
      volatility: 0.002,
      seed: count,
    });
    for (const s of chart.series()) chart.removeSeries(s);
    const heap0 = heapMb();
    const series = chart.addSeries('candlestick');
    const t0 = performance.now();
    series.setData(bars);
    const t1 = performance.now();
    chart.render();
    const t2 = performance.now();
    data.current = { series, bars };
    add('Dataset', `${count.toLocaleString()} synthetic 1-minute candles`);
    add('setData', `${(t1 - t0).toFixed(1)} ms`);
    add('First frame (real canvas)', `${(t2 - t1).toFixed(2)} ms`);
    const heap1 = heapMb();
    if (heap0 !== null && heap1 !== null)
      add('JS heap after load (Chrome only)', `${heap1.toFixed(0)} MB`);
    setRunning(false);
  };

  const measure = async () => {
    if (!chart || !data.current) return;
    setRunning(true);
    const ts = chart.timeScale();
    const { series } = data.current;
    const last = series.length() - 1;

    // Pan: 120 frames, 2,000 bars visible.
    ts.setVisibleLogicalRange({ from: last - 2_000, to: last });
    await nextFrame();
    const pan: number[] = [];
    for (let i = 0; i < 120; i++) {
      await nextFrame();
      const t0 = performance.now();
      const r = ts.getVisibleLogicalRange()!;
      ts.setVisibleLogicalRange({ from: r.from - 15, to: r.to - 15 });
      chart.render();
      pan.push(performance.now() - t0);
    }
    add('Pan, 2,000 bars visible (120 frames)', stats(pan));

    // Zoom sweep from 50 bars to fully zoomed out.
    const zoom: number[] = [];
    for (let i = 0; i <= 60; i++) {
      await nextFrame();
      const visible = Math.round(50 * Math.pow(last / 50, i / 60));
      const t0 = performance.now();
      ts.setVisibleLogicalRange({ from: last - visible, to: last });
      chart.render();
      zoom.push(performance.now() - t0);
    }
    add('Zoom sweep, 50 bars → everything (61 frames)', stats(zoom));
    ts.setVisibleLogicalRange({ from: last - 300, to: last + 5 });

    const stream = async (label: string) => {
      let bar = series.lastPoint() as OhlcBar;
      const frames: number[] = [];
      let updates = 0;
      const start = performance.now();
      while (performance.now() - start < 3_000) {
        await nextFrame();
        const t0 = performance.now();
        for (let k = 0; k < 20; k++) {
          const price = bar.close * (1 + Math.sin(updates) * 0.0004);
          bar =
            updates % 50 === 49
              ? {
                  time: bar.time + MINUTE,
                  open: bar.close,
                  high: Math.max(bar.close, price),
                  low: Math.min(bar.close, price),
                  close: price,
                }
              : {
                  ...bar,
                  high: Math.max(bar.high, price),
                  low: Math.min(bar.low, price),
                  close: price,
                };
          series.update(bar);
          updates++;
        }
        chart.render();
        frames.push(performance.now() - t0);
      }
      add(
        label,
        `${Math.round(updates / 3).toLocaleString()} updates/s (20 per animation frame, so bounded by the frame rate) · frame ${stats(frames)}`,
      );
    };
    await stream('Realtime, 3 s (updates + render per frame)');
    const manager = new IndicatorManager(chart);
    const t0 = performance.now();
    for (const type of ['sma', 'ema', 'bollinger', 'rsi']) manager.add(type, series);
    add('Add SMA, EMA, Bollinger, RSI', `${(performance.now() - t0).toFixed(0)} ms`);
    await stream('Realtime with 4 indicators, 3 s');
    manager.destroy();
    const heap = heapMb();
    if (heap !== null) add('JS heap after the run (Chrome only)', `${heap.toFixed(0)} MB`);
    setRunning(false);
  };

  return (
    <>
      <div className="toolbar">
        {SIZES.map((n) => (
          <button key={n} onClick={() => void load(n)} disabled={!chart || running}>
            Load {n.toLocaleString()}
          </button>
        ))}
        <button onClick={() => void measure()} disabled={!chart || running || !data.current}>
          Run measurements
        </button>
        <span className="desc" style={{ margin: 0 }}>
          {running
            ? 'Running… keep this tab visible (hidden tabs throttle animation frames).'
            : 'Load a dataset, then run the measurements.'}
        </span>
      </div>
      {rows.length ? (
        <table className="perf-table">
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th>{r.label}</th>
                <td>{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <div className="card">
        <Chart height={460} ref={setChart} />
      </div>
    </>
  );
}
