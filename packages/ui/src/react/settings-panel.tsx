import { useId, useRef, useState } from 'react';
import type { ChartUi } from '../chart-ui.js';
import type { ToolbarItem, ToolbarLocation } from '../layout.js';
import { LEGEND_FIELDS, MARKER_FIELDS } from '../preferences.js';
import type { ContextTargetKind, HeaderSection } from '../types.js';
import type { SettingsField } from '../extensions.js';
import { downloadFile, formatShortcut } from '../util.js';
import { Icon } from './icon.js';
import { usePreferences, useUiVersion } from './hooks.js';

export type SettingsCategory =
  | 'general'
  | 'appearance'
  | 'legend'
  | 'header'
  | 'sidebar'
  | 'contextMenu'
  | 'language'
  | 'shortcuts';

export const SETTINGS_CATEGORIES: readonly SettingsCategory[] = [
  'general',
  'appearance',
  'legend',
  'header',
  'sidebar',
  'contextMenu',
  'language',
  'shortcuts',
];

const TARGET_ORDER: readonly ContextTargetKind[] = [
  'chart',
  'candlestick',
  'series',
  'indicator',
  'drawing',
  'priceAxis',
  'timeAxis',
  'pane',
  'order',
  'position',
  'alert',
  'marker',
];
const TARGET_LABELS: Record<ContextTargetKind, string> = {
  chart: 'menu.label',
  pane: 'menu.pane',
  candlestick: 'chartType.candlestick',
  series: 'chartType.line',
  indicator: 'header.indicators',
  drawing: 'header.drawingTools',
  drawingHandle: 'header.drawingTools',
  priceAxis: 'axis.scaleMode',
  timeAxis: 'menu.timeframe',
  order: 'target.order',
  position: 'target.position',
  alert: 'target.alert',
  marker: 'target.marker',
};

/** Records a key combination as `Mod+Shift+K` style text. */
function comboOf(event: React.KeyboardEvent): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return null;
  const parts: string[] = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.metaKey) parts.push('Meta');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  parts.push(event.key.length === 1 ? event.key.toUpperCase() : event.key);
  return parts.join('+');
}

export interface SettingsPanelProps {
  readonly ui: ChartUi;
  /** A built-in category or the id of a registered section (`ui.settings.register`). */
  readonly category: SettingsCategory | (string & {});
  readonly onCategory: (category: SettingsCategory | (string & {})) => void;
}

/** Registered sections with fields, merged by id (several packages may add to one category). */
function extensionCategories(ui: ChartUi) {
  const byId = new Map<string, { id: string; label: string; fields: SettingsField[] }>();
  for (const section of ui.settings.sections()) {
    let fields: readonly SettingsField[] = [];
    try {
      fields = section.fields();
    } catch {
      fields = [];
    }
    const entry = byId.get(section.id);
    if (entry) entry.fields.push(...fields);
    else
      byId.set(section.id, {
        id: section.id,
        label: ui.translate(section.label),
        fields: [...fields],
      });
  }
  return [...byId.values()].filter(
    (c) => c.fields.length && !(SETTINGS_CATEGORIES as readonly string[]).includes(c.id),
  );
}

/** The fields of a registered settings section. */
function ExtensionFields({ ui, fields }: { ui: ChartUi; fields: readonly SettingsField[] }) {
  return (
    <>
      {fields.map((field) => {
        if (field.kind === 'heading')
          return (
            <h3 key={field.id} className="mc-ui-h">
              {ui.translate(field.label)}
            </h3>
          );
        const disabled = field.disabled?.() ?? false;
        if (field.kind === 'toggle')
          return (
            <Toggle
              key={field.id}
              label={ui.translate(field.label)}
              checked={field.value()}
              disabled={disabled}
              onChange={(value) => field.set(value)}
            />
          );
        return (
          <Choice
            key={field.id}
            label={ui.translate(field.label)}
            value={field.value()}
            options={field
              .options()
              .map((o) => [o.value, ui.translate(o.label, o.labelValues)] as const)}
            onChange={(value) => field.set(value)}
          />
        );
      })}
    </>
  );
}

/** The settings content (loaded lazily by `<ChartSettings>`). */
export default function SettingsPanel({ ui, category, onCategory }: SettingsPanelProps) {
  useUiVersion(ui);
  const prefs = usePreferences(ui)!;
  const t = ui.i18n.t.bind(ui.i18n);
  const tabsId = useId();
  const tabs = useRef<HTMLDivElement | null>(null);
  const extra = extensionCategories(ui);
  const categories: readonly string[] = [...SETTINGS_CATEGORIES, ...extra.map((c) => c.id)];
  const extraCategory = extra.find((c) => c.id === category);
  const labels: Record<string, string> = {
    general: t('settings.general'),
    appearance: t('settings.appearance'),
    legend: t('settings.legend'),
    header: t('settings.header'),
    sidebar: t('settings.sidebar'),
    contextMenu: t('settings.contextMenu'),
    language: t('settings.language'),
    shortcuts: t('settings.shortcuts'),
    ...Object.fromEntries(extra.map((c) => [c.id, c.label])),
  };
  const vertical =
    ui.direction === 'rtl'
      ? { next: 'ArrowDown', prev: 'ArrowUp' }
      : { next: 'ArrowDown', prev: 'ArrowUp' };
  return (
    <div className="mc-ui-dialog-body">
      <div
        ref={tabs}
        className="mc-ui-tabs"
        role="tablist"
        aria-orientation="vertical"
        onKeyDown={(e) => {
          const index = categories.indexOf(category);
          let next = -1;
          if (e.key === vertical.next) next = (index + 1) % categories.length;
          if (e.key === vertical.prev) next = (index - 1 + categories.length) % categories.length;
          if (next < 0) return;
          e.preventDefault();
          onCategory(categories[next]!);
          tabs.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
        }}
      >
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            id={`${tabsId}-tab-${c}`}
            aria-controls={`${tabsId}-panel`}
            aria-selected={c === category}
            tabIndex={c === category ? 0 : -1}
            className="mc-ui-btn mc-ui-tab"
            onClick={() => onCategory(c)}
          >
            {labels[c]}
          </button>
        ))}
      </div>
      <div
        className="mc-ui-panel"
        role="tabpanel"
        id={`${tabsId}-panel`}
        aria-labelledby={`${tabsId}-tab-${category}`}
      >
        {category === 'general' ? (
          <>
            <Toggle
              label={t('settings.showHeader')}
              checked={prefs.header.visible}
              onChange={(visible) => ui.preferences.update({ header: { visible } })}
            />
            <Choice
              label={t('settings.density')}
              value={prefs.density}
              options={[
                ['comfortable', t('density.comfortable')],
                ['compact', t('density.compact')],
              ]}
              onChange={(density) =>
                ui.preferences.update({ density: density as 'compact' | 'comfortable' })
              }
            />
            <Choice
              label={t('settings.sidebarMode')}
              value={prefs.sidebar.mode}
              options={(['expanded', 'collapsed', 'floating', 'hidden'] as const).map((m) => [
                m,
                t(`sidebarMode.${m}`),
              ])}
              onChange={(mode) => ui.preferences.update({ sidebar: { mode: mode as 'expanded' } })}
            />
          </>
        ) : null}
        {category === 'appearance' ? (
          <>
            <Choice
              label={t('settings.theme')}
              value={prefs.theme ?? (ui.chart.theme().name === 'dark' ? 'dark' : 'light')}
              options={[
                ['dark', t('theme.dark')],
                ['light', t('theme.light')],
              ]}
              onChange={(theme) => ui.preferences.update({ theme })}
            />
            <Choice
              label={t('settings.crosshair')}
              value={ui.chart.options().crosshair.mode}
              options={(['normal', 'magnet', 'hidden'] as const).map((m) => [
                m,
                t(`crosshair.${m}`),
              ])}
              onChange={(mode) => ui.chart.applyOptions({ crosshair: { mode: mode as 'normal' } })}
            />
            <Choice
              label={t('settings.density')}
              value={prefs.density}
              options={[
                ['comfortable', t('density.comfortable')],
                ['compact', t('density.compact')],
              ]}
              onChange={(density) => ui.preferences.update({ density: density as 'compact' })}
            />
          </>
        ) : null}
        {category === 'legend' ? (
          <>
            <h3 className="mc-ui-h">{t('settings.legendSection')}</h3>
            <Toggle
              label={t('legend.show')}
              checked={prefs.legend.visible}
              onChange={(visible) => ui.preferences.update({ legend: { visible } })}
            />
            {LEGEND_FIELDS.map((field) => (
              <Toggle
                key={field}
                label={t(`legend.field.${field}`)}
                checked={prefs.legend.fields[field]}
                disabled={!prefs.legend.visible}
                onChange={(on) => ui.preferences.update({ legend: { fields: { [field]: on } } })}
              />
            ))}
            <h3 className="mc-ui-h">{t('settings.markersSection')}</h3>
            {MARKER_FIELDS.map((field) => (
              <Toggle
                key={field}
                label={t(`markers.field.${field}`)}
                checked={prefs.markers[field]}
                onChange={(on) => ui.preferences.update({ markers: { [field]: on } })}
              />
            ))}
          </>
        ) : null}
        {category === 'header' ? <ToolbarList ui={ui} location="header" /> : null}
        {category === 'sidebar' ? (
          <>
            <Choice
              label={t('settings.sidebarPosition')}
              value={prefs.sidebar.position}
              options={[
                ['start', t('position.start')],
                ['end', t('position.end')],
              ]}
              onChange={(position) =>
                ui.preferences.update({ sidebar: { position: position as 'start' | 'end' } })
              }
            />
            <Choice
              label={t('settings.sidebarMode')}
              value={prefs.sidebar.mode}
              options={(['expanded', 'collapsed', 'floating', 'hidden'] as const).map((m) => [
                m,
                t(`sidebarMode.${m}`),
              ])}
              onChange={(mode) => ui.preferences.update({ sidebar: { mode: mode as 'expanded' } })}
            />
            <ToolbarList ui={ui} location="sidebar" />
          </>
        ) : null}
        {category === 'contextMenu' ? <ContextMenuList ui={ui} /> : null}
        {category === 'language' ? (
          <>
            <Choice
              label={t('language.label')}
              value={prefs.locale ?? ''}
              options={[
                ['', t('language.auto')] as const,
                ...ui.i18n.locales().map((l) => [l.code, `${l.name} (${l.englishName})`] as const),
              ]}
              onChange={(locale) => {
                if (!locale) {
                  ui.i18n.setLocale('auto');
                  ui.preferences.update({ locale: ui.i18n.locale });
                } else ui.preferences.update({ locale });
              }}
            />
            <Choice
              label={t('direction.label')}
              value={prefs.direction}
              options={[
                ['auto', t('direction.auto')],
                ['ltr', t('direction.ltr')],
                ['rtl', t('direction.rtl')],
              ]}
              onChange={(direction) => ui.preferences.update({ direction: direction as 'auto' })}
            />
            <Toggle
              label={t('numbers.localDigits')}
              checked={prefs.localDigits}
              onChange={(localDigits) => ui.preferences.update({ localDigits })}
            />
          </>
        ) : null}
        {category === 'shortcuts' ? <ShortcutList ui={ui} /> : null}
        {extraCategory ? <ExtensionFields ui={ui} fields={extraCategory.fields} /> : null}
      </div>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="mc-ui-row">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}

function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="mc-ui-row">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        className="mc-ui-field"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Header or sidebar actions: visibility, order (buttons and drag and drop), section and location. */
function ToolbarList({ ui, location }: { ui: ChartUi; location: ToolbarLocation }) {
  const t = ui.i18n.t.bind(ui.i18n);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const items = ui.placements().filter((i) => i.location === location);
  const sections: readonly (HeaderSection | null)[] =
    location === 'header' ? ['left', 'center', 'right'] : [null];
  const row = (item: ToolbarItem, list: readonly ToolbarItem[], index: number) => {
    const label = ui.label(item.action) || item.action.id;
    return (
      <li
        key={item.action.id}
        className="mc-ui-list-item"
        draggable
        data-dragging={dragging === item.action.id ? 'true' : undefined}
        data-drop={over === item.action.id && dragging !== item.action.id ? 'true' : undefined}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', item.action.id);
          setDragging(item.action.id);
        }}
        onDragEnd={() => {
          setDragging(null);
          setOver(null);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(item.action.id);
        }}
        onDrop={(e) => {
          e.preventDefault();
          const id = e.dataTransfer.getData('text/plain');
          setDragging(null);
          setOver(null);
          if (id && id !== item.action.id)
            ui.moveAction(id, { location, section: item.section, index });
        }}
      >
        <input
          type="checkbox"
          aria-label={`${t('settings.visible')}: ${label}`}
          checked={item.visible}
          onChange={(e) => ui.setActionVisible(item.action.id, e.target.checked)}
        />
        <Icon name={item.action.icon} direction={ui.direction} />
        <span className="mc-ui-menu-label">{label}</span>
        {location === 'header' ? (
          <select
            className="mc-ui-field"
            aria-label={`${t('settings.location')}: ${label}`}
            value={item.section}
            onChange={(e) =>
              ui.moveAction(item.action.id, {
                location: 'header',
                section: e.target.value as HeaderSection,
              })
            }
          >
            <option value="left">{t('settings.section.left')}</option>
            <option value="center">{t('settings.section.center')}</option>
            <option value="right">{t('settings.section.right')}</option>
          </select>
        ) : null}
        {item.movable.length > 1 ? (
          <select
            className="mc-ui-field"
            aria-label={`${t('settings.location')}: ${label}`}
            value={item.location}
            onChange={(e) =>
              ui.moveAction(item.action.id, { location: e.target.value as ToolbarLocation })
            }
          >
            {item.movable.map((l) => (
              <option key={l} value={l}>
                {t(`settings.location.${l}`)}
              </option>
            ))}
          </select>
        ) : null}
        <button
          type="button"
          className="mc-ui-btn"
          aria-label={`${t('settings.moveUp')}: ${label}`}
          disabled={index === 0}
          onClick={() => ui.shiftAction(item.action.id, -1)}
        >
          ↑
        </button>
        <button
          type="button"
          className="mc-ui-btn"
          aria-label={`${t('settings.moveDown')}: ${label}`}
          disabled={index === list.length - 1}
          onClick={() => ui.shiftAction(item.action.id, 1)}
        >
          ↓
        </button>
      </li>
    );
  };
  return (
    <>
      <p className="mc-ui-hint">{t('settings.dragHint')}</p>
      {sections.map((section) => {
        const list = section ? items.filter((i) => i.section === section) : items;
        if (!list.length) return null;
        return (
          <section key={section ?? 'all'}>
            {section ? <h3 className="mc-ui-h">{t(`settings.section.${section}`)}</h3> : null}
            <ul className="mc-ui-list">{list.map((item, i) => row(item, list, i))}</ul>
          </section>
        );
      })}
    </>
  );
}

function ContextMenuList({ ui }: { ui: ChartUi }) {
  const t = ui.i18n.t.bind(ui.i18n);
  const prefs = ui.preferences.get();
  const seen = new Set<string>();
  return (
    <>
      <p className="mc-ui-hint">{t('settings.contextMenuHint')}</p>
      {TARGET_ORDER.map((kind) => {
        const actions = ui.contextMenu
          .getActions(kind)
          .filter(
            (a) => !seen.has(a.id) && !a.requires?.some((r) => ui.capabilities[r] === undefined),
          );
        actions.forEach((a) => seen.add(a.id));
        if (!actions.length) return null;
        return (
          <section key={kind}>
            <h3 className="mc-ui-h">{ui.translate(TARGET_LABELS[kind])}</h3>
            <ul className="mc-ui-list">
              {actions.map((action) => {
                const label =
                  typeof action.label === 'function'
                    ? action.description
                      ? ui.translate(action.description, { value: '…', price: '…' })
                      : action.id
                    : ui.translate(action.label, { value: '…', price: '…', count: 1, index: 1 });
                return (
                  <li key={action.id} className="mc-ui-list-item">
                    <input
                      type="checkbox"
                      id={`cm-${action.id}`}
                      checked={!prefs.contextMenu.hidden.includes(action.id)}
                      onChange={(e) => ui.contextMenu.setHidden(action.id, !e.target.checked)}
                    />
                    <Icon name={action.icon} direction={ui.direction} />
                    <label className="mc-ui-menu-label" htmlFor={`cm-${action.id}`}>
                      {label}
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </>
  );
}

function ShortcutList({ ui }: { ui: ChartUi }) {
  const t = ui.i18n.t.bind(ui.i18n);
  const [recording, setRecording] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const actions = ui.actions
    .list()
    .filter((a) => a.run && ui.isAvailable(a))
    .map((a) => ({ action: a, label: ui.label(a) || a.id }))
    .filter(
      ({ label }) => !filter || label.toLocaleLowerCase().includes(filter.toLocaleLowerCase()),
    )
    .sort((a, b) => Number(!ui.rawShortcut(a.action)) - Number(!ui.rawShortcut(b.action)));
  const shortcuts = ui.preferences.get().shortcuts;
  return (
    <>
      <input
        className="mc-ui-field"
        type="search"
        aria-label={t('common.search')}
        placeholder={t('common.searchActions')}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <ul className="mc-ui-list">
        {actions.map(({ action, label }) => {
          const raw = ui.rawShortcut(action);
          return (
            <li key={action.id} className="mc-ui-list-item">
              <span className="mc-ui-menu-label">{label}</span>
              <button
                type="button"
                className="mc-ui-btn mc-ui-kbd"
                aria-label={`${t('settings.shortcut')}: ${label}`}
                aria-pressed={recording === action.id}
                onClick={() => setRecording(recording === action.id ? null : action.id)}
                onKeyDown={(e) => {
                  if (recording !== action.id) return;
                  e.preventDefault();
                  e.stopPropagation();
                  if (e.key === 'Escape') {
                    setRecording(null);
                    return;
                  }
                  const combo = comboOf(e);
                  if (!combo) return;
                  ui.preferences.update({ shortcuts: { ...shortcuts, [action.id]: combo } });
                  setRecording(null);
                }}
              >
                {recording === action.id
                  ? '…'
                  : raw
                    ? formatShortcut(raw)
                    : t('settings.noShortcut')}
              </button>
              {action.id in shortcuts ? (
                <button
                  type="button"
                  className="mc-ui-btn"
                  aria-label={`${t('common.reset')}: ${label}`}
                  onClick={() => {
                    const { [action.id]: _removed, ...next } = shortcuts;
                    ui.preferences.update({ shortcuts: next });
                  }}
                >
                  <Icon name="reset" />
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** Footer actions: restore defaults, export and import preferences, save status. */
export function SettingsFooter({ ui }: { ui: ChartUi }) {
  const t = ui.i18n.t.bind(ui.i18n);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const file = useRef<HTMLInputElement | null>(null);
  usePreferences(ui);
  const status = ui.preferences.status;
  return (
    <>
      {confirming ? (
        <>
          <span role="alert">{t('settings.restoreConfirm')}</span>
          <button type="button" className="mc-ui-btn" onClick={() => setConfirming(false)}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="mc-ui-btn mc-ui-primary"
            onClick={() => {
              ui.preferences.reset();
              setConfirming(false);
            }}
          >
            {t('settings.restoreDefaults')}
          </button>
        </>
      ) : (
        <button type="button" className="mc-ui-btn" onClick={() => setConfirming(true)}>
          <Icon name="reset" />
          {t('settings.restoreDefaults')}
        </button>
      )}
      <button
        type="button"
        className="mc-ui-btn"
        onClick={() =>
          downloadFile(
            'chart-preferences.json',
            new Blob([ui.preferences.exportJson()], { type: 'application/json' }),
            ui.capabilities,
          )
        }
      >
        <Icon name="download" />
        {t('settings.export')}
      </button>
      <button type="button" className="mc-ui-btn" onClick={() => file.current?.click()}>
        <Icon name="folder" />
        {t('settings.import')}
      </button>
      <input
        ref={file}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={async (e) => {
          const chosen = e.target.files?.[0];
          e.target.value = '';
          if (!chosen) return;
          try {
            ui.preferences.importJson(await chosen.text());
            setMessage(t('settings.imported'));
          } catch (error) {
            setMessage(
              t('settings.importError', {
                reason: error instanceof Error ? error.message : String(error),
              }),
            );
          }
        }}
      />
      <span className="mc-ui-grow" role="status" aria-live="polite">
        {message ??
          (status === 'saving'
            ? t('settings.saving')
            : status === 'saved'
              ? t('settings.saved')
              : status === 'error'
                ? t('settings.notSaved')
                : '')}
      </span>
    </>
  );
}
