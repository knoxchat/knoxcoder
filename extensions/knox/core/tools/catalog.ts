/**
 * Dynamic product catalog (HL-46): keep builtin_debug off ordinary app
 * tool lists; expose it for systems work or an active DAP session.
 */

import type { IDE, Tool } from "..";
import { BuiltInToolNames } from "./builtIn";
import { debugTool } from "./definitions/debug";

export function shouldIncludeDebugTool(opts: {
  systems?: boolean;
  debugSessionActive?: boolean;
}): boolean {
  return Boolean(opts.systems || opts.debugSessionActive);
}

export function selectAgentTools(
  base: Tool[],
  opts: {
    systems?: boolean;
    debugSessionActive?: boolean;
  } = {},
): Tool[] {
  const tools = base.filter(
    (tool) => tool.function.name !== BuiltInToolNames.Debug,
  );
  if (shouldIncludeDebugTool(opts)) {
    tools.push(debugTool);
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
