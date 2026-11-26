import { layoutLabels, safeText } from '@market-chart/core';
import type {
  PriceMarker,
  TradingAlert,
  TradingLabelInput,
  TradingOrder,
  TradingPosition,
} from './types.js';

export type Translate = (key: string, values?: Readonly<Record<string, string | number>>) => string;

const shortType = (t: Translate, type: string): string => {
  const key = `trading.type.${type}`;
  const text = t(key);
  return text === key ? safeText(type, 12).toUpperCase() : text;
};

/** Default label segments of an object (plain text). */
export function defaultLabel(input: TradingLabelInput, t: Translate): string[] {
  const { kind, part, object, preferences: p, compact } = input;
  const out: string[] = [];
  if (kind === 'order') {
    const o = object as TradingOrder;
    const sideText = t(
      compact
        ? o.side === 'buy'
          ? 'trading.buyShort'
          : 'trading.sellShort'
        : o.side === 'buy'
          ? 'trading.buy'
          : 'trading.sell',
    );
    out.push(o.label ?? `${sideText} ${shortType(t, o.type)}`);
    if (p.showQuantity) out.push(formatQuantity(o.quantity));
    if (p.showStatus && (o.status === 'pending' || o.status === 'partial') && !compact)
      out.push(t(`trading.status.${o.status}`));
  } else if (kind === 'position') {
    const o = object as TradingPosition;
    if (part === 'takeProfit') out.push(t('trading.takeProfit'));
    else if (part === 'stopLoss') out.push(t('trading.stopLoss'));
    else {
      out.push(o.label ?? t(o.side === 'buy' ? 'trading.long' : 'trading.short'));
      if (p.showQuantity) out.push(formatQuantity(o.quantity));
      if (p.showPnl && o.pnl) out.push(o.pnl);
    }
  } else if (kind === 'alert') {
    const o = object as TradingAlert;
    out.push(o.label ?? t('trading.alert'));
  } else {
    const o = object as PriceMarker;
    out.push(o.label ?? o.kind ?? t('trading.marker'));
  }
  if (!p.axisLabels && !compact) out.push(input.price);
  return out;
}

/** Default tooltip lines. */
export function defaultTooltip(input: TradingLabelInput, t: Translate): string[] {
  const { kind, part, object } = input;
  const lines: string[] = [];
  if (kind === 'order') {
    const o = object as TradingOrder;
    lines.push(
      `${t(`trading.side.${o.side}`)} · ${safeText(o.type, 24)}${o.label ? ` · ${o.label}` : ''}`,
      t('trading.price', { price: input.price }),
      t('trading.quantity', { quantity: formatQuantity(o.quantity) }),
      t('trading.statusLine', { status: t(`trading.status.${o.status ?? 'working'}`) }),
    );
  } else if (kind === 'position') {
    const o = object as TradingPosition;
    lines.push(
      part === 'takeProfit'
        ? t('trading.takeProfitName')
        : part === 'stopLoss'
          ? t('trading.stopLossName')
          : `${t('trading.position')} · ${t(`trading.side.${o.side}`)}`,
      t('trading.price', { price: input.price }),
      t('trading.quantity', { quantity: formatQuantity(o.quantity) }),
    );
    if (o.pnl) lines.push(t('trading.pnl', { pnl: o.pnl }));
  } else if (kind === 'alert') {
    const o = object as TradingAlert;
    lines.push(o.label ?? t('trading.alertName'), t('trading.price', { price: input.price }));
    if (o.active === false) lines.push(t('trading.inactive'));
  } else {
    const o = object as PriceMarker;
    lines.push(
      o.label ?? o.kind ?? t('trading.marker'),
      t('trading.price', { price: input.price }),
    );
  }
  return lines;
}

/** Quantities as plain numbers without float noise (0.1 + 0.2 → 0.3). */
export function formatQuantity(quantity: number): string {
  if (!Number.isFinite(quantity)) return '';
  return String(Number(quantity.toPrecision(12)));
}

export interface LabelRequest {
  readonly key: string;
  /** Line y (CSS px, pane-relative). */
  readonly y: number;
  /** Width of the label box in CSS px. */
  readonly width: number;
}

export interface LabelBox {
  readonly key: string;
  readonly y: number;
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Places label boxes next to their lines without overlaps (the engine's `layoutLabels`), at the right edge
 * of the pane (next to the price axis) or at the left.
 */
export function layoutTradingLabels(
  requests: readonly LabelRequest[],
  options: {
    readonly paneWidth: number;
    readonly paneHeight: number;
    readonly height: number;
    readonly position: 'left' | 'right';
    readonly margin?: number;
  },
): LabelBox[] {
  const margin = options.margin ?? 6;
  return layoutLabels(requests, options.height, options.paneHeight, 1).map((r) => ({
    key: r.key,
    y: r.y,
    top: r.top,
    width: r.width,
    height: options.height,
    left: options.position === 'right' ? Math.max(0, options.paneWidth - r.width - margin) : margin,
  }));
}
