import { useMemo, useState } from 'react';
import { defaultChartOptions } from '@market-chart/core';
import { Code } from '../components/Code';

interface Row {
  readonly path: string;
  readonly depth: number;
  readonly value: unknown;
  readonly group: boolean;
}

function flatten(value: unknown, path: string, depth: number, out: Row[]): Row[] {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (path) out.push({ path, depth, value, group: true });
    for (const [k, v] of Object.entries(value))
      flatten(v, path ? `${path}.${k}` : k, depth + 1, out);
  } else out.push({ path, depth, value, group: false });
  return out;
}

const ROWS = flatten(defaultChartOptions, '', 0, []);

const show = (v: unknown): string =>
  typeof v === 'string' ? `'${v}'` : Array.isArray(v) ? JSON.stringify(v) : String(v);

/** Generated from `defaultChartOptions`: the engine's real defaults. */
export default function OptionsReference() {
  const [query, setQuery] = useState('');
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? ROWS.filter((r) => !r.group && r.path.toLowerCase().includes(q)) : ROWS;
  }, [query]);
  return (
    <>
      <p>
        Pass any subset to <code>createChart(element, options)</code>,{' '}
        <code>&lt;Chart options&gt;</code> or <code>chart.applyOptions()</code>; everything else
        keeps its default. Options are validated, and an invalid value throws with the option&apos;s
        path.
      </p>
      <Code
        language="ts"
        title="example"
        code={`chart.applyOptions({\n  crosshair: { mode: 'magnet' },\n  localization: { locale: 'fa-IR', direction: 'rtl', localizeNumbers: true },\n  timeScale: { rightOffset: 8 },\n});`}
      />
      <input
        type="search"
        className="filters"
        placeholder="Filter options…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Filter options"
      />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Option</th>
              <th>Default</th>
              <th>Type</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.path} className={r.group ? 'group-row' : undefined}>
                <td style={{ paddingInlineStart: `${(query ? 0 : r.depth - 1) * 16 + 8}px` }}>
                  <code>{query ? r.path : r.path.split('.').pop()}</code>
                </td>
                <td>{r.group ? '' : <code>{show(r.value)}</code>}</td>
                <td className="small">
                  {r.group ? 'object' : r.value === null ? 'null' : typeof r.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
