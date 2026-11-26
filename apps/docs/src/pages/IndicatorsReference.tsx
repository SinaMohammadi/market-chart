import { useMemo, useState } from 'react';
import { builtInIndicators } from '@market-chart/indicators';
import type { IndicatorDefinition } from '@market-chart/indicators';
import { Code } from '../components/Code';
import IndicatorPreview from '../demos/IndicatorPreview';
import { useRoute } from '../site';

const CATEGORIES = ['all', ...new Set(builtInIndicators.map((d) => d.category))] as const;

function inputs(d: IndicatorDefinition): string {
  return Object.entries(d.inputs)
    .map(([k, spec]) => `${k} = ${spec.default === null ? 'none' : String(spec.default)}`)
    .join(', ');
}

/** Generated from `builtInIndicators`: every row is a real definition from the package. */
export default function IndicatorsReference() {
  const { anchor } = useRoute();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [selected, setSelected] = useState<string>(
    anchor && builtInIndicators.some((d) => d.type === anchor) ? anchor : 'rsi',
  );
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return builtInIndicators.filter(
      (d) =>
        (category === 'all' || d.category === category) &&
        (!q || `${d.name} ${d.shortName} ${d.type}`.toLowerCase().includes(q)),
    );
  }, [query, category]);
  const current = builtInIndicators.find((d) => d.type === selected)!;
  return (
    <>
      <p>
        {builtInIndicators.length} indicators, calculated incrementally: realtime updates recompute
        only the last bar. Select one to preview it on synthetic data.
      </p>
      <div className="sticky-preview">
        <div className="preview-head">
          <b>{current.name}</b> <span className="badge">{current.category}</span>{' '}
          <span className="badge">
            {current.placement === 'overlay' ? 'on the price pane' : 'own pane'}
          </span>
          {current.needsVolume ? <span className="badge">needs volume</span> : null}
        </div>
        {current.description ? <p className="muted">{current.description}</p> : null}
        <IndicatorPreview type={selected} />
        <Code
          language="ts"
          title="add it"
          code={`indicators.add('${current.type}', candles, { params: { ${inputs(current)} } });\n// or in React: <Indicator type="${current.type}" source={candles} />`}
        />
      </div>
      <div className="filters">
        <input
          type="search"
          placeholder="Filter indicators…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Filter indicators"
        />
        <div className="tabs" role="tablist" aria-label="Category">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              role="tab"
              className="tab"
              aria-selected={category === c}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
      </div>
      <div className="table-wrap">
        <table className="selectable">
          <thead>
            <tr>
              <th>Indicator</th>
              <th>Type</th>
              <th>Category</th>
              <th>Inputs (defaults)</th>
              <th>Outputs</th>
            </tr>
          </thead>
          <tbody>
            {list.map((d) => (
              <tr
                key={d.type}
                id={d.type}
                aria-selected={d.type === selected}
                tabIndex={0}
                onClick={() => setSelected(d.type)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelected(d.type);
                  }
                }}
              >
                <td>
                  <b>{d.name}</b>
                </td>
                <td>
                  <code>{d.type}</code>
                </td>
                <td>{d.category}</td>
                <td className="small">{inputs(d) || '—'}</td>
                <td className="small">
                  {d.outputs.map((o) => (
                    <span key={o.id} className="swatch-label">
                      <span className="swatch" style={{ background: o.color }} />
                      {o.name}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
