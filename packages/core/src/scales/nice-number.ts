/** Smallest "nice" step (1, 2, 2.5, 5 × 10ⁿ) that is >= `raw`. */
export function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const exponent = Math.floor(Math.log10(raw));
  const magnitude = 10 ** exponent;
  const fraction = raw / magnitude;
  const nice =
    fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * magnitude;
}
