import { useEffect, useMemo, useState } from 'react';
import type { ChartApi } from '@market-chart/core';
import { getDrawingManager } from '@market-chart/drawing-tools';
import type { DrawingManager } from '@market-chart/drawing-tools';
import { getIndicatorManager } from '@market-chart/indicators';
import type { IndicatorManager } from '@market-chart/indicators';
import type { ChartUi, ChartUiCapabilities, ChartUiOptions } from '@market-chart/ui';
import { useChartUi } from '@market-chart/ui/react';

export interface DemoChart {
  readonly chart: ChartApi | null;
  readonly setChart: (chart: ChartApi | null) => void;
  readonly ui: ChartUi | null;
  readonly drawings: DrawingManager | null;
  readonly indicators: IndicatorManager | null;
}

/**
 * Chart + drawing and indicator managers + chart UI, the way an application wires them: the managers are the
 * existing packages' (the UI calls their APIs), extra capabilities come from the app.
 */
export function useDemoChart(
  options: ChartUiOptions & { readonly extra?: Partial<ChartUiCapabilities> } = {},
): DemoChart {
  const [chart, setChart] = useState<ChartApi | null>(null);
  const managers = useMemo(
    () =>
      chart ? { drawings: getDrawingManager(chart), indicators: getIndicatorManager(chart) } : null,
    [chart],
  );
  const { extra, ...rest } = options;
  const ui = useChartUi(chart, {
    ...rest,
    capabilities: managers
      ? { drawings: managers.drawings, indicators: managers.indicators, ...extra }
      : {},
  });
  // Capabilities that change over time (e.g. the current symbol) are pushed in without recreating the UI.
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
