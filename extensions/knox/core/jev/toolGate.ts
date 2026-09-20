/**
 * Semantic check on mutating / shell tool calls.
 *
 * Fail-open to allow. Policy / path allowlists still apply first.
 */

import type { PermissionMode } from "../agent/permissions";
import { BuiltInToolNames } from "../tools/builtIn";
import { createKnoxLogger } from "../util/knoxLog";
import { asNoul } from "./answers";
import { resolveJevClient } from "./client";
import { getActiveJevRuntime, getJevUserMessage } from "./config";
import {
  DESTRUCTIVE_ASK,
  TOOL_IRRELEVANT_DENY,
  WEAKENS_TESTS_WARN,
  looksDestructiveQuestion,
  pathMatchesRequestQuestion,
  toolRelevantQuestion,
  weakensTestsQuestion,
} from "./questions";
import type { JevClient, JevNoulQuestion, JevRuntime } from "./types";

const log = createKnoxLogger("jev");

const GATED_TOOLS = new Set<string>([
  BuiltInToolNames.CreateNewFile,
  BuiltInToolNames.EditFile,
  BuiltInToolNames.WriteFile,
  BuiltInToolNames.ApplyPatch,
  BuiltInToolNames.RunTerminalCommand,
  BuiltInToolNames.Build,
  BuiltInToolNames.PtyStart,
  BuiltInToolNames.PtySend,
  BuiltInToolNames.Qemu,
  BuiltInToolNames.GitCommit,
  BuiltInToolNames.GitBisect,
  BuiltInToolNames.GenerateTests,
]);

const FILE_PATH_TOOLS = new Set<string>([
  BuiltInToolNames.CreateNewFile,
  BuiltInToolNames.EditFile,
  BuiltInToolNames.WriteFile,
  BuiltInToolNames.ApplyPatch,
  BuiltInToolNames.GenerateTests,
]);

export type ToolGateAction = "allow" | "ask" | "deny";

export interface ToolGateResult {
  source: "jev" | "heuristic";
  action: ToolGateAction;
  reason: string;
}

export function shouldGateTool(toolName: string): boolean {
  return GATED_TOOLS.has(toolName);
}

/** Tell the model to pick another tool. Shared by the loop and GUI cards. */
export function formatJevDeniedMessage(reason: string): string {
  return `Blocked: ${reason}. The call was not executed. Pick a different tool that matches the user request.`;
}

function canForceAsk(permissionMode?: PermissionMode): boolean {
  return permissionMode === "default" || permissionMode === "acceptEdits";
}

function toolPath(args: Record<string, unknown>): string {
  for (const key of ["filepath", "path", "target_file", "file"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

const ALLOW: ToolGateResult = {
  source: "heuristic",
  action: "allow",
  reason: "Jev tool gate skipped",
};

export async function gateToolCall(input: {
  toolName: string;
  args?: unknown;
  toolDescription?: string;
  userMessage?: string;
  /** Destructive Noul only raises Ask when the user is not in fullAuto. */
  permissionMode?: PermissionMode;
  runtime?: JevRuntime;
  client?: JevClient;
  abortSignal?: AbortSignal;
}): Promise<ToolGateResult> {
  if (!shouldGateTool(input.toolName)) {
    return ALLOW;
  }
  const runtime = input.runtime ?? getActiveJevRuntime();
  const client = resolveJevClient(runtime, input.client);
  if (!runtime.enabled || !client) {
    return ALLOW;
  }
  const args =
    input.args && typeof input.args === "object" && !Array.isArray(input.args)
      ? (input.args as Record<string, unknown>)
      : {};
  const path = toolPath(args);
  const userMessage = (input.userMessage ?? getJevUserMessage()).slice(0, 4_000);
  const questions: Record<string, JevNoulQuestion> = {
    tool_is_relevant: toolRelevantQuestion(),
    looks_destructive: looksDestructiveQuestion(),
  };
  if (FILE_PATH_TOOLS.has(input.toolName) && path) {
    questions.path_matches_request = pathMatchesRequestQuestion();
  }
  if (/\btest|spec|_test\.|tests\//i.test(path)) {
    questions.weakens_tests = weakensTestsQuestion();
  }

  try {
    const result = await client.systemOne(
      {
        model: runtime.model,
        state: {
          user_message: userMessage,
          tool_name: input.toolName,
          tool_description: (input.toolDescription ?? "").slice(0, 400),
          tool_path: path,
          tool_arguments: JSON.stringify(args).slice(0, 2_000),
        },
        questions,
      },
      { signal: input.abortSignal, timeoutMs: runtime.timeoutMs },
    );
    const relevant = asNoul(result.answers, "tool_is_relevant")?.noul ?? 1;
    const destructive = asNoul(result.answers, "looks_destructive")?.noul ?? 0;
    const pathOk = asNoul(result.answers, "path_matches_request")?.noul;
    const weakens = asNoul(result.answers, "weakens_tests")?.noul ?? 0;

    if (relevant < TOOL_IRRELEVANT_DENY) {
      const gate: ToolGateResult = {
        source: "jev",
        action: "deny",
        reason: `tool is not relevant to the request (${relevant.toFixed(2)})`,
      };
      log.info(`tool ${input.toolName} ${gate.action}: ${gate.reason}`);
      return gate;
    }
    if (pathOk !== undefined && pathOk < TOOL_IRRELEVANT_DENY) {
      const gate: ToolGateResult = {
        source: "jev",
        action: "deny",
        reason: `tool path does not match the request (${pathOk.toFixed(2)})`,
      };
      log.info(`tool ${input.toolName} ${gate.action}: ${gate.reason}`);
      return gate;
    }
    if (destructive >= DESTRUCTIVE_ASK && canForceAsk(input.permissionMode)) {
      const gate: ToolGateResult = {
        source: "jev",
        action: "ask",
        reason: `command looks destructive (${destructive.toFixed(2)})`,
      };
      log.info(`tool ${input.toolName} ${gate.action}: ${gate.reason}`);
      return gate;
    }
    if (weakens >= WEAKENS_TESTS_WARN) {
      const gate: ToolGateResult = {
        source: "jev",
        action: "ask",
        reason: `edit may weaken tests (${weakens.toFixed(2)})`,
      };
      log.info(`tool ${input.toolName} ${gate.action}: ${gate.reason}`);
      return gate;
    }
    return {
      source: "jev",
      action: "allow",
      reason: `relevant=${relevant.toFixed(2)}`,
    };
  } catch (error) {
    if (!runtime.failOpen) {
      throw error;
    }
    log.warn(
      `tool gate failed open: ${error instanceof Error ? error.message : String(error)}`,
    );
    return ALLOW;
  }
}
