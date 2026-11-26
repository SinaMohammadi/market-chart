import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { ChartUi } from '../chart-ui.js';
import type { ContextMenuState, MenuEntry, MenuItemEntry } from '../menu.js';
import { placeMenu, placeSubmenu } from '../position.js';
import { Icon } from './icon.js';
import { useMenuState, useThemeName } from './hooks.js';
import { useUiStyles } from './styles.js';

export interface MenuLevel {
  readonly level: number;
  readonly entries: readonly MenuEntry[];
  /** Active item index (-1: none). */
  readonly active: number;
}

/** Everything a custom context-menu renderer needs; the default `<ChartContextMenu>` is built on it. */
export interface ContextMenuApi {
  readonly state: ContextMenuState;
  readonly levels: readonly MenuLevel[];
  readonly showSearch: boolean;
  itemId(level: number, index: number): string;
  getMenuProps(level: number): {
    id: string;
    role: 'menu';
    tabIndex: number;
    'aria-label'?: string;
    'aria-activedescendant'?: string;
    'aria-orientation': 'vertical';
    dir: 'ltr' | 'rtl';
    onKeyDown(event: ReactKeyboardEvent): void;
  };
  getItemProps(
    level: number,
    index: number,
  ): {
    id: string;
    role: 'menuitem' | 'menuitemcheckbox';
    tabIndex: -1;
    'aria-disabled'?: boolean;
    'aria-haspopup'?: 'menu';
    'aria-expanded'?: boolean;
    'aria-checked'?: boolean;
    'aria-keyshortcuts'?: string;
    'data-active': boolean;
    onPointerEnter(): void;
    onClick(): void;
  };
  readonly searchProps: {
    value: string;
    placeholder: string;
    'aria-label': string;
    'aria-controls': string;
    'aria-activedescendant'?: string;
    onChange(event: { target: { value: string } }): void;
    onKeyDown(event: ReactKeyboardEvent): void;
  } | null;
  close(): void;
  confirm(accept: boolean): void;
}

function leafCount(entries: readonly MenuEntry[]): number {
  let n = 0;
  for (const e of entries) if (e.type === 'item') n += e.children ? leafCount(e.children) : 1;
  return n;
}

/** Headless context menu bound to `ui.menu`. */
export function useContextMenu(ui: ChartUi | null): ContextMenuApi | null {
  const state = useMenuState(ui);
  const base = useId();
  if (!ui || !state || !state.open) return null;
  const levels: MenuLevel[] = state.path.map((active, level) => ({
    level,
    entries: ui.menu.levelEntries(level),
    active,
  }));
  const showSearch =
    state.query !== '' ||
    state.entries.some((e) => e.type === 'item' && e.searchable) ||
    leafCount(state.entries) > 15;
  const itemId = (level: number, index: number) => `${base}-${level}-${index}`;
  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (ui.menu.handleKey(event.key)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  const deepest = levels.length - 1;
  return {
    state,
    levels,
    showSearch,
    itemId,
    getMenuProps: (level) => {
      const active = levels[level]?.active ?? -1;
      return {
        id: `${base}-menu-${level}`,
        role: 'menu',
        tabIndex: -1,
        'aria-orientation': 'vertical',
        ...(level === 0 ? { 'aria-label': ui.i18n.t('menu.label') } : {}),
        ...(active >= 0 ? { 'aria-activedescendant': itemId(level, active) } : {}),
        dir: state.direction,
        onKeyDown,
      };
    },
    getItemProps: (level, index) => {
      const entry = levels[level]!.entries[index] as MenuItemEntry;
      const open = levels[level + 1] !== undefined && levels[level]!.active === index;
      return {
        id: itemId(level, index),
        role: entry.checked !== null ? 'menuitemcheckbox' : 'menuitem',
        tabIndex: -1,
        ...(entry.disabled || entry.info ? { 'aria-disabled': true } : {}),
        ...(entry.children ? { 'aria-haspopup': 'menu' as const, 'aria-expanded': open } : {}),
        ...(entry.checked !== null ? { 'aria-checked': entry.checked } : {}),
        ...(entry.shortcut ? { 'aria-keyshortcuts': entry.shortcut } : {}),
        'data-active': levels[level]!.active === index,
        onPointerEnter: () => ui.menu.hover(level, index),
        onClick: () => ui.menu.activate(level, index),
      };
    },
    searchProps: showSearch
      ? {
          value: state.query,
          placeholder: ui.i18n.t('common.searchActions'),
          'aria-label': ui.i18n.t('common.search'),
          'aria-controls': `${base}-menu-0`,
          ...(state.results && (levels[0]?.active ?? -1) >= 0
            ? { 'aria-activedescendant': itemId(0, levels[0]!.active) }
            : {}),
          onChange: (event) => ui.menu.setQuery(event.target.value),
          onKeyDown: (event) => {
            // Typing stays in the field; navigation keys drive the menu.
            if (
              ['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Home', 'End', 'Tab'].includes(
                event.key,
              ) ||
              (deepest > 0 && event.key.startsWith('Arrow'))
            )
              onKeyDown(event);
          },
        }
      : null,
    close: () => ui.menu.close(),
    confirm: (accept) => ui.menu.confirm(accept),
  };
}

export interface ChartContextMenuProps {
  readonly ui: ChartUi | null;
  /** Replace how one item looks (keeps behaviour, ARIA and keyboard handling). */
  readonly renderItem?: (entry: MenuItemEntry, defaultContent: ReactNode) => ReactNode;
  readonly className?: string;
}

/**
 * Default context menu (also used for toolbar dropdowns): portal-rendered, placed inside the viewport, nested
 * submenus opening in the reading direction, search for large menus, keyboard and touch support, dismissed
 * on outside click, scroll, resize or Escape; focus returns to where it was.
 */
export function ChartContextMenu({ ui, renderItem, className }: ChartContextMenuProps) {
  useUiStyles();
  const menu = useContextMenu(ui);
  const theme = useThemeName(ui);
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const items = useRef(new Map<string, HTMLElement>());
  const search = useRef<HTMLInputElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [placements, setPlacements] = useState<
    { left: number; top: number; maxHeight: number | null }[]
  >([]);
  const open = menu !== null;

  // Remember focus before the menu takes it (layout effects run in order, this one first) and restore it on close.
  useLayoutEffect(() => {
    if (!open) return;
    const doc = globalThis.document;
    previousFocus.current = doc.activeElement as HTMLElement | null;
    return () => {
      const target = previousFocus.current;
      if (target && doc.contains(target)) target.focus({ preventScroll: true });
    };
  }, [open]);

  const depth = menu?.levels.length ?? 0;
  const pathKey = menu
    ? `${menu.state.x},${menu.state.y},${menu.state.path.join('.')},${menu.state.query},${menu.state.confirm ? 1 : 0}`
    : '';
  useLayoutEffect(() => {
    if (!menu) return;
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const next: { left: number; top: number; maxHeight: number | null }[] = [];
    for (let level = 0; level < depth; level++) {
      const element = refs.current[level];
      if (!element) break;
      const size = { width: element.offsetWidth, height: element.scrollHeight };
      let placement;
      if (level === 0)
        placement = placeMenu(
          { x: menu.state.x, y: menu.state.y },
          size,
          viewport,
          menu.state.direction,
        );
      else {
        const parent = items.current.get(menu.itemId(level - 1, menu.levels[level - 1]!.active));
        if (!parent) break;
        const r = parent.getBoundingClientRect();
        placement = placeSubmenu(
          { left: r.left, top: r.top, width: r.width, height: r.height },
          size,
          viewport,
          menu.state.direction,
        );
      }
      next.push(placement);
      // Apply now: the next level is anchored to this one's items, and hidden elements cannot take focus.
      element.style.left = `${placement.left}px`;
      element.style.top = `${placement.top}px`;
      element.style.maxHeight = placement.maxHeight === null ? '' : `${placement.maxHeight}px`;
      element.style.visibility = 'visible';
    }
    setPlacements((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    const deepest = refs.current[depth - 1];
    if (menu.state.confirm)
      deepest?.querySelector<HTMLButtonElement>('[data-confirm="yes"]')?.focus();
    else if (depth === 1 && search.current) search.current.focus({ preventScroll: true });
    else deepest?.focus({ preventScroll: true });
    const active = items.current.get(menu.itemId(depth - 1, menu.levels[depth - 1]?.active ?? -1));
    // Keep the active item visible by scrolling the menu only (scrollIntoView may scroll the page, which
    // would close the menu).
    const list = refs.current[depth - 1];
    if (active && list) {
      const top = active.offsetTop;
      const bottom = top + active.offsetHeight;
      if (top < list.scrollTop) list.scrollTop = top;
      else if (bottom > list.scrollTop + list.clientHeight)
        list.scrollTop = bottom - list.clientHeight;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathKey, depth]);

  // Outside click, scroll, resize and window blur close the menu.
  useEffect(() => {
    if (!open || !ui) return;
    const inside = (node: EventTarget | null) =>
      refs.current.some((el) => el && node instanceof Node && el.contains(node));
    const onPointerDown = (e: PointerEvent) => {
      if (!inside(e.target)) ui.menu.close();
    };
    // Scroll events are asynchronous: one caused just before opening (e.g. focusing a toolbar button) can
    // arrive afterwards. Ignore those, and page scrolls that did not move the page.
    const openedAt = performance.now();
    const pageX = window.scrollX;
    const pageY = window.scrollY;
    const onScroll = (e: Event) => {
      if (inside(e.target) || performance.now() - openedAt < 100) return;
      if (
        (e.target === document || e.target === document.documentElement) &&
        window.scrollX === pageX &&
        window.scrollY === pageY
      )
        return;
      ui.menu.close();
    };
    const close = () => ui.menu.close();
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, [open, ui]);

  if (!menu || !ui) return null;
  const doc = (globalThis as { document?: Document }).document;
  if (!doc) return null;
  const { state } = menu;
  const direction = state.direction;
  return createPortal(
    <>
      {menu.levels.map(({ level, entries }) => {
        const place = placements[level];
        return (
          <div
            key={level}
            ref={(el) => {
              refs.current[level] = el;
            }}
            className={`mc-ui-menu${className ? ` ${className}` : ''}`}
            data-mc-theme={theme}
            data-touch={state.source === 'touch' ? 'true' : undefined}
            data-density={ui.preferences.get().density}
            style={{
              left: place?.left ?? 0,
              top: place?.top ?? 0,
              maxHeight: place?.maxHeight ?? undefined,
              visibility: place ? 'visible' : 'hidden',
            }}
            onContextMenu={(e) => e.preventDefault()}
            {...menu.getMenuProps(level)}
          >
            {level === 0 && state.confirm ? (
              <div className="mc-ui-confirm" role="alertdialog" aria-label={state.confirm.message}>
                <span>{state.confirm.message}</span>
                <div className="mc-ui-confirm-actions">
                  <button type="button" className="mc-ui-btn" onClick={() => menu.confirm(false)}>
                    {ui.i18n.t('common.cancel')}
                  </button>
                  <button
                    type="button"
                    className="mc-ui-btn mc-ui-primary"
                    data-confirm="yes"
                    onClick={() => menu.confirm(true)}
                  >
                    {ui.i18n.t('common.ok')}
                  </button>
                </div>
              </div>
            ) : (
              <>
                {level === 0 && menu.searchProps ? (
                  <input
                    ref={search}
                    type="search"
                    role="searchbox"
                    className="mc-ui-menu-search"
                    dir={direction}
                    {...menu.searchProps}
                  />
                ) : null}
                {level === 0 && state.results && !state.results.length ? (
                  <div className="mc-ui-menu-empty" role="status">
                    {ui.i18n.t('common.noResults')}
                  </div>
                ) : null}
                {entries.map((entry, index) => {
                  if (entry.type === 'separator')
                    return <div key={entry.key} className="mc-ui-menu-sep" role="separator" />;
                  const props = menu.getItemProps(level, index);
                  const content = (
                    <>
                      <span className="mc-ui-menu-check" aria-hidden="true">
                        {entry.checked ? (
                          <Icon name="check" size={16} />
                        ) : entry.icon ? (
                          <Icon name={entry.icon} direction={direction} size={16} />
                        ) : null}
                      </span>
                      <span className="mc-ui-menu-label">
                        {entry.label}
                        {state.results && entry.path ? (
                          <span className="mc-ui-menu-path">{entry.path}</span>
                        ) : null}
                      </span>
                      {entry.shortcut ? (
                        <span className="mc-ui-menu-shortcut">{entry.shortcut}</span>
                      ) : null}
                      {entry.children ? (
                        <Icon name="chevron" direction={direction} size={14} />
                      ) : null}
                    </>
                  );
                  return (
                    <div
                      key={entry.key}
                      ref={(el) => {
                        if (el) items.current.set(props.id, el);
                        else items.current.delete(props.id);
                      }}
                      className="mc-ui-menu-item"
                      data-info={entry.info ? 'true' : undefined}
                      data-danger={
                        entry.actionId.endsWith('.delete') || entry.actionId.endsWith('.remove')
                          ? 'true'
                          : undefined
                      }
                      {...props}
                    >
                      {renderItem ? renderItem(entry, content) : content}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        );
      })}
    </>,
    doc.body,
  );
}
