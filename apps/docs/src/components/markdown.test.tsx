// The docs renderer only shows the repository's own Markdown, but it must stay safe and fast for any input.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown, resolveLink } from './Markdown.js';
import { slug, storedLocale } from '../site.js';

const html = (source: string): string =>
  renderToStaticMarkup(<Markdown source={source} skipTitle={false} />);

describe('docs Markdown links (security)', () => {
  it('never renders script-capable URLs as links', () => {
    for (const url of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      ' javascript:alert(1)',
      '\u0001javascript:alert(1)',
      'java\tscript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
    ]) {
      expect(resolveLink(url)).toEqual({ url: '#/', external: false });
      const out = html(`[x](${url})`);
      expect(out).not.toMatch(/href="(?!#)/);
    }
  });
  it('keeps http(s) and mailto links external with noopener', () => {
    expect(html('[a](https://example.com/x)')).toContain(
      '<a href="https://example.com/x" target="_blank" rel="noreferrer noopener">a</a>',
    );
    expect(resolveLink('HTTPS://example.com').external).toBe(true);
    expect(resolveLink('mailto:security@example.com').external).toBe(true);
  });
  it('maps links between repository documents to their documentation pages', () => {
    const cases: [string, string][] = [
      ['docs/ADVANCED.md', '#/guides/advanced'],
      ['../../docs/ADVANCED.md#9-integrating-trading-safely', '#/guides/advanced'],
      ['LEGAL.md#trading-interfaces', '#/license'],
      ['../../SECURITY.md', '#/guides/security'],
      ['../../docs/PERFORMANCE.md', '#/guides/performance'],
      ['FEATURE_MATRIX.md', '#/status'],
      ['packages/trading', '#/packages/trading'],
      ['../trading/README.md', '#/packages/trading'],
      ['../ui', '#/packages/ui'],
    ];
    for (const [link, route] of cases) expect(resolveLink(link).url, link).toBe(route);
  });
  it('escapes markup in text, code and link labels', () => {
    const out = html('<img src=x onerror=alert(1)> `<script>` [<b>x</b>](https://e.test)');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('<script>');
    expect(out).not.toContain('<b>');
  });
});

describe('docs Markdown performance (security)', () => {
  const timed = (source: string): number => {
    const t = performance.now();
    html(source);
    return performance.now() - t;
  };
  it('renders pathological inputs in linear-ish time', () => {
    for (const source of [
      '`'.repeat(60_000),
      '['.repeat(60_000),
      '[x]('.repeat(15_000),
      '**a'.repeat(7_000),
      '<http://'.repeat(7_500),
      `# ${' '.repeat(20_000)}x`,
    ])
      expect(timed(source)).toBeLessThan(500);
  });
  it('slug strips tags without quadratic backtracking', () => {
    const t = performance.now();
    slug('<'.repeat(60_000));
    expect(performance.now() - t).toBeLessThan(200);
    expect(slug('Context <b>menus</b>')).toBe('context-menus');
  });
});

describe('docs settings from storage (security)', () => {
  it('only accepts known languages', () => {
    expect(storedLocale('fa')).toBe('fa');
    expect(storedLocale('xx-evil')).toBe('en');
    expect(storedLocale(null)).toBe('en');
  });
});
