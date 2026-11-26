import { decimalsOf, roundToStep } from '../utils/math.js';

export type PriceFormat =
  | { readonly type: 'price'; readonly precision?: number; readonly minMove?: number }
  | { readonly type: 'volume'; readonly precision?: number }
  | { readonly type: 'percent'; readonly precision?: number };

export type PriceFormatterFn = (price: number) => string;

const MINUS = '−';

/** `toFixed` accepts 0–100 digits; more than 20 is never useful for prices. */
export const MAX_PRICE_PRECISION = 20;

/**
 * Precision from untrusted input (a datafeed's symbol info, a stored layout): an integer in [0, 20]. NaN,
 * non-numbers and missing values give `fallback`; out-of-range values are clamped. Without this, one bad value
 * makes `toFixed` throw a RangeError on every frame and the chart stops drawing.
 */
export function safePrecision(value: unknown, fallback = 2): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(MAX_PRICE_PRECISION, Math.max(0, Math.round(value)));
}

/** A usable `minMove`: a finite number > 0, otherwise undefined. */
function safeMinMove(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Creates a formatter for a `PriceFormat`. Formatters are pure and allocation-light. */
export function createPriceFormatter(format: PriceFormat): PriceFormatterFn {
  switch (format?.type) {
    case 'price': {
      const minMove = safeMinMove(format.minMove);
      const precision = safePrecision(
        format.precision,
        minMove !== undefined ? safePrecision(decimalsOf(minMove)) : 2,
      );
      return (price) => {
        const value = minMove ? Math.round(price / minMove) * minMove : price;
        return withSign(value, Math.abs(value).toFixed(precision));
      };
    }
    case 'percent': {
      const precision = safePrecision(format.precision);
      return (value) => `${withSign(value, Math.abs(value).toFixed(precision))}%`;
    }
    case 'volume': {
      const precision = safePrecision(format.precision);
      return (value) => withSign(value, compact(Math.abs(value), precision));
    }
    default:
      // An unknown type (e.g. from a stored layout) formats like the default price format.
      return createPriceFormatter({ type: 'price', precision: 2 });
  }
}

function withSign(value: number, abs: string): string {
  // Avoid "−0.00" for values that round to zero.
  return value < 0 && Number(abs.replace(/[^0-9.]/g, '')) !== 0 ? `${MINUS}${abs}` : abs;
}

function compact(value: number, precision: number): string {
  const units: readonly [number, string][] = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];
  for (const [size, suffix] of units) {
    if (value >= size) return `${trimZeros((value / size).toFixed(precision))}${suffix}`;
  }
  return trimZeros(value.toFixed(value >= 100 ? 0 : precision));
}

function trimZeros(text: string): string {
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}

/**
 * Tick size of a price format: its `minMove` when set (and valid), otherwise one unit of its `precision`
 * (two decimals by default). Used to round prices the user points at (price actions, dragged order lines).
 */
export function priceTickSize(format: PriceFormat | undefined | null): number {
  if (format?.type === 'price') {
    const minMove = safeMinMove(format.minMove);
    if (minMove !== undefined) return minMove;
  }
  return 10 ** -safePrecision(format?.precision, 2);
}

/**
 * Rounds `price` to the nearest multiple of `tick` without binary-fraction noise (1.1 stays 1.1). A tick that
 * is not a positive finite number leaves the price unchanged; a non-finite price gives NaN.
 */
export function roundToTick(price: number, tick: number): number {
  if (!Number.isFinite(price)) return Number.NaN;
  if (!(tick > 0) || !Number.isFinite(tick)) return price;
  return roundToStep(price, tick);
}
