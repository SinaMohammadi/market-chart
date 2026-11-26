import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { CandlestickSeries, Chart } from '@market-chart/react';
import type { ChartApi, SeriesApi } from '@market-chart/core';
import { getIndicatorManager } from '@market-chart/indicators';
import { getDrawingManager } from '@market-chart/drawing-tools';
import {
  ChartPersistence,
  WorkspaceStore,
  createIndexedDbStorage,
  createLocalStorage,
  createMemoryStorage,
  createSessionStorage,
  defaultSeriesResolver,
  drawingsProvider,
  indicatorsProvider,
  validateWorkspace,
} from '@market-chart/persistence';
import type {
  ChartLayoutMetadata,
  ChartStorageAdapter,
  SaveStatus,
  WorkspaceState,
} from '@market-chart/persistence';
import { syntheticBars } from '../data';
import { Legend } from '../Legend';

type StorageKind = 'local' | 'session' | 'indexeddb' | 'memory';

const STORAGE_LABELS: Record<StorageKind, string> = {
  local: 'localStorage',
  session: 'sessionStorage',
  indexeddb: 'IndexedDB',
  memory: 'Memory (lost on reload)',
};

function makeStorage(kind: StorageKind): ChartStorageAdapter {
  switch (kind) {
    case 'local':
      return createLocalStorage({ prefix: 'market-chart:playground:' });
    case 'session':
      return createSessionStorage({ prefix: 'market-chart:playground:' });
    case 'indexeddb':
      return createIndexedDbStorage({ dbName: 'market-chart-playground' });
    case 'memory':
      return createMemoryStorage();
  }
}

const LAYOUT_ID = 'main-layout';
const bars = syntheticBars('ETHUSDT', 600);

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Indicators, drawings, theme and the visible range are saved automatically (debounced) to the chosen
 * storage. Reload the page to see them restored; open a second tab to see cross-tab sync.
 */
export function PersistenceExample() {
  const [chart, setChart] = useState<ChartApi | null>(null);
  const [series, setSeries] = useState<SeriesApi<'candlestick'> | null>(null);
  const [kind, setKind] = useState<StorageKind>('local');
  const storage = useMemo(() => makeStorage(kind), [kind]);
  const [persistence, setPersistence] = useState<ChartPersistence | null>(null);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!chart || !series) return;
    const indicators = getIndicatorManager(chart);
    const drawings = getDrawingManager(chart);
    const p = new ChartPersistence({
      chart,
      storage,
      id: LAYOUT_ID,
      name: 'Playground layout',
      debounceMs: 800,
      conflict: 'overwrite',
      providers: {
        indicators: indicatorsProvider(indicators, defaultSeriesResolver(chart)),
        drawings: drawingsProvider(drawings, () => series.id),
      },
      getContext: () => ({ symbol: 'ETHUSDT', interval: '1h' }),
    });
    const offs = [
      p.on('status', (e) => setStatus(e.status)),
      p.on('saved', (e) => setRevision(e.state.revision)),
      p.on('loaded', (e) => setRevision(e.state.revision)),
      p.on('remoteChange', (e) => setMessage(`Another tab saved revision ${e.revision}`)),
      p.on('error', (e) =>
        setMessage(e.error instanceof Error ? e.error.message : String(e.error)),
      ),
    ];
    setPersistence(p);
    void p.load().then((found) => {
      setStatus(p.status);
      setMessage(
        found
          ? `Restored revision ${p.currentRevision} from ${STORAGE_LABELS[kind]}`
          : 'Nothing stored yet',
      );
    });
    return () => {
      offs.forEach((off) => off());
      p.destroy();
      setPersistence(null);
    };
  }, [chart, series, storage, kind]);

  const addIndicator = (type: string) => {
    if (chart && series) getIndicatorManager(chart).add(type, series);
  };
  const addTrendLine = () => {
    if (!chart || !series) return;
    const n = bars.length;
    const a = Math.floor(n * (0.3 + Math.random() * 0.3));
    const b = Math.min(n - 1, a + 40 + Math.floor(Math.random() * 60));
    getDrawingManager(chart).add({
      type: 'trend-line',
      seriesId: series.id,
      points: [
        { time: bars[a]!.time, price: bars[a]!.low },
        { time: bars[b]!.time, price: bars[b]!.high },
      ],
    });
  };
  const toggleTheme = () => {
    if (!chart) return;
    const dark = chart.theme().name !== 'light';
    chart.applyOptions({ theme: dark ? 'light' : 'dark' });
  };
  const clearAll = () => {
    if (!chart) return;
    getIndicatorManager(chart).clear();
    getDrawingManager(chart).load({ version: 1, drawings: [] });
    chart.applyOptions({ theme: 'dark' });
    chart.timeScale().scrollToRealtime();
  };
  const onImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !persistence) return;
    try {
      // Imported files are untrusted: check the size before reading; importJson validates the content.
      if (file.size > 5 * 1024 * 1024) throw new Error('the file is larger than 5 MB');
      await persistence.importJson(await file.text());
      setMessage(`Imported ${file.name}`);
    } catch (error) {
      setMessage(`Import rejected: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <>
      <div className="toolbar">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as StorageKind)}
          aria-label="Storage"
        >
          {(Object.keys(STORAGE_LABELS) as StorageKind[]).map((k) => (
            <option key={k} value={k}>
              {STORAGE_LABELS[k]}
            </option>
          ))}
        </select>
        <button onClick={() => addIndicator('sma')}>+ SMA</button>
        <button onClick={() => addIndicator('bollinger')}>+ Bollinger</button>
        <button onClick={() => addIndicator('rsi')}>+ RSI</button>
        <button onClick={addTrendLine}>+ Trend line</button>
        <button onClick={toggleTheme}>Toggle theme</button>
        <button onClick={clearAll}>Clear</button>
        <span className={`badge status-${status}`}>{status}</span>
        <span className="desc" style={{ margin: 0 }}>
          revision {revision}
        </span>
      </div>
      <div className="toolbar">
        <button disabled={!persistence} onClick={() => void persistence?.save()}>
          Save now
        </button>
        <button disabled={!persistence} onClick={() => void persistence?.load()}>
          Reload from storage
        </button>
        <button
          disabled={!persistence}
          onClick={() => persistence && download('chart-layout.json', persistence.exportJson())}
        >
          Export JSON
        </button>
        <label className="file-button">
          Import JSON…
          <input
            type="file"
            accept=".json,application/json"
            onChange={(e) => void onImport(e)}
            hidden
          />
        </label>
        {message ? (
          <span className="desc" style={{ margin: 0 }}>
            {message}
          </span>
        ) : null}
      </div>
      <div className="card">
        <Chart height={460} ref={setChart}>
          <CandlestickSeries data={bars} ref={setSeries} />
          <Legend symbol="ETHUSDT · 1h (synthetic)" series={series} />
        </Chart>
      </div>
      <Workspaces persistence={persistence} />
    </>
  );
}

/** Named workspaces in localStorage: save the current chart as a workspace, open, rename, duplicate… */
function Workspaces({ persistence }: { persistence: ChartPersistence | null }) {
  const store = useMemo(
    () =>
      new WorkspaceStore(
        createLocalStorage<WorkspaceState>({
          prefix: 'market-chart:playground:ws:',
          validate: validateWorkspace,
        }),
      ),
    [],
  );
  const [items, setItems] = useState<ChartLayoutMetadata[]>([]);
  const [name, setName] = useState('My workspace');
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    store.list().then(setItems, (e: unknown) => setError(String(e)));
  }, [store]);
  useEffect(refresh, [refresh]);

  const run = (task: () => Promise<unknown>) => () => {
    setError(null);
    task().then(refresh, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };
  const open = (id: string) =>
    run(async () => {
      const ws = await store.get(id);
      const chartState = ws?.charts[ws.activeChart] ?? ws?.charts[0];
      if (!persistence || !chartState) throw new Error('this workspace has no chart');
      await persistence.importJson(JSON.stringify(chartState));
    });

  return (
    <div className="card workspaces">
      <h3>Workspaces</h3>
      <div className="toolbar">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Workspace name"
          maxLength={80}
        />
        <button
          disabled={!persistence}
          onClick={run(async () =>
            store.create(name.trim() || 'Untitled', {
              charts: [persistence!.capture()],
              layout: '1',
            }),
          )}
        >
          Save current chart as workspace
        </button>
      </div>
      {error ? <p className="desc down">{error}</p> : null}
      {items.length === 0 ? <p className="desc">No workspaces yet.</p> : null}
      <ul>
        {items.map((w) => (
          <li key={w.id}>
            <b>{w.name}</b>
            <span className="badge">rev {w.revision}</span>
            <span className="badge">{new Date(w.updatedAt).toLocaleString()}</span>
            <button className="link" onClick={open(w.id)}>
              Open
            </button>
            <button className="link" onClick={run(() => store.rename(w.id, name.trim() || w.name))}>
              Rename to “{name.trim() || w.name}”
            </button>
            <button className="link" onClick={run(() => store.duplicate(w.id))}>
              Duplicate
            </button>
            <button
              className="link"
              onClick={run(async () =>
                download(`${w.name}.workspace.json`, await store.exportJson(w.id)),
              )}
            >
              Export
            </button>
            <button className="link" onClick={run(() => store.delete(w.id))}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
