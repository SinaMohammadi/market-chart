import { useEffect, useMemo, useState } from 'react';
import type { SeriesApi } from '@market-chart/core';
import {
  AreaSeries,
  BarSeries,
  BaselineSeries,
  CandlestickSeries,
  Chart,
  ChartProvider,
  HistogramSeries,
  LineSeries,
} from '@market-chart/react';
import { PRICE_SOURCES, builtInIndicators } from '@market-chart/indicators';
import type { IndicatorDefinition } from '@market-chart/indicators';
import { Indicator } from '@market-chart/indicators/react';
import {
  LEGEND_FIELDS,
  MARKER_FIELDS,
  UiPreferencesStore,
  orderTicket,
  priceActions,
  symbolSearch,
} from '@market-chart/ui';
import type { ChartUiFeature } from '@market-chart/ui';
import { TradingOverlay } from '@market-chart/trading/react';
import type { TradingOrder } from '@market-chart/trading';
import type { LegendField, MarkerField } from '@market-chart/ui';
import { ChartInterface } from '@market-chart/ui/react';
import { Code } from '../components/Code';
import { closes, syntheticBars, volumeOf } from '../data';
import { SIMULATED, SIMULATED_SYMBOLS, SimulatedBroker } from '../demos/simulated';
import { useTradingChart } from '../demos/useTradingChart';
import { useSite } from '../site';

type SeriesKind = 'candlestick' | 'bar' | 'line' | 'area' | 'baseline';
type Params = Record<string, number | string | boolean | null>;

interface Config {
  readonly series: SeriesKind;
  readonly theme: 'dark' | 'light';
  readonly height: number;
  readonly volume: boolean;
  readonly crosshair: 'normal' | 'magnet' | 'hidden';
  readonly indicators: readonly {
    readonly id: number;
    readonly type: string;
    readonly params: Params;
  }[];
  readonly ui: boolean;
  readonly header: boolean;
  readonly sidebar: boolean;
  readonly sidebarPosition: 'start' | 'end';
  readonly legend: boolean;
  readonly legendFields: Readonly<Record<LegendField, boolean>>;
  readonly markers: Readonly<Record<MarkerField, boolean>>;
  readonly locale: string;
  /** Symbol selector (symbolSearch feature); 'off' leaves it out. */
  readonly symbolSelector: 'off' | 'dropdown' | 'modal' | 'both';
  /** Price actions and the order ticket, with a simulated broker. */
  readonly priceActions: boolean;
  /** Simulated orders drawn by @market-chart/trading. */
  readonly tradingObjects: boolean;
}

const bars = syntheticBars('BTCUSDT', 500);
const LAST = bars[bars.length - 1]!.close;
const SAMPLE_ORDERS: TradingOrder[] = [
  {
    id: 'SIM-1',
    side: 'buy',
    type: 'limit',
    price: Math.round(LAST * 0.97 * 100) / 100,
    quantity: 2,
  },
  {
    id: 'SIM-2',
    side: 'sell',
    type: 'limit',
    price: Math.round(LAST * 1.03 * 100) / 100,
    quantity: 1,
  },
];
const SYMBOL_LIST = SIMULATED_SYMBOLS.slice(0, 50);
const line = closes(bars);
const volume = volumeOf(bars);
const byType = new Map(builtInIndicators.map((d) => [d.type, d]));
const defaults = (d: IndicatorDefinition): Params =>
  Object.fromEntries(Object.entries(d.inputs).map(([k, spec]) => [k, spec.default]));

const DEFAULT_LEGEND = Object.fromEntries(
  LEGEND_FIELDS.map((f) => [f, f !== 'timestamp']),
) as Record<LegendField, boolean>;
const DEFAULT_MARKERS: Record<MarkerField, boolean> = {
  highLow: false,
  previousClose: false,
  lastPriceLine: true,
  lastValueLabel: true,
  indicatorLabels: true,
};

/** Only the values that differ from the defaults go into the generated code. */
function changed<T extends Record<string, unknown>>(value: T, base: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([k, v]) => base[k] !== v)) as Partial<T>;
}

const literal = (value: unknown): string =>
  JSON.stringify(value)
    .replace(/"([A-Za-z_$][\w$]*)":/g, '$1: ')
    .replace(/"/g, "'")
    .replace(/,(?=\S)/g, ', ')
    .replace(/\{(?=\S)/g, '{ ')
    .replace(/(?<=\S)\}/g, ' }');

function generate(c: Config): string {
  const component = {
    candlestick: 'CandlestickSeries',
    bar: 'BarSeries',
    line: 'LineSeries',
    area: 'AreaSeries',
    baseline: 'BaselineSeries',
  }[c.series];
  const ohlc = c.series === 'candlestick' || c.series === 'bar';
  const reactImports = ['Chart', component, ...(c.volume ? ['HistogramSeries'] : [])];
  if (c.ui && c.locale !== 'en') reactImports.push('ChartProvider');
  const lines: string[] = [];
  lines.push(`import { useMemo, useState } from 'react';`);
  lines.push(`import type { SeriesApi } from '@market-chart/core';`);
  lines.push(`import { ${reactImports.sort().join(', ')} } from '@market-chart/react';`);
  if (c.indicators.length)
    lines.push(`import { Indicator } from '@market-chart/indicators/react';`);
  const features: string[] = [];
  if (c.ui && c.symbolSelector !== 'off')
    features.push(`symbolSearch({ mode: '${c.symbolSelector}' })`);
  if (c.ui && c.priceActions) features.push('priceActions()', 'orderTicket()');
  if (c.ui) {
    const uiImports = [
      'UiPreferencesStore',
      ...(c.symbolSelector !== 'off' ? ['symbolSearch'] : []),
      ...(c.priceActions ? ['orderTicket', 'priceActions'] : []),
    ];
    lines.push(`import { ${uiImports.sort().join(', ')} } from '@market-chart/ui';`);
    if (c.tradingObjects)
      lines.push(`import { TradingOverlay } from '@market-chart/trading/react';`);
    lines.push(`import { ChartInterface } from '@market-chart/ui/react';`);
    lines.push(
      `import { useTradingChart } from './useTradingChart'; // see the Live examples page`,
    );
  }
  lines.push('');
  lines.push(`// bars: [{ time, open, high, low, close, volume }], time in UTC milliseconds`);
  lines.push(`export function TradingChart({ bars${c.volume ? ', volume' : ''} }) {`);
  lines.push(`  const [series, setSeries] = useState<SeriesApi | null>(null);`);
  if (c.ui && c.symbolSelector !== 'off') {
    lines.push(
      `  const [symbol, setSymbol] = useState('BTCUSDT'); // symbolList: your SymbolItem[]`,
    );
  }
  if (c.ui && (c.priceActions || c.tradingObjects)) {
    lines.push(
      `  // yourBroker and orders are YOUR code: the library never trades (the docs preview is simulated).`,
    );
  }
  if (c.ui) {
    const prefs: Record<string, unknown> = {};
    if (c.sidebarPosition !== 'start') prefs['sidebar'] = { position: c.sidebarPosition };
    const legend: Record<string, unknown> = {};
    if (!c.legend) legend['visible'] = false;
    const fields = changed(c.legendFields, DEFAULT_LEGEND);
    if (Object.keys(fields).length) legend['fields'] = fields;
    if (Object.keys(legend).length) prefs['legend'] = legend;
    const markers = changed(c.markers, DEFAULT_MARKERS);
    if (Object.keys(markers).length) prefs['markers'] = markers;
    lines.push(
      `  const preferences = useMemo(() => new UiPreferencesStore(${Object.keys(prefs).length ? `{ defaults: ${literal(prefs)} }` : ''}), []);`,
    );
    if (features.length) {
      lines.push(`  // Optional features: only what is listed is installed (and bundled).`);
      lines.push(`  const features = useMemo(() => [${features.join(', ')}], []);`);
    }
    const capabilities: string[] = [];
    if (c.symbolSelector !== 'off')
      capabilities.push('symbols: { value: () => symbol, set: setSymbol, list: () => symbolList }');
    if (c.priceActions)
      capabilities.push(
        "trading: { submit: (ticket) => yourBroker.submit(ticket), simulatedLabel: 'Paper trading' }",
      );
    const args = [
      'preferences',
      ...(features.length ? ['features'] : []),
      ...(capabilities.length ? [`extra: { ${capabilities.join(', ')} }`] : []),
    ];
    lines.push(`  const { setChart, ui } = useTradingChart({ ${args.join(', ')} });`);
  }
  const options: Record<string, unknown> = {};
  if (c.crosshair !== 'normal') options['crosshair'] = { mode: c.crosshair };
  const chartProps = [
    c.ui ? 'ref={setChart}' : '',
    `theme="${c.theme}"`,
    c.ui ? 'height="100%"' : `height={${c.height}}`,
    Object.keys(options).length ? `options={${literal(options)}}` : '',
    c.volume
      ? "onReady={(chart) => chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } })}"
      : '',
  ]
    .filter(Boolean)
    .join(' ');
  const body: string[] = [];
  const data = ohlc ? 'bars' : 'bars.map((b) => ({ time: b.time, value: b.close }))';
  body.push(`<Chart ${chartProps}>`);
  body.push(`  <${component} data={${data}} ref={setSeries} />`);
  if (c.volume)
    body.push(
      `  <HistogramSeries data={volume} options={{ priceScaleId: 'volume', priceFormat: { type: 'volume' } }} />`,
    );
  for (const i of c.indicators) {
    const d = byType.get(i.type);
    const params = d ? changed(i.params, defaults(d)) : i.params;
    body.push(
      `  <Indicator type="${i.type}" source={series}${Object.keys(params).length ? ` params={${literal(params)}}` : ''} />`,
    );
  }
  if (c.ui && c.tradingObjects)
    body.push(
      `  {ui ? <TradingOverlay ui={ui} orders={orders} onModify={(o, price) => yourBroker.modify(o, price)} onCancel={(o) => yourBroker.cancel(o)} /> : null}`,
    );
  body.push(`</Chart>`);
  let jsx = body;
  if (c.ui) {
    const props = [
      'ui={ui}',
      `height={${c.height}}`,
      c.header ? '' : 'header={false}',
      c.sidebar ? '' : 'sidebar={false}',
    ]
      .filter(Boolean)
      .join(' ');
    jsx = [`<ChartInterface ${props}>`, ...body.map((l) => `  ${l}`), `</ChartInterface>`];
  }
  lines.push(`  return (`);
  for (const l of jsx) lines.push(`    ${l}`);
  lines.push(`  );`);
  lines.push(`}`);
  if (c.ui && c.locale !== 'en') {
    // The provider must be above the component that creates the chart UI, so the UI uses its language.
    const args = c.volume ? 'bars, volume' : 'bars';
    const props = c.volume ? 'bars={bars} volume={volume}' : 'bars={bars}';
    lines.push('');
    lines.push(`export function App({ ${args} }) {`);
    lines.push(`  return (`);
    lines.push(`    <ChartProvider locale="${c.locale}">`);
    lines.push(`      <TradingChart ${props} />`);
    lines.push(`    </ChartProvider>`);
    lines.push(`  );`);
    lines.push(`}`);
  }
  return lines.join('\n');
}

function Preview({ config }: { config: Config }) {
  // The provider goes above the component that creates the chart UI, so the UI uses its language.
  return config.ui ? (
    <ChartProvider locale={config.locale}>
      <PreviewChart config={config} />
    </ChartProvider>
  ) : (
    <PreviewChart config={config} />
  );
}

function PreviewChart({ config }: { config: Config }) {
  const [series, setSeries] = useState<SeriesApi | null>(null);
  const preferences = useMemo(
    () =>
      new UiPreferencesStore({
        defaults: {
          sidebar: { position: config.sidebarPosition },
          legend: { visible: config.legend, fields: config.legendFields },
          markers: config.markers,
        },
      }),
    [config],
  );
  const features = useMemo<ChartUiFeature[]>(
    () => [
      ...(config.symbolSelector !== 'off' ? [symbolSearch({ mode: config.symbolSelector })] : []),
      ...(config.priceActions ? [priceActions(), orderTicket()] : []),
    ],
    [config.symbolSelector, config.priceActions],
  );
  const broker = useMemo(() => {
    const b = new SimulatedBroker();
    b.orders = SAMPLE_ORDERS;
    return b;
  }, []);
  const [orders, setOrders] = useState(broker.orders);
  useEffect(() => broker.subscribe(() => setOrders(broker.orders)), [broker]);
  useEffect(() => () => broker.destroy(), [broker]);
  const [symbol, setSymbol] = useState('SYN:BTCUSDT');
  const extra = useMemo(
    () => ({
      ...(config.symbolSelector !== 'off'
        ? { symbols: { value: () => symbol, set: setSymbol, list: () => SYMBOL_LIST } }
        : {}),
      ...(config.priceActions
        ? { trading: { submit: broker.submit, simulatedLabel: SIMULATED } }
        : {}),
    }),
    [config.symbolSelector, config.priceActions, symbol, broker],
  );
  const { setChart, ui } = useTradingChart({ preferences, features, extra });
  const ohlc = config.series === 'candlestick' || config.series === 'bar';
  const options = useMemo(() => ({ crosshair: { mode: config.crosshair } }), [config.crosshair]);
  const chart = (
    <Chart
      ref={config.ui ? setChart : undefined}
      theme={config.theme}
      height={config.ui ? '100%' : config.height}
      options={options}
      onReady={(c) => {
        if (config.volume)
          c.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      }}
    >
      {config.series === 'candlestick' ? <CandlestickSeries data={bars} ref={setSeries} /> : null}
      {config.series === 'bar' ? <BarSeries data={bars} ref={setSeries} /> : null}
      {config.series === 'line' ? <LineSeries data={line} ref={setSeries} /> : null}
      {config.series === 'area' ? <AreaSeries data={line} ref={setSeries} /> : null}
      {config.series === 'baseline' ? (
        <BaselineSeries data={line} ref={setSeries} options={{ baseValue: line[0]!.value }} />
      ) : null}
      {config.volume ? (
        <HistogramSeries
          data={volume}
          options={{
            priceScaleId: 'volume',
            priceFormat: { type: 'volume' },
            lastValueVisible: false,
          }}
        />
      ) : null}
      {config.ui && config.tradingObjects && ui ? (
        <TradingOverlay
          ui={ui}
          orders={orders}
          onModify={(o, price) => broker.modify(o as TradingOrder, price)}
          onCancel={(o) => broker.cancel(o as TradingOrder)}
        />
      ) : null}
      {config.indicators.map((i) =>
        // Indicators need OHLC input for some types (e.g. ATR); line series feed their value as close.
        ohlc || !byType.get(i.type)?.needsVolume ? (
          <Indicator key={i.id} type={i.type} source={series} params={i.params} />
        ) : null,
      )}
    </Chart>
  );
  if (!config.ui) return chart;
  return (
    <ChartInterface ui={ui} height={config.height} header={config.header} sidebar={config.sidebar}>
      {chart}
    </ChartInterface>
  );
}

function ParamInput({
  name,
  spec,
  value,
  onChange,
}: {
  name: string;
  spec: IndicatorDefinition['inputs'][string];
  value: Params[string];
  onChange: (v: Params[string]) => void;
}) {
  const label = spec.label ?? name;
  if (spec.type === 'int' || spec.type === 'float')
    return (
      <label className="param">
        {label}
        <input
          type="number"
          value={value as number}
          min={spec.min}
          max={spec.max}
          step={spec.type === 'int' ? 1 : ('step' in spec && spec.step) || 0.1}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(n);
          }}
        />
      </label>
    );
  if (spec.type === 'enum' || spec.type === 'source')
    return (
      <label className="param">
        {label}
        <select value={value as string} onChange={(e) => onChange(e.target.value)}>
          {(spec.type === 'enum' ? spec.options : PRICE_SOURCES).map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      </label>
    );
  if (spec.type === 'bool')
    return (
      <label className="param">
        <input
          type="checkbox"
          checked={value as boolean}
          onChange={(e) => onChange(e.target.checked)}
        />
        {label}
      </label>
    );
  return null;
}

let nextId = 1;

export default function Builder() {
  const site = useSite();
  const [config, setConfig] = useState<Config>(() => ({
    series: 'candlestick',
    theme: site.theme,
    height: 480,
    volume: true,
    crosshair: 'normal',
    indicators: [
      { id: nextId++, type: 'ema', params: { ...defaults(byType.get('ema')!), length: 21 } },
      { id: nextId++, type: 'rsi', params: defaults(byType.get('rsi')!) },
    ],
    ui: true,
    header: true,
    sidebar: true,
    sidebarPosition: 'start',
    legend: true,
    legendFields: DEFAULT_LEGEND,
    markers: { ...DEFAULT_MARKERS, highLow: true },
    locale: site.locale,
    symbolSelector: 'off',
    priceActions: false,
    tradingObjects: false,
  }));
  const [adding, setAdding] = useState('macd');
  const set = <K extends keyof Config>(key: K, value: Config[K]) =>
    setConfig((c) => ({ ...c, [key]: value }));
  const code = useMemo(() => generate(config), [config]);
  // Remount the preview when the configuration changes, so it always matches the code exactly.
  const key = useMemo(() => JSON.stringify(config), [config]);

  return (
    <div className="builder">
      <form
        className="builder-controls"
        onSubmit={(e) => e.preventDefault()}
        aria-label="Chart options"
      >
        <fieldset>
          <legend>Chart</legend>
          <label className="param">
            Series
            <select
              value={config.series}
              onChange={(e) => set('series', e.target.value as SeriesKind)}
            >
              {(['candlestick', 'bar', 'line', 'area', 'baseline'] as const).map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="param">
            Theme
            <select value={config.theme} onChange={(e) => set('theme', e.target.value as 'dark')}>
              <option>dark</option>
              <option>light</option>
            </select>
          </label>
          <label className="param">
            Crosshair
            <select
              value={config.crosshair}
              onChange={(e) => set('crosshair', e.target.value as 'normal')}
            >
              <option>normal</option>
              <option>magnet</option>
              <option>hidden</option>
            </select>
          </label>
          <label className="param">
            Height {config.height}px
            <input
              type="range"
              min={300}
              max={760}
              step={20}
              value={config.height}
              onChange={(e) => set('height', Number(e.target.value))}
            />
          </label>
          <label className="param">
            <input
              type="checkbox"
              checked={config.volume}
              onChange={(e) => set('volume', e.target.checked)}
            />
            Volume
          </label>
        </fieldset>

        <fieldset>
          <legend>Indicators</legend>
          {config.indicators.map((ind) => {
            const d = byType.get(ind.type)!;
            return (
              <div key={ind.id} className="builder-indicator">
                <div className="builder-indicator-head">
                  <b>{d.name}</b>
                  <button
                    type="button"
                    aria-label={`Remove ${d.name}`}
                    onClick={() =>
                      set(
                        'indicators',
                        config.indicators.filter((x) => x.id !== ind.id),
                      )
                    }
                  >
                    ×
                  </button>
                </div>
                {Object.entries(d.inputs).map(([name, spec]) => (
                  <ParamInput
                    key={name}
                    name={name}
                    spec={spec}
                    value={ind.params[name] ?? null}
                    onChange={(v) =>
                      set(
                        'indicators',
                        config.indicators.map((x) =>
                          x.id === ind.id ? { ...x, params: { ...x.params, [name]: v } } : x,
                        ),
                      )
                    }
                  />
                ))}
              </div>
            );
          })}
          <div className="builder-add">
            <select
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
              aria-label="Indicator to add"
            >
              {builtInIndicators.map((d) => (
                <option key={d.type} value={d.type}>
                  {d.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() =>
                set('indicators', [
                  ...config.indicators,
                  { id: nextId++, type: adding, params: defaults(byType.get(adding)!) },
                ])
              }
            >
              Add
            </button>
          </div>
        </fieldset>

        <fieldset>
          <legend>Interface</legend>
          <label className="param">
            <input
              type="checkbox"
              checked={config.ui}
              onChange={(e) => set('ui', e.target.checked)}
            />
            Use <code>@market-chart/ui</code>
          </label>
          {config.ui ? (
            <>
              <label className="param">
                <input
                  type="checkbox"
                  checked={config.header}
                  onChange={(e) => set('header', e.target.checked)}
                />
                Header
              </label>
              <label className="param">
                <input
                  type="checkbox"
                  checked={config.sidebar}
                  onChange={(e) => set('sidebar', e.target.checked)}
                />
                Sidebar
              </label>
              <label className="param">
                Sidebar side
                <select
                  value={config.sidebarPosition}
                  onChange={(e) => set('sidebarPosition', e.target.value as 'start')}
                >
                  <option value="start">start</option>
                  <option value="end">end</option>
                </select>
              </label>
              <label className="param">
                Language
                <select value={config.locale} onChange={(e) => set('locale', e.target.value)}>
                  <option value="en">English</option>
                  <option value="fa">فارسی</option>
                  <option value="ar">العربية</option>
                </select>
              </label>
              <label className="param">
                <input
                  type="checkbox"
                  checked={config.legend}
                  onChange={(e) => set('legend', e.target.checked)}
                />
                Legend
              </label>
              <label className="param">
                Symbol selector
                <select
                  value={config.symbolSelector}
                  onChange={(e) =>
                    set('symbolSelector', e.target.value as Config['symbolSelector'])
                  }
                >
                  <option value="off">off</option>
                  <option value="dropdown">dropdown</option>
                  <option value="modal">search dialog</option>
                  <option value="both">both</option>
                </select>
              </label>
              <label className="param">
                <input
                  type="checkbox"
                  checked={config.priceActions}
                  onChange={(e) => set('priceActions', e.target.checked)}
                />
                Price actions and order ticket (simulated)
              </label>
              <label className="param">
                <input
                  type="checkbox"
                  checked={config.tradingObjects}
                  onChange={(e) => set('tradingObjects', e.target.checked)}
                />
                Order lines (simulated)
              </label>
              <div className="param-grid" aria-label="Legend fields">
                {LEGEND_FIELDS.map((f) => (
                  <label key={f} className="param">
                    <input
                      type="checkbox"
                      checked={config.legendFields[f]}
                      disabled={!config.legend}
                      onChange={(e) =>
                        set('legendFields', { ...config.legendFields, [f]: e.target.checked })
                      }
                    />
                    {f}
                  </label>
                ))}
              </div>
              <div className="param-grid" aria-label="Price labels">
                {MARKER_FIELDS.map((f) => (
                  <label key={f} className="param">
                    <input
                      type="checkbox"
                      checked={config.markers[f]}
                      onChange={(e) => set('markers', { ...config.markers, [f]: e.target.checked })}
                    />
                    {f}
                  </label>
                ))}
              </div>
            </>
          ) : null}
        </fieldset>
      </form>
      <div className="builder-output">
        <div className="example-body">
          <Preview key={key} config={config} />
        </div>
        <Code code={code} language="tsx" title="TradingChart.tsx" />
      </div>
    </div>
  );
}
