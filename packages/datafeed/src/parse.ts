import { normalizeCandles } from './candles.js';
import type { NormalizeResult } from './candles.js';
import { DatafeedError } from './types.js';

/** Size limits for imported files (untrusted input). */
export interface ImportLimits {
  /** Largest accepted input in bytes (default 100 MiB; counted in UTF-16 code units for strings). */
  readonly maxBytes?: number;
  /** Most data rows accepted (default 5,000,000). */
  readonly maxRows?: number;
}

export const DEFAULT_IMPORT_MAX_BYTES = 100 * 1024 * 1024;
export const DEFAULT_IMPORT_MAX_ROWS = 5_000_000;

function checkSize(length: number, limits: ImportLimits): void {
  const max = limits.maxBytes ?? DEFAULT_IMPORT_MAX_BYTES;
  if (length > max) throw new DatafeedError(`input is larger than ${max} bytes`);
}

function checkRows(rows: number, limits: ImportLimits): void {
  const max = limits.maxRows ?? DEFAULT_IMPORT_MAX_ROWS;
  if (rows > max) throw new DatafeedError(`input has more than ${max} rows`);
}

export interface CsvOptions extends ImportLimits {
  /** Auto-detected from the first line when omitted (`,`, `;`, tab or `|`). */
  readonly delimiter?: string;
  /** Map of candle field → column name or index, overriding header detection. */
  readonly columns?: Partial<
    Record<'time' | 'open' | 'high' | 'low' | 'close' | 'volume', string | number>
  >;
}

const ALIASES: Record<string, readonly string[]> = {
  time: ['time', 'timestamp', 'date', 'datetime', 'opentime', 'open_time', 't'],
  open: ['open', 'o'],
  high: ['high', 'h'],
  low: ['low', 'l'],
  close: ['close', 'c', 'adjclose', 'adj_close', 'price', 'last'],
  volume: ['volume', 'vol', 'v'],
};

function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      out.push(field.trim());
      field = '';
    } else field += ch;
  }
  out.push(field.trim());
  return out;
}

/**
 * Parses OHLCV CSV text. Headers are matched case-insensitively against common names (time/date/timestamp,
 * open/o, …); without a header, columns are read as `time, open, high, low, close, volume`.
 */
export function parseCsv(text: string, options: CsvOptions = {}): NormalizeResult {
  if (typeof text !== 'string') throw new DatafeedError('CSV input must be a string');
  checkSize(text.length, options);
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '' && !l.trim().startsWith('#'));
  if (!lines.length) return { candles: [], dropped: 0, duplicates: 0 };
  checkRows(lines.length - 1, options);
  const delimiter =
    options.delimiter ??
    [',', ';', '\t', '|']
      .map((d) => [d, lines[0]!.split(d).length] as const)
      .sort((a, b) => b[1] - a[1])[0]![0];
  const first = splitLine(lines[0]!, delimiter);
  const hasHeader = first.some(
    (cell) => cell !== '' && Number.isNaN(Number(cell)) && Number.isNaN(Date.parse(cell)),
  );
  const header = hasHeader ? first.map((h) => h.toLowerCase().replace(/[^a-z_]/g, '')) : [];
  const index = (field: keyof typeof ALIASES, fallback: number): number => {
    const configured = options.columns?.[field as keyof NonNullable<CsvOptions['columns']>];
    if (typeof configured === 'number') return configured;
    if (typeof configured === 'string') return header.indexOf(configured.toLowerCase());
    if (!hasHeader) return fallback;
    return header.findIndex((h) => ALIASES[field]!.includes(h));
  };
  const cols = {
    time: index('time', 0),
    open: index('open', 1),
    high: index('high', 2),
    low: index('low', 3),
    close: index('close', 4),
    volume: index('volume', 5),
  };
  if (cols.time < 0 || cols.close < 0)
    throw new DatafeedError('CSV needs at least a time and a close column');
  const rows = lines.slice(hasHeader ? 1 : 0).map((line) => {
    const cells = splitLine(line, delimiter);
    const at = (i: number): string | undefined => (i >= 0 ? cells[i] : undefined);
    return {
      time: at(cols.time),
      open: at(cols.open),
      high: at(cols.high),
      low: at(cols.low),
      close: at(cols.close),
      volume: at(cols.volume),
    };
  });
  return normalizeCandles(rows);
}

/** Parses JSON candles: an array of objects/arrays, or an object with a `candles`/`data`/`bars` array. */
export function parseJsonCandles(
  input: string | unknown,
  limits: ImportLimits = {},
): NormalizeResult {
  let data: unknown;
  if (typeof input === 'string') checkSize(input.length, limits);
  try {
    data = typeof input === 'string' ? JSON.parse(input) : input;
  } catch (error) {
    throw new DatafeedError('invalid JSON', error);
  }
  if (data && !Array.isArray(data) && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    data = o['candles'] ?? o['data'] ?? o['bars'] ?? o['klines'];
  }
  if (!Array.isArray(data))
    throw new DatafeedError(
      'JSON must be an array of candles or contain a candles/data/bars array',
    );
  checkRows(data.length, limits);
  return normalizeCandles(data);
}

/**
 * Reads a user-selected file (CSV or JSON, decided by extension or content). Browser only. The file size is
 * checked before reading, so an oversized file is rejected without loading it into memory.
 */
export async function parseCandleFile(
  file: { readonly name: string; readonly size?: number; text(): Promise<string> },
  options: CsvOptions = {},
): Promise<NormalizeResult> {
  if (typeof file.size === 'number') checkSize(file.size, options);
  const text = await file.text();
  const looksJson = /\.json$/i.test(file.name) || /^\s*[[{]/.test(text);
  return looksJson ? parseJsonCandles(text, options) : parseCsv(text, options);
}
