// @vitest-environment jsdom
import { useState } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChartApi } from '@market-chart/core';
import { CandlestickSeries, Chart, ChartProvider } from '@market-chart/react';
import { DrawingManager } from '@market-chart/drawing-tools';
import { IndicatorManager } from '@market-chart/indicators';
import { HOUR, generateBars, installCanvasMock } from '@market-chart/testing';
import type { ChartUi } from '../chart-ui.js';
import { UiPreferencesStore } from '../preferences.js';
import { ChartInterface, ChartSettings, useChartUi } from './index.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bars = generateBars({ count: 200, interval: HOUR, seed: 31, startPrice: 100 });
let restore: () => void = () => undefined;
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  restore = installCanvasMock();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.querySelectorAll('.mc-ui-menu, .mc-ui-dialog-backdrop').forEach((n) => n.remove());
  restore();
});

let current: { chart: ChartApi | null; ui: ChartUi | null } = { chart: null, ui: null };

/** Like an application: the chart UI is created inside the provider, so it shares its language. */
function App({
  locale = 'en',
  preferences,
}: {
  locale?: string;
  preferences?: UiPreferencesStore;
}) {
  return (
    <ChartProvider locale={locale}>
      <Inner {...(preferences ? { preferences } : {})} />
    </ChartProvider>
  );
}

function Inner({ preferences }: { preferences?: UiPreferencesStore }) {
  const [chart, setChart] = useState<ChartApi | null>(null);
  const [managers] = useState(() => ({
    drawings: null as DrawingManager | null,
    indicators: null as IndicatorManager | null,
  }));
  if (chart && !managers.drawings) {
    managers.drawings = new DrawingManager(chart);
    managers.indicators = new IndicatorManager(chart);
  }
  const ui = useChartUi(chart, {
    capabilities: managers.drawings
      ? { drawings: managers.drawings, indicators: managers.indicators! }
      : {},
    ...(preferences ? { preferences } : {}),
  });
  current = { chart, ui };
  return (
    <ChartInterface ui={ui} height={420}>
      <Chart ref={setChart} options={{ autoSize: false, width: 700, height: 360 }}>
        <CandlestickSeries data={bars} />
      </Chart>
    </ChartInterface>
  );
}

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

async function mount(element: React.ReactElement) {
  await act(async () => root.render(element));
  await flush();
  await flush();
}

function rightClick(x: number, y: number) {
  const overlay = [...current.chart!.element().querySelectorAll('canvas')].pop()!;
  const rect = overlay.getBoundingClientRect();
  act(() => {
    overlay.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + x,
        clientY: rect.top + y,
        button: 2,
      }),
    );
  });
}

describe('<ChartInterface>', () => {
  it('renders an accessible header and sidebar', async () => {
    await mount(<App />);
    const header = container.querySelector('[role="toolbar"][aria-label="Chart toolbar"]')!;
    const sidebar = container.querySelector('[role="toolbar"][aria-orientation="vertical"]')!;
    expect(header).not.toBeNull();
    expect(sidebar).not.toBeNull();
    expect(header.querySelector('[aria-label="Indicators"]')).not.toBeNull();
    expect(header.querySelector('select[aria-label="Language"]')).not.toBeNull();
    // One tab stop per toolbar (roving tabindex).
    expect(header.querySelectorAll('[data-toolbar-item][tabindex="0"]')).toHaveLength(1);
    // Expanded sidebar: visible labels; drawing tools grouped in flyouts.
    expect(sidebar.querySelector('[data-action="tool.trend-line"]')!.textContent).toBe(
      'Trend Line',
    );
    expect(sidebar.querySelector('[role="group"][aria-label="Fibonacci"]')).not.toBeNull();
    expect(container.querySelector('.mc-ui-interface')!.getAttribute('dir')).toBe('ltr');
  });

  it('switches language and direction in place, without recreating the chart', async () => {
    await mount(<App />);
    const chart = current.chart!;
    const element = chart.element();
    const select = container.querySelector<HTMLSelectElement>('select[aria-label="Language"]')!;
    await act(async () => {
      select.value = 'fa';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
    const ui = container.querySelector('.mc-ui-interface')!;
    expect(ui.getAttribute('dir')).toBe('rtl');
    expect(ui.getAttribute('lang')).toBe('fa');
    expect(container.querySelector('[aria-label="اندیکاتورها"]')).not.toBeNull();
    expect(current.chart).toBe(chart);
    expect(chart.element()).toBe(element);
    expect(chart.getDirection()).toBe('rtl');
    expect(chart.getLocale()).toBe('fa-IR');
  });

  it('follows the ChartProvider locale', async () => {
    await mount(<App locale="ar" />);
    expect(container.querySelector('.mc-ui-interface')!.getAttribute('dir')).toBe('rtl');
    expect(container.querySelector('[aria-label="شريط أدوات الرسم البياني"]')).not.toBeNull();
  });

  it('opens the context menu on right-click; keyboard navigation, search and Escape work', async () => {
    await mount(<App />);
    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Indicators"]')!;
    trigger.focus();
    rightClick(300, 5);
    await flush();
    const menu = document.querySelector<HTMLElement>('.mc-ui-menu[role="menu"]')!;
    expect(menu).not.toBeNull();
    expect(menu.getAttribute('aria-label')).toBe('Chart menu');
    const items = [...menu.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"]')].map(
      (n) => n.querySelector('.mc-ui-menu-label')!.textContent,
    );
    expect(menu.querySelector('[aria-keyshortcuts="Alt+R"]')!.textContent).toContain(
      'Reset chart view',
    );
    expect(items).toEqual(
      expect.arrayContaining(['Reset chart view', 'Fit content', 'Add indicator', 'Export image']),
    );
    // Search (the root has a searchable submenu) finds nested items.
    const search = menu.querySelector<HTMLInputElement>('input[type="search"]')!;
    expect(document.activeElement).toBe(search);
    await act(async () => {
      // Through the native setter, so React sees the change (a direct assignment updates its value tracker).
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(search, 'bollinger');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const results = [...document.querySelectorAll('.mc-ui-menu [role="menuitem"]')].map(
      (n) => n.querySelector('.mc-ui-menu-label')!.firstChild!.textContent,
    );
    expect(results).toEqual(['Bollinger Bands']);
    await act(async () => {
      search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await flush();
    expect(document.querySelector('.mc-ui-menu')).toBeNull();
    expect(current.ui!.capabilities.indicators!.list().map((i) => i.type)).toEqual(['bollinger']);
    // Focus goes back to where it was.
    expect(document.activeElement).toBe(trigger);

    rightClick(300, 5);
    await flush();
    const again = document.querySelector<HTMLElement>('.mc-ui-menu')!;
    await act(async () => {
      again.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await flush();
    expect(document.querySelector('.mc-ui-menu')).toBeNull();
  });

  it('closes the menu on outside click', async () => {
    await mount(<App />);
    rightClick(300, 5);
    await flush();
    expect(document.querySelector('.mc-ui-menu')).not.toBeNull();
    act(() => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    await flush();
    expect(document.querySelector('.mc-ui-menu')).toBeNull();
  });

  it('opens settings from the header; hiding an action updates the header and persists', async () => {
    const preferences = new UiPreferencesStore({ autoSave: false });
    await mount(<App preferences={preferences} />);
    await act(async () => current.ui!.openSettings('header'));
    await flush();
    await flush();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const checkbox = dialog.querySelector<HTMLInputElement>(
      'input[aria-label="Visible: Indicators"]',
    )!;
    expect(checkbox.checked).toBe(true);
    await act(async () => checkbox.click());
    expect(preferences.get().actions['header.indicators']).toEqual({ visible: false });
    expect(
      container.querySelector(
        '[role="toolbar"][aria-label="Chart toolbar"] [aria-label="Indicators"]',
      ),
    ).toBeNull();
    // Tabs switch categories.
    const languageTab = [...dialog.querySelectorAll<HTMLElement>('[role="tab"]')].find(
      (tab) => tab.textContent === 'Language',
    )!;
    await act(async () => languageTab.click());
    await flush();
    expect(dialog.querySelector('[role="tabpanel"]')!.textContent).toContain('Text direction');
    await act(async () => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('edits drawing properties from the context menu', async () => {
    await mount(<App />);
    const { chart, ui } = current;
    const series = chart!.series()[0]!;
    const bar = bars[170]!;
    const drawings = ui!.capabilities.drawings!;
    const line = drawings.add({
      type: 'horizontal-line',
      seriesId: series.id,
      points: [{ time: bar.time, price: bar.high + 3 }],
    });
    act(() => chart!.render());
    rightClick(
      chart!.timeScale().logicalToCoordinate(170) + 30,
      series.priceToCoordinate(bar.high + 3)!,
    );
    await flush();
    const props = [...document.querySelectorAll<HTMLElement>('.mc-ui-menu [role="menuitem"]')].find(
      (n) => n.textContent === 'Properties…',
    )!;
    await act(async () => props.click());
    await flush();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const width = dialog.querySelector<HTMLSelectElement>('select[aria-label="Width"]')!;
    await act(async () => {
      width.value = '3';
      width.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(drawings.get(line.id)!.style.lineWidth).toBe(3);
  });
});

describe('server rendering', () => {
  it('renders without a chart (SSR) and ChartSettings stays closed', () => {
    const html = renderToString(
      <ChartProvider locale="fa">
        <ChartInterface ui={null}>
          <div>chart</div>
        </ChartInterface>
        <ChartSettings ui={null} open={false} onClose={() => undefined} />
      </ChartProvider>,
    );
    expect(html).toContain('class="mc-ui mc-ui-interface"');
    expect(html).toContain('chart');
  });
});

describe('legend and object tree', () => {
  const checkboxByLabel = (scope: ParentNode, text: string) => {
    const label = [...scope.querySelectorAll('label')].find((l) => l.textContent === text)!;
    return (label.control ??
      label.querySelector('input') ??
      label.parentElement!.querySelector('input')) as HTMLInputElement;
  };

  it('shows the last bar, follows the crosshair and opens its settings', async () => {
    const preferences = new UiPreferencesStore({ autoSave: false });
    await mount(<App preferences={preferences} />);
    const legend = () => container.querySelector<HTMLElement>('.mc-ui-legend');
    const last = bars[bars.length - 1]!;
    expect(legend()).not.toBeNull();
    expect(legend()!.getAttribute('aria-label')).toBe('Legend');
    expect(legend()!.dataset['hovered']).toBe('false');
    expect(legend()!.querySelector('[data-key="close"]')!.textContent).toContain(
      last.close.toFixed(2),
    );
    expect(legend()!.querySelector('[data-key="open"]')!.textContent).toBe(
      `O${last.open.toFixed(2)}`,
    );

    await act(async () => {
      current.chart!.setCrosshairPosition(bars[20]!.time);
      current.chart!.render();
    });
    await flush();
    expect(legend()!.dataset['hovered']).toBe('true');
    expect(legend()!.querySelector('[data-key="open"]')!.textContent).toContain(
      bars[20]!.open.toFixed(2),
    );

    // The gear opens Settings → Legend and price labels.
    const gear = legend()!.querySelector<HTMLButtonElement>('[aria-label="Legend settings"]')!;
    await act(async () => gear.click());
    await flush();
    await flush();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.querySelector('[role="tab"][aria-selected="true"]')!.textContent).toBe(
      'Legend and price labels',
    );
    await act(async () => checkboxByLabel(dialog, 'Timestamp (ms)').click());
    await flush();
    expect(preferences.get().legend.fields.timestamp).toBe(true);
    expect(legend()!.querySelector('[data-key="timestamp"]')!.textContent).toContain(
      String(bars[20]!.time),
    );
    await act(async () => checkboxByLabel(dialog, 'High and low of the visible bars').click());
    await flush();
    expect(preferences.get().markers.highLow).toBe(true);
    expect(current.chart!.series()[0]!.priceLines()).toHaveLength(2);
    await act(async () => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    // Hiding the legend is a preference too.
    await act(async () =>
      legend()!.querySelector<HTMLButtonElement>('[aria-label="Hide"]')!.click(),
    );
    expect(legend()).toBeNull();
    expect(preferences.get().legend.visible).toBe(false);
  });

  it('lists series, indicators and price labels in the object tree', async () => {
    await mount(<App />);
    const ui = current.ui!;
    const candles = current.chart!.series()[0]!;
    await act(async () => {
      ui.capabilities.indicators!.add('sma', candles, { params: { length: 10 } });
    });
    await act(async () => ui.capabilities.panels!['objectTree']!.toggle());
    await flush();
    const tree = container.querySelector<HTMLElement>('[role="region"][aria-label="Object tree"]')!;
    expect(tree.textContent).toContain('Main series');
    expect(tree.textContent).toContain('SMA');
    expect(tree.querySelector('[aria-label^="Settings: SMA"]')).not.toBeNull();
    const hide = tree.querySelector<HTMLButtonElement>('[aria-label^="Hide Candles"]')!;
    await act(async () => hide.click());
    expect(candles.options().visible).toBe(false);
    await act(async () => checkboxByLabel(tree, 'Previous close line').click());
    await flush();
    expect(ui.preferences.get().markers.previousClose).toBe(true);
    expect(candles.priceLines().map((l) => l.options().price)).toContain(
      bars[bars.length - 2]!.close,
    );
    expect(tree.textContent).toContain(bars[bars.length - 2]!.close.toFixed(2));
  });
});
