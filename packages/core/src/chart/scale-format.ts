import { createPriceFormatter } from '../format/price-format.js';
import type { PriceFormatterFn } from '../format/price-format.js';
import type { PriceScale } from '../scales/price-scale.js';

const percentFormatter = createPriceFormatter({ type: 'percent', precision: 2 });
const indexFormatter = createPriceFormatter({ type: 'price', precision: 2 });
export const defaultPriceFormatter = createPriceFormatter({ type: 'price', precision: 2 });

/** Formats a value in the scale's display space (what `PriceScale.ticks()` returns). */
export function tickFormatter(
  scale: PriceScale,
  priceFormatter: PriceFormatterFn,
): PriceFormatterFn {
  switch (scale.mode) {
    case 'percentage':
      return percentFormatter;
    case 'indexed':
      return indexFormatter;
    default:
      return priceFormatter;
  }
}

/** Formats a raw price as shown on `scale` (price, percent change or index). */
export function priceFormatterFor(
  scale: PriceScale,
  priceFormatter: PriceFormatterFn,
): PriceFormatterFn {
  if (scale.mode === 'normal' || scale.mode === 'logarithmic') return priceFormatter;
  const display = tickFormatter(scale, priceFormatter);
  return (price) => display(scale.transform(price));
}

/** Formats the value at `y` on `scale`, or null when the scale is empty. */
export function coordinateFormatter(
  scale: PriceScale,
  priceFormatter: PriceFormatterFn,
): (y: number) => string | null {
  const display = tickFormatter(scale, priceFormatter);
  return (y) => {
    const value = scale.coordinateToValue(y);
    if (!Number.isFinite(value)) return null;
    return display(scale.mode === 'logarithmic' ? 10 ** value : value);
  };
}
