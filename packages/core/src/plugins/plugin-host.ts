import type { Rect, Unsubscribe } from '../model/types.js';
import type { ChartInputHandler } from '../interaction/input-handler.js';
import type { ChartApi } from '../chart/api.js';
import { ChartError } from '../utils/errors.js';
import { CORE_VERSION, satisfiesVersion } from '../version.js';
import type { ChartPlugin, ChartPluginContext, PaneLayer, PaneLayerZOrder } from './plugin.js';

interface InstalledPlugin {
  readonly plugin: ChartPlugin;
  readonly cleanups: Unsubscribe[];
}

export interface RegisteredLayer {
  readonly owner: string;
  readonly layer: PaneLayer;
}

const ID_PATTERN = /^[a-zA-Z0-9@/._-]{1,128}$/;

/**
 * Owns plugin lifecycle. Everything a plugin registers through its context is tracked and released
 * on removal, so a misbehaving plugin cannot leak listeners or layers after it is gone.
 */
export class PluginHost {
  private readonly installed = new Map<string, InstalledPlugin>();
  private _layers: RegisteredLayer[] = [];
  private readonly chart: ChartApi;
  private readonly reportError: (error: unknown, source: string) => void;
  private readonly redraw: (surface?: 'all' | 'overlay') => void;
  private readonly paneRect: (pane: number) => Rect | null;
  /** Wrapped handlers, most recently registered first. */
  private _inputHandlers: ChartInputHandler[] = [];

  constructor(
    chart: ChartApi,
    reportError: (error: unknown, source: string) => void,
    redraw: (surface?: 'all' | 'overlay') => void,
    paneRect: (pane: number) => Rect | null = () => null,
  ) {
    this.chart = chart;
    this.reportError = reportError;
    this.redraw = redraw;
    this.paneRect = paneRect;
  }

  get layers(): readonly RegisteredLayer[] {
    return this._layers;
  }

  get inputHandlers(): readonly ChartInputHandler[] {
    return this._inputHandlers;
  }

  /** Wraps every handler method so a throwing plugin cannot break chart input. */
  private isolate(owner: string, handler: ChartInputHandler): ChartInputHandler {
    const guard =
      <A extends unknown[], R>(fn: ((...args: A) => R) | undefined, fallback: R) =>
      (...args: A): R => {
        if (!fn) return fallback;
        try {
          return fn.apply(handler, args);
        } catch (error) {
          this.reportError(error, `input:${owner}`);
          return fallback;
        }
      };
    return {
      pointerDown: guard(handler.pointerDown, false),
      pointerMove: guard(handler.pointerMove, undefined),
      pointerUp: guard(handler.pointerUp, undefined),
      pointerCancel: guard(handler.pointerCancel, undefined),
      hover: guard(handler.hover, null),
      doubleClick: guard(handler.doubleClick, false),
      keyDown: guard(handler.keyDown, false),
    };
  }

  has(id: string): boolean {
    return this.installed.has(id);
  }

  install(plugin: ChartPlugin): void {
    if (!plugin || typeof plugin !== 'object' || typeof plugin.install !== 'function') {
      throw new ChartError('use() expects a plugin object with an install() function');
    }
    if (typeof plugin.id !== 'string' || !ID_PATTERN.test(plugin.id)) {
      throw new ChartError(`invalid plugin id "${String(plugin.id)}"`);
    }
    if (typeof plugin.version !== 'string' || plugin.version.length === 0) {
      throw new ChartError(`plugin "${plugin.id}" must declare a version`);
    }
    if (this.installed.has(plugin.id))
      throw new ChartError(`plugin "${plugin.id}" is already installed`);
    if (plugin.requires?.core !== undefined) {
      let compatible: boolean;
      try {
        compatible = satisfiesVersion(CORE_VERSION, plugin.requires.core);
      } catch (error) {
        throw new ChartError(`plugin "${plugin.id}" has an invalid core range: ${String(error)}`);
      }
      if (!compatible) {
        throw new ChartError(
          `plugin "${plugin.id}" requires core ${plugin.requires.core}, but this is ${CORE_VERSION}`,
        );
      }
    }
    for (const dependency of plugin.dependencies ?? []) {
      const id = typeof dependency === 'string' ? dependency : dependency.id;
      const range = typeof dependency === 'string' ? undefined : dependency.version;
      const installed = this.installed.get(id);
      if (!installed) {
        throw new ChartError(`plugin "${plugin.id}" requires "${id}" to be installed first`);
      }
      if (range !== undefined && !satisfiesVersion(installed.plugin.version, range)) {
        throw new ChartError(
          `plugin "${plugin.id}" requires "${id}" ${range}, but ${installed.plugin.version} is installed`,
        );
      }
    }
    const cleanups: Unsubscribe[] = [];
    const record: InstalledPlugin = { plugin, cleanups };
    const owner = plugin.id;
    const context: ChartPluginContext = {
      chart: this.chart,
      on: (event, listener) => {
        const off = this.chart.on(event, listener);
        cleanups.push(off);
        return off;
      },
      addPaneLayer: (layer) => {
        if (!layer || typeof layer.draw !== 'function')
          throw new ChartError('addPaneLayer expects { zOrder, draw }');
        const entry: RegisteredLayer = { owner, layer };
        this._layers = [...this._layers, entry];
        let removed = false;
        const remove = (): void => {
          if (removed) return;
          removed = true;
          this._layers = this._layers.filter((l) => l !== entry);
          this.redraw();
        };
        cleanups.push(remove);
        this.redraw();
        return remove;
      },
      requestRedraw: (surface = 'all') => this.redraw(surface),
      addInputHandler: (handler) => {
        if (!handler || typeof handler !== 'object')
          throw new ChartError('addInputHandler expects an object');
        const wrapped = this.isolate(owner, handler);
        this._inputHandlers = [wrapped, ...this._inputHandlers];
        let removed = false;
        const remove = (): void => {
          if (removed) return;
          removed = true;
          this._inputHandlers = this._inputHandlers.filter((h) => h !== wrapped);
        };
        cleanups.push(remove);
        return remove;
      },
      paneRect: (pane) => this.paneRect(pane),
      reportError: (error) => this.reportError(error, `plugin:${owner}`),
    };
    this.installed.set(plugin.id, record);
    try {
      plugin.install(context);
    } catch (error) {
      this.installed.delete(plugin.id);
      this.runCleanups(record);
      throw new ChartError(
        `plugin "${plugin.id}" failed to install: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  remove(id: string): boolean {
    const record = this.installed.get(id);
    if (!record) return false;
    for (const other of this.installed.values()) {
      if (other.plugin.dependencies?.some((d) => (typeof d === 'string' ? d : d.id) === id)) {
        throw new ChartError(`cannot remove plugin "${id}": "${other.plugin.id}" depends on it`);
      }
    }
    this.installed.delete(id);
    this.teardown(record);
    return true;
  }

  /** Removes all plugins in reverse installation order (dependents first). */
  destroyAll(): void {
    const records = [...this.installed.values()].reverse();
    this.installed.clear();
    for (const record of records) this.teardown(record);
    this._layers = [];
  }

  /** Calls `fn` for each layer of `zOrder` registered for `pane`, isolating failures. */
  forEachLayer(pane: number, zOrder: PaneLayerZOrder, fn: (layer: PaneLayer) => void): void {
    for (const entry of this._layers) {
      if (entry.layer.zOrder !== zOrder || (entry.layer.pane ?? 0) !== pane) continue;
      try {
        fn(entry.layer);
      } catch (error) {
        this.reportError(error, `layer:${entry.owner}`);
      }
    }
  }

  private teardown(record: InstalledPlugin): void {
    this.runCleanups(record);
    try {
      record.plugin.destroy?.();
    } catch (error) {
      this.reportError(error, `plugin:${record.plugin.id}`);
    }
  }

  private runCleanups(record: InstalledPlugin): void {
    for (const cleanup of record.cleanups.splice(0).reverse()) {
      try {
        cleanup();
      } catch (error) {
        this.reportError(error, `plugin:${record.plugin.id}`);
      }
    }
  }
}
