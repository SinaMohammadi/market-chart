// @vitest-environment jsdom
// Server HTML is hydrated on the client without mismatches, then the engine takes over.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import type { ChartApi } from '@market-chart/core';
import { CandlestickSeries, Chart, ChartProvider, ProgressiveChart } from '@market-chart/react';
import { ChartInterface } from '@market-chart/ui/react';
import { StaticChart } from '@market-chart/react/ssr';
import { HOUR, generateBars, installCanvasMock } from '@market-chart/testing';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bars = generateBars({ count: 300, interval: HOUR, seed: 8 });
const line = bars.map((b) => ({ time: b.time, value: b.close }));
let restore: () => void = () => undefined;
let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  restore = installCanvasMock();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container.remove();
  restore();
});

async function hydrate(element: React.ReactElement): Promise<{ errors: unknown[] }> {
  container.innerHTML = renderToString(element);
  const errors: unknown[] = [];
  const consoleError = vi
    .spyOn(console, 'error')
    .mockImplementation((...args) => errors.push(args));
  await act(async () => {
    root = hydrateRoot(container, element, { onRecoverableError: (error) => errors.push(error) });
  });
  consoleError.mockRestore();
  return { errors };
}

async function waitFor(check: () => boolean): Promise<void> {
  for (let i = 0; i < 300 && !check(); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
  expect(check()).toBe(true);
}

describe('hydration', () => {
  it('StaticChart hydrates without mismatches', async () => {
    const { errors } = await hydrate(
      <StaticChart type="candlestick" data={bars} height={150} title="Candles" />,
    );
    expect(errors).toEqual([]);
    expect(container.querySelector('svg[aria-label="Candles"]')).not.toBeNull();
  });

  it('Chart hydrates its placeholder, then creates the engine', async () => {
    let chart: ChartApi | null = null;
    const { errors } = await hydrate(
      <Chart height={300} ref={(c) => void (chart = c)}>
        <CandlestickSeries data={bars} />
      </Chart>,
    );
    expect(errors).toEqual([]);
    await waitFor(() => chart !== null && chart.series().length === 1);
    expect(chart!.series()[0]!.length()).toBe(bars.length);
    expect(container.querySelectorAll('canvas').length).toBeGreaterThan(0);
  });

  it('ProgressiveChart hydrates the static SVG and switches to the engine', async () => {
    let activated: ChartApi | null = null;
    const { errors } = await hydrate(
      <ProgressiveChart
        type="area"
        data={line}
        height={200}
        title="Area"
        activate="mount"
        onActivate={(c) => void (activated = c)}
      />,
    );
    expect(errors).toEqual([]);
    const wrapper = container.firstElementChild as HTMLElement;
    await waitFor(() => wrapper.dataset['chartState'] === 'interactive');
    expect(activated).not.toBeNull();
    expect(activated!.series()[0]!.length()).toBe(line.length);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('ProgressiveChart with activate="interaction" waits for the user', async () => {
    const { errors } = await hydrate(
      <ProgressiveChart type="line" data={line} height={200} activate="interaction" />,
    );
    expect(errors).toEqual([]);
    const wrapper = container.firstElementChild as HTMLElement;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(container.querySelector('canvas')).toBeNull();
    await act(async () => {
      wrapper.dispatchEvent(new Event('focusin', { bubbles: true }));
    });
    await waitFor(() => wrapper.dataset['chartState'] === 'interactive');
  });

  it('an RTL chart interface is mirrored in the server HTML and hydrates without mismatches', async () => {
    const element = (
      <ChartProvider locale="fa">
        <ChartInterface ui={null} height={300}>
          <Chart height={260}>
            <CandlestickSeries data={bars} />
          </Chart>
        </ChartInterface>
      </ChartProvider>
    );
    const html = renderToString(element);
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('lang="fa"');
    const { errors } = await hydrate(element);
    expect(errors).toEqual([]);
    expect(container.querySelector('.mc-ui-interface')!.getAttribute('dir')).toBe('rtl');
  });
});
