import type { ContextMenuEvent, Unsubscribe } from '@market-chart/core';
import type { AnyTranslationKey } from '@market-chart/i18n';
import type { ChartUi } from './chart-ui.js';
import type { Choice, ContextTarget } from './types.js';
import type { KeyLike } from './util.js';

/**
 * An optional part of the interface (symbol search, price actions, order ticket, or a package such as
 * `@market-chart/trading`). Features are installed explicitly, so an application that does not use one neither
 * runs nor bundles it. `install` returns its cleanup.
 */
export interface ChartUiFeature {
  readonly id: string;
  install(ui: ChartUi): (() => void) | undefined;
}

/**
 * Resolves what a context-menu event points at before the built-in resolution (drawings, indicators, data
 * points). Return null to let the next resolver (and finally the built-in one) decide.
 */
export type TargetResolver = (event: ContextMenuEvent) => ContextTarget | null;

/**
 * Runs before the context menu opens. Return true when the request was handled (for example a touch
 * long-press that opens the price-action menu instead).
 */
export type ContextMenuInterceptor = (event: ContextMenuEvent, target: ContextTarget) => boolean;

/** Keyboard handler of a feature; runs after action shortcuts. Return true when the key was used. */
export type KeyHandler = (event: KeyLike) => boolean;

/** One setting of a registered settings section (rendered as a switch or a select). */
export type SettingsField =
  | {
      readonly kind: 'toggle';
      readonly id: string;
      readonly label: AnyTranslationKey | string;
      readonly description?: AnyTranslationKey | string;
      value(): boolean;
      set(value: boolean): void;
      disabled?(): boolean;
    }
  | {
      readonly kind: 'select';
      readonly id: string;
      readonly label: AnyTranslationKey | string;
      readonly description?: AnyTranslationKey | string;
      value(): string;
      options(): readonly Choice[];
      set(value: string): void;
      disabled?(): boolean;
    }
  | { readonly kind: 'heading'; readonly id: string; readonly label: AnyTranslationKey | string };

/** An extra settings category, described as data so any renderer can show it. */
export interface SettingsSection {
  readonly id: string;
  readonly label: AnyTranslationKey | string;
  readonly order?: number;
  fields(): readonly SettingsField[];
}

/** A button of an object-tree row. Labels are already translated. */
export interface ObjectTreeItemAction {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  /** Toggle buttons (show/hide) report their state. */
  readonly pressed?: boolean;
  readonly danger?: boolean;
  run(): void | Promise<void>;
}

/** A row of a registered object-tree section. Texts are shown as plain text. */
export interface ObjectTreeItem {
  readonly id: string;
  readonly label: string;
  /** Secondary text (price, quantity, status). */
  readonly detail?: string;
  readonly color?: string;
  readonly hidden?: boolean;
  readonly selected?: boolean;
  /** Activating the row (click, Enter). */
  select?(): void;
  /** Keyboard focus entered or left the row (e.g. to highlight the object on the chart). */
  focus?(focused: boolean): void;
  readonly actions?: readonly ObjectTreeItemAction[];
}

/** Extra object-tree section (orders, positions, alerts…), described as data. */
export interface ObjectTreeSection {
  readonly id: string;
  readonly label: AnyTranslationKey | string;
  readonly order?: number;
  items(): readonly ObjectTreeItem[];
  /** Called when the items change (renderers re-read `items`, at most once per frame). */
  subscribe?(onChange: () => void): Unsubscribe;
}

/**
 * An ordered list of registrations; `register` returns the removal. Several registrations may share an id
 * (e.g. the order ticket and `@market-chart/trading` both add to the "trading" settings category); renderers
 * show them as one category, in registration order.
 */
export class SectionList<T extends { readonly id: string; readonly order?: number }> {
  private items: T[] = [];
  private readonly onChange: () => void;

  constructor(onChange: () => void) {
    this.onChange = onChange;
  }

  register(item: T): Unsubscribe {
    this.items = [...this.items.filter((i) => i !== item), item];
    this.onChange();
    return () => {
      if (!this.items.includes(item)) return;
      this.items = this.items.filter((i) => i !== item);
      this.onChange();
    };
  }

  list(): readonly T[] {
    return [...this.items].sort((a, b) => (a.order ?? 1000) - (b.order ?? 1000));
  }

  clear(): void {
    this.items = [];
  }
}
