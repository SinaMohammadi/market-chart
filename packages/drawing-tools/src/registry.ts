import { builtInTools } from './tools/index.js';
import type { DrawingToolCategory, DrawingToolDefinition } from './types.js';
import { DrawingError } from './types.js';

const TYPE_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export class DrawingToolRegistry {
  private readonly tools = new Map<string, DrawingToolDefinition>();

  register(
    tool: DrawingToolDefinition<never> | DrawingToolDefinition,
    options: { replace?: boolean } = {},
  ): this {
    const def = tool as DrawingToolDefinition;
    if (!def || typeof def.draw !== 'function' || typeof def.distance !== 'function') {
      throw new DrawingError('a tool needs draw() and distance() functions');
    }
    if (!TYPE_PATTERN.test(def.type)) throw new DrawingError(`invalid tool type "${def.type}"`);
    if (!Number.isInteger(def.points) || def.points < 1 || def.points > 16)
      throw new DrawingError(`${def.type}: points must be 1–16`);
    if (this.tools.has(def.type) && !options.replace)
      throw new DrawingError(`tool "${def.type}" is already registered`);
    this.tools.set(def.type, def);
    return this;
  }

  has(type: string): boolean {
    return this.tools.has(type);
  }

  get(type: string): DrawingToolDefinition {
    const tool = this.tools.get(type);
    if (!tool) throw new DrawingError(`unknown drawing tool "${type}"`);
    return tool;
  }

  list(category?: DrawingToolCategory): DrawingToolDefinition[] {
    const all = [...this.tools.values()];
    return category ? all.filter((t) => t.category === category) : all;
  }
}

export function createDefaultToolRegistry(): DrawingToolRegistry {
  const registry = new DrawingToolRegistry();
  for (const tool of builtInTools) registry.register(tool);
  return registry;
}
