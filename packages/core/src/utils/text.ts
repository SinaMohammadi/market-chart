const char = (code: number): string => String.fromCharCode(code);

/**
 * Control (U+0000–U+001F, U+007F–U+009F) and bidi control characters (U+200E/F, U+202A–U+202E,
 * U+2066–U+2069). Built from code points so the source contains no invisible characters.
 */
const UNSAFE_TEXT_CHARS = new RegExp(
  `[${char(0)}-${char(0x1f)}${char(0x7f)}-${char(0x9f)}${char(0x200e)}${char(0x200f)}${char(0x202a)}-${char(0x202e)}${char(0x2066)}-${char(0x2069)}]+`,
  'g',
);

/**
 * Application text for labels drawn on the chart or shown in an interface (symbol names, order labels):
 * any value becomes a string, runs of control and bidi-control characters become one space (so a label cannot
 * reorder the text around it or break a line), the result is trimmed and cut to `maxLength` characters (with
 * an ellipsis). Canvas and React render it as text; this does not, and need not, escape HTML.
 */
export function safeText(value: unknown, maxLength = 120): string {
  if (value === null || value === undefined) return '';
  const text = String(value).replace(UNSAFE_TEXT_CHARS, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1))}…` : text;
}
