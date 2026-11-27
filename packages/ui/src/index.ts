/**
 * `@market-chart/ui` — the chart interface layer: one action registry shared by context menus, the header and
 * the sidebar; target-aware context menus; configurable toolbars; user preferences saved through
 * `@market-chart/persistence`; translations from `@market-chart/i18n`. Headless and framework independent;
 * React components are in `@market-chart/ui/react`. Nothing touches the DOM at import time.
 */
export { ChartUi, createChartUi } from './chart-ui.js';
export type { ChartUiEvents, ChartUiOptions } from './chart-ui.js';
export { ActionRegistry, UiError } from './registry.js';
export type { ActionRegistryEvents } from './registry.js';
export {
  CATEGORY_ORDER,
  ContextMenuController,
  buildEntries,
  foldText,
  resolveTarget,
  searchEntries,
} from './menu.js';
export type {
  ContextMenuEvents,
  ContextMenuState,
  MenuEntry,
  MenuItemEntry,
  MenuSeparatorEntry,
} from './menu.js';
export { placeMenu, placeSubmenu } from './position.js';
export type { Placement, Rect, Size } from './position.js';
export {
  groupItems,
  headerLayout,
  placeActions,
  reorderPlacements,
  sidebarLayout,
} from './layout.js';
export type { HeaderLayout, ToolbarGroup, ToolbarItem, ToolbarLocation } from './layout.js';
export { legendData } from './legend.js';
export type { LegendData, LegendIndicatorRow, LegendItem } from './legend.js';
export { PriceMarkers, previousPoint } from './markers.js';
export type { MarkerValues } from './markers.js';
export {
  LEGEND_FIELDS,
  MARKER_FIELDS,
  MAX_EXTENSION_PREFERENCES_SIZE,
  MAX_FAVORITE_SYMBOLS,
  MAX_PREFERENCE_ENTRIES,
  MAX_RECENT_SYMBOLS,
  SYMBOL_SELECTOR_MODES,
  UI_PREFERENCES_VERSION,
  UiPreferencesStore,
  defaultUiPreferences,
  isStoredSymbol,
  mergePreferences,
  uiPreferencesProvider,
  validateUiPreferences,
} from './preferences.js';
export type {
  ActionPlacement,
  Density,
  LegendField,
  LegendPreferences,
  MarkerField,
  MarkerPreferences,
  PreferencesStatus,
  SidebarMode,
  SidebarPosition,
  SymbolPreferences,
  SymbolSelectorMode,
  TradePreferences,
  UiPreferences,
  UiPreferencesEvents,
  UiPreferencesPatch,
  UiPreferencesStoreOptions,
} from './preferences.js';
export { builtInActions, toolAction } from './builtins/index.js';
export { toolIcon } from './builtins/helpers.js';
export {
  MAX_ICON_PATH_LENGTH,
  iconNames,
  iconPath,
  isDirectionalIcon,
  registerIcon,
} from './icons.js';
export {
  copyText,
  csvCell,
  csvRow,
  downloadFile,
  formatShortcut,
  matchShortcut,
  parseShortcut,
  safeFileName,
  safeText,
  seriesCsv,
  shortcutKeyOf,
  timeframeLabel,
} from './util.js';
export type { KeyLike } from './util.js';
export type {
  ActionContext,
  ActionKind,
  ActionLocation,
  CapabilityName,
  ChartUiCapabilities,
  SessionCapability,
  ReservedArea,
  Choice,
  ContextTarget,
  ContextTargetKind,
  HeaderSection,
  OrderSide,
  OrderSubmitResult,
  OrderTicketSubmission,
  PriceContext,
  PriceObjectTarget,
  SubmenuItem,
  SymbolItem,
  SymbolSearchRequest,
  SymbolSource,
  TicketField,
  TicketValues,
  TradingCapability,
  UiAction,
  UiActionDefinition,
} from './types.js';
export { SectionList } from './extensions.js';
export type {
  ChartUiFeature,
  ContextMenuInterceptor,
  KeyHandler,
  ObjectTreeItem,
  ObjectTreeItemAction,
  ObjectTreeSection,
  SettingsField,
  SettingsSection,
  TargetResolver,
} from './extensions.js';
// Optional features: import only what you install (each is tree-shaken away otherwise).
export {
  ALL_SYMBOLS,
  FAVORITE_SYMBOLS,
  RECENT_SYMBOLS,
  SymbolSearch,
  filterSymbols,
  normalizeSymbolItem,
  symbolRank,
  symbolSearch,
  symbolSourceOf,
} from './symbols.js';
export type {
  SymbolSearchEvents,
  SymbolSearchOptions,
  SymbolSearchState,
  SymbolSearchStatus,
} from './symbols.js';
export {
  PRICE_TARGETS,
  PriceActions,
  builtInPriceActions,
  priceActions,
  tickSizeOf,
} from './price-actions.js';
/** Re-exported from the engine. */
export { roundToTick } from '@market-chart/core';
export type { PriceActionsEvents, PriceActionsOptions, PriceButtonState } from './price-actions.js';
export {
  OrderTicket,
  defaultTicketFields,
  orderTicket,
  parseTicketNumber,
  validateTicket,
} from './order-ticket.js';
export type { OrderTicketEvents, OrderTicketState, OrderTicketStatus } from './order-ticket.js';
