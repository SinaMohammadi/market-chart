/** Parses #rgb, #rrggbb, #rrggbbaa, rgb() and rgba(). Returns null for other formats. */
export function parseColor(color: string): [number, number, number] | null {
  const c = color.trim();
  if (c.startsWith('#')) {
    const hex = c.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      return [0, 1, 2].map((i) => parseInt(hex[i]! + hex[i]!, 16)) as [number, number, number];
    }
    if (hex.length === 6 || hex.length === 8) {
      return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
    }
    return null;
  }
  const match = /^rgba?\(([^)]+)\)$/i.exec(c);
  if (!match) return null;
  const parts = match[1]!
    .split(/[\s,/]+/)
    .filter(Boolean)
    .slice(0, 3)
    .map(Number);
  return parts.length === 3 && parts.every(Number.isFinite)
    ? (parts as [number, number, number])
    : null;
}

/** Black or white, whichever reads better on `background`. */
export function contrastText(background: string): string {
  const rgb = parseColor(background);
  if (!rgb) return '#ffffff';
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.4 ? '#131722' : '#ffffff';
}
