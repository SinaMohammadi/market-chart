/**
 * `@market-chart/ui/react` — React renderers for the chart interface layer (client-only entry). Every
 * component is optional: use `<ChartInterface>` for everything, or `<ChartHeader>`, `<ChartSidebar>`,
 * `<ChartContextMenu>` and `<ChartSettings>` separately, or the headless hooks for custom UIs.
 */
export { ChartInterface } from './interface.js';
export type { ChartInterfaceProps } from './interface.js';
export { ChartHeader, ChartSidebar, ToolbarItemView, useRovingFocus } from './toolbar.js';
export type {
  ChartHeaderProps,
  ChartSidebarProps,
  ToolbarComponentProps,
  ToolbarItemViewProps,
} from './toolbar.js';
export { ChartContextMenu, useContextMenu } from './context-menu.js';
export { ChartLegend } from './legend.js';
export type { ChartLegendProps } from './legend.js';
export type { ChartContextMenuProps, ContextMenuApi, MenuLevel } from './context-menu.js';
export { ChartSettings } from './settings.js';
export type { ChartSettingsProps } from './settings.js';
export type { SettingsCategory } from './settings-panel.js';
export { Dialog } from './dialog.js';
export type { DialogProps } from './dialog.js';
export {
  DataWindow,
  DrawingDialog,
  ExtensionTreeSections,
  IndicatorDialog,
  ObjectTree,
} from './dialogs.js';
export { Icon, Tooltip } from './icon.js';
export type { IconProps, TooltipProps } from './icon.js';
export {
  ChartUiContext,
  ChartUiProvider,
  useChartUi,
  useChartUiContext,
  useMenuState,
  usePreferences,
  useThemeName,
  useUiVersion,
} from './hooks.js';
export { UI_CSS, UiStylesProvider, useUiStyles } from './styles.js';
export type { UiStylesConfig } from './styles.js';
// Optional features (symbol search, price actions, order ticket): headless hooks and default views.
export {
  SymbolSearchViewContext,
  SymbolSearchViews,
  useOrderTicket,
  usePriceButton,
  useSymbolSearch,
} from './feature-hooks.js';
export type {
  OrderTicketApi,
  SymbolItemRenderInfo,
  SymbolSearchApi,
  SymbolSearchViewOptions,
} from './feature-hooks.js';
export {
  SymbolDropdown,
  SymbolResults,
  SymbolSearchDialog,
  SymbolSearchPanel,
} from './symbol-search.js';
export { OrderTicketDialog, PriceActionButton } from './trade.js';
