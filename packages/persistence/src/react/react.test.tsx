// @vitest-environment jsdom
import { useMemo } from 'react';
import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Chart, LineSeries } from '@market-chart/react';
import type { ChartApi } from '@market-chart/core';
import { HOUR, generateBars, installCanvasMock } from '@market-chart/testing';
import { useChartPersistence } from './index.js';
import type { UseChartPersistenceResult } from './index.js';
import { createMemoryStorage } from '../adapters.js';
import type { ChartStorageAdapter } from '../types.js';

let restore: () => void = () => undefined;
beforeEach(() => {
  restore = installCanvasMock();
});
afterEach(() => restore());

const line = generateBars({ count: 100, interval: HOUR, seed: 4 }).map((b) => ({
  time: b.time,
  value: b.close,
}));

function Persist({
  storage,
  onResult,
}: {
  storage: ChartStorageAdapter;
  onResult: (r: UseChartPersistenceResult) => void;
}) {
  const result = useChartPersistence({ id: 'main', storage, crossTab: false, debounceMs: 10 });
  onResult(result);
  return null;
}

describe('useChartPersistence', () => {
  it('loads the stored layout on mount and autosaves changes', async () => {
    const storage = createMemoryStorage();
    await storage.save('main', {
      version: 1,
      revision: 3,
      savedAt: 0,
      options: { grid: { vertLines: { visible: false } } },
      view: null,
      extensions: {},
    });
    let chart: ChartApi | null = null;
    let result: UseChartPersistenceResult | null = null;
    function App() {
      const stable = useMemo(() => storage, []);
      return (
        <Chart ref={(c) => void (chart = c)} options={{ autoSize: false, width: 600, height: 300 }}>
          <LineSeries data={line} />
          <Persist storage={stable} onResult={(r) => void (result = r)} />
        </Chart>
      );
    }
    const view = render(<App />);
    await waitFor(() => expect(result?.loaded).toBe(true));
    expect(chart!.options().grid.vertLines.visible).toBe(false);
    expect(result!.persistence!.currentRevision).toBe(3);
    chart!.applyOptions({ grid: { horzLines: { visible: false } } } as never);
    await waitFor(() => expect(result?.status).toBe('saved'));
    expect((await storage.load('main'))?.revision).toBe(4);
    const persistence = result!.persistence!;
    view.unmount();
    let destroyed = false;
    try {
      await persistence.save();
    } catch {
      destroyed = true;
    }
    expect(destroyed).toBe(true);
  });
});
