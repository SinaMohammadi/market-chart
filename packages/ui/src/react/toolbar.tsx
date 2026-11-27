import { Suspense, lazy, useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { ComponentType, KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';
import { flushSync } from 'react-dom';
import type { ChartUi } from '../chart-ui.js';
import type { ToolbarGroup, ToolbarItem } from '../layout.js';
import type { ActionContext, UiAction } from '../types.js';
import { Icon, Tooltip } from './icon.js';
import { usePreferences, useThemeName, useUiVersion } from './hooks.js';
import { useUiStyles } from './styles.js';

/** Props of a custom toolbar component (`action.component`). */
export interface ToolbarComponentProps {
  readonly ui: ChartUi;
  readonly action: UiAction;
  readonly context: ActionContext;
  readonly location: 'header' | 'sidebar';
}

/** Arrow-key navigation between toolbar items (one tab stop per toolbar), mirrored in RTL. */
export function useRovingFocus(
  container: RefObject<HTMLElement | null>,
  orientation: 'horizontal' | 'vertical',
  direction: 'ltr' | 'rtl',
) {
  return useCallback(
    (event: ReactKeyboardEvent) => {
      const root = container.current;
      if (!root || (event.target as HTMLElement).tagName === 'SELECT') return;
      const items = [...root.querySelectorAll<HTMLElement>('[data-toolbar-item]:not([disabled])')];
      const index = items.indexOf(document.activeElement as HTMLElement);
      if (index < 0) return;
      const next =
        orientation === 'horizontal'
          ? direction === 'rtl'
            ? 'ArrowLeft'
            : 'ArrowRight'
          : 'ArrowDown';
      const prev =
        orientation === 'horizontal'
          ? direction === 'rtl'
            ? 'ArrowRight'
            : 'ArrowLeft'
          : 'ArrowUp';
      let target = -1;
      if (event.key === next) target = (index + 1) % items.length;
      else if (event.key === prev) target = (index - 1 + items.length) % items.length;
      else if (event.key === 'Home') target = 0;
      else if (event.key === 'End') target = items.length - 1;
      if (target < 0) return;
      event.preventDefault();
      items.forEach((el, i) => el.setAttribute('tabindex', i === target ? '0' : '-1'));
      items[target]!.focus();
    },
    [container, orientation, direction],
  );
}

function anchorOf(element: HTMLElement, direction: 'ltr' | 'rtl', below: boolean) {
  const r = element.getBoundingClientRect();
  if (below) return { x: direction === 'rtl' ? r.right : r.left, y: r.bottom + 2 };
  return { x: direction === 'rtl' ? r.left - 2 : r.right + 2, y: r.top };
}

/** Runs an action from a toolbar; actions that need confirmation ask in the shared menu next to the button. */
function runAction(
  ui: ChartUi,
  action: UiAction,
  location: 'header' | 'sidebar',
  element: HTMLElement,
) {
  if (action.confirm) {
    const entries = ui.toolbarEntries([action], location);
    const at = anchorOf(element, ui.direction, location === 'header');
    ui.openEntries(entries, at.x, at.y, 'api');
    ui.menu.activate(0, 0);
    return;
  }
  void ui.execute(action.id, location);
}

export interface ToolbarItemViewProps {
  readonly ui: ChartUi;
  readonly item: ToolbarItem;
  readonly location: 'header' | 'sidebar';
  readonly showLabel: boolean;
  readonly tabIndex: 0 | -1;
}

/** React views of built-in feature actions, loaded when such an action is shown. */
const BUILT_IN_COMPONENTS: Readonly<Record<string, ComponentType<ToolbarComponentProps>>> = {
  'symbols.picker': lazy(() =>
    import('./symbol-search.js').then((m) => ({ default: m.SymbolPickerToolbarItem })),
  ),
};

export function ToolbarItemView({ ui, item, location, showLabel, tabIndex }: ToolbarItemViewProps) {
  const { action } = item;
  const context = ui.context(null, location);
  const label = ui.label(action, context);
  const shortcut = ui.shortcut(action);
  const enabled = ui.isEnabled(action, context);
  const direction = ui.direction;
  const theme = useThemeName(ui);
  const Custom = action.component as ComponentType<ToolbarComponentProps> | undefined;
  if (Custom) return <Custom ui={ui} action={action} context={context} location={location} />;
  const BuiltIn = location === 'header' ? BUILT_IN_COMPONENTS[action.id] : undefined;
  if (BuiltIn)
    return (
      <Suspense fallback={null}>
        <BuiltIn ui={ui} action={action} context={context} location={location} />
      </Suspense>
    );

  if (action.kind === 'select' && location === 'header') {
    const value = action.value!(context);
    return (
      <Tooltip label={label} shortcut={shortcut} theme={theme} direction={direction}>
        <select
          className="mc-ui-select"
          aria-label={label}
          value={value}
          disabled={!enabled}
          data-toolbar-item=""
          tabIndex={tabIndex}
          onChange={(e) => {
            action.select!(context, e.target.value);
          }}
        >
          {action.options!(context).map((choice) => (
            <option key={choice.value} value={choice.value}>
              {ui.translate(choice.label, choice.labelValues)}
            </option>
          ))}
        </select>
      </Tooltip>
    );
  }

  const isMenu = action.kind === 'menu' || action.kind === 'select';
  const active = ui.isActive(action, context);
  const button = (
    <button
      type="button"
      className="mc-ui-btn"
      data-toolbar-item=""
      data-action={action.id}
      tabIndex={tabIndex}
      disabled={!enabled}
      aria-label={showLabel ? undefined : label}
      aria-pressed={action.kind === 'toggle' || action.isActive ? active : undefined}
      aria-haspopup={isMenu ? 'menu' : undefined}
      aria-keyshortcuts={shortcut}
      onClick={(e) => {
        const el = e.currentTarget;
        if (isMenu) {
          const at = anchorOf(el, direction, location === 'header');
          ui.openEntries(
            ui.actionMenuEntries(action.id, location),
            at.x,
            at.y,
            e.detail === 0 ? 'keyboard' : 'mouse',
          );
        } else runAction(ui, action, location, el);
      }}
    >
      <Icon name={action.icon} direction={direction} />
      {/* Icon-only buttons are named by aria-label (and the tooltip). */}
      {showLabel || !action.icon ? <span className="mc-ui-btn-label">{label}</span> : null}
    </button>
  );
  return showLabel ? (
    button
  ) : (
    <Tooltip
      label={label}
      shortcut={shortcut}
      theme={theme}
      direction={direction}
      placement={location === 'sidebar' ? 'beside' : 'below'}
    >
      {button}
    </Tooltip>
  );
}

export interface ChartHeaderProps {
  readonly ui: ChartUi | null;
  readonly className?: string;
}

/**
 * Configurable header: start / center / end sections (mirrored in RTL), groups with separators, selects,
 * dropdowns, toggles, tooltips, keyboard navigation and a responsive "More" menu for what does not fit.
 */
export function ChartHeader({ ui, className }: ChartHeaderProps) {
  useUiStyles();
  useUiVersion(ui);
  const preferences = usePreferences(ui);
  const root = useRef<HTMLDivElement | null>(null);
  const widths = useRef(new Map<string, number>());
  const [overflow, setOverflow] = useState<readonly string[]>([]);
  const [width, setWidth] = useState(0);
  /** Items hidden beyond the estimate when the rendered header still overflows (padding, gaps, fonts). */
  const [extra, setExtra] = useState(0);
  const direction = ui?.direction ?? 'ltr';
  const onKeyDown = useRovingFocus(root, 'horizontal', direction);

  const rendered = ui !== null && preferences?.header.visible !== false;
  useLayoutEffect(() => {
    // The header renders nothing until the UI exists: observe once it does.
    const el = root.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    // ResizeObserver runs after layout and before paint. A plain state update would render in a later task,
    // so the browser would paint one frame at the new width with the old items (an item visibly jumping into
    // "More"). flushSync renders, measures and moves items before that paint.
    const observer = new ResizeObserver(() => {
      const next = el.clientWidth;
      flushSync(() => setWidth(next));
    });
    observer.observe(el);
    setWidth(el.clientWidth);
    return () => observer.disconnect();
  }, [rendered]);

  const layout = ui?.header();
  const flexible = layout ? [...layout.left, ...layout.center].flatMap((g) => g.items) : [];
  const fixed = layout ? layout.right.flatMap((g) => g.items) : [];
  const key = flexible.map((i) => i.action.id).join(',');

  // Measure items, then move the ones that do not fit (from the end of the start section) into "More".
  useLayoutEffect(() => {
    const el = root.current;
    if (!el || !ui || !width) return;
    for (const node of el.querySelectorAll<HTMLElement>('[data-measure]')) {
      const child = node.firstElementChild as HTMLElement | null;
      if (child) widths.current.set(node.dataset['measure']!, child.offsetWidth + 2);
    }
    // Hide from the end of the start section first, then from the start of the end section.
    const candidates = [...flexible].reverse().concat(fixed);
    const widthOf = (id: string) => widths.current.get(id) ?? 36;
    let total =
      16 +
      (layout!.left.length + layout!.center.length + layout!.right.length) * 9 +
      candidates.reduce((sum, i) => sum + widthOf(i.action.id), 0);
    let count = 0;
    if (total > width) {
      total += 40; // the "More" button
      while (count < candidates.length && total > width)
        total -= widthOf(candidates[count++]!.action.id);
    }
    const hidden = candidates
      .slice(0, Math.min(candidates.length, count + extra))
      .map((i) => i.action.id);
    setOverflow((prev) => (prev.join(',') === hidden.join(',') ? prev : hidden));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui, width, key, ui?.version, extra]);

  // A new width or new items: start again from the estimate.
  useLayoutEffect(() => setExtra(0), [width, key]);

  // Correction pass: if the rendered header still overflows, hide one more item (converges in a few frames).
  useLayoutEffect(() => {
    const el = root.current;
    if (!el || !width) return;
    if (el.scrollWidth > el.clientWidth + 1 && overflow.length < flexible.length + fixed.length)
      setExtra((n) => n + 1);
  }, [width, overflow.length, flexible.length, fixed.length, key]);

  if (!ui || !layout || preferences?.header.visible === false) return null;
  const hidden = new Set(overflow);
  let first = true;
  const renderGroups = (groups: readonly ToolbarGroup[]) =>
    groups.map((group, gi) => {
      const items = group.items.filter((i) => !hidden.has(i.action.id));
      if (!items.length) return null;
      return [
        gi > 0 ? (
          <span
            key={`sep-${group.id}`}
            className="mc-ui-sep"
            role="separator"
            aria-orientation="vertical"
          />
        ) : null,
        ...items.map((item) => {
          const tabIndex = first ? 0 : -1;
          first = false;
          return (
            <span
              key={item.action.id}
              data-measure={item.action.id}
              style={{ display: 'contents' }}
            >
              <ToolbarItemView
                ui={ui}
                item={item}
                location="header"
                showLabel={!item.action.icon || item.action.kind === 'select'}
                tabIndex={tabIndex}
              />
            </span>
          );
        }),
      ];
    });
  const overflowActions = [...flexible, ...fixed]
    .filter((i) => hidden.has(i.action.id))
    .map((i) => i.action);
  return (
    <div
      ref={root}
      className={`mc-ui-header${className ? ` ${className}` : ''}`}
      role="toolbar"
      aria-label={ui.i18n.t('header.label')}
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
    >
      <div className="mc-ui-section" data-section="left">
        {renderGroups(layout.left)}
      </div>
      {layout.center.length ? (
        <div className="mc-ui-section" data-section="center">
          {renderGroups(layout.center)}
        </div>
      ) : null}
      <div className="mc-ui-section" data-section="right">
        {overflowActions.length ? (
          <button
            type="button"
            className="mc-ui-btn"
            data-toolbar-item=""
            tabIndex={-1}
            aria-haspopup="menu"
            aria-label={ui.i18n.t('header.more')}
            title={ui.i18n.t('header.more')}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              ui.openEntries(
                ui.toolbarEntries(overflowActions, 'header'),
                direction === 'rtl' ? r.right : r.left,
                r.bottom + 2,
                e.detail === 0 ? 'keyboard' : 'mouse',
              );
            }}
          >
            <Icon name="more" />
          </button>
        ) : null}
        {renderGroups(layout.right)}
      </div>
    </div>
  );
}

export interface ChartSidebarProps {
  readonly ui: ChartUi | null;
  readonly className?: string;
}

/**
 * Configurable vertical toolbar: groups with separators, drawing-tool categories as flyouts (the button
 * shows the active or last used tool), expanded / collapsed / floating modes and a collapse toggle.
 */
export function ChartSidebar({ ui, className }: ChartSidebarProps) {
  useUiStyles();
  useUiVersion(ui);
  const preferences = usePreferences(ui);
  const root = useRef<HTMLDivElement | null>(null);
  const lastUsed = useRef(new Map<string, string>());
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const direction = ui?.direction ?? 'ltr';
  const onKeyDown = useRovingFocus(root, 'vertical', direction);
  if (!ui || !preferences || preferences.sidebar.mode === 'hidden') return null;
  const mode = preferences.sidebar.mode;
  const groups = ui.sidebar();
  const context = ui.context(null, 'sidebar');
  const showLabel = mode === 'expanded';
  let first = true;
  const tab = (): 0 | -1 => {
    const t = first ? 0 : -1;
    first = false;
    return t as 0 | -1;
  };
  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = { x: event.clientX - offset.x, y: event.clientY - offset.y };
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => setOffset({ x: e.clientX - start.x, y: e.clientY - start.y });
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };
  return (
    <div
      ref={root}
      className={`mc-ui-sidebar${className ? ` ${className}` : ''}`}
      data-mode={mode}
      role="toolbar"
      aria-label={ui.i18n.t('sidebar.label')}
      aria-orientation="vertical"
      onKeyDown={onKeyDown}
      style={
        mode === 'floating' ? { transform: `translate(${offset.x}px, ${offset.y}px)` } : undefined
      }
    >
      {mode === 'floating' ? (
        <div className="mc-ui-drag" onPointerDown={startDrag} aria-hidden="true" />
      ) : null}
      {groups.map((group, gi) => {
        const sep =
          gi > 0 ? <span key={`sep-${group.id}`} className="mc-ui-sep" role="separator" /> : null;
        if (group.id.startsWith('tools.') && group.items.length > 1) {
          const active = group.items.find((i) => ui.isActive(i.action, context));
          if (active) lastUsed.current.set(group.id, active.action.id);
          const shown =
            active ??
            group.items.find((i) => i.action.id === lastUsed.current.get(group.id)) ??
            group.items[0]!;
          const groupLabel = ui.translate(`toolCategory.${group.id.slice('tools.'.length)}`);
          return [
            sep,
            <div key={group.id} className="mc-ui-flyout" role="group" aria-label={groupLabel}>
              <ToolbarItemView
                ui={ui}
                item={shown}
                location="sidebar"
                showLabel={showLabel}
                tabIndex={tab()}
              />
              <button
                type="button"
                className="mc-ui-flyout-toggle"
                aria-haspopup="menu"
                aria-label={groupLabel}
                title={groupLabel}
                data-toolbar-item=""
                tabIndex={-1}
                onClick={(e) => {
                  const r = (
                    e.currentTarget.parentElement ?? e.currentTarget
                  ).getBoundingClientRect();
                  ui.openEntries(
                    ui.toolbarEntries(
                      group.items.map((i) => i.action),
                      'sidebar',
                    ),
                    direction === 'rtl' ? r.left - 2 : r.right + 2,
                    r.top,
                    e.detail === 0 ? 'keyboard' : 'mouse',
                  );
                }}
              />
            </div>,
          ];
        }
        return [
          sep,
          ...group.items.map((item) => (
            <ToolbarItemView
              key={item.action.id}
              ui={ui}
              item={item}
              location="sidebar"
              showLabel={showLabel}
              tabIndex={tab()}
            />
          )),
        ];
      })}
      <span className="mc-ui-sep" role="separator" />
      <button
        type="button"
        className="mc-ui-btn"
        data-toolbar-item=""
        tabIndex={-1}
        aria-label={ui.i18n.t(mode === 'expanded' ? 'sidebar.collapse' : 'sidebar.expand')}
        title={ui.i18n.t(mode === 'expanded' ? 'sidebar.collapse' : 'sidebar.expand')}
        onClick={() =>
          ui.preferences.update({
            sidebar: { mode: mode === 'expanded' ? 'collapsed' : 'expanded' },
          })
        }
      >
        <Icon name={mode === 'expanded' ? 'collapse' : 'expand'} direction={direction} />
        <span className="mc-ui-btn-label">
          {ui.i18n.t(mode === 'expanded' ? 'sidebar.collapse' : 'sidebar.expand')}
        </span>
      </button>
    </div>
  );
}
