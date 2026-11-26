import { useMemo, useState } from 'react';
import { ar, builtInLocales, createI18n, en, fa } from '@market-chart/i18n';
import type { Message } from '@market-chart/i18n';
import { Code } from '../components/Code';

const KEYS = Object.keys(en);
const i18n = createI18n();
const text = (m: Message | undefined): string =>
  m === undefined
    ? ''
    : typeof m === 'string'
      ? m
      : Object.entries(m)
          .map(([k, v]) => `${k}: ${v}`)
          .join(' · ');

const EXTEND = `const i18n = createI18n({ locale: 'auto' });   // the browser's language when supported
i18n.register({ code: 'de', name: 'Deutsch', englishName: 'German', direction: 'ltr', messages: { … } });
i18n.override('fa', { 'menu.resetView': 'نمای اولیه' });

<ChartProvider i18n={i18n} locale="fa">…</ChartProvider>`;

/** Generated from the dictionaries in `@market-chart/i18n`. */
export default function TranslationsReference() {
  const [query, setQuery] = useState('');
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return KEYS.filter((k) => {
      if (!q) return true;
      const all = `${k} ${text((en as Record<string, Message>)[k])} ${text((fa as Record<string, Message>)[k])} ${text((ar as Record<string, Message>)[k])}`;
      return all.toLowerCase().includes(q);
    });
  }, [query]);
  return (
    <>
      <div className="stats small-stats">
        {builtInLocales.map((l) => (
          <div key={l.code} className="stat">
            <span className="stat-value">{KEYS.length - i18n.missingKeys(l.code).length}</span>
            <span className="stat-label">
              {l.name} · {l.direction.toUpperCase()} · {i18n.missingKeys(l.code).length} missing
            </span>
          </div>
        ))}
      </div>
      <Code code={EXTEND} language="tsx" title="your own languages and texts" />
      <input
        type="search"
        className="filters"
        placeholder="Search keys or texts in any language…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search translations"
      />
      <p className="muted">{rows.length} keys</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Key</th>
              <th>English</th>
              <th>فارسی</th>
              <th>العربية</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 400).map((k) => (
              <tr key={k}>
                <td>
                  <code>{k}</code>
                </td>
                <td>{text((en as Record<string, Message>)[k])}</td>
                <td dir="rtl" lang="fa">
                  {text((fa as Record<string, Message>)[k])}
                </td>
                <td dir="rtl" lang="ar">
                  {text((ar as Record<string, Message>)[k])}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 400 ? (
        <p className="muted">Showing the first 400; refine the search.</p>
      ) : null}
    </>
  );
}
