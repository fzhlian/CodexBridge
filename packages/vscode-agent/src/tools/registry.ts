import type { ToolDefinition, ToolExecutionPlan } from "./types.js";

export class ToolRegistry {
  private readonly ordered: ToolDefinition[] = [];
  private readonly byId = new Map<string, ToolDefinition>();

  register(definition: ToolDefinition): void {
    if (this.byId.has(definition.id)) {
      throw new Error(`tool already registered: ${definition.id}`);
    }
    this.ordered.push(definition);
    this.byId.set(definition.id, definition);
  }

  get(toolId: string): ToolDefinition | undefined {
    return this.byId.get(toolId);
  }

  plan(commandText: string): ToolExecutionPlan {
    for (const definition of this.ordered) {
      const matched = definition.matches(commandText);
      if (matched) {
        return matched;
      }
    }
    throw new Error("no tool matched command");
  }
}
