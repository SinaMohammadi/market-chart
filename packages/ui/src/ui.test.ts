import { describe, expect, it, vi } from 'vitest';
import { createMemoryStorage, StorageConflictError } from '@market-chart/persistence';
import {
  ActionRegistry,
  ContextMenuController,
  UiPreferencesStore,
  defaultUiPreferences,
  formatShortcut,
  headerLayout,
  matchShortcut,
  placeActions,
  placeMenu,
  placeSubmenu,
  reorderPlacements,
  searchEntries,
  sidebarLayout,
  timeframeLabel,
  uiPreferencesProvider,
  validateUiPreferences,
} from './index.js';
import type { MenuEntry, UiPreferences } from './index.js';
import { createI18n } from '@market-chart/i18n';

const noop = () => undefined;

describe('ActionRegistry', () => {
  it('registers, overrides, restores, disables and removes actions', () => {
    const registry = new ActionRegistry();
    const changes: string[] = [];
    registry.on('change', ({ id, reason }) => changes.push(`${reason}:${id}`));
    const off = registry.register({
      id: 'a.copy',
      label: 'Copy',
      targets: ['candlestick'],
      run: noop,
    });
    expect(registry.get('a.copy')).toMatchObject({
      kind: 'button',
      locations: ['contextMenu'],
      order: 1000,
      defaultVisible: true,
      owner: 'app',
    });
    expect(() =>
      registry.register({ id: 'a.copy', label: 'X', targets: ['chart'], run: noop }),
    ).toThrow(/already registered/);
    registry.override('a.copy', { label: 'Copy it', shortcut: 'Mod+C' });
    expect(registry.get('a.copy')!.label).toBe('Copy it');
    registry.restore('a.copy');
    expect(registry.get('a.copy')!.label).toBe('Copy');
    registry.setEnabled('a.copy', false);
    expect(registry.isEnabledFlag('a.copy')).toBe(false);
    off();
    expect(registry.has('a.copy')).toBe(false);
    expect(changes).toEqual([
      'register:a.copy',
      'override:a.copy',
      'override:a.copy',
      'enabled:a.copy',
      'unregister:a.copy',
    ]);
  });

  it('validates definitions and removes plugin-owned actions together', () => {
    const registry = new ActionRegistry();
    expect(() => registry.register({ id: 'bad id', label: 'x', run: noop })).toThrow(
      /invalid action id/,
    );
    expect(() =>
      registry.register({ id: 'menu.only', label: 'x', locations: ['contextMenu'], run: noop }),
    ).toThrow(/no targets/);
    expect(() => registry.register({ id: 'nothing', label: 'x' })).toThrow(/does nothing/);
    expect(() => registry.register({ id: 'sel', label: 'x', options: () => [] })).toThrow(
      /needs options, value and select/,
    );
    registry.register({ id: 'p.one', label: 'x', run: noop }, { owner: 'plugin-x' });
    registry.register({ id: 'p.two', label: 'x', run: noop }, { owner: 'plugin-x' });
    registry.register({ id: 'other', label: 'x', run: noop });
    expect(registry.unregisterOwner('plugin-x')).toBe(2);
    expect(registry.list().map((a) => a.id)).toEqual(['other']);
  });
});

const item = (
  key: string,
  extra: Partial<Extract<MenuEntry, { type: 'item' }>> = {},
): MenuEntry => ({
  type: 'item',
  key,
  actionId: key,
  label: key,
  path: '',
  disabled: false,
  checked: null,
  info: false,
  children: null,
  searchable: false,
  confirm: null,
  run: noop,
  ...extra,
});

describe('ContextMenuController', () => {
  const entries = (): MenuEntry[] => [
    item('Reset'),
    { type: 'separator', key: 's1' },
    item('Disabled', { disabled: true }),
    item('Theme', {
      run: null,
      children: [item('Dark', { path: 'Theme' }), item('Light', { path: 'Theme' })],
    }),
    item('Delete', { confirm: 'Sure?' }),
  ];

  it('navigates with arrows (skipping separators and disabled items) and opens submenus by direction', () => {
    const menu = new ContextMenuController();
    menu.show({
      x: 10,
      y: 10,
      target: null,
      entries: entries(),
      direction: 'ltr',
      source: 'keyboard',
    });
    expect(menu.state.path).toEqual([0]);
    menu.handleKey('ArrowDown');
    expect(menu.state.path).toEqual([3]);
    menu.handleKey('ArrowLeft'); // nothing to close at the root
    menu.handleKey('ArrowRight');
    expect(menu.state.path).toEqual([3, 0]);
    menu.handleKey('ArrowDown');
    expect(menu.state.path).toEqual([3, 1]);
    menu.handleKey('Escape');
    expect(menu.state.path).toEqual([3]);
    menu.handleKey('End');
    expect(menu.state.path).toEqual([4]);
    menu.handleKey('Home');
    expect(menu.state.path).toEqual([0]);
    menu.handleKey('t'); // type-ahead
    expect(menu.state.path).toEqual([3]);

    const rtl = new ContextMenuController();
    rtl.show({
      x: 10,
      y: 10,
      target: null,
      entries: entries(),
      direction: 'rtl',
      source: 'keyboard',
    });
    rtl.handleKey('ArrowUp');
    rtl.handleKey('ArrowUp');
    expect(rtl.state.path).toEqual([3]);
    rtl.handleKey('ArrowRight'); // in RTL "right" goes back, not into the submenu
    expect(rtl.state.path).toEqual([3]);
    rtl.handleKey('ArrowLeft');
    expect(rtl.state.path).toEqual([3, 0]);
    rtl.handleKey('ArrowRight');
    expect(rtl.state.path).toEqual([3]);
  });

  it('executes, confirms, closes and reports errors', () => {
    const run = vi.fn();
    const menu = new ContextMenuController();
    const executed: string[] = [];
    const errors: string[] = [];
    menu.on('execute', ({ actionId }) => executed.push(actionId));
    menu.on('error', ({ actionId }) => errors.push(actionId));
    const list: MenuEntry[] = [
      item('Run', { run }),
      item('Delete', { confirm: 'Sure?', run }),
      item('Boom', {
        run: () => {
          throw new Error('boom');
        },
      }),
    ];
    menu.show({ x: 0, y: 0, target: null, entries: list, direction: 'ltr', source: 'mouse' });
    expect(menu.state.path).toEqual([-1]);
    menu.activate(0, 1);
    expect(menu.state.confirm?.message).toBe('Sure?');
    menu.handleKey('Escape');
    expect(menu.state.confirm).toBeNull();
    expect(menu.state.open).toBe(true);
    menu.activate(0, 1);
    menu.handleKey('Enter');
    expect(run).toHaveBeenCalledTimes(1);
    expect(menu.state.open).toBe(false);
    menu.show({ x: 0, y: 0, target: null, entries: list, direction: 'ltr', source: 'mouse' });
    menu.activate(0, 2);
    expect(errors).toEqual(['Boom']);
    expect(executed).toEqual(['Delete']);
    menu.show({ x: 0, y: 0, target: null, entries: [], direction: 'ltr', source: 'mouse' });
    expect(menu.state.open).toBe(false); // nothing to show
  });

  it('searches through nested items', () => {
    const results = searchEntries(entries(), 'lig');
    expect(results.map((r) => `${r.path}/${r.label}`)).toEqual(['Theme/Light']);
    const menu = new ContextMenuController();
    menu.show({ x: 0, y: 0, target: null, entries: entries(), direction: 'ltr', source: 'mouse' });
    menu.setQuery('dark');
    expect(menu.levelEntries(0).map((e) => (e.type === 'item' ? e.label : '-'))).toEqual(['Dark']);
    expect(menu.state.path).toEqual([0]);
    menu.handleKey('Escape');
    expect(menu.state.query).toBe('');
    expect(menu.state.open).toBe(true);
  });
});

describe('positioning', () => {
  const viewport = { width: 800, height: 600 };
  const size = { width: 200, height: 300 };
  it('opens after the point in the reading direction, flips at the edges and clamps', () => {
    expect(placeMenu({ x: 100, y: 100 }, size, viewport, 'ltr')).toMatchObject({
      left: 100,
      top: 100,
      flippedX: false,
    });
    expect(placeMenu({ x: 100, y: 100 }, size, viewport, 'rtl')).toMatchObject({
      left: 100,
      flippedX: true,
    });
    expect(placeMenu({ x: 300, y: 100 }, size, viewport, 'rtl')).toMatchObject({ left: 100 });
    expect(placeMenu({ x: 700, y: 100 }, size, viewport, 'ltr')).toMatchObject({
      left: 500,
      flippedX: true,
    });
    expect(placeMenu({ x: 100, y: 500 }, size, viewport, 'ltr')).toMatchObject({
      top: 200,
      flippedY: true,
    });
    expect(
      placeMenu({ x: 100, y: 100 }, { width: 200, height: 900 }, viewport, 'ltr'),
    ).toMatchObject({ top: 4, maxHeight: 592 });
  });

  it('places submenus beside their item, mirrored in RTL', () => {
    const itemRect = { left: 300, top: 100, width: 200, height: 30 };
    expect(placeSubmenu(itemRect, size, viewport, 'ltr').left).toBe(500);
    expect(placeSubmenu(itemRect, size, viewport, 'rtl').left).toBe(100);
    expect(placeSubmenu({ ...itemRect, left: 550 }, size, viewport, 'ltr')).toMatchObject({
      left: 350,
      flippedX: true,
    });
  });
});

describe('toolbar layout', () => {
  it('applies user placement over defaults, groups and reorders', () => {
    const registry = new ActionRegistry();
    registry.register({
      id: 'h.a',
      label: 'A',
      section: 'left',
      group: 'g1',
      order: 10,
      run: noop,
    });
    registry.register({
      id: 'h.b',
      label: 'B',
      section: 'left',
      group: 'g1',
      order: 20,
      run: noop,
    });
    registry.register({
      id: 'h.c',
      label: 'C',
      section: 'right',
      group: 'g2',
      order: 10,
      run: noop,
      locations: ['header', 'sidebar'],
    });
    registry.register({
      id: 's.d',
      label: 'D',
      locations: ['sidebar'],
      group: 'tools',
      order: 10,
      run: noop,
      defaultVisible: false,
    });
    let prefs = defaultUiPreferences();
    let header = headerLayout(placeActions(registry.list(), prefs));
    expect(header.left[0]!.items.map((i) => i.action.id)).toEqual(['h.a', 'h.b']);
    expect(sidebarLayout(placeActions(registry.list(), prefs))).toEqual([]);
    prefs = defaultUiPreferences({
      actions: {
        ...reorderPlacements({}, ['h.a', 'h.b'], 'h.b', 0),
        'h.c': { location: 'sidebar' },
        's.d': { visible: true },
      },
    });
    const items = placeActions(registry.list(), prefs);
    header = headerLayout(items);
    expect(header.left[0]!.items.map((i) => i.action.id)).toEqual(['h.b', 'h.a']);
    expect(header.right).toEqual([]);
    expect(sidebarLayout(items).flatMap((g) => g.items.map((i) => i.action.id))).toEqual([
      'h.c',
      's.d',
    ]);
    // A location the action does not support is ignored.
    const ignored = placeActions(
      registry.list(),
      defaultUiPreferences({ actions: { 'h.a': { location: 'sidebar' } } }),
    );
    expect(ignored.find((i) => i.action.id === 'h.a')!.location).toBe('header');
  });
});

describe('preferences', () => {
  it('validates, sanitises and migrates', () => {
    const v0 = validateUiPreferences({
      hiddenMenuActions: ['chart.exportData', 'bad id'],
      density: 'huge',
      locale: 'fa',
    });
    expect(v0).toMatchObject({
      version: 3,
      contextMenu: { hidden: ['chart.exportData'] },
      density: 'comfortable',
      locale: 'fa',
    });
    // Version 1 → 2 adds the legend and price markers with their defaults.
    const v1 = validateUiPreferences({ version: 1, density: 'compact' });
    expect(v1.version).toBe(3);
    // Version 2 → 3 adds symbol, trade and extension preferences with their defaults.
    expect(v1.symbols).toEqual({ mode: null, favorites: [], recent: [] });
    expect(v1.trade).toEqual({ confirmOrders: true, axisButton: true });
    expect(v1.extensions).toEqual({});
    expect(v1.density).toBe('compact');
    expect(v1.legend).toEqual(defaultUiPreferences().legend);
    expect(v1.markers).toEqual(defaultUiPreferences().markers);
    // Invalid legend and marker entries are dropped, valid ones kept.
    const v2 = validateUiPreferences({
      version: 2,
      legend: { visible: false, fields: { timestamp: true, open: 'yes', bogus: true } },
      markers: { highLow: true, previousClose: 1 },
    });
    expect(v2.legend.visible).toBe(false);
    expect(v2.legend.fields.timestamp).toBe(true);
    expect(v2.legend.fields.open).toBe(true);
    expect(v2.legend.fields).not.toHaveProperty('bogus');
    expect(v2.markers).toMatchObject({ highLow: true, previousClose: false });
    const p = validateUiPreferences({
      version: 1,
      actions: {
        'h.a': { visible: false, location: 'nowhere', order: 5 },
        'bad id': { visible: true },
      },
      shortcuts: { 'h.a': 'Mod+K', 'h.b': null, 'h.c': 42 },
      sidebar: { position: 'end', mode: 'floating' },
    });
    expect(p.actions).toEqual({ 'h.a': { visible: false, order: 5 } });
    expect(p.shortcuts).toEqual({ 'h.a': 'Mod+K', 'h.b': null });
    expect(p.sidebar).toEqual({ position: 'end', mode: 'floating' });
    expect(() => validateUiPreferences({ version: 9 })).toThrow(/newer than supported/);
    expect(() => validateUiPreferences({ f: () => 1 })).toThrow();
  });

  it('saves through a storage adapter (debounced), loads, imports and exports', async () => {
    vi.useFakeTimers();
    try {
      const storage = createMemoryStorage<UiPreferences>({ validate: validateUiPreferences });
      const store = new UiPreferencesStore({ storage, debounceMs: 100, now: () => 42 });
      const statuses: string[] = [];
      store.on('status', ({ status }) => statuses.push(status));
      store.update({ density: 'compact' });
      store.update({ locale: 'ar' });
      expect(await storage.load('ui-preferences')).toBeNull();
      await vi.advanceTimersByTimeAsync(100);
      expect(await storage.load('ui-preferences')).toMatchObject({
        density: 'compact',
        locale: 'ar',
        revision: 1,
        savedAt: 42,
      });
      expect(statuses).toEqual(['dirty', 'saving', 'saved']);
      const json = store.exportJson();
      expect(JSON.parse(json)).not.toHaveProperty('revision');
      const other = new UiPreferencesStore({ storage });
      expect(await other.load()).toBe(true);
      expect(other.get().locale).toBe('ar');
      expect(() => other.importJson('{"version":5}')).toThrow(/newer/);
      other.importJson(JSON.stringify({ ...JSON.parse(json), density: 'comfortable' }));
      expect(other.get().density).toBe('comfortable');
      other.reset(['locale']);
      expect(other.get()).toMatchObject({ locale: 'ar', density: 'comfortable' });
      store.destroy();
      other.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('resolves revision conflicts with another tab (latest change wins)', async () => {
    const storage = createMemoryStorage<UiPreferences>({ validate: validateUiPreferences });
    const a = new UiPreferencesStore({ storage, autoSave: false });
    const b = new UiPreferencesStore({ storage, autoSave: false });
    a.update({ density: 'compact' });
    await a.save();
    b.update({ locale: 'fa' });
    await b.save();
    expect(b.status).toBe('saved');
    expect(await storage.load('ui-preferences')).toMatchObject({ locale: 'fa', revision: 2 });
    expect(StorageConflictError).toBeDefined();
  });

  it('works as a ChartPersistence / workspace provider', () => {
    const store = new UiPreferencesStore({
      autoSave: false,
      defaults: { sidebar: { position: 'end' } },
    });
    const provider = uiPreferencesProvider(store);
    const seen: number[] = [];
    provider.subscribe!(() => seen.push(1));
    store.update({ locale: 'fa' });
    const captured = provider.capture() as Record<string, unknown>;
    expect(captured).toMatchObject({ locale: 'fa', sidebar: { position: 'end' } });
    expect(captured).not.toHaveProperty('revision');
    store.reset();
    void provider.restore(captured);
    expect(store.get().locale).toBe('fa');
    expect(seen.length).toBe(3);
  });
});

describe('utilities', () => {
  it('formats and matches shortcuts per platform', () => {
    expect(formatShortcut('Mod+Shift+Z', false)).toBe('Ctrl+Shift+Z');
    expect(formatShortcut('Mod+Shift+Z', true)).toBe('⇧⌘Z');
    const key = { key: 'z', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true };
    expect(matchShortcut('Mod+Shift+Z', key, false)).toBe(true);
    expect(matchShortcut('Mod+Shift+Z', key, true)).toBe(false);
    expect(
      matchShortcut('Delete', { ...key, key: 'Delete', ctrlKey: false, shiftKey: false }, false),
    ).toBe(true);
  });

  it('labels timeframes in the current language', () => {
    const i18n = createI18n();
    expect(timeframeLabel('15m', i18n)).toBe('15 minutes');
    expect(timeframeLabel('1h', i18n)).toBe('1 hour');
    expect(timeframeLabel('60', i18n)).toBe('60 minutes');
    i18n.setLocale('fa');
    expect(timeframeLabel('1D', i18n)).toBe('۱ روز');
  });
});
