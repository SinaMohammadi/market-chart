import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { Drawing } from '@market-chart/drawing-tools';
import type { IndicatorHandle } from '@market-chart/indicators';
import { useTranslation } from '@market-chart/react';
import type { ChartUi } from '../chart-ui.js';
import { ChartContextMenu } from './context-menu.js';
import { DataWindow, DrawingDialog, IndicatorDialog, ObjectTree } from './dialogs.js';
import { ChartUiProvider, usePreferences, useThemeName, useUiVersion } from './hooks.js';
import { ChartLegend } from './legend.js';
import { ChartSettings } from './settings.js';
import type { SettingsCategory } from './settings-panel.js';
import { useUiStyles } from './styles.js';
import { ChartHeader, ChartSidebar } from './toolbar.js';
import { SymbolSearchViews } from './feature-hooks.js';
import type { SymbolSearchViewOptions } from './feature-hooks.js';

// Feature interfaces load only when the feature is installed (an app that does not opt in never loads them).
const SymbolSearchDialog = lazy(() =>
  import('./symbol-search.js').then((m) => ({ default: m.SymbolSearchDialog })),
);
const PriceActionButton = lazy(() =>
  import('./trade.js').then((m) => ({ default: m.PriceActionButton })),
);
const OrderTicketDialog = lazy(() =>
  import('./trade.js').then((m) => ({ default: m.OrderTicketDialog })),
);

export interface ChartInterfaceProps {
  readonly ui: ChartUi | null;
  /** The chart (usually a `<Chart>` whose ref created `ui`). */
  readonly children: ReactNode;
  readonly header?: boolean;
  readonly sidebar?: boolean;
  /** Default context-menu renderer (pass `false` and render your own with `useContextMenu`). */
  readonly contextMenu?: boolean;
  /** Built-in object tree and data window panels, opened from the sidebar (default true). */
  readonly panels?: boolean;
  /** Built-in indicator settings and drawing property dialogs (default true). */
  readonly dialogs?: boolean;
  /** Legend with the hovered bar's date, time, OHLC, change, volume and indicator values (default true). */
  readonly legend?: boolean;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly height?: CSSProperties['height'];
  /** Custom result, empty and error views for the built-in symbol search (symbol-search feature). */
  readonly symbolSearchViews?: SymbolSearchViewOptions;
}

interface Toast {
  readonly id: number;
  readonly message: string;
  readonly kind: 'info' | 'error';
}

/**
 * Complete chart interface around a chart: header, sidebar (at the start or end of the reading direction),
 * context menu, settings, built-in panels and dialogs, notifications and keyboard shortcuts. It sets `dir` and
 * `lang` from the chart UI's language, so the whole interface mirrors in RTL.
 */
export function ChartInterface({
  ui,
  children,
  header = true,
  sidebar = true,
  contextMenu = true,
  panels = true,
  dialogs = true,
  legend = true,
  className,
  style,
  height = 560,
  symbolSearchViews,
}: ChartInterfaceProps) {
  useUiStyles();
  useUiVersion(ui);
  // Before the chart (and its UI) exists, e.g. on the server, the provider's language sets dir/lang, so RTL
  // pages render mirrored from the first byte and hydrate without a flip.
  const provider = useTranslation();
  const preferences = usePreferences(ui);
  const theme = useThemeName(ui);
  const root = useRef<HTMLDivElement | null>(null);
  const [settings, setSettings] = useState<{
    open: boolean;
    category: SettingsCategory | (string & {});
  }>({
    open: false,
    category: 'general',
  });
  const [panel, setPanel] = useState<string | null>(null);
  const [indicator, setIndicator] = useState<{
    handle: IndicatorHandle;
    tab: 'inputs' | 'style';
  } | null>(null);
  const [drawing, setDrawing] = useState<{ drawing: Drawing; textOnly: boolean } | null>(null);
  const [toasts, setToasts] = useState<readonly Toast[]>([]);

  // Capabilities this component provides; the application's own ones (and its panels) are kept.
  useEffect(() => {
    if (!ui) return;
    const own = ui.capabilities.panels ?? {};
    ui.setCapabilities({
      openSettings: (category) => setSettings({ open: true, category: category ?? 'general' }),
      ...(panels
        ? {
            panels: {
              ...own,
              objectTree: {
                toggle: () => setPanel((p) => (p === 'objectTree' ? null : 'objectTree')),
                isOpen: () => panelRef.current === 'objectTree',
              },
              dataWindow: {
                toggle: () => setPanel((p) => (p === 'dataWindow' ? null : 'dataWindow')),
                isOpen: () => panelRef.current === 'dataWindow',
              },
            },
          }
        : {}),
      ...(dialogs && ui.capabilities.indicators
        ? { indicatorSettings: (handle, tab) => setIndicator({ handle, tab }) }
        : {}),
      ...(dialogs && ui.capabilities.drawings
        ? {
            drawingProperties: (d: Drawing) => setDrawing({ drawing: d, textOnly: false }),
            editDrawingText: (d: Drawing) => setDrawing({ drawing: d, textOnly: true }),
          }
        : {}),
    });
    // Text tools ask for their text when created or double-clicked.
    const drawings = ui.capabilities.drawings;
    const off =
      dialogs && drawings
        ? drawings.on('textEdit', ({ id }) => {
            const d = drawings.get(id);
            if (d) setDrawing({ drawing: d, textOnly: true });
          })
        : null;
    return () => off?.();
  }, [ui, panels, dialogs]);

  const panelRef = useRef(panel);
  panelRef.current = panel;
  useEffect(() => {
    // Panel state changes the sidebar's active buttons.
    ui?.setCapabilities({});
  }, [panel, ui]);

  useEffect(() => {
    if (!ui || !root.current) return;
    return ui.bindKeyboard(root.current);
  }, [ui]);

  useEffect(() => {
    if (!ui) return;
    let id = 0;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const off = ui.on('notify', ({ message, kind }) => {
      const toast = { id: ++id, message, kind };
      setToasts((list) => [...list.slice(-2), toast]);
      const timer = setTimeout(
        () => {
          timers.delete(timer);
          setToasts((list) => list.filter((x) => x.id !== toast.id));
        },
        kind === 'error' ? 5000 : 2500,
      );
      timers.add(timer);
    });
    return () => {
      off();
      timers.forEach(clearTimeout);
    };
  }, [ui]);

  const position = preferences?.sidebar.position ?? 'start';
  return (
    <ChartUiProvider value={ui}>
      <SymbolSearchViews {...symbolSearchViews}>
        <div
          ref={root}
          className={`mc-ui mc-ui-interface${className ? ` ${className}` : ''}`}
          dir={ui?.direction ?? provider.direction}
          lang={ui?.i18n.locale ?? provider.locale}
          data-mc-theme={theme}
          data-density={preferences?.density}
          style={{ height, ...style }}
        >
          {header ? <ChartHeader ui={ui} /> : null}
          <div className="mc-ui-body" data-sidebar-position={position}>
            {sidebar ? <ChartSidebar ui={ui} /> : null}
            <div className="mc-ui-chart">
              {children}
              {legend ? <ChartLegend ui={ui} /> : null}
              {ui?.priceActions ? (
                <Suspense fallback={null}>
                  <PriceActionButton ui={ui} />
                </Suspense>
              ) : null}
            </div>
            {ui && panel === 'objectTree' ? <ObjectTree ui={ui} /> : null}
            {ui && panel === 'dataWindow' ? <DataWindow ui={ui} /> : null}
          </div>
          <div className="mc-ui-toasts" role="status" aria-live="polite">
            {toasts.map((t) => (
              <div key={t.id} className="mc-ui-toast" data-kind={t.kind}>
                {t.message}
              </div>
            ))}
          </div>
        </div>
        {contextMenu ? <ChartContextMenu ui={ui} /> : null}
        <ChartSettings
          ui={ui}
          open={settings.open}
          category={settings.category}
          onClose={() => setSettings((s) => ({ ...s, open: false }))}
        />
        {ui && indicator ? (
          <IndicatorDialog
            ui={ui}
            indicator={indicator.handle}
            tab={indicator.tab}
            onClose={() => setIndicator(null)}
          />
        ) : null}
        {ui && drawing ? (
          <DrawingDialog
            ui={ui}
            drawing={drawing.drawing}
            textOnly={drawing.textOnly}
            onClose={() => setDrawing(null)}
          />
        ) : null}
        {ui?.symbols ? (
          <Suspense fallback={null}>
            <SymbolSearchDialog ui={ui} />
          </Suspense>
        ) : null}
        {ui?.orderTicket ? (
          <Suspense fallback={null}>
            <OrderTicketDialog ui={ui} />
          </Suspense>
        ) : null}
      </SymbolSearchViews>
    </ChartUiProvider>
  );
}
