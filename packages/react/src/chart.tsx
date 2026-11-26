import { forwardRef, useContext, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { createChart } from '@market-chart/core';
import type {
  ChartApi,
  ChartFormatters,
  ChartOptionsInput,
  CrosshairMoveEvent,
  ThemeInput,
  VisibleRangeChangeEvent,
} from '@market-chart/core';
import { syncChartLocale } from '@market-chart/i18n';
import { ChartContext, ChartRegisterContext, ChartSyncContext } from './context.js';
import { I18nContext } from './i18n.js';
import { useIsomorphicLayoutEffect } from './use-isomorphic-layout-effect.js';

export interface ChartProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'onClick'> {
  /** Chart options. Pass a stable (memoised) object; a new identity re-applies the options. */
  options?: ChartOptionsInput;
  /** Shortcut for `options.theme`. */
  theme?: ThemeInput;
  width?: CSSProperties['width'];
  height?: CSSProperties['height'];
  formatters?: ChartFormatters;
  /** Registers the chart in the nearest `<ChartProvider>` under this id. */
  chartId?: string;
  /** Join the surrounding `<ChartLayout>` sync group (default true). */
  sync?: boolean;
  /**
   * Follow the language and direction of the surrounding `<ChartProvider>` (axis dates, canvas text
   * direction). Default true; `'digits'` also uses the language's digits for prices and dates.
   */
  syncLocale?: boolean | 'digits';
  onReady?: (chart: ChartApi) => void;
  onCrosshairMove?: (event: CrosshairMoveEvent) => void;
  onVisibleRangeChange?: (event: VisibleRangeChangeEvent) => void;
  onChartClick?: (event: CrosshairMoveEvent) => void;
  children?: ReactNode;
}

/**
 * Interactive chart. Renders an empty, sized `<div>` on the server and creates the canvas engine
 * after mount, so it is safe in SSR / React Server Component trees (the package entry is a client module).
 *
 * React never renders individual bars: children such as `<CandlestickSeries>` only push data into the engine.
 */
export const Chart = forwardRef<ChartApi | null, ChartProps>(function Chart(
  {
    options,
    theme,
    width = '100%',
    height = 400,
    formatters,
    chartId,
    sync = true,
    syncLocale = true,
    onReady,
    onCrosshairMove,
    onVisibleRangeChange,
    onChartClick,
    children,
    style,
    ...divProps
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [chart, setChart] = useState<ChartApi | null>(null);
  const register = useContext(ChartRegisterContext);
  const i18n = useContext(I18nContext);
  const syncGroup = useContext(ChartSyncContext);

  // Latest values for the creation effect without re-creating the chart.
  const initial = useRef({ options, theme, formatters });
  initial.current = { options, theme, formatters };
  const handlers = useRef({ onReady, onCrosshairMove, onVisibleRangeChange, onChartClick });
  handlers.current = { onReady, onCrosshairMove, onVisibleRangeChange, onChartClick };

  useIsomorphicLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const { options: o, theme: t, formatters: f } = initial.current;
    const instance = createChart(container, t === undefined ? o : { ...o, theme: t }, f);
    const offs = [
      instance.on('ready', ({ chart: c }) => handlers.current.onReady?.(c)),
      instance.on('crosshairMove', (e) => handlers.current.onCrosshairMove?.(e)),
      instance.on('visibleRangeChange', (e) => handlers.current.onVisibleRangeChange?.(e)),
      instance.on('click', (e) => handlers.current.onChartClick?.(e)),
    ];
    setChart(instance);
    return () => {
      for (const off of offs) off();
      instance.destroy();
      setChart(null);
    };
  }, []);

  // Option updates after mount (the first run is covered by creation).
  const appliedOptions = useRef(options);
  useEffect(() => {
    if (!chart || appliedOptions.current === options) return;
    appliedOptions.current = options;
    if (options) chart.applyOptions(options);
  }, [chart, options]);

  const appliedTheme = useRef(theme);
  useEffect(() => {
    if (!chart || appliedTheme.current === theme) return;
    appliedTheme.current = theme;
    if (theme !== undefined) chart.setTheme(theme);
  }, [chart, theme]);

  const appliedFormatters = useRef(formatters);
  useEffect(() => {
    if (!chart || appliedFormatters.current === formatters) return;
    appliedFormatters.current = formatters;
    chart.setFormatters(formatters ?? {});
  }, [chart, formatters]);

  useEffect(() => {
    if (!chart || !register || chartId === undefined) return;
    return register(chartId, chart);
  }, [chart, register, chartId]);

  useEffect(() => {
    if (!chart || !i18n || syncLocale === false) return;
    return syncChartLocale(chart, i18n, { localDigits: syncLocale === 'digits' });
  }, [chart, i18n, syncLocale]);

  useEffect(() => {
    if (!chart || !syncGroup || !sync) return;
    syncGroup.add(chart);
    return () => syncGroup.remove(chart);
  }, [chart, syncGroup, sync]);

  // The ref is null until the chart has mounted (and after unmount).
  useImperativeHandle(ref, () => chart as ChartApi, [chart]);

  return (
    <div {...divProps} ref={containerRef} style={{ position: 'relative', width, height, ...style }}>
      <ChartContext.Provider value={chart}>{chart ? children : null}</ChartContext.Provider>
    </div>
  );
});
