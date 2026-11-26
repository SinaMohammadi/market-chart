import { useChart, useCrosshair } from '@market-chart/react';
import type { OhlcBar, SeriesApi } from '@market-chart/core';

interface LegendProps {
  symbol: string;
  series: SeriesApi | null;
  extra?: readonly { label: string; series: SeriesApi | null; color: string }[];
}

/**
 * DOM legend rendered as a child of <Chart>. Only this component re-renders on crosshair moves;
 * the chart itself never re-renders through React.
 */
export function Legend({ symbol, series, extra = [] }: LegendProps) {
  const chart = useChart();
  const crosshair = useCrosshair();
  if (!chart || !series) return null;
  const point = (crosshair?.seriesData.get(series) ?? series.lastPoint()) as
    OhlcBar | { value: number } | undefined;
  const fmt = (v: number) => v.toFixed(2);
  return (
    <div className="legend">
      <b>{symbol}</b>
      <span className="badge">synthetic</span>
      {point && 'open' in point ? (
        <span className={point.close >= point.open ? 'up' : 'down'}>
          O {fmt(point.open)} H {fmt(point.high)} L {fmt(point.low)} C {fmt(point.close)}
        </span>
      ) : point && 'value' in point ? (
        <span>{fmt(point.value)}</span>
      ) : null}
      {extra.map(({ label, series: s, color }) => {
        if (!s) return null;
        const p = (crosshair?.seriesData.get(s) ?? s.lastPoint()) as { value: number } | undefined;
        return p ? (
          <span key={label} style={{ color }}>
            {label} {fmt(p.value)}
          </span>
        ) : null;
      })}
    </div>
  );
}
