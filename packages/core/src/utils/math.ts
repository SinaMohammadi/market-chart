export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Rounds to the nearest multiple of `step`, removing floating point noise. */
export function roundToStep(value: number, step: number): number {
  if (step <= 0) return value;
  const decimals = decimalsOf(step);
  return Number((Math.round(value / step) * step).toFixed(decimals));
}

/** Number of decimal places needed to represent `value` (capped at 12). */
export function decimalsOf(value: number): number {
  if (!Number.isFinite(value) || Number.isInteger(value)) return 0;
  const text = value.toExponential();
  const [mantissa, exp] = text.split('e') as [string, string];
  const mantissaDecimals = (mantissa.split('.')[1] ?? '').length;
  return Math.min(12, Math.max(0, mantissaDecimals - Number(exp)));
}
