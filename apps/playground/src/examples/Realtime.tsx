import { useEffect, useRef, useState } from 'react';
import { CandlestickSeries, Chart } from '@market-chart/react';
import type { SeriesApi } from '@market-chart/core';
import { MINUTE, TickSimulator } from '@market-chart/testing';
import { syntheticBars } from '../data';
import { Legend } from '../Legend';

/**
 * Simulated realtime feed (no network): ticks update the last bar and roll over every minute of
 * simulated time. Updates go straight to the engine via the series API — React does not re-render.
 */
export function RealtimeExample() {
  const bars = syntheticBars('BTCUSDT', 1_500, MINUTE);
  const [series, setSeries] = useState<SeriesApi<'candlestick'> | null>(null);
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(4);
  const ticks = useRef(0);
  const [stats, setStats] = useState({ ticks: 0, bars: bars.length });

  useEffect(() => {
    if (!series || !running) return;
    const last = series.lastPoint();
    if (!last) return;
    const sim = new TickSimulator(last, {
      interval: MINUTE,
      volatility: 0.0006,
      seed: Math.floor(last.time / MINUTE),
    });
    const timer = setInterval(() => {
      for (let i = 0; i < speed; i++) series.update(sim.next(2_000));
      ticks.current += speed;
    }, 50);
    const statsTimer = setInterval(
      () => setStats({ ticks: ticks.current, bars: series.length() }),
      500,
    );
    return () => {
      clearInterval(timer);
      clearInterval(statsTimer);
    };
  }, [series, running, speed]);

  return (
    <>
      <div className="toolbar">
        <button aria-pressed={running} onClick={() => setRunning((r) => !r)}>
          {running ? 'Pause feed' : 'Resume feed'}
        </button>
        {[1, 4, 20].map((s) => (
          <button key={s} aria-pressed={speed === s} onClick={() => setSpeed(s)}>
            {s * 20} ticks/s
          </button>
        ))}
        <span className="desc" style={{ margin: 0 }}>
          {stats.ticks.toLocaleString()} ticks · {stats.bars.toLocaleString()} bars · scroll back in
          history: the view stays put while new bars arrive
        </span>
      </div>
      <div className="card">
        <Chart height={520}>
          <CandlestickSeries data={bars} ref={setSeries} />
          <Legend symbol="BTCUSDT · 1m (simulated feed)" series={series} />
        </Chart>
      </div>
    </>
  );
}
