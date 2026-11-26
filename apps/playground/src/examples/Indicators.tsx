import { useEffect, useMemo, useReducer, useState } from 'react';
import { CandlestickSeries, Chart, useCrosshair } from '@market-chart/react';
import type { ChartApi, SeriesApi } from '@market-chart/core';
import { getIndicatorManager } from '@market-chart/indicators';
import type {
  IndicatorConfig,
  IndicatorHandle,
  IndicatorManager,
  InputSpec,
} from '@market-chart/indicators';
import { HOUR, TickSimulator } from '@market-chart/testing';
import { syntheticBars } from '../data';

const STARTER: readonly [string, Record<string, unknown>?][] = [
  ['bollinger'],
  ['ema', { length: 50 }],
  ['rsi'],
  ['macd'],
];

function useManagerVersion(manager: IndicatorManager | null): number {
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!manager) return;
    const offs = [
      manager.on('added', bump),
      manager.on('removed', bump),
      manager.on('changed', bump),
    ];
    return () => offs.forEach((off) => off());
  }, [manager]);
  return version;
}

/** Settings form generated from the indicator's input schema. */
function ParamsForm({ handle }: { handle: IndicatorHandle }) {
  const [error, setError] = useState<string | null>(null);
  const params = handle.params();
  const update = (key: string, value: unknown) => {
    try {
      handle.setParams({ [key]: value });
      setError(null);
    } catch (e) {
      setError(
        e instanceof Error ? e.message.replace('[market-chart/indicators] ', '') : String(e),
      );
    }
  };
  const field = (key: string, spec: InputSpec) => {
    const value = params[key];
    switch (spec.type) {
      case 'int':
      case 'float':
        return (
          <input
            type="number"
            defaultValue={String(value)}
            step={spec.type === 'int' ? 1 : (spec.step ?? 0.1)}
            min={spec.min}
            max={spec.max}
            onChange={(e) => e.target.value !== '' && update(key, Number(e.target.value))}
          />
        );
      case 'source':
      case 'enum': {
        const options =
          spec.type === 'source'
            ? ['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4', 'hlcc4']
            : spec.options;
        return (
          <select value={String(value)} onChange={(e) => update(key, e.target.value)}>
            {options.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        );
      }
      case 'bool':
        return (
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => update(key, e.target.checked)}
          />
        );
      case 'time':
        return (
          <span className="desc">
            {value === null ? 'first bar' : new Date(value as number).toISOString()}
          </span>
        );
    }
  };
  const entries = Object.entries(handle.definition.inputs);
  return (
    <div className="params">
      {entries.length === 0 ? <span className="desc">No inputs</span> : null}
      {entries.map(([key, spec]) => (
        <label key={key}>
          <span>{spec.label ?? key}</span>
          {field(key, spec)}
        </label>
      ))}
      {error ? <span className="down">{error}</span> : null}
    </div>
  );
}

/** Legend inside <Chart>: values of every indicator at the crosshair (or the last bar). */
function IndicatorLegend({
  manager,
  source,
}: {
  manager: IndicatorManager;
  source: SeriesApi<'candlestick'> | null;
}) {
  const crosshair = useCrosshair();
  useManagerVersion(manager);
  const time = crosshair?.time ?? source?.lastPoint()?.time ?? null;
  if (time === null) return null;
  return (
    <div className="legend" style={{ flexDirection: 'column', gap: 2 }}>
      {manager.list().map((handle) => {
        const values = handle.valuesAt(time);
        return (
          <span key={handle.id} style={{ opacity: handle.visible() ? 1 : 0.5 }}>
            <b>{handle.label()}</b>{' '}
            {handle.definition.outputs
              .filter((o) => values[o.id] !== null)
              .slice(0, 4)
              .map((o) => (
                <span
                  key={o.id}
                  style={{
                    color: handle.style().outputs?.[o.id]?.color ?? o.color,
                    marginRight: 6,
                  }}
                >
                  {values[o.id]!.toFixed(2)}
                </span>
              ))}
          </span>
        );
      })}
    </div>
  );
}

export function IndicatorsExample() {
  const bars = syntheticBars('BTCUSDT', 1_500);
  const [chart, setChart] = useState<ChartApi | null>(null);
  const [candles, setCandles] = useState<SeriesApi<'candlestick'> | null>(null);
  const manager = useMemo(() => (chart ? getIndicatorManager(chart) : null), [chart]);
  useManagerVersion(manager);
  const [choice, setChoice] = useState('supertrend');
  const [open, setOpen] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [saved, setSaved] = useState<IndicatorConfig[] | null>(null);

  useEffect(() => {
    if (!manager || !candles || manager.list().length > 0) return;
    for (const [type, params] of STARTER) manager.add(type, candles, { params });
    manager.chart.panes()[0]?.setStretchFactor(2.5);
  }, [manager, candles]);

  useEffect(() => {
    if (!live || !candles) return;
    const last = candles.lastPoint();
    if (!last) return;
    const sim = new TickSimulator(last, { interval: HOUR, volatility: 0.002, seed: 3 });
    const timer = setInterval(() => {
      for (let i = 0; i < 5; i++) candles.update(sim.next(6 * 60_000));
    }, 50);
    return () => clearInterval(timer);
  }, [live, candles]);

  const grouped = useMemo(() => {
    if (!manager) return [];
    const categories = ['trend', 'momentum', 'volatility', 'volume', 'advanced'] as const;
    return categories.map((c) => [c, manager.registry.list(c)] as const);
  }, [manager]);

  return (
    <>
      <div className="toolbar">
        <select value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Indicator">
          {grouped.map(([category, list]) => (
            <optgroup key={category} label={category}>
              {list.map((d) => (
                <option key={d.type} value={d.type}>
                  {d.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <button
          disabled={!manager || !candles}
          onClick={() => manager && candles && manager.add(choice, candles)}
        >
          Add indicator
        </button>
        <button aria-pressed={live} onClick={() => setLive((v) => !v)}>
          {live ? 'Stop simulated feed' : 'Start simulated feed'}
        </button>
        <button disabled={!manager} onClick={() => manager && setSaved(manager.serialize())}>
          Save
        </button>
        <button
          disabled={!manager || !saved || !candles}
          onClick={() => {
            if (!manager || !saved || !candles) return;
            manager.clear();
            manager.restore(saved, (id) => (id === candles.id ? candles : undefined));
          }}
        >
          Restore
        </button>
      </div>
      <div className="card" style={{ marginBottom: 12 }}>
        <Chart height={620} ref={setChart}>
          <CandlestickSeries data={bars} ref={setCandles} />
          {manager ? <IndicatorLegend manager={manager} source={candles} /> : null}
        </Chart>
      </div>
      <div className="grid2">
        {manager?.list().map((handle) => (
          <div className="tile" key={handle.id}>
            <h3>
              <span>{handle.label()}</span>
              <span style={{ display: 'flex', gap: 6 }}>
                <button
                  className="link"
                  onClick={() => setOpen(open === handle.id ? null : handle.id)}
                >
                  settings
                </button>
                <button className="link" onClick={() => handle.setVisible(!handle.visible())}>
                  {handle.visible() ? 'hide' : 'show'}
                </button>
                <button className="link" onClick={() => handle.remove()}>
                  remove
                </button>
              </span>
            </h3>
            <div className="desc" style={{ margin: 0 }}>
              {handle.definition.category} · {handle.definition.placement}
            </div>
            {open === handle.id ? <ParamsForm handle={handle} /> : null}
          </div>
        ))}
      </div>
      {saved ? (
        <details style={{ marginTop: 10 }}>
          <summary className="desc">Saved configuration (plain JSON)</summary>
          <pre className="desc" style={{ whiteSpace: 'pre-wrap' }}>
            {JSON.stringify(saved, null, 2)}
          </pre>
        </details>
      ) : null}
    </>
  );
}
