import type { IndicatorCategory, IndicatorDefinition, InputSchema } from './types.js';
import { IndicatorError } from './types.js';

const TYPE_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/;

/** Checks a definition's internal consistency (unique outputs, fills that reference real outputs…). */
export function validateDefinition(definition: IndicatorDefinition): void {
  if (!definition || typeof definition.create !== 'function')
    throw new IndicatorError('definition must have a create() function');
  if (!TYPE_PATTERN.test(definition.type))
    throw new IndicatorError(`invalid indicator type "${definition.type}"`);
  if (!definition.outputs.length)
    throw new IndicatorError(`${definition.type}: at least one output is required`);
  const ids = new Set<string>();
  for (const output of definition.outputs) {
    if (!ID_PATTERN.test(output.id))
      throw new IndicatorError(`${definition.type}: invalid output id "${output.id}"`);
    if (ids.has(output.id))
      throw new IndicatorError(`${definition.type}: duplicate output id "${output.id}"`);
    ids.add(output.id);
  }
  for (const fill of definition.fills ?? []) {
    if (!ids.has(fill.from) || !ids.has(fill.to))
      throw new IndicatorError(`${definition.type}: fill references unknown output`);
  }
  for (const [key, spec] of Object.entries(definition.inputs)) {
    if (!ID_PATTERN.test(key))
      throw new IndicatorError(`${definition.type}: invalid input name "${key}"`);
    if (spec.type === 'enum' && !spec.options.includes(spec.default)) {
      throw new IndicatorError(`${definition.type}: default of "${key}" is not one of its options`);
    }
  }
}

/**
 * A set of indicator definitions. Registries are plain instances (no global state):
 * `createDefaultRegistry()` returns a new one pre-filled with the built-ins.
 */
export class IndicatorRegistry {
  private readonly definitions = new Map<string, IndicatorDefinition>();

  register<S extends InputSchema>(
    definition: IndicatorDefinition<S>,
    options: { replace?: boolean } = {},
  ): this {
    const def = definition as unknown as IndicatorDefinition;
    validateDefinition(def);
    if (this.definitions.has(def.type) && !options.replace) {
      throw new IndicatorError(
        `indicator "${def.type}" is already registered (pass { replace: true } to override)`,
      );
    }
    this.definitions.set(def.type, def);
    return this;
  }

  has(type: string): boolean {
    return this.definitions.has(type);
  }

  get(type: string): IndicatorDefinition {
    const definition = this.definitions.get(type);
    if (!definition)
      throw new IndicatorError(
        `unknown indicator "${type}". Registered: ${[...this.definitions.keys()].join(', ')}`,
      );
    return definition;
  }

  list(category?: IndicatorCategory): IndicatorDefinition[] {
    const all = [...this.definitions.values()];
    return category ? all.filter((d) => d.category === category) : all;
  }
}
