import type { PriceScaleMode } from '@market-chart/core';
import type { ActionContext, SubmenuItem, UiActionDefinition } from '../types.js';
import { copyText } from '../util.js';
import { formatPrice, formatTime } from './helpers.js';

const POINT = ['candlestick', 'series'] as const;
const DRAWING = ['drawing', 'drawingHandle'] as const;

/** Price under the pointer, or the point's close/value. */
function pointPrice(ctx: ActionContext): number | null {
  const target = ctx.target;
  if (!target) return null;
  if (target.price !== null && Number.isFinite(target.price)) return target.price;
  const p = target.point as { close?: number; value?: number } | undefined;
  return p?.close ?? p?.value ?? null;
}

export function pointActions(): UiActionDefinition[] {
  return [
    {
      id: 'point.viewOhlc',
      label: 'point.viewOhlc',
      icon: 'info',
      category: 'point',
      targets: POINT,
      locations: ['contextMenu'],
      order: 10,
      submenu: (ctx) => {
        const target = ctx.target!;
        const p = target.point as {
          time: number;
          open?: number;
          high?: number;
          low?: number;
          close?: number;
          value?: number;
          volume?: number;
        };
        const rows: SubmenuItem[] = [];
        const price = (v: number) => formatPrice(ctx, v, target.series);
        for (const key of ['open', 'high', 'low', 'close', 'value'] as const) {
          const v = p[key];
          if (typeof v === 'number')
            rows.push({
              id: key,
              label: `point.${key}`,
              labelValues: { value: price(v) },
              info: true,
            });
        }
        if (typeof p.volume === 'number')
          rows.push({
            id: 'volume',
            label: 'point.volume',
            labelValues: { value: ctx.i18n.formatNumber(p.volume) },
            info: true,
          });
        rows.push({
          id: 'time',
          label: 'point.time',
          labelValues: { value: formatTime(ctx, p.time) },
          info: true,
        });
        return rows;
      },
    },
    {
      id: 'point.copyPrice',
      label: 'point.copyPrice',
      labelValues: (ctx) => ({ value: formatPrice(ctx, pointPrice(ctx) ?? 0, ctx.target?.series) }),
      icon: 'copy',
      category: 'point',
      targets: POINT,
      locations: ['contextMenu'],
      order: 20,
      isEnabled: (ctx) => pointPrice(ctx) !== null,
      run: async (ctx) => {
        // The plain number (not localized digits), so it pastes into spreadsheets and order forms.
        const format = ctx.target?.series?.options().priceFormat;
        const precision =
          format && format.type !== 'volume' && 'precision' in format ? (format.precision ?? 2) : 2;
        await copyText(pointPrice(ctx)!.toFixed(precision), ctx.capabilities);
        ctx.ui.notify(ctx.t('common.copied'));
      },
    },
    {
      id: 'point.copyTimestamp',
      label: 'point.copyTimestamp',
      icon: 'clock',
      category: 'point',
      targets: POINT,
      locations: ['contextMenu'],
      order: 30,
      isEnabled: (ctx) => ctx.target?.time !== null,
      run: async (ctx) => {
        await copyText(new Date(ctx.target!.time!).toISOString(), ctx.capabilities);
        ctx.ui.notify(ctx.t('common.copied'));
      },
    },
    {
      id: 'point.horizontalLine',
      label: 'point.horizontalLine',
      labelValues: (ctx) => ({ value: formatPrice(ctx, pointPrice(ctx) ?? 0, ctx.target?.series) }),
      icon: 'tool-hline',
      category: 'point',
      targets: [...POINT, 'chart', 'pane'],
      locations: ['contextMenu'],
      order: 40,
      requires: ['drawings'],
      isVisible: (ctx) => ctx.target?.price !== null && ctx.target?.time !== null,
      run: (ctx) => {
        const target = ctx.target!;
        const series =
          target.series ?? ctx.chart.series().find((s) => s.options().pane === (target.pane ?? 0));
        if (!series) return;
        ctx.capabilities.drawings!.add({
          type: 'horizontal-line',
          seriesId: series.id,
          points: [{ time: target.time!, price: target.price! }],
        });
      },
    },
    {
      id: 'point.createAlert',
      label: 'point.createAlert',
      labelValues: (ctx) => ({ value: formatPrice(ctx, pointPrice(ctx) ?? 0, ctx.target?.series) }),
      icon: 'bell',
      category: 'point',
      targets: [...POINT, 'chart', 'priceAxis'],
      locations: ['contextMenu'],
      order: 50,
      requires: ['alerts'],
      // With the price-actions feature, 'Create alert at…' is in the 'At this price' category instead.
      isVisible: (ctx) => !ctx.ui.priceActions,
      isEnabled: (ctx) => pointPrice(ctx) !== null,
      run: (ctx) =>
        ctx.capabilities.alerts!.create({
          price: pointPrice(ctx)!,
          time: ctx.target?.time ?? null,
          ...(ctx.target?.series ? { series: ctx.target.series } : {}),
        }),
    },
    {
      id: 'point.inspect',
      label: 'point.inspect',
      icon: 'search',
      category: 'point',
      targets: [...POINT, 'indicator'],
      locations: ['contextMenu'],
      order: 60,
      requires: ['inspect'],
      run: (ctx) => ctx.capabilities.inspect!(ctx.target!),
    },
  ];
}

export function drawingActions(): UiActionDefinition[] {
  const selected = (ctx: ActionContext): string[] => {
    const drawings = ctx.capabilities.drawings!;
    const selection = drawings.selection();
    const id = ctx.target?.drawing?.id;
    return id && !selection.includes(id) ? [id] : [...selection];
  };
  const current = (ctx: ActionContext) =>
    ctx.target?.drawing ? ctx.capabilities.drawings!.get(ctx.target.drawing.id) : undefined;
  const base = {
    targets: DRAWING,
    locations: ['contextMenu'] as const,
    requires: ['drawings'] as const,
  };
  return [
    {
      ...base,
      id: 'drawing.edit',
      label: 'drawing.edit',
      icon: 'edit',
      category: 'drawing',
      order: 10,
      requires: ['drawings', 'editDrawingText'],
      isVisible: (ctx) => {
        const d = current(ctx);
        return (
          !!d &&
          ctx.capabilities.drawings!.tools().find((t) => t.type === d.type)?.editableText === true
        );
      },
      run: (ctx) => ctx.capabilities.editDrawingText!(current(ctx)!),
    },
    {
      ...base,
      id: 'drawing.properties',
      label: 'drawing.properties',
      icon: 'sliders',
      category: 'drawing',
      order: 20,
      requires: ['drawings', 'drawingProperties'],
      run: (ctx) => ctx.capabilities.drawingProperties!(current(ctx)!),
    },
    {
      ...base,
      id: 'drawing.duplicate',
      label: 'drawing.duplicate',
      icon: 'duplicate',
      category: 'drawing',
      order: 30,
      shortcut: 'Mod+D',
      run: (ctx) => {
        const drawings = ctx.capabilities.drawings!;
        drawings.copy(selected(ctx));
        drawings.paste();
      },
    },
    {
      ...base,
      id: 'drawing.copy',
      label: 'drawing.copy',
      icon: 'copy',
      category: 'drawing',
      order: 40,
      run: (ctx) => ctx.capabilities.drawings!.copy(selected(ctx)),
    },
    {
      id: 'drawing.paste',
      label: 'drawing.paste',
      icon: 'paste',
      category: 'add',
      targets: [...DRAWING, 'chart', 'pane', 'candlestick', 'series'],
      locations: ['contextMenu'],
      requires: ['drawings'],
      order: 50,
      isVisible: (ctx) => ctx.capabilities.drawings!.canPaste(),
      run: (ctx) => {
        ctx.capabilities.drawings!.paste();
      },
    },
    {
      ...base,
      id: 'drawing.lock',
      label: (ctx) => ctx.t(current(ctx)?.locked ? 'drawing.unlock' : 'drawing.lock'),
      icon: 'lock',
      category: 'drawing-arrange',
      order: 10,
      isActive: (ctx) => current(ctx)?.locked === true,
      run: (ctx) => ctx.capabilities.drawings!.setLocked(!current(ctx)?.locked, selected(ctx)),
    },
    {
      ...base,
      id: 'drawing.visibility',
      label: (ctx) => ctx.t(current(ctx)?.visible === false ? 'drawing.show' : 'drawing.hide'),
      icon: 'eye-off',
      category: 'drawing-arrange',
      order: 20,
      run: (ctx) =>
        ctx.capabilities.drawings!.setVisible(current(ctx)?.visible === false, selected(ctx)),
    },
    {
      ...base,
      id: 'drawing.bringToFront',
      label: 'drawing.bringToFront',
      icon: 'front',
      category: 'drawing-arrange',
      order: 30,
      run: (ctx) => ctx.capabilities.drawings!.bringToFront(selected(ctx)),
    },
    {
      ...base,
      id: 'drawing.sendToBack',
      label: 'drawing.sendToBack',
      icon: 'back',
      category: 'drawing-arrange',
      order: 40,
      run: (ctx) => ctx.capabilities.drawings!.sendToBack(selected(ctx)),
    },
    {
      ...base,
      id: 'drawing.group',
      label: 'drawing.group',
      icon: 'group',
      category: 'drawing-arrange',
      order: 50,
      isVisible: (ctx) => selected(ctx).length > 1,
      run: (ctx) => {
        ctx.capabilities.drawings!.group(selected(ctx));
      },
    },
    {
      ...base,
      id: 'drawing.ungroup',
      label: 'drawing.ungroup',
      icon: 'ungroup',
      category: 'drawing-arrange',
      order: 60,
      isVisible: (ctx) => current(ctx)?.groupId != null,
      run: (ctx) => ctx.capabilities.drawings!.ungroup(selected(ctx)),
    },
    {
      ...base,
      id: 'drawing.delete',
      label: 'drawing.delete',
      icon: 'trash',
      category: 'drawing-danger',
      shortcut: 'Delete',
      confirm: (ctx) => {
        const count = selected(ctx).length;
        return count > 1 ? ctx.t('drawing.deleteConfirm', { count }) : null;
      },
      run: (ctx) => ctx.capabilities.drawings!.remove(selected(ctx)),
    },
  ];
}

export function indicatorActions(): UiActionDefinition[] {
  const indicator = (ctx: ActionContext) => ctx.target?.indicator;
  const base = {
    targets: ['indicator'] as const,
    locations: ['contextMenu'] as const,
    requires: ['indicators'] as const,
  };
  return [
    {
      ...base,
      id: 'indicator.settings',
      label: 'indicator.settings',
      icon: 'sliders',
      category: 'indicator',
      order: 10,
      requires: ['indicators', 'indicatorSettings'],
      run: (ctx) => ctx.capabilities.indicatorSettings!(indicator(ctx)!, 'inputs'),
    },
    {
      ...base,
      id: 'indicator.appearance',
      label: 'indicator.appearance',
      icon: 'palette',
      category: 'indicator',
      order: 20,
      requires: ['indicators', 'indicatorSettings'],
      run: (ctx) => ctx.capabilities.indicatorSettings!(indicator(ctx)!, 'style'),
    },
    {
      ...base,
      id: 'indicator.duplicate',
      label: 'indicator.duplicate',
      icon: 'duplicate',
      category: 'indicator',
      order: 30,
      run: (ctx) => {
        const i = indicator(ctx)!;
        ctx.capabilities.indicators!.add(i.type, i.source, {
          params: i.params(),
          style: i.style(),
          visible: i.visible(),
        });
      },
    },
    {
      ...base,
      id: 'indicator.visibility',
      label: (ctx) =>
        ctx.t(indicator(ctx)?.visible() === false ? 'indicator.show' : 'indicator.hide'),
      icon: 'eye-off',
      category: 'indicator',
      order: 40,
      run: (ctx) => {
        const i = indicator(ctx)!;
        i.setVisible(!i.visible());
      },
    },
    {
      ...base,
      id: 'indicator.moveToPane',
      label: 'indicator.moveToPane',
      icon: 'move',
      category: 'indicator',
      order: 50,
      submenu: (ctx) => {
        const i = indicator(ctx)!;
        const current = i.pane();
        const items: SubmenuItem[] = ctx.chart.panes().map((pane) => ({
          id: `pane-${pane.index}`,
          label: pane.index === 0 ? 'indicator.mainPane' : 'indicator.paneN',
          labelValues: { index: pane.index + 1 },
          checked: pane.index === current,
          disabled: pane.index === current,
          run: () => i.moveToPane(pane.index),
        }));
        items.push({
          id: 'new',
          label: 'indicator.newPane',
          separatorBefore: true,
          run: () => i.moveToPane('new'),
        });
        return items;
      },
    },
    {
      ...base,
      id: 'indicator.reset',
      label: 'indicator.reset',
      icon: 'reset',
      category: 'indicator',
      order: 60,
      run: (ctx) => {
        const i = indicator(ctx)!;
        const defaults: Record<string, unknown> = {};
        for (const [key, spec] of Object.entries(i.definition.inputs)) defaults[key] = spec.default;
        i.setParams(defaults);
        i.setStyle({ outputs: {}, fillsVisible: true, levelsVisible: true });
      },
    },
    {
      ...base,
      id: 'indicator.remove',
      label: 'indicator.remove',
      icon: 'trash',
      category: 'indicator-danger',
      run: (ctx) => indicator(ctx)!.remove(),
    },
  ];
}

export function axisActions(): UiActionDefinition[] {
  const scale = (ctx: ActionContext) =>
    ctx.chart.priceScale(ctx.target?.side ?? 'right', ctx.target?.pane ?? 0);
  const price = {
    targets: ['priceAxis'] as const,
    locations: ['contextMenu'] as const,
    category: 'axis',
  };
  return [
    {
      ...price,
      id: 'axis.resetScale',
      label: 'axis.resetScale',
      icon: 'reset',
      order: 10,
      run: (ctx) => scale(ctx).applyOptions({ autoScale: true }),
    },
    {
      ...price,
      id: 'axis.autoScale',
      label: 'axis.autoScale',
      icon: 'auto',
      order: 20,
      isActive: (ctx) => scale(ctx).options().autoScale,
      run: (ctx) => scale(ctx).applyOptions({ autoScale: !scale(ctx).options().autoScale }),
    },
    {
      ...price,
      id: 'axis.invert',
      label: 'axis.invert',
      icon: 'invert',
      order: 30,
      isActive: (ctx) => scale(ctx).options().invertScale,
      run: (ctx) => scale(ctx).applyOptions({ invertScale: !scale(ctx).options().invertScale }),
    },
    {
      ...price,
      id: 'axis.scaleMode',
      label: 'axis.scaleMode',
      icon: 'scale',
      order: 40,
      options: () =>
        (['normal', 'logarithmic', 'percentage', 'indexed'] as const).map((value) => ({
          value,
          label: `scaleMode.${value}`,
        })),
      value: (ctx) => scale(ctx).options().mode,
      select: (ctx, value) => scale(ctx).applyOptions({ mode: value as PriceScaleMode }),
    },
    {
      id: 'axis.resetTime',
      label: 'axis.resetTime',
      icon: 'reset',
      category: 'axis',
      targets: ['timeAxis'],
      locations: ['contextMenu'],
      order: 10,
      run: (ctx) => ctx.chart.timeScale().reset(),
    },
    {
      id: 'axis.timeVisible',
      label: 'axis.timeVisible',
      icon: 'clock',
      category: 'axis',
      targets: ['timeAxis'],
      locations: ['contextMenu'],
      order: 20,
      isActive: (ctx) => ctx.chart.timeScale().options().timeVisible === true,
      run: (ctx) => {
        const visible = ctx.chart.timeScale().options().timeVisible === true;
        ctx.chart.timeScale().applyOptions({ timeVisible: !visible });
      },
    },
    {
      id: 'axis.settings',
      label: 'axis.settings',
      icon: 'settings',
      category: 'settings',
      targets: ['priceAxis', 'timeAxis'],
      locations: ['contextMenu'],
      requires: ['openSettings'],
      run: (ctx) => ctx.capabilities.openSettings!('appearance'),
    },
  ];
}
