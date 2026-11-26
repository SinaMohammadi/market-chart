import { useEffect, useState } from 'react';
import type { ChartUi } from '../chart-ui.js';
import type { LegendItem } from '../legend.js';
import { Icon } from './icon.js';
import { usePreferences, useUiVersion } from './hooks.js';

export interface ChartLegendProps {
  readonly ui: ChartUi | null;
  readonly className?: string;
}

/** Re-renders once per animation frame at most while the crosshair moves or data streams in. */
function useLegendTime(ui: ChartUi | null): { time: number | null; tick: number } {
  const [state, setState] = useState<{ time: number | null; tick: number }>({
    time: null,
    tick: 0,
  });
  useEffect(() => {
    if (!ui) return;
    let frame: number | null = null;
    let time: number | null = null;
    const raf =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (cb: () => void) => setTimeout(cb, 16) as unknown as number;
    const caf =
      typeof cancelAnimationFrame === 'function'
        ? cancelAnimationFrame
        : (id: number) => clearTimeout(id);
    const flush = (): void => {
      if (frame !== null) return;
      frame = raf(() => {
        frame = null;
        setState((s) => ({ time, tick: s.tick + 1 }));
      });
    };
    const offs = [
      ui.chart.on('crosshairMove', (e) => {
        time = e.time;
        flush();
      }),
      ui.chart.on('dataChanged', flush),
    ];
    return () => {
      offs.forEach((off) => off());
      if (frame !== null) caf(frame);
    };
  }, [ui]);
  return state;
}

function Value({ item }: { item: LegendItem }) {
  return (
    <span className="mc-ui-legend-value" data-key={item.key}>
      {item.label ? <span className="mc-ui-legend-key">{item.label}</span> : null}
      <span
        className="mc-ui-legend-num"
        data-trend={item.trend}
        style={item.color ? { color: item.color } : undefined}
      >
        {item.text}
      </span>
    </span>
  );
}

/**
 * Legend over the chart: the hovered bar's (or last bar's) date, time, timestamp, open, high, low, close,
 * change and volume, and a row per indicator with its values and buttons to hide it, open its settings or
 * remove it. What it shows is a user preference (Settings → Legend and price labels).
 */
export function ChartLegend({ ui, className }: ChartLegendProps) {
  useUiVersion(ui);
  const preferences = usePreferences(ui);
  const { time } = useLegendTime(ui);
  const [collapsed, setCollapsed] = useState(false);
  if (!ui || !preferences?.legend.visible) return null;
  const t = ui.i18n.t.bind(ui.i18n);
  const data = ui.legend(time);
  if (!data.series) return null;
  const rtl = ui.direction === 'rtl';
  // The plot itself is not mirrored: keep clear of the price axis on the side the legend starts from.
  const offset =
    (rtl ? ui.chart.priceScale('right').width() : ui.chart.priceScale('left').width()) + 8;
  const indicatorSettings = ui.capabilities.indicatorSettings;
  return (
    <div
      className={`mc-ui-legend${className ? ` ${className}` : ''}`}
      role="group"
      aria-label={t('legend.label')}
      data-hovered={data.hovered}
      style={rtl ? { right: offset } : { left: offset }}
    >
      <div className="mc-ui-legend-row mc-ui-legend-main">
        <span className="mc-ui-legend-title">{data.title}</span>
        {data.timeItems.map((item) => (
          <Value key={item.key} item={item} />
        ))}
        {data.items.map((item) => (
          <Value key={item.key} item={item} />
        ))}
        <span className="mc-ui-legend-actions">
          {ui.capabilities.openSettings ? (
            <button
              type="button"
              className="mc-ui-btn mc-ui-legend-btn"
              aria-label={t('legend.settings')}
              title={t('legend.settings')}
              onClick={() => ui.openSettings('legend')}
            >
              <Icon name="settings" size={14} />
            </button>
          ) : null}
          <button
            type="button"
            className="mc-ui-btn mc-ui-legend-btn"
            aria-label={t('indicator.hide')}
            title={t('indicator.hide')}
            onClick={() => ui.preferences.update({ legend: { visible: false } })}
          >
            <Icon name="eye-off" size={14} />
          </button>
        </span>
      </div>
      {data.indicators.length ? (
        <>
          {collapsed
            ? null
            : data.indicators.map((row) => (
                <div
                  key={row.indicator.id}
                  className="mc-ui-legend-row"
                  data-hidden={!row.visible || undefined}
                >
                  <span className="mc-ui-legend-name">{row.label}</span>
                  {row.items.map((item) => (
                    <Value key={item.key} item={item} />
                  ))}
                  <span className="mc-ui-legend-actions">
                    <button
                      type="button"
                      className="mc-ui-btn mc-ui-legend-btn"
                      aria-pressed={!row.visible}
                      aria-label={`${t(row.visible ? 'indicator.hide' : 'indicator.show')}: ${row.label}`}
                      onClick={() => row.indicator.setVisible(!row.visible)}
                    >
                      <Icon name={row.visible ? 'eye' : 'eye-off'} size={14} />
                    </button>
                    {indicatorSettings ? (
                      <button
                        type="button"
                        className="mc-ui-btn mc-ui-legend-btn"
                        aria-label={`${t('indicator.settings')} ${row.label}`}
                        onClick={() => indicatorSettings(row.indicator, 'inputs')}
                      >
                        <Icon name="settings" size={14} />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="mc-ui-btn mc-ui-legend-btn"
                      aria-label={`${t('indicator.remove')}: ${row.label}`}
                      onClick={() => row.indicator.remove()}
                    >
                      <Icon name="close" size={14} />
                    </button>
                  </span>
                </div>
              ))}
          <button
            type="button"
            className="mc-ui-btn mc-ui-legend-btn mc-ui-legend-toggle"
            aria-expanded={!collapsed}
            aria-label={`${t('header.indicators')} (${data.indicators.length})`}
            onClick={() => setCollapsed((c) => !c)}
          >
            <Icon name={collapsed ? 'expand' : 'collapse'} size={14} />
            <span className="mc-ui-legend-count">{data.indicators.length}</span>
          </button>
        </>
      ) : null}
    </div>
  );
}
