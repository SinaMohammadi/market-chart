/**
 * `@market-chart/persistence/react` — `useChartPersistence` (client-only entry).
 */
import { useEffect, useRef, useState } from 'react';
import { useChart } from '@market-chart/react';
import { ChartPersistence } from '../chart-persistence.js';
import type { ChartPersistenceOptions, SaveStatus } from '../chart-persistence.js';

export interface UseChartPersistenceResult {
  readonly persistence: ChartPersistence | null;
  readonly status: SaveStatus;
  /** True once the initial load has finished (whether or not anything was stored). */
  readonly loaded: boolean;
}

/**
 * Persists the surrounding `<Chart>`: loads the stored state once on mount, then autosaves.
 * Pass stable `storage` and `providers` objects (memoise them).
 */
export function useChartPersistence(
  options: Omit<ChartPersistenceOptions, 'chart'> & { readonly loadOnMount?: boolean },
): UseChartPersistenceResult {
  const chart = useChart();
  const [result, setResult] = useState<UseChartPersistenceResult>({
    persistence: null,
    status: 'idle',
    loaded: false,
  });
  const latest = useRef(options);
  latest.current = options;
  const { id, storage } = options;
  useEffect(() => {
    if (!chart) return;
    const { loadOnMount = true, ...rest } = latest.current;
    const persistence = new ChartPersistence({ ...rest, chart });
    let alive = true;
    const off = persistence.on(
      'status',
      ({ status }) => alive && setResult((r) => ({ ...r, status })),
    );
    setResult({ persistence, status: persistence.status, loaded: !loadOnMount });
    if (loadOnMount) {
      void persistence
        .load()
        .then(
          () => alive && setResult((r) => ({ ...r, loaded: true, status: persistence.status })),
        );
    }
    return () => {
      alive = false;
      off();
      persistence.destroy();
    };
  }, [chart, id, storage]);
  return result;
}
