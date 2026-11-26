import { useEffect, useMemo, useState } from 'react';
import type { ChartApi } from '@market-chart/core';
import { getDrawingManager } from '@market-chart/drawing-tools';
import { getIndicatorManager } from '@market-chart/indicators';
import type { ChartUiCapabilities, ChartUiOptions } from '@market-chart/ui';
import { useChartUi } from '@market-chart/ui/react';

/**
 * A chart with the drawing and indicator managers and the chart UI, wired the way an application does it.
 * Pass the chart setter to `<Chart ref={setChart}>`; `ui` is null until the chart has mounted.
 */
export function useTradingChart(
  options: ChartUiOptions & { readonly extra?: Partial<ChartUiCapabilities> } = {},
) {
  const [chart, setChart] = useState<ChartApi | null>(null);
  const managers = useMemo(
    () =>
      chart ? { drawings: getDrawingManager(chart), indicators: getIndicatorManager(chart) } : null,
    [chart],
  );
  const { extra, ...rest } = options;
  const ui = useChartUi(chart, { ...rest, capabilities: { ...managers, ...extra } });
  // Capabilities that change over time (symbol, timeframe…) are pushed in without recreating the UI.
  useEffect(() => {
    if (ui && extra) ui.setCapabilities(extra);
  }, [ui, extra]);
  return {
    chart,
    setChart,
    ui,
    drawings: managers?.drawings ?? null,
    indicators: managers?.indicators ?? null,
  };
}
