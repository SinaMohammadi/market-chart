import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ChartApi } from '@market-chart/core';
import { useI18n } from '@market-chart/react';
import { ChartUi } from '../chart-ui.js';
import type { ChartUiOptions } from '../chart-ui.js';
import type { ContextMenuState } from '../menu.js';
import type { UiPreferences } from '../preferences.js';

/** The chart UI of the nearest `<ChartInterface>` / `<ChartUiProvider>`. */
export const ChartUiContext = createContext<ChartUi | null>(null);

export const ChartUiProvider = ChartUiContext.Provider;

export function useChartUiContext(): ChartUi | null {
  return useContext(ChartUiContext);
}

/**
 * Creates the chart UI for `chart` (null until the chart has mounted) and destroys it on unmount. Uses the
 * `I18n` of the surrounding `<ChartProvider>` unless `options.i18n` is given. Pass stable options (memoise
 * `capabilities` or update them with `ui.setCapabilities`).
 */
export function useChartUi(chart: ChartApi | null, options: ChartUiOptions = {}): ChartUi | null {
  const i18n = useI18n();
  const latest = useRef(options);
  latest.current = options;
  const [ui, setUi] = useState<ChartUi | null>(null);
  useEffect(() => {
    if (!chart) return;
    const instance = new ChartUi(chart, { i18n, ...latest.current });
    setUi(instance);
    return () => {
      instance.destroy();
      setUi(null);
    };
  }, [chart, i18n, options.preferences]);
  return ui;
}

/** Re-renders when anything shown by toolbars changes (actions, preferences, language, chart state). */
export function useUiVersion(ui: ChartUi | null): number {
  return useSyncExternalStore(
    (onChange) => (ui ? ui.on('change', onChange) : () => undefined),
    () => ui?.version ?? -1,
    () => -1,
  );
}

export function usePreferences(ui: ChartUi | null): UiPreferences | null {
  return useSyncExternalStore(
    (onChange) => (ui ? ui.preferences.on('change', onChange) : () => undefined),
    () => ui?.preferences.get() ?? null,
    () => null,
  );
}

/** Context-menu state for custom renderers (see `useContextMenu`). */
export function useMenuState(ui: ChartUi | null): ContextMenuState | null {
  return useSyncExternalStore(
    (onChange) => (ui ? ui.menu.on('change', onChange) : () => undefined),
    () => ui?.menu.state ?? null,
    () => null,
  );
}

/** `dark`/`light` from the chart's theme, for the UI colours. */
export function useThemeName(ui: ChartUi | null): 'dark' | 'light' {
  useUiVersion(ui);
  const name = ui?.chart.destroyed === false ? ui.chart.theme().name : 'light';
  return name === 'dark' ? 'dark' : 'light';
}
