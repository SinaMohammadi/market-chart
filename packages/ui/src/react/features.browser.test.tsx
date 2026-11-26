// @vitest-environment jsdom
// Real-browser checks for the symbol search and the order ticket (focus trap, keyboard, virtualised list,
// placement in RTL). They need real layout, so they skip themselves under jsdom and run in the Chromium suite.
import { useState } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChartApi } from '@market-chart/core';
import { CandlestickSeries, Chart, ChartProvider } from '@market-chart/react';
import { HOUR, generateBars } from '@market-chart/testing';
import type { ChartUi } from '../chart-ui.js';
import { orderTicket } from '../order-ticket.js';
import { priceActions } from '../price-actions.js';
import { symbolSearch } from '../symbols.js';
import type { ChartUiFeature } from '../extensions.js';
import type { ChartUiCapabilities, SymbolItem } from '../types.js';
import { ChartInterface, useChartUi } from './index.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const inJsdom = /jsdom/i.test(globalThis.navigator?.userAgent ?? '');
const bars = generateBars({ count: 200, interval: HOUR, seed: 8, startPrice: 100 });
// SIMULATED symbols: enough to need the virtualised list.
const MANY: SymbolItem[] = Array.from({ length: 3000 }, (_, i) => ({
  symbol: `SYN:S${String(i).padStart(4, '0')}`,
  name: `Synthetic ${i}`,
}));
let container: HTMLDivElement;
let root: Root;
let current: ChartUi | null = null;

function Inner({
  caps,
  features,
}: {
  caps: ChartUiCapabilities;
  features: readonly ChartUiFeature[];
}) {
  const [chart, setChart] = useState<ChartApi | null>(null);
  const ui = useChartUi(chart, { capabilities: caps, features });
  current = ui;
  return (
    <div style={{ width: 900 }}>
      <ChartInterface ui={ui} height={460}>
        <Chart ref={setChart} options={{ autoSize: false, width: 800, height: 380 }}>
          <CandlestickSeries data={bars} />
        </Chart>
      </ChartInterface>
    </div>
  );
}

async function settle(times = 5): Promise<void> {
  for (let i = 0; i < times; i++)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
}

async function mount(
  caps: ChartUiCapabilities,
  features: readonly ChartUiFeature[],
  locale = 'en',
) {
  await act(async () =>
    root.render(
      <ChartProvider locale={locale}>
        <Inner caps={caps} features={features} />
      </ChartProvider>,
    ),
  );
  await settle();
  return current!;
}

function source() {
  let value = 'SYN:S0001';
  return { value: () => value, set: (s: string) => (value = s), list: () => MANY };
}

const keydown = (el: Element, key: string, init: KeyboardEventInit = {}) =>
  act(() => {
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
    );
  });

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document
    .querySelectorAll('.mc-ui-menu, .mc-ui-dialog-backdrop, .mc-ui-popover')
    .forEach((n) => n.remove());
});

describe.skipIf(inJsdom)('symbol search in a real browser', () => {
  it('traps focus in the dialog, navigates a virtualised list of 3,000 and restores focus', async () => {
    await mount({ symbols: source() }, [symbolSearch({ mode: 'modal' })]);
    const opener = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.getAttribute('aria-label') === 'Search symbols',
    )!;
    opener.focus();
    await act(async () => opener.click());
    await settle(3);
    const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]')!;
    const input = dialog.querySelector<HTMLInputElement>('input[role="combobox"]')!;
    expect(document.activeElement === input).toBe(true);
    // Only the rows in view are in the DOM.
    container.scrollIntoView({ block: 'start' });
    const rendered = dialog.querySelectorAll('[role="option"]').length;
    expect(rendered).toBeGreaterThan(5);
    expect(rendered).toBeLessThan(60);
    // Keyboard: 40 rows down; the highlighted row is rendered and scrolled into view.
    for (let i = 0; i < 40; i++) await keydown(input, 'ArrowDown');
    const activeId = input.getAttribute('aria-activedescendant')!;
    const active = document.getElementById(activeId)!;
    expect(active.textContent!.includes('SYN:S0039')).toBe(true);
    const list = dialog.querySelector<HTMLElement>('[role="listbox"]')!.getBoundingClientRect();
    const row = active.getBoundingClientRect();
    expect(row.top).toBeGreaterThanOrEqual(list.top - 1);
    expect(row.bottom).toBeLessThanOrEqual(list.bottom + 1);
    // Focus trap: Tab from the last focusable element goes to the first, Shift+Tab back to the last.
    const focusable = [
      ...dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input, [tabindex]:not([tabindex="-1"])',
      ),
    ];
    const last = focusable[focusable.length - 1]!;
    last.focus();
    await keydown(last, 'Tab');
    expect(document.activeElement === focusable[0]).toBe(true);
    await keydown(focusable[0]!, 'Tab', { shiftKey: true });
    expect(document.activeElement === last).toBe(true);
    // Escape closes and focus returns to the button that opened it.
    input.focus();
    await keydown(input, 'Escape');
    await settle(2);
    expect(document.querySelector('[role="dialog"][aria-modal="true"]')).toBeNull();
    expect(document.activeElement === opener).toBe(true);
  });

  it('places the dropdown under its button, aligned to the start edge in RTL and inside the viewport', async () => {
    await mount({ symbols: source() }, [symbolSearch({ mode: 'dropdown' })], 'fa');
    const button = container.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!;
    button.scrollIntoView({ block: 'start' });
    await act(async () => button.click());
    await settle(3);
    const popover = document.querySelector<HTMLElement>('.mc-ui-popover')!;
    expect(popover.getAttribute('dir')).toBe('rtl');
    const b = button.getBoundingClientRect();
    const p = popover.getBoundingClientRect();
    expect(p.top).toBeGreaterThanOrEqual(b.bottom);
    expect(p.left).toBeGreaterThanOrEqual(0);
    expect(p.right).toBeLessThanOrEqual(window.innerWidth + 1);
    // RTL: the popover's right edge follows the button's right edge (unless clamped to the viewport).
    if (b.right - p.width >= 8) expect(Math.abs(p.right - b.right)).toBeLessThanOrEqual(1);
    expect(document.activeElement === popover.querySelector('input')).toBe(true);
  });

  it('order ticket: keyboard stepping with the tick size and a focus trap', async () => {
    const ui = await mount(
      { trading: { submit: async () => ({ ok: true }), simulatedLabel: 'SIMULATED' } },
      [priceActions(), orderTicket()],
    );
    const price = ui.priceActions!.contextAt({ price: 100, pane: 0 })!;
    await act(async () => ui.orderTicket!.open({ side: 'buy', type: 'limit', price }));
    await settle(3);
    const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]')!;
    const priceInput = dialog.querySelector<HTMLInputElement>('input[inputmode="decimal"]')!;
    priceInput.focus();
    await keydown(priceInput, 'ArrowUp');
    await keydown(priceInput, 'ArrowUp');
    expect(priceInput.value).toBe('100.02');
    const focusable = [
      ...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input, select'),
    ];
    const last = focusable[focusable.length - 1]!;
    last.focus();
    await keydown(last, 'Tab');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});
