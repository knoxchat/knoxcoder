import { ContextItem, Tool, ToolExtras } from "..";
import { canParseUrl } from "../util/url";

import { BuiltInToolNames } from "./builtIn";
import { ToolCallError, ToolCallErrorCode } from "./errors";
import {
  executeToolWithMiddleware,
  ToolCallMiddlewareOptions,
} from "./middleware";
import { createNewFileImpl } from "./implementations/createNewFile";
import { editFileImpl } from "./implementations/editFile";
import { writeFileImpl } from "./implementations/writeFile";
import { applyPatchImpl } from "./implementations/applyPatch";
import { exactSearchImpl } from "./implementations/exactSearch";
import { globImpl } from "./implementations/glob";
import { readCurrentlyOpenFileImpl } from "./implementations/readCurrentlyOpenFile";
import { readFileImpl } from "./implementations/readFile";
import { runTerminalCommandImpl } from "./implementations/runTerminalCommand";
import { buildImpl } from "./implementations/build";
import { awaitShellImpl } from "./implementations/awaitShell";
import {
  ptyReadImpl,
  ptySendImpl,
  ptyStartImpl,
} from "./implementations/pty";
import { searchWebImpl } from "./implementations/searchWeb";
import { viewDiffImpl } from "./implementations/viewDiff";
import { viewRepoMapImpl } from "./implementations/viewRepoMap";
import { viewSubdirectoryImpl } from "./implementations/viewSubdirectory";
import { enhancedSearchImpl, intelligentChainImpl } from "./implementations/enhancedTools";
import { skillImpl } from "./implementations/skill";
import { lspImpl } from "./implementations/lsp";
import { memoryImpl } from "./implementations/memory";
import { memoryGraphImpl } from "./implementations/memoryGraph";
import { memorySessionsImpl } from "./implementations/memorySessions";
import { memoryManageImpl } from "./implementations/memoryManage";
import { memoryLearnImpl } from "./implementations/memoryLearn";
import { generateTestsImpl } from "./implementations/generateTests";
import { taskImpl } from "./implementations/task";
import { askUserImpl } from "./implementations/askUser";
import {
  gitBlameImpl,
  gitCommitImpl,
  gitDiffImpl,
  gitLogImpl,
  gitStatusImpl,
} from "./implementations/git";
import { gitBisectImpl } from "./implementations/gitBisect";
import { qemuImpl } from "./implementations/qemu";
import { debugImpl } from "./implementations/debug";
import { kconfigImpl } from "./implementations/kconfig";
import { maintainersImpl } from "./implementations/maintainers";
import { workspaceCheckpointImpl } from "./implementations/workspaceCheckpoint";
import { planImpl } from "./implementations/plan";
import { compositeImplementations } from "./implementations/composite";

// ─── HTTP Tool Caller ────────────────────────────────────────────────────────

/** Built-in + composite tool names that have a real `callTool` implementation. */
export function hasToolImplementation(toolName: string): boolean {
  if (Object.values(BuiltInToolNames).includes(toolName as BuiltInToolNames)) {
    return true;
  }
  return Object.prototype.hasOwnProperty.call(
    compositeImplementations,
    toolName,
  );
}

export function listImplementedToolNames(): string[] {
  return [
    ...Object.values(BuiltInToolNames),
    ...Object.keys(compositeImplementations),
  ];
}

async function callHttpTool(
  url: string,
  args: any,
  extras: ToolExtras,
): Promise<ContextItem[]> {
  const response = await extras.fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      arguments: args,
    }),
  });

  if (!response.ok) {
    throw new ToolCallError({
      code: ToolCallErrorCode.NETWORK_ERROR,
      message: `HTTP tool call failed with status ${response.status}: ${url}`,
      toolName: url,
      retryable: response.status >= 500 || response.status === 429,
      context: { url, status: response.status, statusText: response.statusText },
    });
  }

  const data = await response.json();
  return data.output;
}

// ─── URI-Based Tool Dispatch ─────────────────────────────────────────────────

async function callToolFromUri(
  uri: string,
  args: any,
  extras: ToolExtras,
): Promise<ContextItem[]> {
  const parseable = canParseUrl(uri);
  if (!parseable) {
    throw new ToolCallError({
      code: ToolCallErrorCode.INVALID_URI,
      message: `Invalid tool URI: ${uri}`,
      toolName: uri,
      retryable: false,
      context: { uri },
    });
  }
  const parsedUri = new URL(uri);

  switch (parsedUri?.protocol) {
    case "http:":
    case "https:":
      return callHttpTool(uri, args, extras);
    default:
      throw new ToolCallError({
        code: ToolCallErrorCode.INVALID_URI,
        message: `Unsupported protocol: ${parsedUri?.protocol}`,
        toolName: uri,
        retryable: false,
        context: { protocol: parsedUri?.protocol },
      });
  }
}

// ─── Built-In Tool Implementation Router ─────────────────────────────────────

/**
 * Route a built-in tool call to its implementation.
 * This is the raw execution — NO middleware applied here.
 */
function routeBuiltInTool(
  uri: string,
  args: any,
  extras: ToolExtras,
): Promise<ContextItem[]> {
  switch (uri) {
    case BuiltInToolNames.ReadFile:
      return readFileImpl(args, extras);
    case BuiltInToolNames.CreateNewFile:
      return createNewFileImpl(args, extras);
    case BuiltInToolNames.EditFile:
      return editFileImpl(args, extras);
    case BuiltInToolNames.WriteFile:
      return writeFileImpl(args, extras);
    case BuiltInToolNames.ApplyPatch:
      return applyPatchImpl(args, extras);
    case BuiltInToolNames.ExactSearch:
      return exactSearchImpl(args, extras);
    case BuiltInToolNames.RunTerminalCommand:
      return runTerminalCommandImpl(args, extras);
    case BuiltInToolNames.Build:
      return buildImpl(args, extras);
    case BuiltInToolNames.AwaitShell:
      return awaitShellImpl(args, extras);
    case BuiltInToolNames.PtyStart:
      return ptyStartImpl(args, extras);
    case BuiltInToolNames.PtySend:
      return ptySendImpl(args, extras);
    case BuiltInToolNames.PtyRead:
      return ptyReadImpl(args, extras);
    case BuiltInToolNames.SearchWeb:
      return searchWebImpl(args, extras);
    case BuiltInToolNames.ViewDiff:
      return viewDiffImpl(args, extras);
    case BuiltInToolNames.ViewRepoMap:
      return viewRepoMapImpl(args, extras);
    case BuiltInToolNames.ViewSubdirectory:
      return viewSubdirectoryImpl(args, extras);
    case BuiltInToolNames.Glob:
      return globImpl(args, extras);
    case BuiltInToolNames.ReadCurrentlyOpenFile:
      return readCurrentlyOpenFileImpl(args, extras);
    case BuiltInToolNames.EnhancedSearch:
      return enhancedSearchImpl(args, extras);
    case BuiltInToolNames.IntelligentChain:
      return intelligentChainImpl(args, extras);
    case BuiltInToolNames.Skill:
      return skillImpl(args, extras);
    case BuiltInToolNames.Lsp:
      return lspImpl(args, extras);
    case BuiltInToolNames.Memory:
      return memoryImpl(args, extras);
    case BuiltInToolNames.MemoryGraph:
      return memoryGraphImpl(args, extras);
    case BuiltInToolNames.MemorySessions:
      return memorySessionsImpl(args, extras);
    case BuiltInToolNames.MemoryManage:
      return memoryManageImpl(args, extras);
    case BuiltInToolNames.MemoryLearn:
      return memoryLearnImpl(args, extras);
    case BuiltInToolNames.GenerateTests:
      return generateTestsImpl(args, extras);
    case BuiltInToolNames.Task:
      return taskImpl(args, extras);
    case BuiltInToolNames.AskUser:
      return askUserImpl(args, extras);
    case BuiltInToolNames.GitStatus:
      return gitStatusImpl(args, extras);
    case BuiltInToolNames.GitDiff:
      return gitDiffImpl(args, extras);
    case BuiltInToolNames.GitLog:
      return gitLogImpl(args, extras);
    case BuiltInToolNames.GitBlame:
      return gitBlameImpl(args, extras);
    case BuiltInToolNames.GitCommit:
      return gitCommitImpl(args, extras);
    case BuiltInToolNames.GitBisect:
      return gitBisectImpl(args, extras);
    case BuiltInToolNames.Qemu:
      return qemuImpl(args, extras);
    case BuiltInToolNames.Debug:
      return debugImpl(args, extras);
    case BuiltInToolNames.Kconfig:
      return kconfigImpl(args, extras);
    case BuiltInToolNames.Maintainers:
      return maintainersImpl(args, extras);
    case BuiltInToolNames.WorkspaceCheckpoint:
      return workspaceCheckpointImpl(args, extras);
    case BuiltInToolNames.Plan:
      return planImpl(args, extras);
    default: {
      const compositeImpl = compositeImplementations[uri];
      if (compositeImpl) {
        return compositeImpl(args, extras);
      }
      return callToolFromUri(uri, args, extras);
    }
  }
}

// ─── Raw Call Tool (No Middleware) ────────────────────────────────────────────

/**
 * Execute a tool call WITHOUT middleware.
 * Used internally by the orchestration layer which applies its own retry/timeout.
 */
export async function callToolRaw(
  tool: Tool,
  args: any,
  extras: ToolExtras,
): Promise<ContextItem[]> {
  const uri = tool.uri ?? tool.function.name;
  return routeBuiltInTool(uri, args, extras);
}

// ─── Enterprise-Grade Call Tool (With Middleware) ─────────────────────────────

/**
 * Execute a tool call WITH full enterprise middleware stack:
 * - Argument parsing & repair
 * - Input validation
 * - Circuit breaker
 * - Timeout enforcement
 * - Retry with exponential backoff + jitter
 * - File write locking
 * - Structured error handling
 * - Performance metrics & logging
 *
 * This is the primary entry point for external callers (core.ts, GUI, etc.)
 */
export async function callTool(
  tool: Tool,
  args: any,
  extras: ToolExtras,
  middlewareOptions?: Partial<ToolCallMiddlewareOptions>,
): Promise<ContextItem[]> {
  return executeToolWithMiddleware(
    (t, a, e) => {
      const uri = t.uri ?? t.function.name;
      return routeBuiltInTool(uri, a, e);
    },
    tool,
    args,
    extras,
    middlewareOptions,
  );
}
