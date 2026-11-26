/**
 * `@market-chart/trading` — the application's own orders, positions (with take-profit and stop-loss), alerts
 * and custom markers, drawn at their prices on a `@market-chart/core` chart. Optional interaction (drag to
 * modify, cancel buttons, clicks, tooltips) calls the application's callbacks; with a `ChartUi` it adds
 * context-menu targets, an object-tree section and a "Trading" settings category.
 *
 * The library never trades: it has no broker code and sends nothing anywhere. The application owns accounts,
 * validation and execution. Nothing touches the DOM at import time.
 */
export {
  DEFAULT_TRADING_COLORS,
  TRADING_PREFERENCES_KEY,
  TradingOverlay,
  createTradingOverlay,
} from './overlay.js';
export type { TradingHit, TradingItem, TradingOverlayEvents } from './overlay.js';
export { attachTradingUi } from './ui-bridge.js';
export {
  DEFAULT_TRADING_PREFERENCES,
  MAX_TRADING_OBJECTS,
  TradingError,
  isSafeColor,
  normalizeAlert,
  normalizeMarker,
  normalizeOrder,
  normalizePosition,
  validateTradingPreferences,
} from './validate.js';
export { defaultLabel, defaultTooltip, formatQuantity, layoutTradingLabels } from './layout.js';
export type { LabelBox, LabelRequest } from './layout.js';
export {
  tradingMessages,
  tradingMessagesAr,
  tradingMessagesEn,
  tradingMessagesFa,
} from './messages.js';
export type { TradingMessageKey } from './messages.js';
export type {
  OrderStatus,
  PriceMarker,
  TradingAlert,
  TradingColors,
  TradingLabelInput,
  TradingObject,
  TradingObjectInfo,
  TradingObjectKind,
  TradingObjectPart,
  TradingOrder,
  TradingOverlayOptions,
  TradingPosition,
  TradingPreferences,
  TradingSide,
} from './types.js';
