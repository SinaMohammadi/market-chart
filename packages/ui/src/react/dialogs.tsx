import { useEffect, useId, useState } from 'react';
import type { CrosshairMoveEvent, LineStyle } from '@market-chart/core';
import type { Drawing } from '@market-chart/drawing-tools';
import type { IndicatorHandle } from '@market-chart/indicators';
import type { ChartUi } from '../chart-ui.js';
import { formatPrice, formatTime, mainSeries } from '../builtins/helpers.js';
import { MARKER_FIELDS } from '../preferences.js';
import type { ObjectTreeItem } from '../extensions.js';
import { Dialog } from './dialog.js';
import { Icon } from './icon.js';
import { useThemeName, useUiVersion } from './hooks.js';

const LINE_STYLES: readonly LineStyle[] = ['solid', 'dashed', 'dotted'];
const LINE_STYLE_KEYS: Record<LineStyle, string> = {
  solid: 'style.lineSolid',
  dashed: 'style.lineDashed',
  dotted: 'style.lineDotted',
};

/** Colour inputs need #rrggbb; keeps alpha out (other formats show as black but are not overwritten). */
function hex(color: string | undefined): string {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : '#2962ff';
}

function Field({ label, children }: { label: string; children: (id: string) => React.ReactNode }) {
  const id = useId();
  return (
    <div className="mc-ui-row">
      <label htmlFor={id}>{label}</label>
      {children(id)}
    </div>
  );
}

/**
 * Indicator settings: inputs generated from the indicator's input schema (validated by the indicator
 * package), and per-output style (visibility, colour, width, line style).
 */
export function IndicatorDialog({
  ui,
  indicator,
  tab,
  onClose,
}: {
  ui: ChartUi;
  indicator: IndicatorHandle | null;
  tab: 'inputs' | 'style';
  onClose: () => void;
}) {
  const theme = useThemeName(ui);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);
  if (!indicator || indicator.removed) return null;
  const t = ui.i18n.t.bind(ui.i18n);
  const params = indicator.params();
  const style = indicator.style();
  const apply = (fn: () => void) => {
    try {
      fn();
      setError(null);
      setTick((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const name = ui.i18n.has(`indicatorName.${indicator.type}`)
    ? t(`indicatorName.${indicator.type}`)
    : indicator.definition.name;
  return (
    <Dialog
      open
      title={name}
      onClose={onClose}
      direction={ui.direction}
      lang={ui.i18n.locale}
      theme={theme}
      size="small"
      closeLabel={t('common.close')}
    >
      <div className="mc-ui-panel">
        {tab === 'inputs'
          ? Object.entries(indicator.definition.inputs).map(([key, spec]) => (
              <Field key={key} label={spec.label ?? key}>
                {(id) =>
                  spec.type === 'bool' ? (
                    <input
                      id={id}
                      type="checkbox"
                      checked={params[key] === true}
                      onChange={(e) =>
                        apply(() => indicator.setParams({ [key]: e.target.checked }))
                      }
                    />
                  ) : spec.type === 'enum' || spec.type === 'source' ? (
                    <select
                      id={id}
                      className="mc-ui-field"
                      value={String(params[key])}
                      onChange={(e) => apply(() => indicator.setParams({ [key]: e.target.value }))}
                    >
                      {(spec.type === 'enum'
                        ? spec.options
                        : ['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4', 'hlcc4']
                      ).map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : spec.type === 'time' ? (
                    <input
                      id={id}
                      className="mc-ui-field"
                      type="datetime-local"
                      value={
                        params[key]
                          ? new Date(params[key] as number).toISOString().slice(0, 16)
                          : ''
                      }
                      onChange={(e) =>
                        apply(() =>
                          indicator.setParams({
                            [key]: e.target.value ? Date.parse(`${e.target.value}Z`) : null,
                          }),
                        )
                      }
                    />
                  ) : (
                    <input
                      id={id}
                      className="mc-ui-field"
                      type="number"
                      inputMode="decimal"
                      min={spec.min}
                      max={spec.max}
                      step={spec.type === 'float' ? (spec.step ?? 'any') : 1}
                      defaultValue={String(params[key])}
                      onBlur={(e) =>
                        apply(() => indicator.setParams({ [key]: Number(e.target.value) }))
                      }
                      onKeyDown={(e) =>
                        e.key === 'Enter' &&
                        apply(() =>
                          indicator.setParams({
                            [key]: Number((e.target as HTMLInputElement).value),
                          }),
                        )
                      }
                    />
                  )
                }
              </Field>
            ))
          : indicator.definition.outputs.map((output) => {
              const o = style.outputs?.[output.id] ?? {};
              const set = (patch: Record<string, unknown>) =>
                apply(() =>
                  indicator.setStyle({
                    outputs: { ...style.outputs, [output.id]: { ...o, ...patch } },
                  }),
                );
              return (
                <fieldset
                  key={output.id}
                  className="mc-ui-row"
                  style={{ border: 0, padding: 0, margin: 0 }}
                >
                  <legend className="mc-ui-h">{output.name}</legend>
                  <input
                    type="checkbox"
                    aria-label={`${t('settings.visible')}: ${output.name}`}
                    checked={o.visible ?? !output.hidden}
                    onChange={(e) => set({ visible: e.target.checked })}
                  />
                  <input
                    type="color"
                    aria-label={output.name}
                    value={hex(o.color ?? output.color)}
                    onChange={(e) => set({ color: e.target.value })}
                  />
                  {output.kind !== 'histogram' ? (
                    <>
                      <select
                        className="mc-ui-field"
                        aria-label={`${output.name}: ${t('style.width')}`}
                        value={o.lineWidth ?? output.lineWidth ?? 1}
                        onChange={(e) => set({ lineWidth: Number(e.target.value) })}
                      >
                        {[1, 2, 3, 4].map((w) => (
                          <option key={w} value={w}>
                            {w}px
                          </option>
                        ))}
                      </select>
                      <select
                        className="mc-ui-field"
                        aria-label={`${output.name}: ${t('style.lineStyle')}`}
                        value={o.lineStyle ?? output.lineStyle ?? 'solid'}
                        onChange={(e) => set({ lineStyle: e.target.value })}
                      >
                        {LINE_STYLES.map((s) => (
                          <option key={s} value={s}>
                            {ui.i18n.t(LINE_STYLE_KEYS[s])}
                          </option>
                        ))}
                      </select>
                    </>
                  ) : null}
                </fieldset>
              );
            })}
        {error ? (
          <p className="mc-ui-hint" role="alert" style={{ color: 'var(--mc-ui-danger)' }}>
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

/** Drawing properties: line colour, width and style, fill, text colour, size and text, extend, labels. */
export function DrawingDialog({
  ui,
  drawing,
  textOnly,
  onClose,
}: {
  ui: ChartUi;
  drawing: Drawing | null;
  textOnly: boolean;
  onClose: () => void;
}) {
  const theme = useThemeName(ui);
  useUiVersion(ui);
  const manager = ui.capabilities.drawings;
  const current = drawing && manager ? manager.get(drawing.id) : undefined;
  const [text, setText] = useState(current?.text ?? '');
  useEffect(() => setText(current?.text ?? ''), [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!current || !manager) return null;
  const t = ui.i18n.t.bind(ui.i18n);
  const s = current.style;
  const update = (patch: Partial<Drawing['style']>) => manager.update(current.id, { style: patch });
  const tool = manager.tools().find((x) => x.type === current.type);
  const title = ui.i18n.has(`tool.${current.type}`)
    ? t(`tool.${current.type}`)
    : (tool?.name ?? current.type);
  return (
    <Dialog
      open
      title={title}
      onClose={onClose}
      direction={ui.direction}
      lang={ui.i18n.locale}
      theme={theme}
      size="small"
      closeLabel={t('common.close')}
    >
      <div className="mc-ui-panel">
        {tool?.editableText || textOnly ? (
          <Field label={t('style.text')}>
            {(id) => (
              <textarea
                id={id}
                className="mc-ui-field"
                style={{ height: 70, paddingBlock: 6 }}
                dir="auto"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onBlur={() => manager.setText(current.id, text)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    manager.setText(current.id, text);
                    onClose();
                  }
                }}
              />
            )}
          </Field>
        ) : null}
        {!textOnly ? (
          <>
            <Field label={t('style.line')}>
              {(id) => (
                <span className="mc-ui-row" style={{ flex: 'none' }}>
                  <input
                    id={id}
                    type="color"
                    value={hex(s.lineColor)}
                    onChange={(e) => update({ lineColor: e.target.value })}
                  />
                  <select
                    className="mc-ui-field"
                    aria-label={t('style.width')}
                    value={s.lineWidth}
                    onChange={(e) => update({ lineWidth: Number(e.target.value) })}
                  >
                    {[1, 2, 3, 4].map((w) => (
                      <option key={w} value={w}>
                        {w}px
                      </option>
                    ))}
                  </select>
                  <select
                    className="mc-ui-field"
                    aria-label={t('style.lineStyle')}
                    value={s.lineStyle}
                    onChange={(e) => update({ lineStyle: e.target.value as LineStyle })}
                  >
                    {LINE_STYLES.map((x) => (
                      <option key={x} value={x}>
                        {t(LINE_STYLE_KEYS[x])}
                      </option>
                    ))}
                  </select>
                </span>
              )}
            </Field>
            <Field label={t('style.fill')}>
              {(id) => (
                <span className="mc-ui-row" style={{ flex: 'none' }}>
                  <input
                    id={id}
                    type="checkbox"
                    aria-label={t('style.fill')}
                    checked={s.fillColor !== 'transparent'}
                    onChange={(e) =>
                      update({
                        fillColor: e.target.checked ? 'rgba(41, 98, 255, 0.15)' : 'transparent',
                      })
                    }
                  />
                  <input
                    type="color"
                    aria-label={`${t('style.fill')} ${t('style.color')}`}
                    disabled={s.fillColor === 'transparent'}
                    value={hex(s.fillColor)}
                    onChange={(e) => update({ fillColor: `${e.target.value}33` })}
                  />
                </span>
              )}
            </Field>
            <Field label={t('style.text')}>
              {(id) => (
                <span className="mc-ui-row" style={{ flex: 'none' }}>
                  <input
                    id={id}
                    type="color"
                    value={hex(s.textColor)}
                    onChange={(e) => update({ textColor: e.target.value })}
                  />
                  <input
                    className="mc-ui-field"
                    type="number"
                    min={8}
                    max={48}
                    aria-label={t('style.fontSize')}
                    style={{ width: 70 }}
                    value={s.fontSize}
                    onChange={(e) =>
                      update({ fontSize: Math.max(8, Math.min(48, Number(e.target.value) || 12)) })
                    }
                  />
                </span>
              )}
            </Field>
            <div className="mc-ui-row">
              <label>
                <input
                  type="checkbox"
                  checked={s.showLabels}
                  onChange={(e) => update({ showLabels: e.target.checked })}
                />{' '}
                {t('style.labels')}
              </label>
            </div>
          </>
        ) : null}
      </div>
    </Dialog>
  );
}

/**
 * Object tree: the chart's series, indicators and drawings, with show/hide, settings, lock and remove, and
 * the price labels shown on the chart (visible high/low, previous close, last price).
 */
export function ObjectTree({ ui }: { ui: ChartUi }) {
  useUiVersion(ui);
  // Series visibility and price-label switches are not toolbar state: re-render on chart changes too.
  const [, setTick] = useState(0);
  useEffect(() => {
    const bump = (): void => setTick((n) => n + 1);
    const offs = [ui.chart.on('dataChanged', bump), ui.preferences.on('change', bump)];
    return () => offs.forEach((off) => off());
  }, [ui]);
  const t = ui.i18n.t.bind(ui.i18n);
  const drawings = ui.capabilities.drawings;
  const indicators = ui.capabilities.indicators;
  const indicatorSettings = ui.capabilities.indicatorSettings;
  const drawingProperties = ui.capabilities.drawingProperties;
  const context = ui.context();
  const main = mainSeries(context);
  const label = (type: string, fallback: string, prefix: string) =>
    ui.i18n.has(`${prefix}.${type}`) ? t(`${prefix}.${type}`) : fallback;
  const plainSeries = ui.chart.series().filter((s) => !indicators?.indicatorForSeries(s));
  const indicatorList = indicators?.list() ?? [];
  const drawingList = drawings?.list() ?? [];
  const markers = ui.preferences.get().markers;
  const values = ui.markers.values();
  const empty = <li className="mc-ui-hint">{t('objectTree.empty')}</li>;
  return (
    <div className="mc-ui-side-panel" role="region" aria-label={t('sidebar.objectTree')}>
      <h3 className="mc-ui-h">{t('objectTree.series')}</h3>
      <ul className="mc-ui-list">
        {plainSeries.map((s) => {
          const title = s.options().title || label(s.type, s.type, 'chartType');
          const name = s === main ? `${title} · ${t('objectTree.main')}` : title;
          const visible = s.options().visible;
          const last = s.lastPoint() as Record<string, number> | undefined;
          const lastValue = last?.['close'] ?? last?.['value'];
          return (
            <li key={s.id} className="mc-ui-list-item" data-hidden={!visible || undefined}>
              <span className="mc-ui-menu-label" title={name}>
                {name}
              </span>
              {typeof lastValue === 'number' ? (
                <span className="mc-ui-tree-value">{formatPrice(context, lastValue, s)}</span>
              ) : null}
              <button
                type="button"
                className="mc-ui-btn"
                aria-pressed={!visible}
                aria-label={t(visible ? 'objectTree.hide' : 'objectTree.show', { name })}
                onClick={() => s.applyOptions({ visible: !visible })}
              >
                <Icon name={visible ? 'eye' : 'eye-off'} />
              </button>
            </li>
          );
        })}
        {plainSeries.length ? null : empty}
      </ul>
      <h3 className="mc-ui-h">{t('header.indicators')}</h3>
      <ul className="mc-ui-list">
        {indicatorList.map((i) => (
          <li key={i.id} className="mc-ui-list-item" data-hidden={!i.visible() || undefined}>
            <span className="mc-ui-menu-label" title={label(i.type, i.label(), 'indicatorName')}>
              {i.label()}
            </span>
            <button
              type="button"
              className="mc-ui-btn"
              aria-pressed={!i.visible()}
              aria-label={`${t(i.visible() ? 'indicator.hide' : 'indicator.show')}: ${i.label()}`}
              onClick={() => i.setVisible(!i.visible())}
            >
              <Icon name={i.visible() ? 'eye' : 'eye-off'} />
            </button>
            {indicatorSettings ? (
              <button
                type="button"
                className="mc-ui-btn"
                aria-label={t('objectTree.settings', { name: i.label() })}
                onClick={() => indicatorSettings(i, 'inputs')}
              >
                <Icon name="settings" />
              </button>
            ) : null}
            <button
              type="button"
              className="mc-ui-btn"
              aria-label={`${t('indicator.remove')}: ${i.label()}`}
              onClick={() => i.remove()}
            >
              <Icon name="trash" />
            </button>
          </li>
        ))}
        {indicatorList.length ? null : empty}
      </ul>
      <h3 className="mc-ui-h">{t('header.drawingTools')}</h3>
      <ul className="mc-ui-list">
        {drawingList.map((d) => {
          const name = label(d.type, d.type, 'tool');
          return (
            <li
              key={d.id}
              className="mc-ui-list-item"
              aria-selected={drawings!.selection().includes(d.id)}
            >
              <button
                type="button"
                className="mc-ui-btn mc-ui-menu-label"
                style={{ justifyContent: 'flex-start' }}
                onClick={() => drawings!.select([d.id])}
              >
                {name}
                {d.text ? ` — ${d.text.slice(0, 20)}` : ''}
              </button>
              <button
                type="button"
                className="mc-ui-btn"
                aria-pressed={!d.visible}
                aria-label={`${t(d.visible ? 'drawing.hide' : 'drawing.show')}: ${name}`}
                onClick={() => drawings!.setVisible(!d.visible, [d.id])}
              >
                <Icon name={d.visible ? 'eye' : 'eye-off'} />
              </button>
              <button
                type="button"
                className="mc-ui-btn"
                aria-pressed={d.locked}
                aria-label={`${t(d.locked ? 'drawing.unlock' : 'drawing.lock')}: ${name}`}
                onClick={() => drawings!.setLocked(!d.locked, [d.id])}
              >
                <Icon name={d.locked ? 'lock' : 'unlock'} />
              </button>
              {drawingProperties ? (
                <button
                  type="button"
                  className="mc-ui-btn"
                  aria-label={t('objectTree.settings', { name })}
                  onClick={() => drawingProperties(d)}
                >
                  <Icon name="settings" />
                </button>
              ) : null}
              <button
                type="button"
                className="mc-ui-btn"
                aria-label={`${t('drawing.delete')}: ${name}`}
                onClick={() => drawings!.remove([d.id])}
              >
                <Icon name="trash" />
              </button>
            </li>
          );
        })}
        {drawingList.length ? null : empty}
      </ul>
      <h3 className="mc-ui-h">{t('settings.markersSection')}</h3>
      <ul className="mc-ui-list">
        {MARKER_FIELDS.map((field) => {
          const value =
            field === 'highLow' && values.high && values.low
              ? `${formatPrice(context, values.high.price, main)} / ${formatPrice(context, values.low.price, main)}`
              : field === 'previousClose' && values.previousClose !== null
                ? formatPrice(context, values.previousClose, main)
                : null;
          return (
            <li key={field} className="mc-ui-list-item">
              <label className="mc-ui-menu-label" style={{ display: 'flex', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={markers[field]}
                  onChange={(e) =>
                    ui.preferences.update({ markers: { [field]: e.target.checked } })
                  }
                />
                {t(`markers.field.${field}`)}
              </label>
              {value ? <span className="mc-ui-tree-value">{value}</span> : null}
            </li>
          );
        })}
      </ul>
      <ExtensionTreeSections ui={ui} />
    </div>
  );
}

/**
 * Object-tree sections registered by packages (`ui.objectTree.register`), e.g. orders and positions. Rows are
 * focusable buttons: Enter selects, Delete runs the row's danger action (cancel/remove), and focusing a row
 * lets the package highlight the object on the chart. Re-renders at most once per frame on changes.
 */
export function ExtensionTreeSections({ ui }: { ui: ChartUi }) {
  const [, setTick] = useState(0);
  const sections = ui.objectTree.sections();
  // Registering or removing a section bumps the UI version.
  const version = ui.version;
  useEffect(() => {
    let frame: number | null = null;
    const bump = (): void => {
      if (frame !== null) return;
      const raf =
        globalThis.requestAnimationFrame ??
        ((fn: FrameRequestCallback) => setTimeout(() => fn(0), 16) as unknown as number);
      frame = raf(() => {
        frame = null;
        setTick((n) => n + 1);
      });
    };
    const offs = ui.objectTree
      .sections()
      .map((section) => section.subscribe?.(bump) ?? (() => undefined));
    return () => {
      offs.forEach((off) => off());
      if (frame !== null) (globalThis.cancelAnimationFrame ?? clearTimeout)(frame);
    };
  }, [ui, version]);
  return (
    <>
      {sections.map((section) => {
        let items: readonly ObjectTreeItem[] = [];
        try {
          items = section.items();
        } catch {
          items = [];
        }
        const title = ui.translate(section.label);
        return (
          <section key={section.id} aria-label={title}>
            <h3 className="mc-ui-h">{title}</h3>
            <ul className="mc-ui-list">
              {items.map((item) => {
                const danger = item.actions?.find((a) => a.danger);
                return (
                  <li
                    key={item.id}
                    className="mc-ui-list-item mc-ui-tree-row"
                    aria-selected={item.selected || undefined}
                    data-hidden={item.hidden || undefined}
                  >
                    {item.color ? (
                      <span
                        className="mc-ui-tree-swatch"
                        style={{ background: item.color }}
                        aria-hidden="true"
                      />
                    ) : null}
                    <button
                      type="button"
                      className="mc-ui-btn mc-ui-menu-label"
                      style={{ justifyContent: 'flex-start' }}
                      aria-pressed={item.selected ?? undefined}
                      onClick={() => item.select?.()}
                      onFocus={() => item.focus?.(true)}
                      onBlur={() => item.focus?.(false)}
                      onKeyDown={(e) => {
                        if ((e.key === 'Delete' || e.key === 'Backspace') && danger) {
                          e.preventDefault();
                          void danger.run();
                        }
                      }}
                    >
                      {item.label}
                    </button>
                    {item.detail ? <span className="mc-ui-tree-value">{item.detail}</span> : null}
                    {item.actions?.map((action) => (
                      <button
                        key={action.id}
                        type="button"
                        className="mc-ui-btn"
                        aria-label={action.label}
                        title={action.label}
                        aria-pressed={action.pressed}
                        onClick={() => void action.run()}
                      >
                        <Icon name={action.icon} direction={ui.direction} />
                      </button>
                    ))}
                  </li>
                );
              })}
              {items.length ? null : (
                <li className="mc-ui-hint">{ui.i18n.t('objectTree.empty')}</li>
              )}
            </ul>
          </section>
        );
      })}
    </>
  );
}

/** Data window: values under the crosshair (or of the last bar) for every series. */
export function DataWindow({ ui }: { ui: ChartUi }) {
  const t = ui.i18n.t.bind(ui.i18n);
  const [event, setEvent] = useState<CrosshairMoveEvent | null>(null);
  useUiVersion(ui);
  useEffect(() => ui.chart.on('crosshairMove', setEvent), [ui]);
  const context = ui.context();
  const time = event?.time ?? mainSeries(context)?.lastPoint()?.time ?? null;
  const indicators = ui.capabilities.indicators;
  return (
    <div
      className="mc-ui-side-panel"
      role="region"
      aria-label={t('sidebar.dataInspector')}
      aria-live="off"
    >
      {time !== null ? <p className="mc-ui-hint">{formatTime(context, time)}</p> : null}
      <table>
        <tbody>
          {ui.chart.series().flatMap((series) => {
            const point = (time !== null ? series.dataAt(time) : undefined) as
              Record<string, number> | undefined;
            if (!point) return [];
            const owner = indicators?.indicatorForSeries(series);
            const title = owner ? owner.label() : series.options().title || series.type;
            return Object.entries(point)
              .filter(([k, v]) => k !== 'time' && typeof v === 'number')
              .map(([k, v]) => (
                <tr key={`${series.id}-${k}`}>
                  <th scope="row">
                    {k === 'value'
                      ? title
                      : `${title} ${ui.i18n.has(`point.${k}`) ? t(`point.${k}`, { value: '' }).trim() : k}`}
                  </th>
                  <td>
                    {k === 'volume' ? ui.i18n.formatNumber(v) : formatPrice(context, v, series)}
                  </td>
                </tr>
              ));
          })}
        </tbody>
      </table>
    </div>
  );
}
