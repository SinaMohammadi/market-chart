import type { SeriesApi } from '@market-chart/core';

/** Plain-text sanitiser for application labels (from the engine; re-exported for convenience). */
export { safeText } from '@market-chart/core';
import type { I18n } from '@market-chart/i18n';
import type { ChartUiCapabilities } from './types.js';

/** True on Apple platforms (read lazily, never at import time). */
export function isApplePlatform(): boolean {
  const nav = (globalThis as { navigator?: { platform?: string; userAgent?: string } }).navigator;
  return /Mac|iPhone|iPad|iPod/.test(nav?.platform ?? nav?.userAgent ?? '');
}

export interface KeyLike {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  /** Physical key (`KeyB`, `Digit1`): used when `key` is not the letter, e.g. Alt+B gives "∫" on macOS. */
  readonly code?: string;
}

const PRINTABLE_ASCII = /^[ -~]$/;

/**
 * The letter or digit of the physical key (`KeyB` → "b", `Digit1` → "1"), or null for other codes. Used when
 * the character does not name the key: Alt on macOS (Alt+B → "∫"), non-Latin layouts (Persian, Arabic) and
 * Shift with digits (Shift+1 → "!").
 */
export function letterOfCode(code: string | undefined): string | null {
  const m = code ? /^(?:Key([A-Z])|Digit([0-9]))$/.exec(code) : null;
  return m ? (m[1] ?? m[2]!).toLowerCase() : null;
}

/**
 * The key of a keyboard event as shortcuts name it: the character, or the physical letter or digit when the
 * character does not name it (see `letterOfCode`). Lower case for single characters.
 */
export function shortcutKeyOf(event: KeyLike): string {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const physical = letterOfCode(event.code);
  if (!physical) return key;
  // Only when the character does not name a Latin key, so AZERTY's A (physical Q) still means A.
  const fromCode =
    key === 'Dead' ||
    (event.key.length === 1 && !PRINTABLE_ASCII.test(event.key)) ||
    (event.shiftKey && /^[0-9]$/.test(physical) && !/^[0-9]$/.test(key));
  return fromCode ? physical : key;
}

/** Parses `Mod+Shift+Z` style shortcuts (`Mod` = ⌘ on Apple platforms, Ctrl elsewhere). */
export function parseShortcut(shortcut: string): {
  key: string;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  mod: boolean;
} | null {
  const parts = shortcut
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return null;
  const key = parts.pop()!;
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  return {
    key,
    ctrl: mods.has('ctrl'),
    meta: mods.has('meta') || mods.has('cmd'),
    alt: mods.has('alt'),
    shift: mods.has('shift'),
    mod: mods.has('mod'),
  };
}

export function matchShortcut(
  shortcut: string,
  event: KeyLike,
  apple = isApplePlatform(),
): boolean {
  const s = parseShortcut(shortcut);
  if (!s) return false;
  const ctrl = s.ctrl || (s.mod && !apple);
  const meta = s.meta || (s.mod && apple);
  const wanted = s.key.length === 1 ? s.key.toLowerCase() : s.key;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  return (
    (key === wanted || shortcutKeyOf(event) === wanted) &&
    event.ctrlKey === ctrl &&
    event.metaKey === meta &&
    event.altKey === s.alt &&
    event.shiftKey === s.shift
  );
}

/** Human-readable shortcut for the platform (`⌘Z`, `Ctrl+Z`). */
export function formatShortcut(shortcut: string, apple = isApplePlatform()): string {
  const s = parseShortcut(shortcut);
  if (!s) return shortcut;
  const names: Record<string, string> = {
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Delete: 'Del',
    Escape: 'Esc',
  };
  const key = names[s.key] ?? (s.key.length === 1 ? s.key.toUpperCase() : s.key);
  if (apple)
    return `${s.ctrl ? '⌃' : ''}${s.alt ? '⌥' : ''}${s.shift ? '⇧' : ''}${s.meta || s.mod ? '⌘' : ''}${key}`;
  return [
    s.ctrl || s.mod ? 'Ctrl' : '',
    s.meta ? 'Win' : '',
    s.alt ? 'Alt' : '',
    s.shift ? 'Shift' : '',
    key,
  ]
    .filter(Boolean)
    .join('+');
}

/** Copies text through the application's handler or the Clipboard API. */
export async function copyText(text: string, capabilities: ChartUiCapabilities): Promise<void> {
  if (capabilities.clipboard) return capabilities.clipboard(text);
  const clipboard = (
    globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }
  ).navigator?.clipboard;
  if (!clipboard)
    throw new Error('the Clipboard API is not available; provide capabilities.clipboard');
  await clipboard.writeText(text);
}

const char = (code: number): string => String.fromCharCode(code);

/**
 * Control characters (U+0000–U+001F, U+007F), bidi controls (U+200E/F, U+202A–U+202E, U+2066–U+2069: U+202E
 * can make `report<RLO>fdp.exe` display as `reportexe.pdf`) and characters reserved in file names. Built from
 * code points so the source contains no invisible characters.
 */
const UNSAFE_FILE_CHARS = new RegExp(
  `[${char(0)}-${char(0x1f)}${char(0x7f)}${char(0x200e)}${char(0x200f)}${char(0x202a)}-${char(0x202e)}${char(0x2066)}-${char(0x2069)}<>:"/\\\\|?*]+`,
  'g',
);

/**
 * A file name that is safe on every platform and for application download handlers: path separators,
 * control and reserved characters become `_`, leading dots and trailing dots/spaces are removed, Windows
 * device names (`CON`, `NUL`, …) are prefixed, and the result is at most 120 characters (the extension is
 * kept). Names that end up empty become `download`.
 */
export function safeFileName(name: string): string {
  let clean = String(name).replace(UNSAFE_FILE_CHARS, '_');
  clean = clean.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(clean)) clean = `_${clean}`;
  if (clean.length > 120) {
    const dot = clean.lastIndexOf('.');
    const ext = dot > 0 && clean.length - dot <= 10 ? clean.slice(dot) : '';
    clean = clean.slice(0, 120 - ext.length) + ext;
  }
  return clean || 'download';
}

/** Saves a file through the application's handler or a temporary download link. The name is sanitised. */
export function downloadFile(name: string, blob: Blob, capabilities: ChartUiCapabilities): void {
  name = safeFileName(name);
  if (capabilities.download) {
    capabilities.download({ name, blob });
    return;
  }
  const doc = (globalThis as { document?: Document }).document;
  if (!doc) throw new Error('downloads need a document; provide capabilities.download');
  const url = URL.createObjectURL(blob);
  const a = doc.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  doc.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * One CSV cell, safe to open in a spreadsheet: finite numbers are written as they are; any other text that
 * starts with `=`, `+`, `-`, `@`, tab or carriage return is prefixed with `'` so it is not run as a formula
 * (CSV/formula injection), and cells with a delimiter, quote or line break are quoted.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",;\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A CSV line from cells (see {@link csvCell}). */
export function csvRow(cells: readonly unknown[]): string {
  return cells.map(csvCell).join(',');
}

/** CSV of a series (ISO time + its fields), using the column API (no object per row). */
export function seriesCsv(series: SeriesApi): string {
  const { length, times, fields } = series.columns();
  const names = Object.keys(fields);
  const lines = [csvRow(['time', ...names])];
  for (let i = 0; i < length; i++) {
    const time = new Date(times[i]!);
    // Times outside the Date range would make toISOString throw and break the whole export.
    const row: unknown[] = [Number.isNaN(time.getTime()) ? times[i] : time.toISOString()];
    for (const name of names) {
      const v = fields[name]![i]!;
      row.push(Number.isNaN(v) ? '' : v);
    }
    lines.push(csvRow(row));
  }
  return `${lines.join('\n')}\n`;
}

/** `15m` → "15 minutes" in the current language. */
export function timeframeLabel(timeframe: string, i18n: I18n): string {
  const match =
    /^(\d+)?([smhdDwWM])$/.exec(timeframe.trim()) ??
    (/^\d+$/.test(timeframe) ? [timeframe, timeframe, 'm'] : null);
  if (!match) return timeframe;
  const count = match[1] ? Number(match[1]) : 1;
  const unit = match[2]!;
  const key =
    unit === 's'
      ? 'timeframe.seconds'
      : unit === 'm'
        ? 'timeframe.minutes'
        : unit === 'h'
          ? 'timeframe.hours'
          : unit === 'd' || unit === 'D'
            ? 'timeframe.days'
            : unit === 'w' || unit === 'W'
              ? 'timeframe.weeks'
              : 'timeframe.months';
  return i18n.t(key, { count });
}
