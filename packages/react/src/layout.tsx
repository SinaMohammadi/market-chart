import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createChartSync } from '@market-chart/core';
import type { ChartSyncOptions } from '@market-chart/core';
import { ChartSyncContext } from './context.js';

export type LayoutPreset = '1' | '2h' | '2v' | '3' | '4' | '6' | '8' | '12';

/** CSS-grid description of a layout. `areas` uses one letter per cell (`a`, `b`, …) like `grid-template-areas`. */
export interface LayoutGrid {
  readonly columns: number;
  readonly rows: number;
  readonly areas?: readonly string[];
}

export const layoutPresets: Readonly<Record<LayoutPreset, LayoutGrid>> = {
  '1': { columns: 1, rows: 1 },
  '2h': { columns: 2, rows: 1 },
  '2v': { columns: 1, rows: 2 },
  '3': { columns: 2, rows: 2, areas: ['a b', 'a c'] },
  '4': { columns: 2, rows: 2 },
  '6': { columns: 3, rows: 2 },
  '8': { columns: 4, rows: 2 },
  '12': { columns: 4, rows: 3 },
};

/** Number of cells in a grid (distinct area names, or columns × rows). */
export function layoutCellCount(grid: LayoutGrid): number {
  if (grid.areas)
    return new Set(
      grid.areas
        .join(' ')
        .split(/\s+/)
        .filter((a) => a !== '.'),
    ).size;
  return grid.columns * grid.rows;
}

function resolveGrid(layout: LayoutPreset | LayoutGrid): LayoutGrid {
  const grid = typeof layout === 'string' ? layoutPresets[layout] : layout;
  if (!grid || !(grid.columns >= 1) || !(grid.rows >= 1) || grid.columns * grid.rows > 64) {
    throw new Error(`[market-chart] invalid layout ${JSON.stringify(layout)}`);
  }
  return grid;
}

export interface LayoutCellState {
  readonly index: number;
  readonly symbol: string | undefined;
  readonly interval: string | undefined;
  /** Sets this cell's symbol (all cells when symbols are linked). */
  setSymbol(symbol: string): void;
  setInterval(interval: string): void;
}

interface LayoutState {
  symbols: (string | undefined)[];
  intervals: (string | undefined)[];
  setSymbol(index: number, symbol: string): void;
  setInterval(index: number, interval: string): void;
}

const LayoutStateContext = createContext<LayoutState | null>(null);
const CellIndexContext = createContext<number>(0);

/**
 * Symbol and interval of the current layout cell. Data loading for a symbol/interval is the app's job
 * (or a datafeed's): the layout only keeps the state and links it across cells.
 */
export function useLayoutCell(): LayoutCellState {
  const state = useContext(LayoutStateContext);
  const index = useContext(CellIndexContext);
  return {
    index,
    symbol: state?.symbols[index],
    interval: state?.intervals[index],
    setSymbol: (symbol) => state?.setSymbol(index, symbol),
    setInterval: (interval) => state?.setInterval(index, interval),
  };
}

export interface ChartLayoutProps {
  layout: LayoutPreset | LayoutGrid;
  /** Renders one cell. Receives the cell index; use `useLayoutCell()` inside for symbol/interval. */
  children: (index: number) => ReactNode;
  height?: CSSProperties['height'];
  gap?: number;
  /** Synchronisation between the charts; `false` disables it. */
  sync?: ChartSyncOptions | false;
  /** When linked, changing one cell's symbol/interval changes all cells. */
  linkSymbol?: boolean;
  linkInterval?: boolean;
  defaultSymbol?: string;
  defaultInterval?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * Grid of charts with synchronised crosshair and time range. Every `<Chart>` rendered inside a cell joins
 * the layout's sync group automatically; pass `sync={false}` on a chart to keep it independent.
 */
export function ChartLayout({
  layout,
  children,
  height = 600,
  gap = 1,
  sync = {},
  linkSymbol = false,
  linkInterval = true,
  defaultSymbol,
  defaultInterval,
  className,
  style,
}: ChartLayoutProps) {
  const grid = resolveGrid(layout);
  const cells = layoutCellCount(grid);
  const syncKey =
    sync === false ? 'off' : `${sync.crosshair !== false}|${sync.timeRange !== false}`;
  const group = useMemo(() => (sync === false ? null : createChartSync(sync)), [syncKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => group?.destroy(), [group]);

  const [symbols, setSymbols] = useState<(string | undefined)[]>(() =>
    Array.from({ length: cells }, () => defaultSymbol),
  );
  const [intervals, setIntervals] = useState<(string | undefined)[]>(() =>
    Array.from({ length: cells }, () => defaultInterval),
  );
  const state = useMemo<LayoutState>(
    () => ({
      symbols: Array.from({ length: cells }, (_, i) => symbols[i] ?? defaultSymbol),
      intervals: Array.from({ length: cells }, (_, i) => intervals[i] ?? defaultInterval),
      setSymbol: (index, symbol) =>
        setSymbols((prev) =>
          Array.from({ length: cells }, (_, i) => (linkSymbol || i === index ? symbol : prev[i])),
        ),
      setInterval: (index, interval) =>
        setIntervals((prev) =>
          Array.from({ length: cells }, (_, i) =>
            linkInterval || i === index ? interval : prev[i],
          ),
        ),
    }),
    [cells, symbols, intervals, linkSymbol, linkInterval, defaultSymbol, defaultInterval],
  );

  const areaNames = grid.areas
    ? [
        ...new Set(
          grid.areas
            .join(' ')
            .split(/\s+/)
            .filter((a) => a !== '.'),
        ),
      ]
    : null;
  return (
    <ChartSyncContext.Provider value={group}>
      <LayoutStateContext.Provider value={state}>
        <div
          className={className}
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${grid.columns}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))`,
            gridTemplateAreas: grid.areas
              ? grid.areas.map((row) => `"${row}"`).join(' ')
              : undefined,
            gap,
            height,
            ...style,
          }}
        >
          {Array.from({ length: cells }, (_, index) => (
            <div
              key={index}
              data-layout-cell={index}
              style={{
                minWidth: 0,
                minHeight: 0,
                position: 'relative',
                gridArea: areaNames?.[index],
              }}
            >
              <CellIndexContext.Provider value={index}>{children(index)}</CellIndexContext.Provider>
            </div>
          ))}
        </div>
      </LayoutStateContext.Provider>
    </ChartSyncContext.Provider>
  );
}
