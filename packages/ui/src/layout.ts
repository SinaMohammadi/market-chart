import type { ActionPlacement, UiPreferences } from './preferences.js';
import type { HeaderSection, UiAction } from './types.js';

export type ToolbarLocation = 'header' | 'sidebar';

/** An action as placed by defaults plus user preferences. */
export interface ToolbarItem {
  readonly action: UiAction;
  readonly location: ToolbarLocation;
  readonly section: HeaderSection;
  readonly group: string;
  readonly order: number;
  readonly visible: boolean;
  /** Locations the action supports (the user can move it between them). */
  readonly movable: readonly ToolbarLocation[];
}

export interface ToolbarGroup {
  readonly id: string;
  readonly items: readonly ToolbarItem[];
}

export interface HeaderLayout {
  readonly left: readonly ToolbarGroup[];
  readonly center: readonly ToolbarGroup[];
  readonly right: readonly ToolbarGroup[];
}

/** Places every header/sidebar action (visible or not), sorted by order. */
export function placeActions(
  actions: readonly UiAction[],
  preferences: UiPreferences,
): ToolbarItem[] {
  const items: ToolbarItem[] = [];
  actions.forEach((action, index) => {
    const movable = action.locations.filter(
      (l): l is ToolbarLocation => l === 'header' || l === 'sidebar',
    );
    if (!movable.length) return;
    const p: ActionPlacement = preferences.actions[action.id] ?? {};
    const location = p.location && movable.includes(p.location) ? p.location : movable[0]!;
    items.push({
      action,
      location,
      section: p.section ?? action.section ?? 'left',
      group: p.group ?? action.group ?? 'default',
      order: p.order ?? action.order + index / 10_000,
      visible: p.visible ?? action.defaultVisible,
      movable,
    });
  });
  return items.sort((a, b) => a.order - b.order);
}

/** Groups items in first-appearance order (items are already sorted). */
export function groupItems(items: readonly ToolbarItem[]): ToolbarGroup[] {
  const groups = new Map<string, ToolbarItem[]>();
  for (const item of items) {
    let list = groups.get(item.group);
    if (!list) groups.set(item.group, (list = []));
    list.push(item);
  }
  return [...groups].map(([id, list]) => ({ id, items: list }));
}

export function headerLayout(items: readonly ToolbarItem[]): HeaderLayout {
  const visible = items.filter((i) => i.location === 'header' && i.visible);
  return {
    left: groupItems(visible.filter((i) => i.section === 'left')),
    center: groupItems(visible.filter((i) => i.section === 'center')),
    right: groupItems(visible.filter((i) => i.section === 'right')),
  };
}

export function sidebarLayout(items: readonly ToolbarItem[]): ToolbarGroup[] {
  return groupItems(items.filter((i) => i.location === 'sidebar' && i.visible));
}

/**
 * New placements after moving `id` to `index` within the list `ids` (all items of one container, in display
 * order). Orders are rewritten for that container only, so other containers keep their user order.
 */
export function reorderPlacements(
  current: Readonly<Record<string, ActionPlacement>>,
  ids: readonly string[],
  id: string,
  index: number,
  extra: ActionPlacement = {},
): Record<string, ActionPlacement> {
  const list = ids.filter((x) => x !== id);
  list.splice(Math.max(0, Math.min(index, list.length)), 0, id);
  const next: Record<string, ActionPlacement> = { ...current };
  list.forEach((x, i) => {
    next[x] = { ...next[x], order: (i + 1) * 10, ...(x === id ? extra : {}) };
  });
  return next;
}
