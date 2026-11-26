import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { builtInTools } from '@market-chart/drawing-tools';
import { builtInIndicators } from '@market-chart/indicators';
import { builtInActions } from '@market-chart/ui';
import { PAGES } from '../pages';
import { href, navigate } from '../site';
import { headingsOf } from './Markdown';

interface Entry {
  readonly title: string;
  readonly where: string;
  readonly path: string;
  readonly anchor?: string;
  readonly text: string;
}

/** Pages, the headings of every document, indicators, drawing tools and actions. */
function staticEntries(): Entry[] {
  const out: Entry[] = [];
  for (const p of PAGES)
    out.push({ title: p.title, where: p.section, path: p.path, text: `${p.title} ${p.summary}` });
  for (const d of builtInIndicators)
    out.push({
      title: d.name,
      where: 'Indicator',
      path: '/reference/indicators',
      anchor: d.type,
      text: `${d.name} ${d.shortName} ${d.type} ${d.category} indicator`,
    });
  for (const t of builtInTools)
    out.push({
      title: t.name,
      where: 'Drawing tool',
      path: '/reference/drawing-tools',
      anchor: t.category,
      text: `${t.name} ${t.type} ${t.category} drawing tool`,
    });
  for (const a of builtInActions())
    out.push({
      title: a.id,
      where: 'Action',
      path: '/reference/actions',
      anchor: a.id,
      text: `${a.id} ${typeof a.label === 'string' ? a.label : ''} action`,
    });
  return out;
}

function score(entry: Entry, words: readonly string[]): number {
  const title = entry.title.toLowerCase();
  const text = entry.text.toLowerCase();
  let s = 0;
  for (const w of words) {
    if (title.startsWith(w)) s += 6;
    else if (title.includes(w)) s += 4;
    else if (text.includes(w)) s += 1;
    else return 0;
  }
  return s + (entry.where === 'Introduction' || entry.where === 'Packages' ? 1 : 0);
}

/** Site search: Ctrl+K or "/" focuses it; arrows and Enter pick a result. */
export function Search() {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [headings, setHeadings] = useState<Entry[]>([]);
  const input = useRef<HTMLInputElement | null>(null);
  const id = useId();
  const base = useMemo(staticEntries, []);

  // Document headings are indexed the first time search is used (the documents load on demand).
  const loaded = useRef(false);
  const loadHeadings = () => {
    if (loaded.current) return;
    loaded.current = true;
    void Promise.all(
      PAGES.filter((p) => p.markdown).map(async (p) =>
        headingsOf(await p.markdown!()).map((h): Entry => ({
          title: h.text,
          where: p.title,
          path: p.path,
          anchor: h.id,
          text: h.text,
        })),
      ),
    ).then((lists) => setHeadings(lists.flat()));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement).tagName);
      if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  const results = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return [...base, ...headings]
      .map((e) => [e, score(e, words)] as const)
      .filter(([, s]) => s > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([e]) => e);
  }, [query, base, headings]);

  const go = (e: Entry) => {
    navigate(e.path, e.anchor);
    setOpen(false);
    setQuery('');
    input.current?.blur();
  };

  return (
    <div className="search">
      <input
        ref={input}
        type="search"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={`${id}-list`}
        aria-activedescendant={results.length ? `${id}-${active}` : undefined}
        aria-label="Search the documentation"
        placeholder="Search docs  (Ctrl K)"
        value={query}
        onFocus={() => {
          loadHeadings();
          setOpen(true);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && results[active]) {
            e.preventDefault();
            go(results[active]);
          } else if (e.key === 'Escape') {
            setQuery('');
            input.current?.blur();
          }
        }}
      />
      {open && results.length ? (
        <ul className="search-results" role="listbox" id={`${id}-list`}>
          {results.map((r, i) => (
            <li
              key={`${r.path}#${r.anchor ?? ''}#${r.title}`}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                go(r);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <a href={href(r.path, r.anchor)} tabIndex={-1}>
                <span className="search-title">{r.title}</span>
                <span className="search-where">{r.where}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
