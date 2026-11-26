import { EventEmitter } from '@market-chart/core';
import type { Unsubscribe } from '@market-chart/core';
import type { ActionLocation, ContextTargetKind, UiAction, UiActionDefinition } from './types.js';

export class UiError extends Error {
  constructor(message: string) {
    super(`[market-chart/ui] ${message}`);
    this.name = 'UiError';
  }
}

export interface ActionRegistryEvents {
  change: {
    readonly id: string | null;
    readonly reason: 'register' | 'unregister' | 'override' | 'enabled';
  };
}

const ID = /^[A-Za-z0-9_.:-]{1,120}$/;
const LOCATIONS: readonly ActionLocation[] = ['contextMenu', 'header', 'sidebar'];

function normalise(definition: UiActionDefinition, owner: string): UiAction {
  if (!definition || typeof definition.id !== 'string' || !ID.test(definition.id)) {
    throw new UiError(`invalid action id "${String(definition?.id)}"`);
  }
  if (typeof definition.label !== 'string' && typeof definition.label !== 'function') {
    throw new UiError(
      `action "${definition.id}" needs a label (translation key, text or function)`,
    );
  }
  const targets: readonly ContextTargetKind[] = definition.targets ?? [];
  const locations = definition.locations ?? (targets.length ? ['contextMenu'] : ['header']);
  for (const location of locations) {
    if (!LOCATIONS.includes(location))
      throw new UiError(`action "${definition.id}": unknown location "${String(location)}"`);
  }
  if (locations.includes('contextMenu') && !targets.length) {
    throw new UiError(`action "${definition.id}" is in the context menu but has no targets`);
  }
  const kind =
    definition.kind ??
    (definition.options
      ? 'select'
      : definition.submenu && !definition.run
        ? 'menu'
        : definition.isActive
          ? 'toggle'
          : 'button');
  if (kind === 'select' && (!definition.options || !definition.value || !definition.select)) {
    throw new UiError(`select action "${definition.id}" needs options, value and select`);
  }
  if (!definition.run && !definition.submenu && kind !== 'select' && !definition.component) {
    throw new UiError(
      `action "${definition.id}" does nothing: give it run, submenu, options or a component`,
    );
  }
  return {
    ...definition,
    kind,
    locations,
    targets,
    order: Number.isFinite(definition.order) ? definition.order! : 1000,
    defaultVisible: definition.defaultVisible ?? true,
    owner: definition.owner ?? owner,
  };
}

/**
 * All actions of one chart UI: context-menu items, header buttons and sidebar tools share this registry,
 * so an action is defined once and can be shown, hidden or moved by the user without changing its definition.
 */
export class ActionRegistry {
  private readonly actions = new Map<string, UiAction>();
  private readonly originals = new Map<string, UiAction>();
  private readonly disabled = new Set<string>();
  private readonly emitter = new EventEmitter<ActionRegistryEvents>();
  private _version = 0;

  get version(): number {
    return this._version;
  }

  on<K extends keyof ActionRegistryEvents>(
    event: K,
    listener: (payload: ActionRegistryEvents[K]) => void,
  ): Unsubscribe {
    return this.emitter.on(event, listener);
  }

  /** Adds an action. Throws on duplicate ids unless `replace` is set (to override a built-in). */
  register(
    definition: UiActionDefinition,
    options: { replace?: boolean; owner?: string } = {},
  ): Unsubscribe {
    if (this.actions.has(definition?.id) && !options.replace) {
      throw new UiError(
        `action "${definition.id}" is already registered (pass { replace: true } to override it)`,
      );
    }
    const action = normalise(definition, options.owner ?? 'app');
    this.actions.set(action.id, action);
    this.originals.set(action.id, action);
    this.changed(action.id, 'register');
    return () => {
      if (
        this.actions.get(action.id)?.owner === action.owner &&
        this.originals.get(action.id) === action
      )
        this.unregister(action.id);
    };
  }

  registerAll(
    definitions: readonly UiActionDefinition[],
    options: { replace?: boolean; owner?: string } = {},
  ): Unsubscribe {
    const offs = definitions.map((d) => this.register(d, options));
    return () => offs.forEach((off) => off());
  }

  /** Changes parts of a registered action (e.g. a built-in's label or shortcut); `restore` undoes it. */
  override(id: string, patch: Partial<Omit<UiActionDefinition, 'id'>>): void {
    const original = this.originals.get(id);
    if (!original) throw new UiError(`cannot override unknown action "${id}"`);
    this.actions.set(id, normalise({ ...this.actions.get(id)!, ...patch, id }, original.owner));
    this.changed(id, 'override');
  }

  restore(id: string): void {
    const original = this.originals.get(id);
    if (!original) return;
    this.actions.set(id, original);
    this.changed(id, 'override');
  }

  unregister(id: string): boolean {
    const removed = this.actions.delete(id);
    this.originals.delete(id);
    this.disabled.delete(id);
    if (removed) this.changed(id, 'unregister');
    return removed;
  }

  /** Removes every action registered by `owner` (e.g. when a plugin is removed). */
  unregisterOwner(owner: string): number {
    let count = 0;
    for (const action of [...this.actions.values()])
      if (action.owner === owner && this.unregister(action.id)) count++;
    return count;
  }

  has(id: string): boolean {
    return this.actions.has(id);
  }

  get(id: string): UiAction | undefined {
    return this.actions.get(id);
  }

  /** Actions in registration order, optionally only those for a location or target. */
  list(
    filter: { location?: ActionLocation; target?: ContextTargetKind; owner?: string } = {},
  ): UiAction[] {
    return [...this.actions.values()].filter(
      (a) =>
        (!filter.location || a.locations.includes(filter.location)) &&
        (!filter.target || a.targets.includes(filter.target)) &&
        (!filter.owner || a.owner === filter.owner),
    );
  }

  /** Runtime switch, independent of user preferences (e.g. while a request is running). */
  setEnabled(id: string, enabled: boolean): void {
    if (!this.actions.has(id)) throw new UiError(`unknown action "${id}"`);
    if (enabled === !this.disabled.has(id)) return;
    if (enabled) this.disabled.delete(id);
    else this.disabled.add(id);
    this.changed(id, 'enabled');
  }

  isEnabledFlag(id: string): boolean {
    return !this.disabled.has(id);
  }

  private changed(id: string | null, reason: ActionRegistryEvents['change']['reason']): void {
    this._version++;
    this.emitter.emit('change', { id, reason });
  }
}
