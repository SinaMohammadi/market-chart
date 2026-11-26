import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { StaticChart } from './static-chart.js';

const line = Array.from({ length: 50 }, (_, i) => ({
  time: i * 1000,
  value: 100 + Math.sin(i / 5) * 10,
}));
const candles = Array.from({ length: 20 }, (_, i) => ({
  time: i,
  open: 10 + i,
  high: 12 + i,
  low: 9 + i,
  close: i % 2 ? 9 + i : 11 + i,
}));

describe('StaticChart (server rendering)', () => {
  it('renders an accessible SVG line chart', () => {
    const html = renderToString(
      <StaticChart type="line" data={line} height={120} title="Synthetic price" />,
    );
    expect(html).toContain('<svg');
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Synthetic price"');
    expect(html).toMatch(/<path[^>]+d="M0 /);
  });

  it('renders area gradients and candles', () => {
    const area = renderToString(<StaticChart type="area" data={line} height={120} />);
    expect(area).toContain('linearGradient');
    const candle = renderToString(
      <StaticChart type="candlestick" data={candles} height={120} showLastValue />,
    );
    expect((candle.match(/<rect/g) ?? []).length).toBe(20);
    expect(candle).toContain('<span');
  });

  it('is deterministic (no hydration mismatch risk)', () => {
    const a = renderToString(<StaticChart type="area" data={line} height={100} showLastValue />);
    const b = renderToString(<StaticChart type="area" data={line} height={100} showLastValue />);
    expect(a).toBe(b);
  });

  it('handles empty and malformed data', () => {
    const html = renderToString(
      <StaticChart type="line" data={[{ time: 1, value: Number.NaN }]} height={50} />,
    );
    expect(html).toContain('aria-label="Empty chart"');
  });

  it('the ssr entry only imports server-safe modules', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const allowed = new Set(['react', 'react/jsx-runtime', '@market-chart/core/static']);
    const files = readdirSync(here).filter((f) => /\.[jt]sx?$/.test(f) && !f.includes('.test.'));
    expect(files.length).toBeGreaterThan(0);
    let checked = 0;
    for (const file of files) {
      const source = readFileSync(join(here, file), 'utf8');
      for (const match of source.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g)) {
        const spec = match[1]!;
        expect(spec.startsWith('./') || allowed.has(spec)).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
