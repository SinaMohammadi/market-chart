import { createDigitLocalizer, createPriceFormatter } from '@market-chart/core';
import type { SeriesApi } from '@market-chart/core';
import type { ActionContext, SubmenuItem } from '../types.js';

/** The chart's first series (the main price series in typical layouts). */
export function mainSeries(ctx: ActionContext): SeriesApi | undefined {
  const indicators = ctx.capabilities.indicators;
  return (
    ctx.chart.series().find((s) => !indicators?.indicatorForSeries(s)) ?? ctx.chart.series()[0]
  );
}

/** Price formatted like the series' axis labels, with locale digits when the user wants them. */
export function formatPrice(ctx: ActionContext, price: number, series?: SeriesApi): string {
  const format = (series ?? mainSeries(ctx))?.options().priceFormat;
  const text = createPriceFormatter(format ?? { type: 'price', precision: 2 })(price);
  const localDigits = ctx.ui.preferences.get().localDigits && ctx.i18n.numerals === 'native';
  return localDigits ? (createDigitLocalizer(ctx.i18n.formatLocale)?.(text) ?? text) : text;
}

export function formatTime(ctx: ActionContext, time: number): string {
  const timeZone = ctx.chart.options().localization.timeZone;
  try {
    return ctx.i18n.formatDate(time, { dateStyle: 'medium', timeStyle: 'short', timeZone });
  } catch {
    return ctx.i18n.formatDate(time);
  }
}

/** Drawing tools grouped by category, as nested submenu items that activate the tool. */
export function drawingToolItems(ctx: ActionContext): SubmenuItem[] {
  const drawings = ctx.capabilities.drawings;
  if (!drawings) return [];
  const byCategory = new Map<string, SubmenuItem[]>();
  const active = drawings.activeTool();
  for (const tool of drawings.tools()) {
    let list = byCategory.get(tool.category);
    if (!list) byCategory.set(tool.category, (list = []));
    list.push({
      id: tool.type,
      label: ctx.i18n.has(`tool.${tool.type}`) ? `tool.${tool.type}` : tool.name,
      icon: toolIcon(tool.type),
      checked: active === tool.type,
      run: () => drawings.setActiveTool(tool.type),
    });
  }
  return [...byCategory].map(([category, children]) => ({
    id: `category-${category}`,
    label: ctx.i18n.has(`toolCategory.${category}`) ? `toolCategory.${category}` : category,
    icon: toolIcon(children[0]!.id),
    children,
  }));
}

/** Indicators grouped by category; selecting one adds it to the main series. */
export function indicatorItems(ctx: ActionContext): SubmenuItem[] {
  const indicators = ctx.capabilities.indicators;
  const source = mainSeries(ctx);
  if (!indicators || !source) return [];
  const byCategory = new Map<string, SubmenuItem[]>();
  for (const definition of indicators.registry.list()) {
    let list = byCategory.get(definition.category);
    if (!list) byCategory.set(definition.category, (list = []));
    list.push({
      id: definition.type,
      label: ctx.i18n.has(`indicatorName.${definition.type}`)
        ? `indicatorName.${definition.type}`
        : definition.name,
      run: () => {
        indicators.add(definition.type, source);
      },
    });
  }
  return [...byCategory].map(([category, children]) => ({
    id: `category-${category}`,
    label: ctx.i18n.has(`indicatorCategory.${category}`)
      ? `indicatorCategory.${category}`
      : category,
    children,
  }));
}

const TOOL_ICONS: Record<string, string> = {
  'trend-line': 'tool-line',
  ray: 'tool-ray',
  'extended-line': 'tool-line',
  arrow: 'arrow',
  'horizontal-line': 'tool-hline',
  'horizontal-ray': 'tool-hline',
  'vertical-line': 'tool-vline',
  rectangle: 'rect',
  circle: 'circle',
  ellipse: 'circle',
  'parallel-channel': 'channel',
  'regression-channel': 'channel',
  text: 'text',
  note: 'note',
  callout: 'note',
  'price-label': 'note',
  'long-position': 'position-long',
  'short-position': 'position-short',
  'price-range': 'ruler',
  'date-range': 'ruler',
  'date-price-range': 'ruler',
  pitchfork: 'pitchfork',
  'schiff-pitchfork': 'pitchfork',
  'gann-fan': 'gann',
  'gann-box': 'gann',
  'elliott-impulse': 'pattern',
  'elliott-correction': 'pattern',
  'cyclic-lines': 'pattern',
};

export function toolIcon(type: string): string {
  if (type.startsWith('fib-')) return 'fib';
  return TOOL_ICONS[type] ?? 'pencil';
}
