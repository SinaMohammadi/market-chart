import type { ReactNode } from 'react';
import { href, slug } from '../site';
import { Code } from './Code';

/**
 * A small Markdown renderer for the repository's own documents (READMEs, docs/*.md): headings, paragraphs,
 * lists, tables, code fences, block quotes, rules and inline code, emphasis and links. Text is rendered as
 * React text nodes, never as HTML, so nothing in a document can inject markup.
 */

/** Repository links → documentation routes (or the source on disk when there is no page). */
const LINKS: Readonly<Record<string, string>> = {
  'docs/SSR.md': '/guides/ssr',
  'SSR.md': '/guides/ssr',
  'docs/PERFORMANCE.md': '/guides/performance',
  'PERFORMANCE.md': '/guides/performance',
  'docs/ARCHITECTURE.md': '/guides/architecture',
  'ARCHITECTURE.md': '/guides/architecture',
  'docs/ADVANCED.md': '/guides/advanced',
  'ADVANCED.md': '/guides/advanced',
  'docs/PUBLISHING.md': '/guides/publishing',
  'PUBLISHING.md': '/guides/publishing',
  'docs/LEGAL.md': '/license',
  'LEGAL.md': '/license',
  'SECURITY.md': '/guides/security',
  'FEATURE_MATRIX.md': '/status',
  LICENSE: '/license',
};

/**
 * Where a Markdown link may point. Only `http(s):` and `mailto:` URLs leave the site; any other scheme
 * (`javascript:`, `data:`, `vbscript:`, `file:`…, in any letter case, with leading spaces or control
 * characters) never becomes an `href` and falls through to the internal routes below.
 */
export function resolveLink(url: string): { url: string; external: boolean } {
  // eslint-disable-next-line no-control-regex
  const trimmed = url.replace(/^[\u0000- ]+/, '');
  if (/^(https?:\/\/|mailto:)/i.test(trimmed)) return { url: trimmed, external: true };
  // eslint-disable-next-line no-control-regex
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed.replace(/[\u0000- ]/g, '')))
    return { url: href('/'), external: false };
  if (url.startsWith('#'))
    return {
      url: href(location.hash.slice(1).split('#')[0] || '/', url.slice(1)),
      external: false,
    };
  const clean = url.replace(/^(\.\.\/)+|^\.\//, '').replace(/#.*$/, '');
  const pkg =
    /(?:^|\/)?(?:packages\/)?(core|react|indicators|drawing-tools|charts|datafeed|persistence|testing|i18n|ui|trading)(?:\/README\.md)?\/?$/.exec(
      clean,
    );
  if (LINKS[clean]) return { url: href(LINKS[clean]!), external: false };
  for (const [file, route] of Object.entries(LINKS))
    if (clean.endsWith(file)) return { url: href(route), external: false };
  if (pkg && (clean.startsWith('packages/') || clean === pkg[1] || clean.endsWith('README.md')))
    return { url: href(`/packages/${pkg[1]}`), external: false };
  if (clean.startsWith('apps/playground')) return { url: href('/examples'), external: false };
  return { url: href('/'), external: false };
}

export function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  // code | link | bold | italic | autolink. Every repetition is bounded: unbounded runs (`[[[[…`, long
  // backtick runs) made matching quadratic, so a large document could freeze the page.
  const re =
    /(`{1,16})([\s\S]{0,4000}?)\1|\[([^\]\n]{1,500})\]\(([^)\s]{1,2000})(?:\s+"[^"\n]{0,200}")?\)|\*\*([^*]{1,2000})\*\*|(?<![\w*])[*_]([^*_\n]{1,2000})[*_](?![\w*])|<(https?:\/\/[^>\s]{1,2000})>/g;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(re)) {
    const index = m.index ?? 0;
    if (index > last) out.push(text.slice(last, index));
    const key = `${keyBase}-${i++}`;
    if (m[1] !== undefined) out.push(<code key={key}>{m[2]!.trim()}</code>);
    else if (m[3] !== undefined) {
      const { url, external } = resolveLink(m[4]!);
      out.push(
        <a
          key={key}
          href={url}
          {...(external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
        >
          {inline(m[3], key)}
        </a>,
      );
    } else if (m[5] !== undefined) out.push(<strong key={key}>{inline(m[5], key)}</strong>);
    else if (m[6] !== undefined) out.push(<em key={key}>{m[6]}</em>);
    else if (m[7] !== undefined)
      out.push(
        <a key={key} href={m[7]} target="_blank" rel="noreferrer noopener">
          {m[7]}
        </a>,
      );
    last = index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (row: string): string[] =>
  row
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'));

interface ListItem {
  readonly text: string;
  readonly children: string[];
}

function List({ lines, ordered, keyBase }: { lines: string[]; ordered: boolean; keyBase: string }) {
  // Group continuation and nested lines under their item.
  const items: ListItem[] = [];
  const indent = /^(\s*)/.exec(lines[0]!)![1]!.length;
  for (const line of lines) {
    const own = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (own && own[1]!.length <= indent) items.push({ text: own[2]!, children: [] });
    else if (items.length) {
      const last = items[items.length - 1]!;
      if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(line) || last.children.length) last.children.push(line);
      else (last as { text: string }).text += ` ${line.trim()}`;
    }
  }
  const Tag = ordered ? 'ol' : 'ul';
  return (
    <Tag>
      {items.map((item, i) => (
        <li key={i}>
          {inline(item.text, `${keyBase}-${i}`)}
          {item.children.length ? (
            <Blocks text={item.children.join('\n')} keyBase={`${keyBase}-${i}c`} />
          ) : null}
        </li>
      ))}
    </Tag>
  );
}

function Blocks({ text, keyBase }: { text: string; keyBase: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  let n = 0;
  const key = () => `${keyBase}-${n++}`;
  // Nested lists are indented: compare against the block's own minimum indentation.
  const base = Math.min(...lines.filter((l) => l.trim()).map((l) => /^(\s*)/.exec(l)![1]!.length));
  const at = (j: number) => (lines[j] ?? '').slice(Number.isFinite(base) ? base : 0);
  while (i < lines.length) {
    const line = at(i);
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = /^(\s*)(```+|~~~+)\s*([\w-]*)/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !at(i).trim().startsWith(fence[2]!))
        body.push(at(i++).slice(fence[1]!.length));
      i++;
      out.push(<Code key={key()} code={body.join('\n')} language={fence[3] || 'text'} />);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      const Tag = `h${Math.min(level + 0, 6)}` as 'h1';
      out.push(
        <Tag key={key()} id={slug(heading[2]!)}>
          {inline(heading[2]!, key())}
        </Tag>,
      );
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push(<hr key={key()} />);
      i++;
      continue;
    }
    if (line.startsWith('|') && /^\s*\|?\s*:?-{2,}/.test(at(i + 1))) {
      const head = cells(line);
      const align = cells(at(i + 1)).map((c) =>
        c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : undefined,
      );
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && at(i).trim().startsWith('|')) rows.push(cells(at(i++)));
      out.push(
        <div key={key()} className="table-wrap">
          <table>
            <thead>
              <tr>
                {head.map((c, j) => (
                  <th key={j} style={align[j] ? { textAlign: align[j] } : undefined}>
                    {inline(c, `${keyBase}-h${j}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, j) => (
                    <td key={j} style={align[j] ? { textAlign: align[j] } : undefined}>
                      {inline(c, `${keyBase}-${ri}-${j}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (line.startsWith('>')) {
      const body: string[] = [];
      while (i < lines.length && at(i).startsWith('>')) body.push(at(i++).replace(/^>\s?/, ''));
      out.push(
        <blockquote key={key()}>
          <Blocks text={body.join('\n')} keyBase={key()} />
        </blockquote>,
      );
      continue;
    }
    const listStart = /^(\s*)([-*+]|\d+[.)])\s+/.exec(line);
    if (listStart) {
      const ordered = /\d/.test(listStart[2]!);
      const body: string[] = [];
      while (i < lines.length) {
        const l = at(i);
        if (!l.trim()) {
          // A blank line continues the list only when the next line is indented or another item.
          const next = at(i + 1);
          if (/^\s+\S/.test(next) || /^(?:[-*+]|\d+[.)])\s+/.test(next)) {
            body.push('');
            i++;
            continue;
          }
          break;
        }
        if (body.length && !/^\s/.test(l) && !/^(?:[-*+]|\d+[.)])\s+/.test(l)) break;
        body.push(l);
        i++;
      }
      out.push(<List key={key()} lines={body} ordered={ordered} keyBase={key()} />);
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      at(i).trim() &&
      !/^(#{1,6}\s|```|~~~|>|\||(-{3,}|\*{3,})\s*$|\s*(?:[-*+]|\d+[.)])\s+)/.test(at(i))
    )
      para.push(at(i++).trim());
    if (!para.length) {
      // A line no rule matched (e.g. a stray marker): show it as text rather than looping.
      para.push(at(i++).trim());
    }
    out.push(<p key={key()}>{inline(para.join(' '), key())}</p>);
  }
  return <>{out}</>;
}

export interface MarkdownProps {
  readonly source: string;
  /** Drop the document's own `# Title` (the page shows one). */
  readonly skipTitle?: boolean;
}

export function Markdown({ source, skipTitle = true }: MarkdownProps) {
  const text = skipTitle ? source.replace(/^\s*#\s+[^\n]*\n/, '') : source;
  return (
    <div className="markdown">
      <Blocks text={text} keyBase="md" />
    </div>
  );
}

/** `## Heading` lines of a document, for the search index. */
export function headingsOf(source: string): { level: number; text: string; id: string }[] {
  const out: { level: number; text: string; id: string }[] = [];
  let fenced = false;
  for (const line of source.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const m = !fenced && /^(#{2,3})\s+(.*?)\s*#*$/.exec(line);
    if (m) out.push({ level: m[1]!.length, text: m[2]!.replace(/[`*]/g, ''), id: slug(m[2]!) });
  }
  return out;
}
