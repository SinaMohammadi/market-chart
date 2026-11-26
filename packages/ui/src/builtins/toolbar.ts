import type { ActionContext, UiActionDefinition } from '../types.js';
import { downloadFile, safeText, seriesCsv } from '../util.js';
import { drawingToolItems, indicatorItems, mainSeries, toolIcon } from './helpers.js';

function fullscreenElement(ctx: ActionContext): HTMLElement {
  return (
    ctx.capabilities.fullscreenElement?.() ??
    ctx.chart.element().parentElement ??
    ctx.chart.element()
  );
}

function isFullscreen(): boolean {
  return !!(globalThis as { document?: Document }).document?.fullscreenElement;
}

/** Header actions (some also appear in context menus; see `chartActions`). */
export function headerActions(): UiActionDefinition[] {
  return [
    {
      id: 'header.symbol',
      label: 'header.symbol',
      icon: 'search',
      locations: ['header'],
      section: 'left',
      group: 'symbol',
      order: 10,
      // A plain select over the `symbol` capability, or over a static `symbols.list()`. The symbol-search
      // feature replaces it with its own dropdown and search button.
      isVisible: ({ ui, capabilities }) =>
        !ui.symbols && (!!capabilities.symbol || !!capabilities.symbols?.list),
      options: ({ capabilities }) => {
        const { symbol, symbols } = capabilities;
        if (symbol) return symbol.options?.() ?? [{ value: symbol.value(), label: symbol.value() }];
        const list = symbols!.list!().map((item) => ({
          value: item.symbol,
          label: safeText(item.symbol, 64),
        }));
        const current = symbols!.value();
        return list.some((c) => c.value === current)
          ? list
          : [{ value: current, label: safeText(current, 64) }, ...list];
      },
      value: ({ capabilities }) => (capabilities.symbol ?? capabilities.symbols!).value(),
      select: ({ capabilities }, value) =>
        (capabilities.symbol ?? capabilities.symbols!).set(value),
    },
    {
      id: 'header.compare',
      label: 'header.compare',
      icon: 'compare',
      locations: ['header'],
      section: 'left',
      group: 'symbol',
      order: 20,
      requires: ['compare'],
      // With symbol search and `compare.add`, the search opens in compare mode; otherwise the app's dialog.
      isVisible: ({ ui, capabilities }) =>
        !!capabilities.compare!.open || (!!capabilities.compare!.add && !!ui.symbols),
      run: ({ ui, capabilities }) => {
        if (capabilities.compare!.add && ui.symbols) ui.symbols.open({ purpose: 'compare' });
        else capabilities.compare!.open?.();
      },
    },
    {
      id: 'header.indicators',
      label: 'header.indicators',
      icon: 'indicator',
      locations: ['header', 'sidebar'],
      section: 'left',
      group: 'studies',
      order: 40,
      requires: ['indicators'],
      kind: 'menu',
      searchable: true,
      submenu: indicatorItems,
    },
    {
      id: 'header.drawingTools',
      label: 'header.drawingTools',
      icon: 'pencil',
      locations: ['header'],
      section: 'left',
      group: 'studies',
      order: 50,
      defaultVisible: false,
      requires: ['drawings'],
      kind: 'menu',
      searchable: true,
      submenu: drawingToolItems,
    },
    {
      id: 'header.undo',
      label: 'header.undo',
      icon: 'undo',
      locations: ['header'],
      section: 'left',
      group: 'history',
      order: 60,
      shortcut: 'Mod+Z',
      requires: ['drawings'],
      isEnabled: ({ capabilities }) => capabilities.drawings!.canUndo(),
      run: ({ capabilities }) => capabilities.drawings!.undo(),
    },
    {
      id: 'header.redo',
      label: 'header.redo',
      icon: 'redo',
      locations: ['header'],
      section: 'left',
      group: 'history',
      order: 70,
      shortcut: 'Mod+Shift+Z',
      requires: ['drawings'],
      isEnabled: ({ capabilities }) => capabilities.drawings!.canRedo(),
      run: ({ capabilities }) => capabilities.drawings!.redo(),
    },
    {
      id: 'header.saveLayout',
      label: 'header.saveLayout',
      icon: 'save',
      locations: ['header'],
      section: 'right',
      group: 'layout',
      order: 10,
      shortcut: 'Mod+S',
      requires: ['saveLayout'],
      run: ({ capabilities }) => capabilities.saveLayout!(),
    },
    {
      id: 'header.loadWorkspace',
      label: 'header.loadWorkspace',
      icon: 'folder',
      locations: ['header'],
      section: 'right',
      group: 'layout',
      order: 20,
      requires: ['loadWorkspace'],
      run: ({ capabilities }) => capabilities.loadWorkspace!(),
    },
    {
      id: 'header.language',
      label: 'header.language',
      icon: 'globe',
      locations: ['header'],
      section: 'right',
      group: 'preferences',
      order: 20,
      options: ({ i18n }) => i18n.locales().map((l) => ({ value: l.code, label: l.name })),
      value: ({ i18n }) => i18n.locale,
      select: ({ ui }, value) => {
        ui.preferences.update({ locale: value });
      },
    },
    {
      id: 'header.settings',
      label: 'header.settings',
      icon: 'settings',
      locations: ['header', 'sidebar'],
      section: 'right',
      group: 'preferences',
      order: 30,
      requires: ['openSettings'],
      run: ({ capabilities }) => capabilities.openSettings!(),
    },
    {
      id: 'header.screenshot',
      label: 'header.screenshot',
      icon: 'camera',
      locations: ['header'],
      section: 'right',
      group: 'export',
      order: 10,
      shortcut: 'Alt+S',
      run: async ({ chart, capabilities }) => {
        const blob = await new Promise<Blob | null>((resolve) =>
          chart.takeScreenshot().toBlob(resolve, 'image/png'),
        );
        if (!blob) throw new Error('the chart image could not be created');
        downloadFile('chart.png', blob, capabilities);
      },
    },
    {
      id: 'header.export',
      label: 'header.export',
      icon: 'download',
      locations: ['header'],
      section: 'right',
      group: 'export',
      order: 20,
      defaultVisible: false,
      kind: 'menu',
      submenu: (ctx) => [
        {
          id: 'image',
          label: 'menu.exportImage',
          icon: 'image',
          run: () => ctx.ui.actions.execute('header.screenshot', 'header'),
        },
        {
          id: 'data',
          label: 'menu.exportData',
          icon: 'download',
          disabled: !mainSeries(ctx),
          run: () => {
            const series = mainSeries(ctx);
            if (series)
              downloadFile(
                `chart-data-${series.id}.csv`,
                new Blob([seriesCsv(series)], { type: 'text/csv' }),
                ctx.capabilities,
              );
          },
        },
      ],
    },
    {
      id: 'header.fullscreen',
      label: (ctx) => ctx.t(isFullscreen() ? 'header.exitFullscreen' : 'header.fullscreen'),
      icon: 'fullscreen',
      locations: ['header'],
      section: 'right',
      group: 'export',
      order: 30,
      isActive: () => isFullscreen(),
      run: async (ctx) => {
        const doc = (globalThis as { document?: Document }).document;
        if (!doc) return;
        if (doc.fullscreenElement) await doc.exitFullscreen();
        else await fullscreenElement(ctx).requestFullscreen();
      },
    },
  ];
}

/** Sidebar: cursor modes, every drawing tool (grouped by category), magnet, and chart tools. */
export function sidebarActions(): UiActionDefinition[] {
  return [
    {
      id: 'sidebar.cursor',
      label: 'sidebar.cursor',
      icon: 'cursor',
      locations: ['sidebar'],
      group: 'cursors',
      order: 10,
      shortcut: 'Escape',
      requires: ['drawings'],
      isActive: ({ capabilities, chart }) =>
        capabilities.drawings!.activeTool() === null && chart.options().crosshair.mode === 'hidden',
      run: ({ capabilities, chart }) => {
        capabilities.drawings!.setActiveTool(null);
        chart.applyOptions({ crosshair: { mode: 'hidden' } });
      },
    },
    {
      id: 'sidebar.crosshair',
      label: 'sidebar.crosshair',
      icon: 'crosshair',
      locations: ['sidebar'],
      group: 'cursors',
      order: 20,
      isActive: ({ capabilities, chart }) =>
        (capabilities.drawings?.activeTool() ?? null) === null &&
        chart.options().crosshair.mode !== 'hidden',
      run: ({ capabilities, chart }) => {
        capabilities.drawings?.setActiveTool(null);
        if (chart.options().crosshair.mode === 'hidden')
          chart.applyOptions({ crosshair: { mode: 'normal' } });
      },
    },
    ...drawingToolActions(),
    {
      id: 'sidebar.magnet',
      label: 'sidebar.magnet',
      icon: 'magnet',
      locations: ['sidebar'],
      group: 'drawing-options',
      order: 900,
      requires: ['drawings'],
      isActive: ({ capabilities }) => capabilities.drawings!.magnet() !== 'off',
      run: ({ capabilities }) =>
        capabilities.drawings!.setMagnet(
          capabilities.drawings!.magnet() === 'off' ? 'weak' : 'off',
        ),
    },
    {
      id: 'sidebar.removeAll',
      label: 'sidebar.removeAll',
      icon: 'trash',
      locations: ['sidebar'],
      group: 'drawing-options',
      order: 910,
      requires: ['drawings'],
      isEnabled: ({ capabilities }) => capabilities.drawings!.list().length > 0,
      confirm: (ctx) =>
        ctx.t('drawing.deleteConfirm', { count: ctx.capabilities.drawings!.list().length }),
      run: ({ capabilities }) => capabilities.drawings!.clear(),
    },
    ...panelAction('watchlist', 'sidebar.watchlist', 'list', 1000),
    ...panelAction('objectTree', 'sidebar.objectTree', 'tree', 1010),
    ...panelAction('dataWindow', 'sidebar.dataInspector', 'database', 1020),
    ...panelAction('alerts', 'sidebar.alerts', 'bell', 1030),
  ];
}

function panelAction(
  panel: string,
  label: string,
  icon: string,
  order: number,
): UiActionDefinition[] {
  return [
    {
      id: `sidebar.${panel}`,
      label,
      icon,
      locations: ['sidebar', 'header'],
      section: 'right',
      group: 'panels',
      order,
      requires: ['panels'],
      isVisible: ({ capabilities }) => !!capabilities.panels?.[panel],
      isActive: ({ capabilities }) => capabilities.panels?.[panel]?.isOpen() === true,
      run: ({ capabilities }) => capabilities.panels![panel]!.toggle(),
    },
  ];
}

/**
 * One action per drawing tool of the built-in registry, grouped by category (the sidebar shows each group as
 * a flyout). Tools only call `DrawingManager.setActiveTool`, so all tool logic stays in drawing-tools.
 * Custom tools registered later get actions through `ui.actions.register` or `toolAction()`.
 */
const TOOLS: readonly [string, string][] = [
  ['trend-line', 'lines'],
  ['ray', 'lines'],
  ['extended-line', 'lines'],
  ['arrow', 'lines'],
  ['horizontal-line', 'lines'],
  ['horizontal-ray', 'lines'],
  ['vertical-line', 'lines'],
  ['parallel-channel', 'shapes'],
  ['rectangle', 'shapes'],
  ['circle', 'shapes'],
  ['ellipse', 'shapes'],
  ['fib-retracement', 'fibonacci'],
  ['fib-extension', 'fibonacci'],
  ['fib-fan', 'fibonacci'],
  ['fib-channel', 'fibonacci'],
  ['fib-time-zones', 'fibonacci'],
  ['fib-arcs', 'fibonacci'],
  ['fib-wedge', 'fibonacci'],
  ['gann-fan', 'gann'],
  ['gann-box', 'gann'],
  ['pitchfork', 'patterns'],
  ['schiff-pitchfork', 'patterns'],
  ['regression-channel', 'patterns'],
  ['elliott-impulse', 'patterns'],
  ['elliott-correction', 'patterns'],
  ['cyclic-lines', 'patterns'],
  ['text', 'annotations'],
  ['note', 'annotations'],
  ['callout', 'annotations'],
  ['price-label', 'annotations'],
  ['long-position', 'measure'],
  ['short-position', 'measure'],
  ['price-range', 'measure'],
  ['date-range', 'measure'],
  ['date-price-range', 'measure'],
];

export function toolAction(type: string, category: string, order: number): UiActionDefinition {
  return {
    id: `tool.${type}`,
    label: (ctx) =>
      ctx.i18n.has(`tool.${type}`)
        ? ctx.t(`tool.${type}`)
        : (ctx.capabilities.drawings?.tools().find((t) => t.type === type)?.name ?? type),
    icon: toolIcon(type),
    locations: ['sidebar'],
    group: `tools.${category}`,
    order,
    requires: ['drawings'],
    isVisible: ({ capabilities }) => capabilities.drawings!.tools().some((t) => t.type === type),
    isActive: ({ capabilities }) => capabilities.drawings!.activeTool() === type,
    run: ({ capabilities }) =>
      capabilities.drawings!.setActiveTool(
        capabilities.drawings!.activeTool() === type ? null : type,
      ),
  };
}

function drawingToolActions(): UiActionDefinition[] {
  return TOOLS.map(([type, category], i) => toolAction(type, category, 100 + i));
}
