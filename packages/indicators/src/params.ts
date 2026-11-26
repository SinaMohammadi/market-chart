import type { InputSchema, InputSpec, IndicatorDefinition, Params } from './types.js';
import { IndicatorError, PRICE_SOURCES } from './types.js';

export function defaultParams<S extends InputSchema>(schema: S): Params<S> {
  const out: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(schema)) out[key] = spec.default;
  return out as Params<S>;
}

function checkValue(key: string, spec: InputSpec, value: unknown): unknown {
  switch (spec.type) {
    case 'int':
    case 'float': {
      if (typeof value !== 'number' || !Number.isFinite(value))
        throw new IndicatorError(`"${key}" must be a finite number`);
      if (spec.type === 'int' && !Number.isInteger(value))
        throw new IndicatorError(`"${key}" must be an integer`);
      if (spec.min !== undefined && value < spec.min)
        throw new IndicatorError(`"${key}" must be >= ${spec.min}`);
      if (spec.max !== undefined && value > spec.max)
        throw new IndicatorError(`"${key}" must be <= ${spec.max}`);
      return value;
    }
    case 'source':
      if (!PRICE_SOURCES.includes(value as never))
        throw new IndicatorError(`"${key}" must be one of ${PRICE_SOURCES.join(', ')}`);
      return value;
    case 'enum':
      if (!spec.options.includes(value as string))
        throw new IndicatorError(`"${key}" must be one of ${spec.options.join(', ')}`);
      return value;
    case 'bool':
      if (typeof value !== 'boolean') throw new IndicatorError(`"${key}" must be a boolean`);
      return value;
    case 'time':
      if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) {
        throw new IndicatorError(`"${key}" must be a timestamp (UTC ms) or null`);
      }
      return value;
  }
}

/**
 * Merges `input` over the schema defaults and validates every value. Unknown keys are rejected, so
 * imported configurations cannot smuggle extra data into a calculator.
 */
export function resolveParams<S extends InputSchema>(
  definition: IndicatorDefinition<S>,
  input?: Readonly<Record<string, unknown>>,
): Params<S> {
  const params: Record<string, unknown> = { ...defaultParams(definition.inputs) };
  if (input !== undefined) {
    if (input === null || typeof input !== 'object')
      throw new IndicatorError('params must be an object');
    for (const key of Object.keys(input)) {
      // Own keys only: `constructor`, `toString`… are not parameters, even though every object inherits them.
      const spec = Object.prototype.hasOwnProperty.call(definition.inputs, key)
        ? definition.inputs[key]
        : undefined;
      if (!spec)
        throw new IndicatorError(`unknown parameter "${key}" for indicator "${definition.type}"`);
      const value = input[key];
      if (value === undefined) continue;
      params[key] = checkValue(key, spec, value);
    }
  }
  const resolved = params as Params<S>;
  const error = definition.validate?.(resolved);
  if (error) throw new IndicatorError(`${definition.type}: ${error}`);
  return resolved;
}

/** Legend label such as `RSI 14 close`. */
export function indicatorLabel<S extends InputSchema>(
  definition: IndicatorDefinition<S>,
  params: Params<S>,
): string {
  const parts = Object.entries(definition.inputs)
    .filter(([, spec]) => spec.type !== 'bool' && spec.type !== 'time')
    .map(([key]) => String((params as Record<string, unknown>)[key]));
  return parts.length ? `${definition.shortName} ${parts.join(' ')}` : definition.shortName;
}
