/** Error thrown for invalid input passed to the public API. Messages always name the offending argument. */
export class ChartError extends Error {
  constructor(message: string) {
    super(`[market-chart] ${message}`);
    this.name = 'ChartError';
  }
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ChartError(message);
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
