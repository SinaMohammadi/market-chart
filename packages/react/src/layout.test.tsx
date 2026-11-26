// @vitest-environment jsdom
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChartApi } from '@market-chart/core';
import { HOUR, barsToLine, generateBars, installCanvasMock } from '@market-chart/testing';
import {
  Chart,
  ChartLayout,
  LineSeries,
  layoutCellCount,
  layoutPresets,
  useLayoutCell,
} from './index.js';

let restore: () => void = () => undefined;
beforeEach(() => {
  restore = installCanvasMock();
});
afterEach(() => restore());

const data = barsToLine(generateBars({ count: 300, interval: HOUR, seed: 8 }));

describe('<ChartLayout>', () => {
  it('knows the cell count of every preset', () => {
    expect(
      Object.fromEntries(Object.entries(layoutPresets).map(([k, g]) => [k, layoutCellCount(g)])),
    ).toEqual({
      '1': 1,
      '2h': 2,
      '2v': 2,
      '3': 3,
      '4': 4,
      '6': 6,
      '8': 8,
      '12': 12,
    });
  });

  it('renders one chart per cell, links intervals and syncs time ranges', async () => {
    const charts: (ChartApi | null)[] = [];
    let setters: ((v: string) => void)[] = [];
    const seen: (string | undefined)[][] = [];
    function Cell({ index }: { index: number }) {
      const cell = useLayoutCell();
      setters[index] = cell.setInterval;
      seen[index] = [cell.symbol, cell.interval];
      return (
        <Chart
          ref={(c) => {
            charts[index] = c;
          }}
          options={{ autoSize: false, width: 300, height: 200 }}
        >
          <LineSeries data={data} />
        </Chart>
      );
    }
    const { container } = render(
      <ChartLayout layout="4" height={400} defaultSymbol="BTCUSDT" defaultInterval="1h">
        {(index) => <Cell index={index} />}
      </ChartLayout>,
    );
    expect(container.querySelectorAll('[data-layout-cell]')).toHaveLength(4);
    await waitFor(() => expect(charts.filter(Boolean)).toHaveLength(4));
    expect(seen[2]).toEqual(['BTCUSDT', '1h']);
    await act(async () => setters[1]!('4h'));
    expect(seen.map((s) => s[1])).toEqual(['4h', '4h', '4h', '4h']);

    for (const c of charts) c!.render();
    charts[0]!.timeScale().setVisibleLogicalRange({ from: 50, to: 120 });
    for (let i = 0; i < 3; i++) for (const c of charts) c!.render();
    const target = charts[0]!.timeScale().getVisibleLogicalRange()!;
    for (const c of charts.slice(1)) {
      const r = c!.timeScale().getVisibleLogicalRange()!;
      expect(r.from).toBeCloseTo(target.from, 2);
      expect(r.to).toBeCloseTo(target.to, 2);
    }
    setters = [];
  });
});
