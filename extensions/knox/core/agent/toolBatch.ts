/**
 * Shared tool-batch rules for GUI chat and `runAgentLoop` (HL-01).
 *
 * Consecutive readonly tools in one assistant turn may run concurrently.
 * Writes, missing tools, and job-kill controls stay sequential.
 */

import type { Tool } from "..";
import { BuiltInToolNames } from "../tools/builtIn";

function parseArgsRecord(args: unknown): Record<string, unknown> {
  if (args && typeof args === "object" && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }
  if (typeof args === "string") {
    const trimmed = args.trim();
    if (!trimmed) {
      return {};
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

/** `await_shell` / `pty_read` with `kill=true` mutates a job; never batch it. */
export function isAwaitShellKill(toolName: string, args: unknown): boolean {
  if (
    toolName !== BuiltInToolNames.AwaitShell &&
    toolName !== BuiltInToolNames.PtyRead
  ) {
    return false;
  }
  const parsed = parseArgsRecord(args);
  return parsed.kill === true || parsed.kill === "true";
}

export function canRunToolInParallel(
  tool: Tool | undefined,
  args?: unknown,
): boolean {
  if (!tool?.readonly) {
    return false;
  }
  return !isAwaitShellKill(tool.function.name, args);
}
