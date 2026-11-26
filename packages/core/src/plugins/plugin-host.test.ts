import { describe, expect, it, vi } from 'vitest';
import type { ChartApi } from '../chart/api.js';
import { EventEmitter } from '../events/emitter.js';
import { PluginHost } from './plugin-host.js';
import type { ChartPlugin } from './plugin.js';

function fakeChart(): ChartApi & { emitter: EventEmitter<Record<string, unknown>> } {
  const emitter = new EventEmitter<Record<string, unknown>>();
  return {
    emitter,
    on: (e: string, l: (p: unknown) => void) => emitter.on(e, l),
  } as unknown as ChartApi & {
    emitter: EventEmitter<Record<string, unknown>>;
  };
}

function plugin(id: string, extra: Partial<ChartPlugin> = {}): ChartPlugin {
  return { id, version: '1.0.0', install: () => undefined, ...extra };
}

describe('PluginHost', () => {
  it('installs, validates ids and prevents duplicates', () => {
    const host = new PluginHost(
      fakeChart(),
      () => undefined,
      () => undefined,
    );
    host.install(plugin('a'));
    expect(host.has('a')).toBe(true);
    expect(() => host.install(plugin('a'))).toThrow(/already installed/);
    expect(() => host.install(plugin('bad id!'))).toThrow(/invalid plugin id/);
    expect(() =>
      host.install({ id: 'x', install: () => undefined } as unknown as ChartPlugin),
    ).toThrow(/version/);
  });

  it('enforces dependencies on install and removal', () => {
    const host = new PluginHost(
      fakeChart(),
      () => undefined,
      () => undefined,
    );
    expect(() => host.install(plugin('child', { dependencies: ['base'] }))).toThrow(
      /requires "base"/,
    );
    host.install(plugin('base'));
    host.install(plugin('child', { dependencies: ['base'] }));
    expect(() => host.remove('base')).toThrow(/depends on it/);
    host.remove('child');
    host.remove('base');
    expect(host.has('base')).toBe(false);
  });

  it('releases listeners and layers on removal', () => {
    const chart = fakeChart();
    const redraw = vi.fn();
    const host = new PluginHost(chart, () => undefined, redraw);
    const listener = vi.fn();
    const destroy = vi.fn();
    host.install(
      plugin('p', {
        install: (ctx) => {
          ctx.on('crosshairMove', listener);
          ctx.addPaneLayer({ zOrder: 'above', draw: () => undefined });
        },
        destroy,
      }),
    );
    expect(host.layers).toHaveLength(1);
    chart.emitter.emit('crosshairMove', {});
    host.remove('p');
    chart.emitter.emit('crosshairMove', {});
    expect(listener).toHaveBeenCalledTimes(1);
    expect(host.layers).toHaveLength(0);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('checks core and dependency versions', () => {
    const host = new PluginHost(
      fakeChart(),
      () => undefined,
      () => undefined,
    );
    expect(() => host.install(plugin('future', { requires: { core: '>=99.0.0' } }))).toThrow(
      /requires core/,
    );
    expect(() => host.install(plugin('broken-range', { requires: { core: '^nope' } }))).toThrow(
      /invalid core range/,
    );
    host.install(plugin('ok', { requires: { core: '>=0.1.0' } }));
    host.install({ ...plugin('base'), version: '1.4.0' });
    expect(() =>
      host.install(plugin('needs-2', { dependencies: [{ id: 'base', version: '^2.0.0' }] })),
    ).toThrow(/requires "base" \^2\.0\.0, but 1\.4\.0/);
    host.install(plugin('needs-1', { dependencies: [{ id: 'base', version: '^1.2.0' }] }));
    expect(() => host.remove('base')).toThrow(/depends on it/);
  });

  it('rolls back a failed install', () => {
    const chart = fakeChart();
    const host = new PluginHost(
      chart,
      () => undefined,
      () => undefined,
    );
    expect(() =>
      host.install(
        plugin('broken', {
          install: (ctx) => {
            ctx.addPaneLayer({ zOrder: 'top', draw: () => undefined });
            throw new Error('nope');
          },
        }),
      ),
    ).toThrow(/failed to install: nope/);
    expect(host.has('broken')).toBe(false);
    expect(host.layers).toHaveLength(0);
  });

  it('isolates layer failures', () => {
    const errors: string[] = [];
    const host = new PluginHost(
      fakeChart(),
      (_e, source) => errors.push(source),
      () => undefined,
    );
    const ok = vi.fn();
    host.install(
      plugin('p', {
        install: (ctx) => {
          ctx.addPaneLayer({
            zOrder: 'below',
            draw: () => {
              throw new Error('x');
            },
          });
          ctx.addPaneLayer({ zOrder: 'below', draw: ok });
        },
      }),
    );
    host.forEachLayer(0, 'below', (layer) => layer.draw({} as never));
    expect(ok).toHaveBeenCalledTimes(1);
    expect(errors).toEqual(['layer:p']);
  });
});
