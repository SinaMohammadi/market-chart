import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import type { ChartApi, ChartOptionsInput } from '@market-chart/core';
import { StaticChart } from './ssr/static-chart.js';
import type { StaticChartProps } from './ssr/static-chart.js';
import { Chart } from './chart.js';
import { Series } from './series.js';

/**
 * When the interactive engine takes over from the static SVG:
 * - `mount`: right after hydration;
 * - `idle`: when the browser is idle (falls back to a short timeout);
 * - `visible`: when the chart scrolls into view;
 * - `interaction`: on the first pointer, touch or keyboard focus on the chart.
 */
export type ProgressiveActivation = 'mount' | 'idle' | 'visible' | 'interaction';

export type ProgressiveChartProps = StaticChartProps & {
  readonly activate?: ProgressiveActivation;
  /** Options for the interactive chart (its theme and height come from the static props). */
  readonly chartOptions?: ChartOptionsInput;
  /**
   * Interactive content (series, indicators, legends…). Without children, one series of the static `type`
   * is created with the same `data`.
   */
  readonly children?: ReactNode;
  readonly onActivate?: (chart: ChartApi) => void;
};

function useActivation(
  mode: ProgressiveActivation,
  target: RefObject<HTMLElement | null>,
): boolean {
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (active) return;
    if (mode === 'mount') {
      setActive(true);
      return;
    }
    const g = globalThis as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
      IntersectionObserver?: typeof IntersectionObserver;
    };
    if (mode === 'idle') {
      if (g.requestIdleCallback) {
        const handle = g.requestIdleCallback(() => setActive(true), { timeout: 2000 });
        return () => g.cancelIdleCallback?.(handle);
      }
      const handle = setTimeout(() => setActive(true), 200);
      return () => clearTimeout(handle);
    }
    const element = target.current;
    if (!element) return;
    if (mode === 'visible') {
      if (!g.IntersectionObserver) {
        setActive(true);
        return;
      }
      const observer = new g.IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) setActive(true);
      });
      observer.observe(element);
      return () => observer.disconnect();
    }
    const on = () => setActive(true);
    const events = ['pointerenter', 'pointerdown', 'touchstart', 'focusin'] as const;
    for (const event of events) element.addEventListener(event, on, { passive: true });
    return () => {
      for (const event of events) element.removeEventListener(event, on);
    };
  }, [mode, active, target]);
  return active;
}

/**
 * Renders a lightweight `<StaticChart>` (SVG, identical on server and client, so it hydrates without
 * mismatches) and switches to the interactive engine when `activate` says so. The static picture stays until
 * the interactive chart has drawn, so there is no blank flash. Pages get meaningful HTML for SEO and first
 * paint without running the canvas engine until it is needed.
 */
export function ProgressiveChart(props: ProgressiveChartProps) {
  const { activate = 'visible', chartOptions, children, onActivate, ...staticProps } = props;
  const { height, theme = 'light', data, type, className, style } = staticProps;
  const wrapper = useRef<HTMLDivElement>(null);
  const active = useActivation(activate, wrapper);
  const [ready, setReady] = useState(false);
  const onActivateRef = useRef(onActivate);
  onActivateRef.current = onActivate;

  const fitDefault = !children;
  const chartRef = useRef<ChartApi | null>(null);
  // Taken from the ref (set as soon as the engine exists), not the `ready` event, which needs a first frame
  // with a non-zero size (hidden tabs, zero-width containers).
  const captureChart = useCallback((chart: ChartApi | null) => {
    if (chart && chartRef.current !== chart) {
      chartRef.current = chart;
      onActivateRef.current?.(chart);
    } else if (!chart) chartRef.current = null;
  }, []);

  // Swap once the interactive chart has data to show (a datafeed may still be loading), with a
  // fallback so an empty chart does not stay invisible.
  useEffect(() => {
    if (!active || ready) return;
    let done = false;
    let off: (() => void) | null = null;
    const finish = () => {
      const chart = chartRef.current;
      if (done || !chart || chart.destroyed) return;
      done = true;
      off?.();
      if (fitDefault) chart.timeScale().fitContent(); // match the static overview
      chart.render();
      setReady(true);
    };
    const poll = setInterval(() => {
      const chart = chartRef.current;
      if (!chart || off) return;
      if (chart.series().some((series) => series.length() > 0)) finish();
      else off = chart.on('dataChanged', finish);
    }, 16);
    const fallback = setTimeout(finish, 3000);
    return () => {
      clearInterval(poll);
      clearTimeout(fallback);
      off?.();
    };
  }, [active, ready, fitDefault]);

  return (
    <div
      ref={wrapper}
      className={className}
      style={{ position: 'relative', height, ...style }}
      data-chart-state={ready ? 'interactive' : 'static'}
      tabIndex={activate === 'interaction' && !active ? 0 : undefined}
    >
      {ready ? null : (
        <StaticChart
          {...staticProps}
          theme={theme}
          background={staticProps.background ?? true}
          className={undefined}
          style={{ position: 'absolute', inset: 0 }}
        />
      )}
      {active ? (
        <Chart
          height={height}
          theme={theme}
          options={chartOptions}
          ref={captureChart}
          style={ready ? undefined : { opacity: 0 }}
        >
          {children ?? <Series type={type} data={data as never} />}
        </Chart>
      ) : null}
    </div>
  );
}
