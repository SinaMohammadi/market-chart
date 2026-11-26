import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { ChartUi } from '../chart-ui.js';
import { iconNames } from '../icons.js';
import { FAVORITE_SYMBOLS, RECENT_SYMBOLS } from '../symbols.js';
import type { SymbolItem } from '../types.js';
import type { SymbolSearchApi } from './feature-hooks.js';
import { SymbolSearchViewContext, useSymbolSearch } from './feature-hooks.js';
import { Dialog } from './dialog.js';
import { Icon } from './icon.js';
import { useThemeName } from './hooks.js';
import { useUiStyles } from './styles.js';

const OVERSCAN = 6;
const NO_RESULTS: readonly SymbolItem[] = [];

function ItemIcon({ icon }: { icon: string | undefined }) {
  if (!icon) return null;
  if (iconNames().includes(icon)) return <Icon name={icon} />;
  // Validated (http(s) or data:image) by normalizeSymbolItem; decorative.
  return (
    <img
      className="mc-ui-symbol-icon"
      src={icon}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  );
}

function DefaultItem({ item }: { item: SymbolItem }) {
  const meta = [item.exchange, item.type].filter(Boolean).join(' · ');
  return (
    <>
      <ItemIcon icon={item.icon} />
      <span className="mc-ui-symbol-main">
        <span className="mc-ui-symbol-code">{item.symbol}</span>
        {item.name || item.description ? (
          <span className="mc-ui-symbol-name">{item.name ?? item.description}</span>
        ) : null}
      </span>
      {item.badge ? <span className="mc-ui-badge">{item.badge}</span> : null}
      {meta ? <span className="mc-ui-symbol-meta">{meta}</span> : null}
    </>
  );
}

/** The virtualised result list (only the rows in view, plus a few, are in the DOM). */
export function SymbolResults({ ui, api }: { ui: ChartUi; api: SymbolSearchApi }) {
  const views = useContext(SymbolSearchViewContext);
  const row = views.rowHeight ?? 48;
  const list = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState({ top: 0, height: 360 });
  const state = api.state;
  const t = ui.i18n.t.bind(ui.i18n);
  const results = state?.results ?? NO_RESULTS;
  const active = state?.active ?? -1;

  useLayoutEffect(() => {
    const el = list.current;
    if (el) setView({ top: el.scrollTop, height: el.clientHeight || 360 });
  }, [results]);
  // Keep the highlighted row in view.
  useLayoutEffect(() => {
    const el = list.current;
    if (!el || active < 0) return;
    const top = active * row;
    const before = el.scrollTop;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + row > el.scrollTop + el.clientHeight) el.scrollTop = top + row - el.clientHeight;
    // Render the rows now: the scroll event that would update the window arrives a frame later, and the
    // highlighted row (aria-activedescendant) must exist immediately.
    if (el.scrollTop !== before) setView({ top: el.scrollTop, height: el.clientHeight || 360 });
  }, [active, row]);

  if (!state) return null;
  const retry = () => ui.symbols?.retry();
  let message: ReactNode = null;
  if (state.status === 'error') {
    message = views.renderError ? (
      views.renderError(state, retry)
    ) : (
      <div className="mc-ui-symbols-state" role="alert">
        <span>{state.error ?? t('symbols.error')}</span>
        <button type="button" className="mc-ui-btn" onClick={retry}>
          {t('symbols.retry')}
        </button>
      </div>
    );
  } else if (state.status === 'ready' && !results.length) {
    message = views.renderEmpty ? (
      views.renderEmpty(state)
    ) : (
      <div className="mc-ui-symbols-state">
        {state.group === FAVORITE_SYMBOLS && !state.query
          ? t('symbols.emptyFavorites')
          : state.group === RECENT_SYMBOLS && !state.query
            ? t('symbols.emptyRecent')
            : t('symbols.empty')}
      </div>
    );
  }
  const first = Math.max(0, Math.floor(view.top / row) - OVERSCAN);
  const last = Math.min(results.length, Math.ceil((view.top + view.height) / row) + OVERSCAN);
  const current = api.current;
  return (
    <>
      <div className="mc-ui-sr" role="status" aria-live="polite">
        {state.status === 'loading'
          ? t('symbols.loading')
          : state.status === 'ready'
            ? t('symbols.results', { count: results.length })
            : ''}
      </div>
      <div
        ref={list}
        className="mc-ui-symbols-list"
        {...api.listboxProps}
        aria-busy={state.status === 'loading' || undefined}
        onScroll={(e) =>
          setView({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight || 360 })
        }
      >
        {message ?? (
          <div style={{ height: results.length * row, position: 'relative' }}>
            {results.slice(first, last).map((item, i) => {
              const index = first + i;
              const favorite = api.isFavorite(item.symbol);
              const info = {
                active: index === active,
                favorite,
                current: item.symbol === current,
                query: state.query,
              };
              return (
                <div
                  key={`${item.symbol}:${index}`}
                  className="mc-ui-symbol"
                  data-current={info.current || undefined}
                  style={{ top: index * row, height: row }}
                  {...api.optionProps(index)}
                >
                  {views.renderItem ? views.renderItem(item, info) : <DefaultItem item={item} />}
                  {views.hideStar || ui.symbols?.options.favorites === false ? null : (
                    <button
                      type="button"
                      tabIndex={-1}
                      className="mc-ui-btn mc-ui-star"
                      aria-pressed={favorite}
                      aria-label={t(favorite ? 'symbols.removeFavorite' : 'symbols.addFavorite', {
                        symbol: item.symbol,
                      })}
                      onClick={(e) => {
                        e.stopPropagation();
                        api.toggleFavorite(item.symbol);
                      }}
                    >
                      <Icon name="star" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

/** Group tabs (All, Favorites, Recent and the source's groups); arrow keys move between them. */
function GroupTabs({ ui, api }: { ui: ChartUi; api: SymbolSearchApi }) {
  const state = api.state;
  if (!state || api.groups.length < 2) return null;
  const rtl = ui.direction === 'rtl';
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const index = api.groups.findIndex((g) => g.id === state.group);
    const next = rtl ? 'ArrowLeft' : 'ArrowRight';
    const prev = rtl ? 'ArrowRight' : 'ArrowLeft';
    let target = -1;
    if (e.key === next) target = (index + 1) % api.groups.length;
    else if (e.key === prev) target = (index - 1 + api.groups.length) % api.groups.length;
    if (target < 0) return;
    e.preventDefault();
    api.setGroup(api.groups[target]!.id);
    e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[target]?.focus();
  };
  return (
    <div
      className="mc-ui-symbols-groups"
      role="tablist"
      aria-label={ui.i18n.t('symbols.groups')}
      onKeyDown={onKeyDown}
    >
      {api.groups.map((g) => (
        <button
          key={g.id}
          type="button"
          role="tab"
          aria-selected={g.id === state.group}
          aria-controls={api.listboxId}
          tabIndex={g.id === state.group ? 0 : -1}
          className="mc-ui-btn mc-ui-tab"
          style={{ width: 'auto' }}
          onClick={() => api.setGroup(g.id)}
        >
          {g.label}
        </button>
      ))}
    </div>
  );
}

/** Search box, group tabs and results: the body of the dialog and of the dropdown. */
export function SymbolSearchPanel({
  ui,
  inputRef,
}: {
  ui: ChartUi;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const api = useSymbolSearch(ui);
  const t = ui.i18n.t.bind(ui.i18n);
  return (
    <div className="mc-ui-symbols">
      <div className="mc-ui-symbols-search">
        <Icon name="search" />
        <input
          ref={inputRef}
          className="mc-ui-field"
          type="search"
          aria-label={t('symbols.search')}
          placeholder={t('symbols.placeholder')}
          {...api.inputProps}
        />
      </div>
      <GroupTabs ui={ui} api={api} />
      <SymbolResults ui={ui} api={api} />
    </div>
  );
}

/**
 * The search dialog: shown while the search is open on the `modal` surface (or on the `dropdown` surface when
 * no dropdown is mounted, e.g. with the header hidden). Full screen on small screens.
 */
export function SymbolSearchDialog({ ui }: { ui: ChartUi }) {
  useUiStyles();
  const api = useSymbolSearch(ui);
  const theme = useThemeName(ui);
  const input = useRef<HTMLInputElement | null>(null);
  const state = api.state;
  const show =
    !!state?.open &&
    state.surface !== 'custom' &&
    (state.surface === 'modal' || !dropdowns.get(ui));
  return (
    <Dialog
      open={show}
      title={ui.i18n.t(state?.purpose === 'compare' ? 'symbols.compareTitle' : 'symbols.title')}
      onClose={() => api.close()}
      direction={ui.direction}
      lang={ui.i18n.locale}
      theme={theme}
      size="search"
      closeLabel={ui.i18n.t('common.close')}
      initialFocus={input}
    >
      <SymbolSearchPanel ui={ui} inputRef={input} />
    </Dialog>
  );
}

/** Mounted dropdowns per UI (the dialog stands in when there is none). */
const dropdowns = new WeakMap<ChartUi, number>();

/** Header dropdown: the current symbol as a button that opens the search in a popover below it. */
export function SymbolDropdown({ ui }: { ui: ChartUi }) {
  useUiStyles();
  const api = useSymbolSearch(ui);
  const theme = useThemeName(ui);
  const button = useRef<HTMLButtonElement | null>(null);
  const popover = useRef<HTMLDivElement | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const state = api.state;
  const open = !!state?.open && state.surface === 'dropdown';
  const rtl = ui.direction === 'rtl';

  useEffect(() => {
    dropdowns.set(ui, (dropdowns.get(ui) ?? 0) + 1);
    return () => {
      const n = (dropdowns.get(ui) ?? 1) - 1;
      if (n > 0) dropdowns.set(ui, n);
      else dropdowns.delete(ui);
    };
  }, [ui]);

  useLayoutEffect(() => {
    if (!open) {
      setAnchor(null);
      return;
    }
    const r = button.current?.getBoundingClientRect();
    if (r) setAnchor({ x: rtl ? r.right : r.left, y: r.bottom + 4 });
  }, [open, rtl]);
  // Focus moves into the popover once it is rendered.
  useLayoutEffect(() => {
    if (anchor) input.current?.focus();
  }, [anchor]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (popover.current?.contains(target) || button.current?.contains(target)) return;
      ui.symbols?.close();
    };
    const opener = button.current;
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      // The popover is gone: focus returns to the button unless the user moved it elsewhere.
      if (!document.activeElement || document.activeElement === document.body)
        opener?.focus({ preventScroll: true });
    };
  }, [open, ui]);

  const current = api.current;
  const name = ui.symbols?.currentItem()?.name;
  const t = ui.i18n.t.bind(ui.i18n);
  const doc = (globalThis as { document?: Document }).document;
  const width = 380;
  return (
    <>
      <button
        ref={button}
        type="button"
        className="mc-ui-btn mc-ui-symbol-btn"
        data-toolbar-item=""
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={current ? t('symbols.current', { symbol: current }) : t('header.symbol')}
        title={name}
        onClick={() => (open ? api.close() : api.open({ surface: 'dropdown' }))}
      >
        <Icon name="search" />
        <span>{current ?? t('header.symbol')}</span>
      </button>
      {open && anchor && doc
        ? createPortal(
            <div
              ref={popover}
              className="mc-ui mc-ui-popover"
              data-mc-theme={theme}
              dir={ui.direction}
              lang={ui.i18n.locale}
              role="dialog"
              aria-label={t('symbols.title')}
              style={{
                top: Math.min(anchor.y, (globalThis.innerHeight || 800) - 200),
                left: rtl
                  ? Math.max(8, anchor.x - width)
                  : Math.max(8, Math.min(anchor.x, (globalThis.innerWidth || 1200) - width - 8)),
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  api.close();
                }
              }}
            >
              <SymbolSearchPanel ui={ui} inputRef={input} />
            </div>,
            doc.body,
          )
        : null}
    </>
  );
}

/** Toolbar component for the `symbols.picker` action. */
export function SymbolPickerToolbarItem({ ui }: { ui: ChartUi }) {
  return <SymbolDropdown ui={ui} />;
}
