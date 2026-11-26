import type { UiActionDefinition } from '../types.js';
import { MARKER_FIELDS } from '../preferences.js';
import { downloadFile, seriesCsv, timeframeLabel } from '../util.js';
import { drawingToolItems, indicatorItems, mainSeries } from './helpers.js';

/** Background of the chart (and of other panes and data points: general chart actions). */
const BACKGROUND = ['chart', 'pane', 'candlestick', 'series'] as const;

export function chartActions(): UiActionDefinition[] {
  return [
    {
      id: 'chart.resetView',
      label: 'menu.resetView',
      icon: 'reset',
      category: 'view',
      targets: BACKGROUND,
      locations: ['contextMenu'],
      order: 10,
      shortcut: 'Alt+R',
      run: ({ chart }) => {
        chart.timeScale().reset();
        for (const pane of chart.panes()) {
          for (const id of ['right', 'left'])
            chart.priceScale(id, pane.index).applyOptions({ autoScale: true });
        }
      },
    },
    {
      id: 'chart.fitContent',
      label: 'menu.fitContent',
      icon: 'fit',
      category: 'view',
      targets: [...BACKGROUND, 'timeAxis'],
      locations: ['contextMenu'],
      order: 20,
      run: ({ chart }) => chart.timeScale().fitContent(),
    },
    {
      id: 'pane.resetHeights',
      label: 'pane.resetHeights',
      icon: 'fit',
      category: 'pane',
      targets: ['pane'],
      locations: ['contextMenu'],
      isVisible: ({ chart }) => chart.panes().length > 1,
      run: ({ chart }) => chart.panes().forEach((p) => p.setStretchFactor(1)),
    },
    {
      id: 'chart.addIndicator',
      label: 'menu.addIndicator',
      icon: 'indicator',
      category: 'add',
      targets: BACKGROUND,
      locations: ['contextMenu'],
      order: 10,
      requires: ['indicators'],
      searchable: true,
      submenu: indicatorItems,
    },
    {
      id: 'chart.addDrawing',
      label: 'menu.addDrawing',
      icon: 'pencil',
      category: 'add',
      targets: BACKGROUND,
      locations: ['contextMenu'],
      order: 20,
      requires: ['drawings'],
      searchable: true,
      submenu: drawingToolItems,
    },
    {
      id: 'chart.crosshairMode',
      label: 'menu.crosshairMode',
      icon: 'crosshair',
      category: 'chart',
      targets: BACKGROUND,
      locations: ['contextMenu'],
      order: 10,
      options: () => [
        { value: 'normal', label: 'crosshair.normal' },
        { value: 'magnet', label: 'crosshair.magnet' },
        { value: 'hidden', label: 'crosshair.hidden' },
      ],
      value: ({ chart }) => chart.options().crosshair.mode,
      select: ({ chart }, value) =>
        chart.applyOptions({ crosshair: { mode: value as 'normal' | 'magnet' | 'hidden' } }),
    },
    {
      id: 'chart.chartType',
      label: 'menu.chartType',
      icon: 'candles',
      category: 'chart',
      targets: BACKGROUND,
      locations: ['contextMenu', 'header'],
      section: 'left',
      group: 'chart',
      order: 30,
      requires: ['chartType'],
      options: ({ capabilities, i18n }) =>
        capabilities.chartType!.options.map((value) => ({
          value,
          label: i18n.has(`chartType.${value}`) ? `chartType.${value}` : value,
        })),
      value: ({ capabilities }) => capabilities.chartType!.value(),
      select: ({ capabilities }, value) => capabilities.chartType!.set(value),
    },
    {
      id: 'chart.timeframe',
      label: 'menu.timeframe',
      icon: 'clock',
      category: 'chart',
      targets: BACKGROUND,
      locations: ['contextMenu', 'header'],
      section: 'left',
      group: 'chart',
      order: 20,
      requires: ['timeframe'],
      options: ({ capabilities, i18n }) =>
        capabilities.timeframe!.options.map((value) => ({
          value,
          label: timeframeLabel(value, i18n),
        })),
      value: ({ capabilities }) => capabilities.timeframe!.value(),
      select: ({ capabilities }, value) => capabilities.timeframe!.set(value),
    },
    {
      id: 'chart.theme',
      label: 'menu.theme',
      icon: 'theme',
      category: 'chart',
      targets: BACKGROUND,
      locations: ['contextMenu', 'header'],
      section: 'right',
      group: 'preferences',
      order: 10,
      options: () => [
        { value: 'dark', label: 'theme.dark' },
        { value: 'light', label: 'theme.light' },
      ],
      value: ({ chart }) => {
        const theme = chart.options().theme;
        return typeof theme === 'string' ? theme : chart.theme().name;
      },
      // A preference, so it is saved and restored with the other interface settings.
      select: ({ ui }, value) => {
        ui.preferences.update({ theme: value });
      },
    },
    {
      id: 'chart.legend',
      label: 'legend.show',
      icon: 'list',
      kind: 'toggle',
      category: 'chart',
      targets: BACKGROUND,
      locations: ['contextMenu'],
      order: 30,
      isActive: ({ ui }) => ui.preferences.get().legend.visible,
      run: ({ ui }) => {
        ui.preferences.update((p) => ({ legend: { visible: !p.legend.visible } }));
      },
    },
    {
      id: 'chart.priceLabels',
      label: 'settings.markersSection',
      icon: 'ruler',
      category: 'chart',
      targets: [...BACKGROUND, 'priceAxis'],
      locations: ['contextMenu'],
      order: 40,
      submenu: ({ ui }) => {
        const markers = ui.preferences.get().markers;
        return MARKER_FIELDS.map((field) => ({
          id: field,
          label: `markers.field.${field}`,
          checked: markers[field],
          run: () => {
            ui.preferences.update((p) => ({ markers: { [field]: !p.markers[field] } }));
          },
        }));
      },
    },
    {
      id: 'chart.settings',
      label: 'menu.settings',
      icon: 'settings',
      category: 'settings',
      targets: BACKGROUND,
      locations: ['contextMenu'],
      requires: ['openSettings'],
      run: ({ capabilities }) => capabilities.openSettings!(),
    },
    {
      id: 'chart.exportImage',
      label: 'menu.exportImage',
      icon: 'image',
      category: 'export',
      targets: BACKGROUND,
      locations: ['contextMenu'],
      order: 10,
      run: async ({ chart, capabilities }) => {
        const canvas = chart.takeScreenshot();
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, 'image/png'),
        );
        if (!blob) throw new Error('the chart image could not be created');
        downloadFile(
          `chart-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`,
          blob,
          capabilities,
        );
      },
    },
    {
      id: 'chart.exportData',
      label: 'menu.exportData',
      icon: 'download',
      category: 'export',
      targets: BACKGROUND,
      locations: ['contextMenu'],
      order: 20,
      isEnabled: (ctx) => (mainSeries(ctx)?.length() ?? 0) > 0,
      run: (ctx) => {
        const series = ctx.target?.series ?? mainSeries(ctx);
        if (!series) return;
        downloadFile(
          `chart-data-${series.id}.csv`,
          new Blob([seriesCsv(series)], { type: 'text/csv' }),
          ctx.capabilities,
        );
      },
    },
  ];
}
