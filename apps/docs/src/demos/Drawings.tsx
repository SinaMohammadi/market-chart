import { useEffect, useState } from 'react';
import type { ChartApi } from '@market-chart/core';
import { CandlestickSeries, Chart } from '@market-chart/react';
import { getDrawingManager } from '@market-chart/drawing-tools';
import type { DrawingManager } from '@market-chart/drawing-tools';
import { syntheticBars } from '../data';
import { useTheme } from '../site';

const bars = syntheticBars('XAUUSD', 400);
const TOOLS = [
  'trend-line',
  'horizontal-line',
  'rectangle',
  'fib-retracement',
  'long-position',
  'text',
];

/** The drawing manager without any UI package: pick a tool, then click on the chart to place it. */
export default function Drawings({ tool }: { tool?: string }) {
  const theme = useTheme();
  const [manager, setManager] = useState<DrawingManager | null>(null);
  const [, rerender] = useState(0);
  useEffect(() => {
    if (!manager) return;
    if (tool) manager.setActiveTool(tool);
    const offs = [
      manager.on('toolChange', () => rerender((n) => n + 1)),
      manager.on('change', () => rerender((n) => n + 1)),
    ];
    return () => offs.forEach((off) => off());
  }, [manager, tool]);
  const tools = tool && !TOOLS.includes(tool) ? [tool, ...TOOLS] : TOOLS;
  return (
    <>
      <div className="demo-toolbar" role="toolbar" aria-label="Drawing tools">
        {tools.map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={manager?.activeTool() === t}
            onClick={() => manager?.setActiveTool(manager.activeTool() === t ? null : t)}
          >
            {t}
          </button>
        ))}
        <span className="demo-sep" />
        <button type="button" disabled={!manager?.canUndo()} onClick={() => manager?.undo()}>
          Undo
        </button>
        <button type="button" disabled={!manager?.canRedo()} onClick={() => manager?.redo()}>
          Redo
        </button>
        <button type="button" onClick={() => manager?.clear()}>
          Clear ({manager?.list().length ?? 0})
        </button>
      </div>
      <Chart
        height={380}
        theme={theme}
        onReady={(chart: ChartApi) => setManager(getDrawingManager(chart))}
      >
        <CandlestickSeries data={bars} />
      </Chart>
    </>
  );
}
