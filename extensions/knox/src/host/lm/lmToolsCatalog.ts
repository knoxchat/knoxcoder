import { allTools } from "core/tools";
import type { Tool } from "core";

export type KnoxLmToolContribution = {
  name: string;
  displayName: string;
  modelDescription: string;
  userDescription: string;
  inputSchema?: Record<string, unknown>;
  readonly: boolean;
  tags: string[];
};

export function knoxLmToolContributions(
  tools: Tool[] = allTools,
): KnoxLmToolContribution[] {
  return tools.map((tool) => ({
    name: tool.function.name,
    displayName: tool.displayTitle,
    modelDescription: tool.function.description ?? tool.displayTitle,
    userDescription: tool.displayTitle,
    inputSchema: tool.function.parameters,
    readonly: tool.readonly,
    tags: ["knox", tool.readonly ? "readonly" : "mutating"],
  }));
}

export function knoxLmToolNames(tools: Tool[] = allTools): string[] {
  return knoxLmToolContributions(tools).map((tool) => tool.name);
}
