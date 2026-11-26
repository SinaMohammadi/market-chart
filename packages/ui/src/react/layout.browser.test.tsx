// @vitest-environment jsdom
// Layout-dependent behaviour (overflow, viewport placement, RTL submenus) needs a real browser: these tests
// skip themselves under jsdom and run in the Chromium suite.
import { useState } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChartApi } from '@market-chart/core';
import { Chart, ChartProvider } from '@market-chart/react';
import { DrawingManager } from '@market-chart/drawing-tools';
import { IndicatorManager } from '@market-chart/indicators';
import { HOUR, generateBars } from '@market-chart/testing';
import type { ChartUi } from '../chart-ui.js';
import { ChartInterface, useChartUi } from './index.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const inJsdom = /jsdom/i.test(globalThis.navigator?.userAgent ?? '');
const bars = generateBars({ count: 300, interval: HOUR, seed: 41, startPrice: 100 });
let container: HTMLDivElement;
let root: Root;
let current: { chart: ChartApi | null; ui: ChartUi | null } = { chart: null, ui: null };

function Inner({ width }: { width: number }) {
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
      ? {
          drawings: managers.drawings,
          indicators: managers.indicators!,
          timeframe: {
            value: () => '1h',
            options: ['1m', '5m', '15m', '1h', '4h', '1D'],
            set: () => undefined,
          },
          symbol: { value: () => 'SYN', set: () => undefined },
        }
      : {},
  });
  current = { chart, ui };
  return (
    <div style={{ width }}>
      <ChartInterface ui={ui} height={420}>
        <Chart ref={setChart} height={360} />
        {chart ? null : null}
      </ChartInterface>
    </div>
  );
}

async function mount(width: number, locale = 'en') {
  await act(async () =>
    root.render(
      <ChartProvider locale={locale}>
        <Inner width={width} />
      </ChartProvider>,
    ),
  );
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
  }
  act(() => {
    current.chart!.addSeries('candlestick').setData(bars);
    current.chart!.render();
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.querySelectorAll('.mc-ui-menu').forEach((n) => n.remove());
});

describe.skipIf(inJsdom)('layout in a real browser', () => {
  it('moves header actions that do not fit into "More actions"', async () => {
    await mount(360);
    const header = container.querySelector<HTMLElement>(
      '[role="toolbar"][aria-label="Chart toolbar"]',
    )!;
    const more = header.querySelector<HTMLButtonElement>('[aria-label="More actions"]');
    expect(more).not.toBeNull();
    expect(header.scrollWidth).toBeLessThanOrEqual(header.clientWidth + 1);
    act(() => more!.click());
    const menu = document.querySelector<HTMLElement>('.mc-ui-menu')!;
    expect(menu.querySelectorAll('[role="menuitem"]').length).toBeGreaterThan(0);
  });

  it('keeps menus inside the viewport and opens RTL submenus to the left', async () => {
    await mount(900, 'fa');
    const ui = current.ui!;
    const viewportWidth = window.innerWidth;
    // Near the left edge in RTL: the menu flips to open on the right of the point instead of leaving the screen.
    act(() =>
      ui.contextMenu.open({
        x: 20,
        y: 40,
        target: { kind: 'chart', event: null as never, pane: 0, time: null, price: null },
      }),
    );
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    });
    const menu = document.querySelector<HTMLElement>('.mc-ui-menu')!;
    const rect = menu.getBoundingClientRect();
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(viewportWidth);
    expect(menu.getAttribute('dir')).toBe('rtl');
    act(() => ui.menu.handleKey('ArrowDown'));
    // Open the first item with children with ArrowLeft (forward in RTL).
    const entries = ui.menu.levelEntries(0);
    const withChildren = entries.findIndex((e) => e.type === 'item' && e.children);
    act(() => ui.menu.hover(0, withChildren));
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    });
    const menus = document.querySelectorAll<HTMLElement>('.mc-ui-menu');
    expect(menus.length).toBe(2);
    const sub = menus[1]!.getBoundingClientRect();
    const parent = menus[0]!.getBoundingClientRect();
    // Room on both sides near x=20? The root flipped to the right, so the submenu opens further right
    // only if needed; with the root at the left edge, RTL "after" (left) does not fit and it flips.
    // Submenus are anchored to the item (inside the menu's padding), so they overlap the parent by a few px.
    expect(sub.left >= parent.right - 8 || sub.right <= parent.left + 8).toBe(true);
    act(() => ui.menu.close());

    act(() =>
      ui.contextMenu.open({
        x: viewportWidth - 40,
        y: 40,
        target: { kind: 'chart', event: null as never, pane: 0, time: null, price: null },
      }),
    );
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    });
    act(() => ui.menu.hover(0, withChildren));
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    });
    const [rootMenu, subMenu] = [...document.querySelectorAll<HTMLElement>('.mc-ui-menu')].map(
      (m) => m.getBoundingClientRect(),
    );
    expect(rootMenu!.right).toBeLessThanOrEqual(viewportWidth - 40 + 1);
    expect(subMenu!.right).toBeLessThanOrEqual(rootMenu!.left + 8);
    expect(subMenu!.left).toBeGreaterThanOrEqual(0);
  });
});
