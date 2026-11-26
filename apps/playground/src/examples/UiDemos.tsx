import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { CandlestickSeries, Chart, ChartProvider } from '@market-chart/react';
import type { OhlcBar } from '@market-chart/core';
import { createLocalStorage } from '@market-chart/persistence';
import { UiPreferencesStore, copyText, validateUiPreferences } from '@market-chart/ui';
import type { MenuItemEntry, UiPreferences } from '@market-chart/ui';
import type { ToolbarComponentProps } from '@market-chart/ui/react';
import { ChartInterface, Icon, useContextMenu, usePreferences } from '@market-chart/ui/react';
import { syntheticBars } from '../data';
import { useDemoChart } from './ui-common';

const bars = syntheticBars('ETHUSDT', 500);

function useSeedStudies(demo: ReturnType<typeof useDemoChart>) {
  // Seed an indicator and a drawing so every context-menu target is there to try.
  useEffect(() => {
    const { chart, indicators, drawings } = demo;
    if (!chart || !indicators || !drawings || indicators.list().length) return;
    const series = chart.series()[0];
    if (!series) return;
    indicators.add('sma', series, { params: { length: 30 } });
    indicators.add('rsi', series);
    const a = bars[bars.length - 80]!;
    const b = bars[bars.length - 20]!;
    drawings.add({
      type: 'trend-line',
      seriesId: series.id,
      points: [
        { time: a.time, price: a.low },
        { time: b.time, price: b.high },
      ],
    });
  }, [demo.chart, demo.indicators, demo.drawings]); // eslint-disable-line react-hooks/exhaustive-deps
}

function DemoInterface({
  demo,
  height = 520,
  style,
}: {
  demo: ReturnType<typeof useDemoChart>;
  height?: number;
  style?: CSSProperties;
}) {
  useSeedStudies(demo);
  return (
    <ChartInterface ui={demo.ui} height={height} style={style}>
      <Chart ref={demo.setChart} height="100%">
        <CandlestickSeries data={bars} />
      </Chart>
    </ChartInterface>
  );
}

/** Demo 2: a complete interface in Persian, mirrored for RTL (header, sidebar, menus, dialogs, canvas text). */
export function RtlExample() {
  return (
    <ChartProvider locale="fa">
      <RtlInner />
    </ChartProvider>
  );
}

function RtlInner() {
  const demo = useDemoChart({
    extra: {
      timeframe: {
        value: () => '1h',
        options: ['5m', '15m', '1h', '4h', '1D'],
        set: () => undefined,
      },
    },
  });
  useEffect(() => {
    demo.ui?.preferences.update({ localDigits: true });
  }, [demo.ui]);
  return (
    <>
      <p className="desc" dir="rtl" lang="fa">
        نوار ابزار، نوار کناری (در سمت راست)، منوی راست‌کلیک، زیرمنوها و پنجره تنظیمات همگی
        راست‌به‌چپ هستند؛ محور زمان همچنان از گذشته به آینده است و ارقام محورها فارسی‌اند. روی
        نمودار، شمع‌ها، خط روند، اندیکاتور یا محورها راست‌کلیک کنید.
      </p>
      <DemoInterface demo={demo} />
    </>
  );
}

/** Demos 4 and 5: target-aware context menus, custom actions (dynamic, submenus, plugin-owned), custom renderer. */
export function ContextMenuExample() {
  const demo = useDemoChart();
  const [custom, setCustom] = useState(false);
  const [pluginOn, setPluginOn] = useState(true);
  const ui = demo.ui;
  useEffect(() => {
    if (!ui) return;
    const offs = [
      ui.contextMenu.register({
        id: 'custom.copy-close',
        label: 'Copy close (custom action)',
        icon: 'copy',
        targets: ['candlestick'],
        category: 'point',
        order: 5,
        shortcut: 'Alt+C',
        run: async (ctx) => {
          await copyText(String((ctx.target!.point as OhlcBar).close), ctx.capabilities);
          ctx.ui.notify(`Copied ${(ctx.target!.point as OhlcBar).close}`);
        },
      }),
      ui.contextMenu.register({
        id: 'custom.bar-stats',
        label: 'Bar statistics',
        icon: 'info',
        targets: ['candlestick'],
        category: 'point',
        order: 6,
        // Dynamic items computed from the clicked bar.
        submenu: (ctx) => {
          const b = ctx.target!.point as OhlcBar;
          const range = ((b.high - b.low) / b.low) * 100;
          const body = (Math.abs(b.close - b.open) / Math.max(b.high - b.low, 1e-9)) * 100;
          return [
            { id: 'range', label: `Range ${range.toFixed(2)} %`, info: true },
            { id: 'body', label: `Body ${body.toFixed(0)} % of range`, info: true },
            { id: 'dir', label: b.close >= b.open ? 'Up bar' : 'Down bar', info: true },
          ];
        },
      }),
      ui.contextMenu.register({
        id: 'custom.only-up-bars',
        label: 'Only on up bars (visibility condition)',
        targets: ['candlestick'],
        category: 'point',
        order: 7,
        isVisible: (ctx) =>
          (ctx.target!.point as OhlcBar).close > (ctx.target!.point as OhlcBar).open,
        run: (ctx) => ctx.ui.notify('This bar closed up'),
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [ui]);
  useEffect(() => {
    if (!ui || !pluginOn) return;
    // A plugin's actions share an owner and disappear together.
    ui.registry.registerAll(
      [
        {
          id: 'plugin.mark-level',
          label: 'Mark level (plugin)',
          icon: 'tool-hline',
          targets: ['chart', 'candlestick', 'priceAxis'],
          category: 'add',
          confirm: 'Add a price line here?',
          run: (ctx) => {
            const series = ctx.chart.series()[0];
            if (series && ctx.target?.price != null)
              series.createPriceLine({
                price: ctx.target.price,
                title: 'plugin',
                color: '#f5a623',
              });
          },
        },
      ],
      { owner: 'demo-plugin' },
    );
    return () => {
      ui.actions.unregisterOwner('demo-plugin');
    };
  }, [ui, pluginOn]);
  return (
    <>
      <div className="toolbar">
        <button aria-pressed={custom} onClick={() => setCustom((c) => !c)}>
          Custom menu renderer (headless hook)
        </button>
        <button aria-pressed={pluginOn} onClick={() => setPluginOn((p) => !p)}>
          Demo plugin installed
        </button>
        <span className="desc" style={{ margin: 0 }}>
          Right-click (or long-press, or Shift+F10) on a candle, the trend line, its handles when
          selected, the SMA/RSI, the price or time axis, or the RSI pane.
        </span>
      </div>
      <ChartInterface ui={ui} height={520} contextMenu={!custom}>
        <Chart ref={demo.setChart} height="100%">
          <CandlestickSeries data={bars} />
        </Chart>
      </ChartInterface>
      {custom ? <CustomMenu demo={demo} /> : null}
      <Seed demo={demo} />
    </>
  );
}

function Seed({ demo }: { demo: ReturnType<typeof useDemoChart> }) {
  useSeedStudies(demo);
  return null;
}

/** A completely different look built on `useContextMenu`: same actions, keyboard handling and ARIA. */
function CustomMenu({ demo }: { demo: ReturnType<typeof useDemoChart> }) {
  const menu = useContextMenu(demo.ui);
  if (!menu) return null;
  const level = menu.levels[menu.levels.length - 1]!;
  return (
    <div
      style={{
        position: 'fixed',
        left: menu.state.x,
        top: menu.state.y,
        zIndex: 10000,
        background: '#fff8e1',
        color: '#3e2723',
        border: '2px solid #f5a623',
        borderRadius: 12,
        padding: 8,
        minWidth: 220,
        fontFamily: 'Georgia, serif',
      }}
      {...menu.getMenuProps(menu.levels.length - 1)}
      ref={(el) => el?.focus()}
    >
      {menu.levels.length > 1 ? (
        <button
          style={{ marginBottom: 6 }}
          onClick={() => menu.state && demo.ui?.menu.handleKey('ArrowLeft')}
        >
          ← back
        </button>
      ) : null}
      {level.entries.map((entry, i) =>
        entry.type === 'separator' ? (
          <hr key={entry.key} />
        ) : (
          <div
            key={entry.key}
            {...menu.getItemProps(level.level, i)}
            style={{
              padding: '4px 8px',
              borderRadius: 6,
              background: level.active === i ? '#ffe0b2' : undefined,
              opacity: (entry as MenuItemEntry).disabled ? 0.4 : 1,
              cursor: 'pointer',
            }}
          >
            {(entry as MenuItemEntry).checked ? '✓ ' : ''}
            {(entry as MenuItemEntry).label}
            {(entry as MenuItemEntry).children ? ' ›' : ''}
          </div>
        ),
      )}
      {menu.state.confirm ? (
        <div>
          {menu.state.confirm.message} <button onClick={() => menu.confirm(true)}>yes</button>{' '}
          <button onClick={() => menu.confirm(false)}>no</button>
        </div>
      ) : null}
    </div>
  );
}

/** A custom header component: last price, updated live. */
function LastPrice({ ui }: ToolbarComponentProps) {
  const series = ui.chart.series()[0];
  const last = series?.lastPoint() as OhlcBar | undefined;
  return (
    <span
      className="badge"
      style={{ fontVariantNumeric: 'tabular-nums' }}
      data-toolbar-item=""
      tabIndex={-1}
    >
      {last
        ? ui.i18n.formatNumber(last.close, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : '—'}
    </span>
  );
}

/** Demos 6 and 7: header sections, custom actions and components, sidebar position/mode, density. */
export function ToolbarsExample() {
  const demo = useDemoChart({
    extra: {
      symbol: {
        value: () => 'ETHUSDT',
        options: () => [
          { value: 'ETHUSDT', label: 'ETHUSDT (synthetic)' },
          { value: 'BTCUSDT', label: 'BTCUSDT (synthetic)' },
        ],
        set: () => undefined,
      },
    },
  });
  const ui = demo.ui;
  const prefs = usePreferences(ui);
  useEffect(() => {
    if (!ui) return;
    const offs = [
      ui.actions.register({
        id: 'demo.last-price',
        label: 'Last price',
        locations: ['header'],
        section: 'center',
        component: LastPrice,
        run: () => undefined,
      }),
      ui.actions.register({
        id: 'demo.flip-theme',
        label: 'Flip theme (custom action)',
        icon: 'theme',
        locations: ['header', 'sidebar'],
        section: 'right',
        group: 'custom',
        shortcut: 'Alt+T',
        isActive: (ctx) => ctx.chart.theme().name === 'light',
        run: (ctx) => {
          ctx.ui.preferences.update({
            theme: ctx.chart.theme().name === 'light' ? 'dark' : 'light',
          });
        },
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [ui]);
  return (
    <>
      <div className="toolbar">
        {(['expanded', 'collapsed', 'floating', 'hidden'] as const).map((mode) => (
          <button
            key={mode}
            aria-pressed={prefs?.sidebar.mode === mode}
            onClick={() => ui?.preferences.update({ sidebar: { mode } })}
          >
            {mode}
          </button>
        ))}
        <button
          aria-pressed={prefs?.sidebar.position === 'end'}
          onClick={() =>
            ui?.preferences.update({
              sidebar: { position: prefs?.sidebar.position === 'end' ? 'start' : 'end' },
            })
          }
        >
          sidebar at the end
        </button>
        <button
          aria-pressed={prefs?.density === 'compact'}
          onClick={() =>
            ui?.preferences.update({
              density: prefs?.density === 'compact' ? 'comfortable' : 'compact',
            })
          }
        >
          compact
        </button>
        <button
          aria-pressed={prefs?.header.visible === false}
          onClick={() =>
            ui?.preferences.update({ header: { visible: !(prefs?.header.visible ?? true) } })
          }
        >
          hide header
        </button>
        <span className="desc" style={{ margin: 0 }}>
          Narrow the window to see actions move into “More actions”. Alt+T runs the custom action.
        </span>
      </div>
      <DemoInterface demo={demo} />
    </>
  );
}

/** Demo 8: user settings and action management, saved to localStorage, with export/import. */
export function UiSettingsExample() {
  const preferences = useMemo(
    () =>
      new UiPreferencesStore({
        storage: createLocalStorage<UiPreferences>({
          prefix: 'market-chart:playground:',
          validate: validateUiPreferences,
        }),
        id: 'ui-settings-demo',
        defaults: { sidebar: { mode: 'collapsed' } },
      }),
    [],
  );
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    void preferences.load().then(() => setLoaded(true));
  }, [preferences]);
  const demo = useDemoChart({ preferences });
  const prefs = usePreferences(demo.ui);
  return (
    <>
      <div className="toolbar">
        {(
          [
            'general',
            'appearance',
            'header',
            'sidebar',
            'contextMenu',
            'language',
            'shortcuts',
          ] as const
        ).map((c) => (
          <button key={c} onClick={() => demo.ui?.openSettings(c)}>
            <Icon name="settings" size={14} /> {c}
          </button>
        ))}
        <span className="badge">{loaded ? preferences.status : 'loading'}</span>
      </div>
      <div
        className="grid2"
        style={{ gridTemplateColumns: '2fr minmax(240px, 1fr)', alignItems: 'start' }}
      >
        <DemoInterface demo={demo} height={500} />
        <pre
          className="tile"
          style={{ margin: 0, maxHeight: 500, overflow: 'auto', fontSize: 11 }}
          aria-label="Stored preferences"
        >
          {prefs ? preferences.exportJson() : ''}
        </pre>
      </div>
      <p className="desc">
        Changes apply immediately and are saved to localStorage through the persistence package
        (reload the page to see them restored). Settings → Restore defaults, Export and Import are
        in the dialog footer.
      </p>
    </>
  );
}
