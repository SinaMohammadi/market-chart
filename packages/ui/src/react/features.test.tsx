// @vitest-environment jsdom
import { useState } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChartApi } from '@market-chart/core';
import { CandlestickSeries, Chart, ChartProvider } from '@market-chart/react';
import { HOUR, generateBars, installCanvasMock } from '@market-chart/testing';
import type { ChartUi } from '../chart-ui.js';
import type { ChartUiFeature } from '../extensions.js';
import { orderTicket } from '../order-ticket.js';
import { priceActions } from '../price-actions.js';
import { symbolSearch } from '../symbols.js';
import type { ChartUiCapabilities, SymbolItem } from '../types.js';
import { ChartInterface, useChartUi, useSymbolSearch } from './index.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bars = generateBars({ count: 200, interval: HOUR, seed: 12, startPrice: 100 });
const LIST: SymbolItem[] = [
  { symbol: 'BTCUSDT', name: 'Bitcoin', group: 'crypto' },
  { symbol: 'ETHUSDT', name: '<img src=x onerror="window.__pwned=1">Ether', group: 'crypto' },
  { symbol: 'EURUSD', name: 'Euro', group: 'forex' },
];
let restore: () => void = () => undefined;
let container: HTMLDivElement;
let root: Root;
let current: { chart: ChartApi | null; ui: ChartUi | null } = { chart: null, ui: null };

beforeEach(() => {
  restore = installCanvasMock();
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
  restore();
});

async function settle(times = 4): Promise<void> {
  for (let i = 0; i < times; i++)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });
}

function Inner({
  capabilities,
  features,
  extra,
}: {
  capabilities: ChartUiCapabilities;
  features: readonly ChartUiFeature[];
  extra?: (ui: ChartUi | null) => React.ReactNode;
}) {
  const [chart, setChart] = useState<ChartApi | null>(null);
  const ui = useChartUi(chart, { capabilities, features });
  current = { chart, ui };
  return (
    <ChartInterface ui={ui} height={420}>
      <Chart ref={setChart} options={{ autoSize: false, width: 700, height: 360 }}>
        <CandlestickSeries data={bars} />
      </Chart>
      {extra?.(ui)}
    </ChartInterface>
  );
}

async function mount(
  capabilities: ChartUiCapabilities,
  features: readonly ChartUiFeature[],
  extra?: (ui: ChartUi | null) => React.ReactNode,
): Promise<ChartUi> {
  await act(async () =>
    root.render(
      <ChartProvider locale="en">
        <Inner capabilities={capabilities} features={features} {...(extra ? { extra } : {})} />
      </ChartProvider>,
    ),
  );
  await settle();
  return current.ui!;
}

function source(set = vi.fn()) {
  let value = 'BTCUSDT';
  return {
    value: () => value,
    set: (s: string) => {
      value = s;
      set(s);
    },
    list: () => LIST,
    groups: [
      { id: 'crypto', label: 'Crypto' },
      { id: 'forex', label: 'Forex' },
    ],
  };
}

const options = () => [...document.querySelectorAll<HTMLElement>('[role="option"]')];
const key = (el: Element, k: string, init: KeyboardEventInit = {}) =>
  act(() => {
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }),
    );
  });
const type = (input: HTMLInputElement, value: string) =>
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

describe('symbol selector', () => {
  it('header dropdown: lists, filters, selects with the keyboard and restores focus', async () => {
    const set = vi.fn();
    await mount({ symbols: source(set) }, [symbolSearch()]);
    const button = container.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!;
    expect(button.textContent).toContain('BTCUSDT');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    await act(async () => button.click());
    await settle(2);
    const popover = document.querySelector<HTMLElement>('.mc-ui-popover')!;
    expect(popover.getAttribute('role')).toBe('dialog');
    const input = popover.querySelector<HTMLInputElement>('input[role="combobox"]')!;
    expect(document.activeElement).toBe(input);
    expect(options()).toHaveLength(3);
    await type(input, 'eur');
    expect(options().map((o) => o.textContent)).toEqual([expect.stringContaining('EURUSD')]);
    expect(input.getAttribute('aria-activedescendant')).toBe(options()[0]!.id);
    await key(input, 'Enter');
    await settle(1);
    expect(set).toHaveBeenCalledWith('EURUSD');
    expect(document.querySelector('.mc-ui-popover')).toBeNull();
    expect(document.activeElement).toBe(container.querySelector('button[aria-haspopup="listbox"]'));
    expect(container.querySelector('button[aria-haspopup="listbox"]')!.textContent).toContain(
      'EURUSD',
    );
  });

  it('search dialog: focus moves in, groups and favourites work, Escape closes and restores focus', async () => {
    const ui = await mount({ symbols: source() }, [symbolSearch({ mode: 'modal' })]);
    expect(container.querySelector('button[aria-haspopup="listbox"]')).toBeNull();
    const opener = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.getAttribute('aria-label') === 'Search symbols',
    )!;
    opener.focus();
    await act(async () => opener.click());
    await settle(2);
    const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]')!;
    expect(dialog.textContent).toContain('Symbol search');
    const input = dialog.querySelector<HTMLInputElement>('input[role="combobox"]')!;
    expect(document.activeElement).toBe(input);
    const tabs = [...dialog.querySelectorAll<HTMLButtonElement>('[role="tab"]')].map(
      (t) => t.textContent,
    );
    expect(tabs).toEqual(['All', 'Favorites', 'Recent', 'Crypto', 'Forex']);
    const star = options()[2]!.querySelector<HTMLButtonElement>('.mc-ui-star')!;
    expect(star.getAttribute('aria-label')).toBe('Add EURUSD to favorites');
    await act(async () => star.click());
    expect(ui.preferences.get().symbols.favorites).toEqual(['EURUSD']);
    await act(async () =>
      [...dialog.querySelectorAll<HTMLButtonElement>('[role="tab"]')][1]!.click(),
    );
    expect(options().map((o) => o.textContent)).toEqual([expect.stringContaining('EURUSD')]);
    // Mod+D toggles the highlighted symbol's favourite.
    await key(input, 'ArrowDown');
    await key(input, 'd', { ctrlKey: true });
    expect(ui.preferences.get().symbols.favorites).toEqual([]);
    await key(input, 'Escape');
    await settle(1);
    expect(document.querySelector('[role="dialog"][aria-modal="true"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('renders application text as text', async () => {
    (window as { __pwned?: number }).__pwned = 0;
    const ui = await mount({ symbols: source() }, [symbolSearch({ mode: 'modal' })]);
    await act(async () => ui.symbols!.open({ query: 'eth' }));
    await settle(2);
    const option = options()[0]!;
    expect(option.querySelector('img')).toBeNull();
    expect(option.textContent).toContain('<img src=x onerror="window.__pwned=1">Ether');
    expect((window as { __pwned?: number }).__pwned).toBe(0);
  });

  it('opens from typing on the chart with the typed letter', async () => {
    const ui = await mount({ symbols: source() }, [symbolSearch({ mode: 'both' })]);
    const rootEl = container.querySelector<HTMLElement>('.mc-ui-interface')!;
    await key(rootEl, 'e');
    await settle(2);
    expect(ui.symbols!.state).toMatchObject({ open: true, query: 'e', surface: 'modal' });
    const input = document.querySelector<HTMLInputElement>(
      '[role="dialog"] input[role="combobox"]',
    )!;
    expect(input.value).toBe('e');
  });

  it('supports a completely custom selector built on useSymbolSearch', async () => {
    const set = vi.fn();
    function Custom({ ui }: { ui: ChartUi | null }) {
      const api = useSymbolSearch(ui);
      return (
        <div data-testid="custom">
          <button type="button" onClick={() => api.open()}>
            Pick ({api.current})
          </button>
          {api.state?.open ? (
            <>
              <input aria-label="custom search" {...api.inputProps} />
              <ul {...api.listboxProps}>
                {api.state.results.map((item, i) => (
                  <li key={item.symbol} {...api.optionProps(i)}>
                    {item.symbol}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      );
    }
    const ui = await mount({ symbols: source(set) }, [symbolSearch({ mode: 'custom' })], (u) => (
      <Custom ui={u} />
    ));
    const custom = container.querySelector('[data-testid="custom"]')!;
    await act(async () => custom.querySelector('button')!.click());
    expect(ui.symbols!.state.surface).toBe('custom');
    // The built-in dialog stays closed in custom mode.
    expect(document.querySelector('[role="dialog"][aria-modal="true"]')).toBeNull();
    const input = custom.querySelector<HTMLInputElement>('input')!;
    await type(input, 'btc');
    await key(input, 'Enter');
    expect(set).toHaveBeenCalledWith('BTCUSDT');
  });
});

describe('price actions and the order ticket', () => {
  it('shows the "+" button at the crosshair and opens the price-action menu', async () => {
    const create = vi.fn();
    const ui = await mount({ alerts: { create } }, [priceActions()]);
    const overlay = current
      .chart!.element()
      .querySelector<HTMLCanvasElement>('canvas[data-layer="overlay"]')!;
    const rect = overlay.getBoundingClientRect();
    await act(async () => {
      overlay.dispatchEvent(
        new (
          ((globalThis as { PointerEvent?: typeof PointerEvent }).PointerEvent ??
            MouseEvent) as typeof PointerEvent
        )('pointermove', {
          clientX: rect.left + 300,
          clientY: rect.top + 120,
          bubbles: true,
          pointerType: 'mouse',
        }),
      );
      current.chart!.render();
    });
    await settle(2);
    const plus = container.querySelector<HTMLButtonElement>('.mc-ui-price-btn')!;
    expect(plus.getAttribute('aria-label')).toMatch(/^Actions at \d/);
    expect(plus.style.top).toBe('120px');
    await act(async () => plus.click());
    expect(ui.menu.state.open).toBe(true);
    const menu = document.querySelector<HTMLElement>('.mc-ui-menu')!;
    const item = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((e) =>
      e.textContent?.startsWith('Create alert at'),
    )!;
    await act(async () => item.click());
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ price: expect.any(Number) }));
  });

  it('lists price actions in the shortcut settings with a sample price when their shortcuts are on', async () => {
    const shortcutRows = async (ui: ChartUi) => {
      await act(async () => ui.openSettings('shortcuts'));
      await settle(2);
      return [...document.querySelectorAll<HTMLElement>('[role="tabpanel"] .mc-ui-list-item')].map(
        (li) => li.textContent ?? '',
      );
    };
    const last = bars[bars.length - 1]!.close.toFixed(2);
    let ui = await mount({ alerts: { create: vi.fn() } }, [priceActions({ shortcuts: true })]);
    const rows = await shortcutRows(ui);
    const alert = rows.find((r) => r.startsWith('Create alert at'));
    expect(alert).toBe(`Create alert at ${last}${ui.shortcut(ui.actions.get('price.alert')!)}`);
    act(() => root.unmount());
    root = createRoot(container);
    // Without shortcuts they would do nothing from the keyboard, so they stay out of the list.
    ui = await mount({ alerts: { create: vi.fn() } }, [priceActions()]);
    expect((await shortcutRows(ui)).some((r) => r.startsWith('Create alert at'))).toBe(false);
  });

  it('order ticket: simulated label, validation, confirmation, one submission and the result', async () => {
    let finish!: (r: { ok: boolean; message?: string }) => void;
    const submit = vi.fn(() => new Promise<{ ok: boolean; message?: string }>((r) => (finish = r)));
    const ui = await mount({ trading: { submit, simulatedLabel: 'SIMULATED — no real orders' } }, [
      priceActions(),
      orderTicket(),
    ]);
    const price = ui.priceActions!.contextAt({ price: 100, pane: 0 })!;
    await act(async () => ui.orderTicket!.open({ side: 'sell', type: 'limit', price }));
    await settle(2);
    const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]')!;
    expect(dialog.textContent).toContain('SIMULATED — no real orders');
    const sell = [...dialog.querySelectorAll<HTMLButtonElement>('.mc-ui-side-btn')].find(
      (b) => b.textContent === 'Sell',
    )!;
    expect(sell.getAttribute('aria-pressed')).toBe('true');
    const quantity = document.getElementById(
      dialog.querySelectorAll('label')[2]!.htmlFor,
    ) as HTMLInputElement;
    await type(quantity, '0');
    expect(quantity.getAttribute('aria-invalid')).toBe('true');
    expect(dialog.textContent).toContain('Must be greater than zero');
    await type(quantity, '۲');
    expect(quantity.getAttribute('aria-invalid')).toBeNull();
    const footer = () => [
      ...document.querySelectorAll<HTMLButtonElement>('.mc-ui-dialog-foot button'),
    ];
    await act(async () =>
      footer()
        .find((b) => b.textContent === 'Review order')!
        .click(),
    );
    expect(dialog.textContent).toContain('Send this order?');
    expect(dialog.textContent).toContain('Sell 2');
    expect(submit).not.toHaveBeenCalled();
    // A double-click on Review lands on Send immediately: ignored until the confirmation was visible.
    await act(async () =>
      footer()
        .find((b) => b.textContent === 'Send order')!
        .click(),
    );
    expect(submit).not.toHaveBeenCalled();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 450));
    });
    await act(async () =>
      footer()
        .find((b) => b.textContent === 'Send order')!
        .click(),
    );
    expect(submit).toHaveBeenCalledOnce();
    const sending = footer().find((b) => b.textContent === 'Sending…')!;
    expect(sending.disabled).toBe(true);
    await act(async () => sending.click());
    expect(submit).toHaveBeenCalledOnce();
    await act(async () => finish({ ok: false, message: '<b>Rejected</b>: market closed' }));
    const status = dialog.querySelector('.mc-ui-ticket-status[data-status="rejected"]')!;
    expect(status.textContent).toBe('<b>Rejected</b>: market closed');
    expect(status.querySelector('b')).toBeNull();
  });
});

describe('registered sections', () => {
  it('renders object-tree and settings sections from other packages', async () => {
    const ui = await mount({}, []);
    const select = vi.fn();
    const remove = vi.fn();
    act(() => {
      ui.objectTree.register({
        id: 'app.orders',
        label: 'My orders',
        items: () => [
          {
            id: 'o1',
            label: 'Buy 2 <script>',
            detail: '100.00',
            select,
            actions: [{ id: 'x', label: 'Cancel o1', icon: 'close', danger: true, run: remove }],
          },
        ],
      });
      ui.settings.register({
        id: 'app',
        label: 'My app',
        fields: () => [
          { kind: 'toggle', id: 'flag', label: 'Flag', value: () => true, set: () => undefined },
        ],
      });
    });
    await act(async () => ui.capabilities.panels!['objectTree']!.toggle());
    const tree = container.querySelector<HTMLElement>('[role="region"][aria-label="Object tree"]')!;
    const section = tree.querySelector<HTMLElement>('section[aria-label="My orders"]')!;
    const row = section.querySelector<HTMLButtonElement>('.mc-ui-tree-row button')!;
    expect(row.textContent).toBe('Buy 2 <script>');
    await act(async () => row.click());
    expect(select).toHaveBeenCalledOnce();
    await key(row, 'Delete');
    expect(remove).toHaveBeenCalledOnce();
    await act(async () => ui.openSettings('app'));
    await settle(3);
    const tab = [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find(
      (t) => t.textContent === 'My app',
    )!;
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('[role="tabpanel"]')!.textContent).toContain('Flag');
  });

  it('adds nothing when no feature is installed', async () => {
    await mount({ symbol: { value: () => 'A', set: () => undefined } }, []);
    expect(container.querySelector('button[aria-haspopup="listbox"]')).toBeNull();
    expect(container.querySelector('.mc-ui-price-btn')).toBeNull();
    // The plain select of the existing `symbol` capability is unchanged.
    expect(container.querySelector('select[aria-label="Symbol"]')).not.toBeNull();
  });
});
