/**
 * Dynamic product catalog (HL-46): keep builtin_debug off ordinary app
 * tool lists; expose it for systems work or an active DAP session.
 */

import type { IDE, Tool } from "..";
import { BuiltInToolNames } from "./builtIn";
import { debugTool } from "./definitions/debug";
import { compositeTools } from "./definitions/composite";

export function shouldIncludeDebugTool(opts: {
  systems?: boolean;
  debugSessionActive?: boolean;
}): boolean {
  return Boolean(opts.systems || opts.debugSessionActive);
}

export function isCompositeToolName(name: string): boolean {
  return name.startsWith("composite_");
}

export function selectAgentTools(
  base: Tool[],
  opts: {
    systems?: boolean;
    debugSessionActive?: boolean;
    /** Default false: composites stay off the model catalog. */
    enableCompositeTools?: boolean;
  } = {},
): Tool[] {
  const tools = base.filter((tool) => {
    if (tool.function.name === BuiltInToolNames.Debug) {
      return false;
    }
    if (!opts.enableCompositeTools && isCompositeToolName(tool.function.name)) {
      return false;
    }
    return true;
  });
  if (shouldIncludeDebugTool(opts)) {
    tools.push(debugTool);
  }
  if (opts.enableCompositeTools) {
    for (const tool of compositeTools) {
      if (!tools.some((existing) => existing.function.name === tool.function.name)) {
        tools.push(tool);
      }
    }
  }
  return tools;
}

/**
 * Product catalog for a child agent / Core path: same gate as GUI chat
 * (systems profile or a live DAP session).
 */
export async function resolveProductAgentTools(
  base: Tool[],
  opts: {
    systems?: boolean;
    ide?: Pick<IDE, "debugControl">;
  } = {},
): Promise<Tool[]> {
  let debugSessionActive = false;
  try {
    const status = await opts.ide?.debugControl?.({ op: "status" });
    debugSessionActive = Boolean(status?.sessionActive);
  } catch {
    debugSessionActive = false;
  }
  return selectAgentTools(base, {
    systems: opts.systems,
    debugSessionActive,
  });
}
