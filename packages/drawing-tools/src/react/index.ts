/**
 * `@market-chart/drawing-tools/react` — headless React bindings (client-only entry).
 * Render your own toolbar with `useDrawingToolbar()`; nothing here imposes UI.
 */
import { useMemo, useRef, useSyncExternalStore } from 'react';
import { useChart } from '@market-chart/react';
import type { ChartApi } from '@market-chart/core';
import { getDrawingManager } from '../manager.js';
import type { DrawingManager, MagnetMode } from '../manager.js';
import type { Drawing, DrawingToolCategory, DrawingToolDefinition } from '../types.js';

/** The drawing manager of the surrounding `<Chart>` (or of `chart`). Null before mount. */
export function useDrawingManager(chart?: ChartApi | null): DrawingManager | null {
  const contextChart = useChart();
  const target = chart === undefined ? contextChart : chart;
  return useMemo(() => (target && !target.destroyed ? getDrawingManager(target) : null), [target]);
}

export interface DrawingToolbarState {
  readonly manager: DrawingManager | null;
  readonly groups: readonly {
    readonly category: DrawingToolCategory;
    readonly tools: readonly DrawingToolDefinition[];
  }[];
  readonly activeTool: string | null;
  readonly selection: readonly string[];
  readonly drawings: readonly Drawing[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly magnet: MagnetMode;
}

const CATEGORY_ORDER: readonly DrawingToolCategory[] = [
  'lines',
  'shapes',
  'annotations',
  'measure',
  'fibonacci',
  'gann',
  'patterns',
];
const EMPTY: DrawingToolbarState = {
  manager: null,
  groups: [],
  activeTool: null,
  selection: [],
  drawings: [],
  canUndo: false,
  canRedo: false,
  magnet: 'off',
};

/**
 * Everything a toolbar needs, kept in sync with the manager through `useSyncExternalStore`.
 * Call the manager's methods (`setActiveTool`, `undo`, `deleteSelected`…) from your buttons.
 */
export function useDrawingToolbar(chart?: ChartApi | null): DrawingToolbarState {
  const manager = useDrawingManager(chart);
  const snapshot = useRef<DrawingToolbarState>(EMPTY);
  const subscribe = useMemo(
    () => (onChange: () => void) => {
      if (!manager) return () => undefined;
      const offs = (
        ['change', 'selectionChange', 'toolChange', 'historyChange', 'magnetChange'] as const
      ).map((event) =>
        manager.on(event, () => {
          snapshot.current = read(manager);
          onChange();
        }),
      );
      return () => offs.forEach((off) => off());
    },
    [manager],
  );
  const getSnapshot = (): DrawingToolbarState => {
    if (snapshot.current.manager !== manager) snapshot.current = manager ? read(manager) : EMPTY;
    return snapshot.current;
  };
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}

function read(manager: DrawingManager): DrawingToolbarState {
  const tools = manager.tools();
  return {
    manager,
    groups: CATEGORY_ORDER.map((category) => ({
      category,
      tools: tools.filter((t) => t.category === category),
    })).filter((g) => g.tools.length),
    activeTool: manager.activeTool(),
    selection: manager.selection(),
    drawings: manager.list(),
    canUndo: manager.canUndo(),
    canRedo: manager.canRedo(),
    magnet: manager.magnet(),
  };
}
