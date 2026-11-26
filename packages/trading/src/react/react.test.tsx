// @vitest-environment jsdom
import { useState } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChartApi } from '@market-chart/core';
import { CandlestickSeries, Chart, ChartProvider } from '@market-chart/react';
import { HOUR, generateBars, installCanvasMock } from '@market-chart/testing';
import type { ChartUi } from '@market-chart/ui';
import { ChartInterface, useChartUi } from '@market-chart/ui/react';
import type { TradingOrder, TradingOverlay as Overlay } from '../index.js';
import { TradingOverlay } from './index.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const bars = generateBars({ count: 150, interval: HOUR, seed: 3, startPrice: 100 });
const last = bars[bars.length - 1]!.close;
let restore: () => void = () => undefined;
let container: HTMLDivElement;
let root: Root;
const state: { chart: ChartApi | null; ui: ChartUi | null; overlay: Overlay | null } = {
  chart: null,
  ui: null,
  overlay: null,
};

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

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });
}

function App({
  orders,
  onCancel,
  locale = 'en',
}: {
  orders: TradingOrder[];
  onCancel?: () => void;
  locale?: string;
}) {
  return (
    <ChartProvider locale={locale}>
      <Inner orders={orders} {...(onCancel ? { onCancel } : {})} />
    </ChartProvider>
  );
}

function Inner({ orders, onCancel }: { orders: TradingOrder[]; onCancel?: () => void }) {
  const [chart, setChart] = useState<ChartApi | null>(null);
  const ui = useChartUi(chart);
  state.chart = chart;
  state.ui = ui;
  return (
    <ChartInterface ui={ui} height={420}>
      <Chart ref={setChart} options={{ autoSize: false, width: 700, height: 360 }}>
        <CandlestickSeries data={bars} />
        {ui ? (
          <TradingOverlay
            ui={ui}
            orders={orders}
            {...(onCancel ? { onCancel } : {})}
            onReady={(o) => (state.overlay = o)}
          />
        ) : null}
      </Chart>
    </ChartInterface>
  );
}

const order = (patch: Partial<TradingOrder> = {}): TradingOrder => ({
  id: 'o1',
  side: 'buy',
  type: 'limit',
  price: last - 1,
  quantity: 1,
  ...patch,
});

describe('<TradingOverlay>', () => {
  it('applies orders from props, updates them and follows callback changes', async () => {
    const first = vi.fn();
    await act(async () => root.render(<App orders={[order()]} onCancel={first} />));
    await settle();
    const overlay = state.overlay!;
    expect(overlay.items().map((i) => i.key)).toEqual(['order:o1']);
    expect(overlay.items()[0]!.cancellable).toBe(true);
    await act(async () =>
      root.render(<App orders={[order(), order({ id: 'o2', side: 'sell', price: last + 1 })]} />),
    );
    await settle();
    // Same overlay, new data; without onCancel the × disappears.
    expect(state.overlay).toBe(overlay);
    expect(overlay.items().map((i) => i.key)).toEqual(['order:o1', 'order:o2']);
    expect(overlay.items()[0]!.cancellable).toBe(false);
  });

  it('lists orders in the object tree as focusable rows that highlight and select their line', async () => {
    const onCancel = vi.fn();
    await act(async () =>
      root.render(
        <App orders={[order({ label: '<img src=x onerror=alert(1)>' })]} onCancel={onCancel} />,
      ),
    );
    await settle();
    await act(async () => state.ui!.capabilities.panels!['objectTree']!.toggle());
    await settle();
    const section = container.querySelector<HTMLElement>('section[aria-label="Orders"]')!;
    const row = section.querySelector<HTMLButtonElement>('.mc-ui-tree-row button')!;
    expect(row.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(section.querySelector('img')).toBeNull();
    await act(async () => row.focus());
    await act(async () => row.click());
    expect(state.overlay!.selected()).toBe('order:o1');
    const cancel = section.querySelector<HTMLButtonElement>('button[aria-label^="Cancel"]')!;
    await act(async () => cancel.click());
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('removes its lines when unmounted', async () => {
    await act(async () => root.render(<App orders={[order()]} />));
    await settle();
    const series = state.chart!.series()[0]!;
    expect(series.priceLines()).toHaveLength(1);
    await act(async () => root.render(<App orders={[]} />));
    await settle();
    expect(series.priceLines()).toHaveLength(0);
  });

  it('translates the trading interface in Persian (RTL)', async () => {
    await act(async () => root.render(<App orders={[order()]} locale="fa" />));
    await settle();
    expect(container.querySelector('.mc-ui-interface')!.getAttribute('dir')).toBe('rtl');
    await act(async () => state.ui!.capabilities.panels!['objectTree']!.toggle());
    await settle();
    expect(container.querySelector('section[aria-label="سفارش ها"]')).not.toBeNull();
    expect(state.overlay!.t('trading.cancelOrder')).toBe('لغو سفارش');
  });
});
