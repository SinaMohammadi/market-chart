# @market-chart/persistence

Saves and restores charts and workspaces: storage adapters (memory, localStorage, sessionStorage, IndexedDB,
REST, custom), versioned schemas with migrations, validation of everything that is loaded, autosave with save
status, revision-based conflict handling, cross-tab sync, JSON import/export and named workspaces.

Nothing touches browser storage at import time or during SSR: adapters resolve `localStorage`, `indexedDB` and
`fetch` on first use.

## Persisting a chart

```ts
import { getIndicatorManager } from '@market-chart/indicators';
import { getDrawingManager } from '@market-chart/drawing-tools';
import {
  ChartPersistence,
  createLocalStorage,
  defaultSeriesResolver,
  drawingsProvider,
  indicatorsProvider,
} from '@market-chart/persistence';

const persistence = new ChartPersistence({
  chart,
  storage: createLocalStorage(),
  id: 'main-layout',
  providers: {
    indicators: indicatorsProvider(getIndicatorManager(chart), defaultSeriesResolver(chart)),
    drawings: drawingsProvider(getDrawingManager(chart), () => candles.id),
  },
  getContext: () => ({ symbol: controller.symbol, interval: controller.interval }),
  debounceMs: 1000,      // autosave after a quiet period (autoSave: false for manual saves)
  conflict: 'overwrite', // or 'reload', 'fail' (default), or (local, remote) => merged
});
persistence.on('status', ({ status }) => badge.textContent = status); // idle · dirty · saving · saved · error · conflict
await persistence.load();          // false when nothing is stored yet
await persistence.save();          // skipped when nothing changed
const json = persistence.exportJson();
await persistence.importJson(text); // validated, applied, then saved as the next revision
persistence.destroy();
```

What is saved: chart options (theme, layout, grid, crosshair, scales, time scale, localisation, interaction),
the exact visible range (restored once data arrives, without drifting), symbol/interval, and any provider
state. A **provider** is `{ capture(), restore(data), subscribe?(onChange) }`, so application state (watchlists,
UI settings…) can be added with `valueProvider(get, set)`.

## Storage adapters

| Adapter | Notes |
|---|---|
| `createMemoryStorage()` | Tests, SSR, ephemeral sessions |
| `createLocalStorage({ prefix })` / `createSessionStorage()` | Keeps a small metadata index for `list()`; quota errors become `StorageQuotaError` |
| `createWebStorage({ storage: () => myStorage })` | Any `getItem`/`setItem`/`removeItem` object |
| `createIndexedDbStorage({ dbName, storeName })` | Larger quota; the revision check and write run in one transaction |
| `createRestStorage({ baseUrl, headers, fetch })` | `GET/PUT/DELETE <baseUrl>/<id>`, `GET <baseUrl>` lists. Writes send `If-Match: <previous revision>`; `409`/`412` becomes a `StorageConflictError` with the server's state |
| custom | Implement `StorageAdapter<T>`: `save`, `load`, `delete`, `list` |

Every adapter validates on read and rejects a write whose `revision` is not newer than the stored one
(`StorageConflictError`). That is how concurrent edits from another tab or device are detected.

## Schemas, migrations and validation

States carry `version` (schema) and `revision` (save counter). `validateChartState` and `validateWorkspace`:

- deep-copy the input, keeping plain data only: no functions, class instances, `__proto__`/`constructor` keys,
  non-finite numbers, or absurd sizes and depths;
- migrate older versions step by step (`v0 → v1`, …) and reject versions newer than the library;
- check every field's type and range.

Imported files therefore can never execute code or pollute prototypes. Indicator and drawing configs are
validated again by their own packages when restored.

## Cross-tab sync

With `BroadcastChannel` available (default `crossTab: true`), a save tells other tabs with the same id to reload.
A tab with real unsaved edits keeps them and emits `remoteChange`; its next save resolves the conflict with the
configured strategy.

## Workspaces

```ts
const store = new WorkspaceStore(createLocalStorage<WorkspaceState>({ prefix: 'ws:', validate: validateWorkspace }));
const ws = await store.create('Morning', { layout: '2x1', charts: [persistence.capture()] });
await store.rename(ws.id, 'Morning session');
await store.duplicate(ws.id);
const json = await store.exportJson(ws.id);
await store.importJson(json);            // new id, everything validated
await store.save(upsertWatchlist(ws, { id: 'fav', name: 'Favourites', symbols: ['BTCUSD'] }));
```

## React

```tsx
import { useChartPersistence } from '@market-chart/persistence/react';

function Persist() {
  const storage = useMemo(() => createLocalStorage(), []);
  const { status, loaded, persistence } = useChartPersistence({ id: 'main-layout', storage });
  return <span>{loaded ? status : 'loading…'}</span>;
}
// <Chart>…<Persist /></Chart>
```

The hook loads once on mount (`loadOnMount: false` to skip), autosaves, and destroys the manager on unmount.

## Security

Stored and imported states are untrusted; see [SECURITY.md](../../SECURITY.md).

- `apply()` / `load()` / `importJson()` apply only the persisted option groups (`theme`, `layout`, `grid`,
  `crosshair`, `timeScale`, price scales, `localization`, `interaction`); a stored `width`, `height`, `autoSize`
  or `panes` value is ignored.
- `parseJson(text, { maxBytes })` refuses text larger than 20 MiB by default (`MAX_JSON_BYTES`). Check
  `file.size` before reading an imported file.
- `createRestStorage` options: `credentials` (sent explicitly, default `'same-origin'`), `timeoutMs` (default 15000),
  `maxResponseBytes` (default 20 MiB). Error messages contain the URL without query string or credentials.
  The server must authorise every id and enforce `If-Match`; the client-side conflict strategy cannot protect
  other users' data.
- Listings from Web Storage indexes and REST responses go through `validateLayoutMetadata` (valid id, name of at
  most 256 characters, numeric fields).
- Workspace grids must have 1–8 columns and rows.
- Cross-tab messages must have the exact `{ type: 'saved', id, revision, origin }` shape (integer revision);
  anything else is ignored.
