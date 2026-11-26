import { describe, expect, it } from 'vitest';
import type { SeriesApi } from '@market-chart/core';
import {
  csvCell,
  csvRow,
  downloadFile,
  iconPath,
  registerIcon,
  safeFileName,
  seriesCsv,
  validateUiPreferences,
} from './index.js';

describe('CSV export (security)', () => {
  it('neutralises spreadsheet formulas and quotes special cells', () => {
    for (const evil of ['=HYPERLINK("http://x")', '+1+1', '-2+3', '@SUM(A1)', '\tcmd', '\rcmd'])
      expect(csvCell(evil).replace(/^"/, '').startsWith("'")).toBe(true);
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell(-1.5)).toBe('-1.5');
    expect(csvCell(Number.NaN)).toBe('');
    expect(csvRow(['time', '=cmd', 3])).toBe("time,'=cmd,3");
  });

  it('escapes field names and survives times outside the Date range', () => {
    const series = {
      columns: () => ({
        length: 2,
        times: new Float64Array([Date.UTC(2024, 0, 1), 1e17]),
        fields: {
          '=cmd|"/c calc"!A1': new Float64Array([1, Number.NaN]),
          close: new Float64Array([-2, 3]),
        },
      }),
    } as unknown as SeriesApi;
    const csv = seriesCsv(series);
    expect(csv.split('\n')[0]).toBe(`time,"'=cmd|""/c calc""!A1",close`);
    expect(csv.split('\n')[1]).toBe('2024-01-01T00:00:00.000Z,1,-2');
    expect(csv.split('\n')[2]).toBe('100000000000000000,,3');
  });
});

describe('download names (security)', () => {
  it('removes path, control and reserved characters', () => {
    expect(safeFileName('../../etc/passwd')).toBe('_.._etc_passwd');
    expect(safeFileName('chart\u0000\u001f\u202e.csv')).toBe('chart_.csv');
    expect(safeFileName('report\u202efdp.exe')).toBe('report_fdp.exe');
    expect(safeFileName('a<b>c:d"e|f?g*h\\i.png')).toBe('a_b_c_d_e_f_g_h_i.png');
    expect(safeFileName('CON.csv')).toBe('_CON.csv');
    expect(safeFileName('...')).toBe('download');
    const long = safeFileName(`${'x'.repeat(500)}.csv`);
    expect(long).toHaveLength(120);
    expect(long.endsWith('.csv')).toBe(true);
  });
  it('downloadFile passes the sanitised name to the application handler', () => {
    const names: string[] = [];
    downloadFile('../secret/chart-data-a/b.csv', new Blob(['x']), {
      download: ({ name }) => void names.push(name),
    });
    expect(names).toEqual(['_secret_chart-data-a_b.csv']);
  });
});

describe('icons (security)', () => {
  it('never returns inherited members as path data', () => {
    const dot = iconPath('dot');
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty'])
      expect(iconPath(name)).toBe(dot);
  });
  it('rejects prototype names, markup and oversized paths', () => {
    expect(() => registerIcon('__proto__', 'M0 0')).toThrow(/invalid icon name/);
    expect(() => registerIcon('constructor', 'M0 0')).toThrow(/invalid icon name/);
    expect(() => registerIcon('x', 'M0 0"/><script>alert(1)</script>')).toThrow(/path data/);
    expect(() => registerIcon('x', `M0 0${' L1 1'.repeat(5000)}`)).toThrow(/path data/);
    registerIcon('custom-ok', 'M0 0L1 1');
    expect(iconPath('custom-ok')).toBe('M0 0L1 1');
  });
});

describe('stored preferences (security)', () => {
  it('bounds entries and locale length', () => {
    const actions = Object.fromEntries(
      Array.from({ length: 2000 }, (_, i) => [`a${i}`, { visible: false }]),
    );
    const p = validateUiPreferences({
      version: 2,
      actions,
      shortcuts: Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`s${i}`, 'X'])),
      contextMenu: { hidden: Array.from({ length: 2000 }, (_, i) => `h${i}`) },
      locale: `en${'-abcdefgh'.repeat(50)}`,
    });
    expect(Object.keys(p.actions)).toHaveLength(500);
    expect(Object.keys(p.shortcuts)).toHaveLength(500);
    expect(p.contextMenu.hidden).toHaveLength(500);
    expect(p.locale).toBeNull();
    expect(validateUiPreferences({ version: 2, locale: 'fa-IR' }).locale).toBe('fa-IR');
  });
  it('drops prototype keys from stored actions', () => {
    const p = validateUiPreferences(
      JSON.parse('{"version":2,"actions":{"__proto__":{"visible":false},"ok":{"visible":true}}}'),
    );
    expect(Object.keys(p.actions)).toEqual(['ok']);
    expect(({} as Record<string, unknown>)['visible']).toBeUndefined();
  });
});
