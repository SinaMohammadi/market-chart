// Every published entry point must be importable on a server: no DOM, no storage and no network APIs
// at import time. Browser globals are replaced by traps that record any access while importing.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const BROWSER_GLOBALS = [
  'window',
  'document',
  'navigator',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'requestIdleCallback',
  'matchMedia',
  'ResizeObserver',
  'IntersectionObserver',
  'HTMLElement',
  'HTMLCanvasElement',
  'OffscreenCanvas',
  'BroadcastChannel',
  'WebSocket',
  'EventSource',
  'fetch',
] as const;

const accessed = new Set<string>();
const saved = new Map<string, PropertyDescriptor | undefined>();
let recording = false;

beforeAll(() => {
  for (const name of BROWSER_GLOBALS) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    saved.set(name, descriptor);
    let value: unknown =
      descriptor && 'value' in descriptor ? descriptor.value : descriptor?.get?.call(globalThis);
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get() {
        if (recording) accessed.add(name);
        return value;
      },
      set(next: unknown) {
        value = next;
      },
    });
  }
});

afterAll(() => {
  for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

const ENTRIES = [
  '@market-chart/core',
  '@market-chart/core/static',
  '@market-chart/react',
  '@market-chart/react/ssr',
  '@market-chart/indicators',
  '@market-chart/indicators/react',
  '@market-chart/drawing-tools',
  '@market-chart/drawing-tools/react',
  '@market-chart/charts',
  '@market-chart/datafeed',
  '@market-chart/datafeed/react',
  '@market-chart/persistence',
  '@market-chart/persistence/react',
  '@market-chart/testing',
  '@market-chart/i18n',
  '@market-chart/ui',
  '@market-chart/ui/react',
  '@market-chart/trading',
  '@market-chart/trading/react',
];

describe('server-safe imports', () => {
  for (const entry of ENTRIES) {
    it(`${entry} touches no browser API at import time`, async () => {
      accessed.clear();
      recording = true;
      let module: Record<string, unknown>;
      try {
        module = (await import(/* @vite-ignore */ entry)) as Record<string, unknown>;
      } finally {
        recording = false;
      }
      expect(Object.keys(module).length).toBeGreaterThan(0);
      expect([...accessed]).toEqual([]);
    });
  }

  it('runs in an environment without a DOM', () => {
    expect(typeof (globalThis as { document?: unknown }).document).toBe('undefined');
    expect(typeof (globalThis as { window?: unknown }).window).toBe('undefined');
  });
});
