/**
 * Agent eval harness — mocked model, real tools.
 *
 * The scripted LLM emits predetermined tool calls (no live API).
 * File / policy / abort behavior goes through `callTool` + middleware,
 * the same path as GUI Agent chat.
 */

import type {
  ChatMessage,
  ContextItem,
  IDE,
  Tool,
  ToolExtras,
} from "..";
import { renderContextItems } from "../util/messageContent";
import { joinPathsToUri } from "../util/uri";
import {
  runAgentLoop,
  type AgentLoopStoppedReason,
} from "../agent/loop";
import { callTool } from "../tools/callTool";
import { BuiltInToolNames } from "../tools/builtIn";
import { ToolCallError, ToolCallErrorCode } from "../tools/errors";
import type { AgentToolPolicy } from "../tools/toolPolicy";
import type { SearchOptions } from "../protocol/ide";
import { formatSearchTruncationNotice } from "../tools/ripgrep";
import {
  applyPatchTool,
  awaitShellTool,
  buildTool,
  editFileTool,
  exactSearchTool,
  gitBlameTool,
  gitBisectTool,
  gitDiffTool,
  gitLogTool,
  gitStatusTool,
  globTool,
  kconfigTool,
  maintainersTool,
  planTool,
  qemuTool,
  readFileTool,
  runTerminalCommandTool,
  viewSubdirectoryTool,
  writeFileTool,
} from "../tools";
import {
  extractVerifiedFilePath,
  parseToolArgs,
  shouldVerifyTool,
} from "../tools/postEditVerification";
import { loadCodebaseCard } from "../context/codebaseCard";
import {
  resetRustPolicyForTests,
  rustPolicyShouldEnable,
  setRustPolicyEnabled,
  setRustUserTask,
} from "../context/rustPolicy";
import { summarizeRustEval, type RustEvalMetrics } from "./rustEvalMetrics";
import { blobTouchedUnsafe } from "../tools/rustEditGuard";
import { resolveRustIsLib } from "../tools/build/rustVerify";
import {
  attachBuildDiagnostics,
  resetBuildVerifyCircuits,
  runPostEditBuildVerify,
} from "../tools/build/verifyCommand";

export const EVAL_WORKSPACE_URI = "file:///tmp/knox-eval-ws";

export function evalFileMatchesType(rel: string, fileType?: string): boolean {
  if (!fileType) {
    return true;
  }
  const type = fileType.trim().replace(/^\./, "").toLowerCase();
  const base = rel.split("/").pop() ?? rel;
  const ext = base.includes(".")
    ? base.slice(base.lastIndexOf(".") + 1).toLowerCase()
    : "";
  if (type === "c") {
    return ext === "c" || ext === "h";
  }
  if (type === "cpp" || type === "cc") {
    return ["cc", "cpp", "cxx", "hpp", "hh", "hxx"].includes(ext);
  }
  if (type === "asm" || type === "s") {
    return ext === "s" || ext === "asm";
  }
  if (type === "make") {
    return /makefile/i.test(base) || ext === "mk";
  }
  if (type === "kconfig") {
    return base.toLowerCase().startsWith("kconfig");
  }
  if (type === "rust" || type === "rs") {
    return ext === "rs" || base.toLowerCase() === "cargo.toml";
  }
  return ext === type;
}

/** True when eval tool args are a cargo check/test/clippy/fmt (or similar) oracle. */
export function isCargoEvalCommand(args: Record<string, unknown>): boolean {
  if (typeof args.explain === "string" && args.explain.trim()) {
    return true;
  }
  if (
    args.action === "doc" ||
    args.action === "clippy" ||
    args.action === "fmt" ||
    args.action === "test" ||
    args.action === "fix" ||
    args.action === "expand" ||
    args.action === "miri" ||
    args.action === "deny" ||
    args.action === "audit" ||
    args.action === "tree" ||
    (typeof args.doc === "string" && args.doc.trim())
  ) {
    return true;
  }
  const blob = [
    args.command,
    args.target,
    args.extraArgs,
    args.extra_args,
  ]
    .filter((part): part is string => typeof part === "string")
    .join(" ");
  return /(?:^|[\s;|&])cargo\b/i.test(blob);
}

/** Minimal glob (`*`, `**`, `?`) for eval `fileGlob` / kconfig search. */
export function evalFileGlobMatches(rel: string, fileGlob?: string): boolean {
  if (!fileGlob?.trim()) {
    return true;
  }
  const pattern = fileGlob.trim().replace(/^\.\//, "").replace(/\\/g, "/");
  let regexSource = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        regexSource += ".*";
        i += 1;
        if (pattern[i + 1] === "/") {
          i += 1;
        }
      } else {
        regexSource += "[^/]*";
      }
      continue;
    }
    if (ch === "?") {
      regexSource += "[^/]";
      continue;
    }
    if ("+^${}()|[]\\.".includes(ch)) {
      regexSource += `\\${ch}`;
      continue;
    }
    regexSource += ch;
  }
  const regex = new RegExp(`^${regexSource}$`, "i");
  const base = rel.split("/").pop() ?? rel;
  return regex.test(rel) || regex.test(base);
}

export type EvalStoppedReason = AgentLoopStoppedReason;

export interface ScriptedToolCall {
  name: string;
  args: Record<string, unknown>;
  id?: string;
}

export interface ScriptedTurn {
  content?: string;
  toolCalls?: ScriptedToolCall[];
}

export interface EvalToolTrace {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  error?: string;
  output: string;
}

export interface AgentEvalResult {
  stoppedReason: EvalStoppedReason;
  steps: number;
  summary: string;
  files: Record<string, string>;
  toolTrace: EvalToolTrace[];
  /** RL-56 counters when the workspace or verifyCommand is Cargo. */
  rustMetrics?: RustEvalMetrics;
}

export interface EvalIdeHooks {
  /** Called from writeFile before the store updates. Abort here to test mid-tool cancel. */
  beforeWrite?: (uri: string) => void | Promise<void>;
  /** Intercept `ide.subprocess` (git tools). */
  subprocess?: (
    command: string,
    cwd?: string,
  ) => Promise<[string, string]> | [string, string];
}

export type EvalCommandHandler = (
  args: Record<string, unknown>,
  files: Record<string, string>,
) => Promise<ContextItem[]> | ContextItem[];

export interface AgentEvalOptions {
  prompt?: string;
  workspace: Record<string, string>;
  script: ScriptedTurn[];
  /** Cap tool→continue rounds. `null` / omit = unlimited. */
  maxSteps?: number | null;
  abortSignal?: AbortSignal;
  policy?: AgentToolPolicy | null;
  catalog?: Tool[];
  ideHooks?: EvalIdeHooks;
  /**
   * Intercept `builtin_run_terminal_command` so CI can run a test-fix loop
   * without spawning a real shell.
   */
  evaluateCommand?: EvalCommandHandler;
  /** Intercept `builtin_await_shell` (long-job goldens; no real spawn). */
  evaluateAwaitShell?: EvalCommandHandler;
  /**
   * Intercept `builtin_qemu` (panic/RIP goldens; no real qemu-system spawn).
   */
  evaluateQemu?: EvalCommandHandler;
  /**
   * After mutating edits, run this command via `evaluateCommand` (or a real
   * shell if none) and append parsed compiler diagnostics (HL-07).
   */
  verifyCommand?: string;
  /** Circuit-breaker cap for identical build error signatures. Default 8. */
  verifyMaxIterations?: number;
  /** Identical-tool / fail-streak cap. Default 3 (`null` / `0` disables). */
  doomLoopThreshold?: number | null;
  /** RL-20: no-tool "done" is not completed while cargo/compiler oracle is red. */
  holdCompletionWhileOracleRed?: boolean;
}

export const DEFAULT_EVAL_CATALOG: Tool[] = [
  readFileTool,
  editFileTool,
  writeFileTool,
  applyPatchTool,
  runTerminalCommandTool,
];

/** Product-like catalog for systems / discovery golden tasks (HL-03). */
export const SYSTEMS_EVAL_CATALOG: Tool[] = [
  ...DEFAULT_EVAL_CATALOG,
  exactSearchTool,
  globTool,
  viewSubdirectoryTool,
  awaitShellTool,
  buildTool,
  gitStatusTool,
  gitDiffTool,
  gitLogTool,
  gitBlameTool,
  gitBisectTool,
  qemuTool,
  kconfigTool,
  maintainersTool,
  planTool,
];

/** Cargo / rustc goldens (RL-13): same product tools, no qemu/kconfig. */
export const RUST_EVAL_CATALOG: Tool[] = [
  ...DEFAULT_EVAL_CATALOG,
  exactSearchTool,
  globTool,
  viewSubdirectoryTool,
  awaitShellTool,
  buildTool,
];

export function workspaceUri(relativePath: string): string {
  return joinPathsToUri(EVAL_WORKSPACE_URI, relativePath);
}

export function snapshotFiles(store: Map<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  const prefix = `${EVAL_WORKSPACE_URI.replace(/\/$/, "")}/`;
  for (const [uri, content] of store) {
    if (uri.startsWith(prefix)) {
      out[decodeURIComponent(uri.slice(prefix.length))] = content;
    } else if (uri === EVAL_WORKSPACE_URI) {
      out[""] = content;
    }
  }
  return out;
}

export function createEvalIde(
  files: Record<string, string>,
  hooks: EvalIdeHooks = {},
  abortSignal?: AbortSignal,
): { ide: IDE; store: Map<string, string> } {
  const store = new Map<string, string>();
  for (const [rel, content] of Object.entries(files)) {
    store.set(workspaceUri(rel), content);
  }

  const root = EVAL_WORKSPACE_URI.replace(/\/$/, "");

  const isDirOrRoot = (uri: string): boolean => {
    const normalized = uri.replace(/\/$/, "");
    if (normalized === root) {
      return true;
    }
    const prefix = `${normalized}/`;
    for (const key of store.keys()) {
      if (key.startsWith(prefix)) {
        return true;
      }
    }
    return false;
  };

  const ide = {
    getWorkspaceDirs: async () => [EVAL_WORKSPACE_URI],
    getCurrentFile: async () => undefined,
    getIdeInfo: async () => ({ remoteName: "local" }),
    fileExists: async (uri: string) => store.has(uri) || isDirOrRoot(uri),
    listDir: async (dirUri: string): Promise<[string, number][]> => {
      const prefix = `${dirUri.replace(/\/$/, "")}/`;
      const children = new Map<string, number>();
      for (const key of store.keys()) {
        if (!key.startsWith(prefix)) {
          continue;
        }
        const rest = key.slice(prefix.length);
        if (!rest) {
          continue;
        }
        const name = rest.split("/")[0];
        if (!name) {
          continue;
        }
        const isFile = rest === name;
        if (isFile) {
          children.set(name, 1);
        } else if (children.get(name) !== 1) {
          children.set(name, 2);
        }
      }
      return [...children.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    },
    getSearchResults: async (query: string, options?: SearchOptions) => {
      const prefix = `${root}/`;
      const max = options?.maxResults ?? 50;
      const pathFilter = options?.path?.replace(/^\.\//, "").replace(/\/$/, "");
      let regex: RegExp;
      try {
        regex = new RegExp(
          options?.pcre2 !== true && options?.fixedStrings !== false
            ? query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
            : query,
          options?.caseSensitive ? "" : "i",
        );
      } catch {
        return `Search error: invalid pattern ${query}`;
      }
      const hits: string[] = [];
      for (const [uri, content] of store) {
        if (!uri.startsWith(prefix)) {
          continue;
        }
        const rel = decodeURIComponent(uri.slice(prefix.length));
        if (pathFilter && rel !== pathFilter && !rel.startsWith(`${pathFilter}/`)) {
          continue;
        }
        if (!evalFileMatchesType(rel, options?.fileType)) {
          continue;
        }
        if (!evalFileGlobMatches(rel, options?.fileGlob)) {
          continue;
        }
        const fileLines = content.split("\n");
        for (let i = 0; i < fileLines.length; i++) {
          if (regex.test(fileLines[i])) {
            hits.push(`${rel}:${i + 1}:${fileLines[i]}`);
            if (hits.length >= max) {
              hits.push(formatSearchTruncationNotice(max));
              return hits.join("\n");
            }
          }
        }
      }
      return hits.join("\n") || "No matches found";
    },
    readFile: async (uri: string) => {
      const content = store.get(uri);
      if (content === undefined) {
        throw new Error(`missing file: ${uri}`);
      }
      return content;
    },
    writeFile: async (uri: string, contents: string) => {
      await hooks.beforeWrite?.(uri);
      if (abortSignal?.aborted) {
        throw new ToolCallError({
          code: ToolCallErrorCode.CANCELLED,
          message: "Write file cancelled",
          toolName: BuiltInToolNames.WriteFile,
          retryable: false,
        });
      }
      store.set(uri, contents);
    },
    removeFile: async (uri: string) => {
      store.delete(uri);
    },
    openFile: async () => {},
    getGitRootPath: async () => EVAL_WORKSPACE_URI,
    subprocess: async (command: string, cwd?: string) => {
      if (hooks.subprocess) {
        return hooks.subprocess(command, cwd);
      }
      return ["", "eval IDE: subprocess not configured"];
    },
  } as unknown as IDE;

  return { ide, store };
}

export function createScriptedLlm(script: ScriptedTurn[]) {
  let turn = 0;
  return {
    streamChat: async function* (
      _messages: ChatMessage[],
      signal: AbortSignal,
      options?: { tools?: Tool[] },
    ) {
      if (signal.aborted) {
        return;
      }
      const next = script[turn] ?? { content: "" };
      turn += 1;
      const toolsDisabled = !options?.tools?.length;
      if (toolsDisabled || !next.toolCalls?.length) {
        yield {
          role: "assistant" as const,
          content: next.content ?? "",
        };
        return;
      }
      yield {
        role: "assistant" as const,
        content: next.content ?? "",
        toolCalls: next.toolCalls.map((call, index) => ({
          id: call.id ?? `eval-${turn}-${index}`,
          type: "function" as const,
          index,
          function: {
            name: call.name,
            arguments: JSON.stringify(call.args),
          },
        })),
      };
    },
    model: "eval-scripted",
    title: "eval-scripted",
  };
}

/**
 * One Agent chat turn: scripted model → shared `runAgentLoop` → real `callTool`.
 * At the cap, the next stream is text-only and further tool calls are not executed.
 */
export async function runAgentEval(
  options: AgentEvalOptions,
): Promise<AgentEvalResult> {
  const { ide, store } = createEvalIde(
    options.workspace,
    options.ideHooks,
    options.abortSignal,
  );
  const catalog = options.catalog ?? DEFAULT_EVAL_CATALOG;
  const llm = createScriptedLlm(options.script);
  const toolTrace: EvalToolTrace[] = [];
  resetBuildVerifyCircuits();
  resetRustPolicyForTests();

  const extras: ToolExtras = {
    ide,
    llm: llm as unknown as ToolExtras["llm"],
    fetch: (async () => new Response()) as ToolExtras["fetch"],
    tool: catalog[0] ?? readFileTool,
    abortSignal: options.abortSignal,
  };

  const messages: ChatMessage[] = [
    { role: "system", content: "You are Knox Agent under eval. Follow the script." },
  ];
  try {
    const card = await loadCodebaseCard(ide);
    if (card) {
      messages.push({ role: "system", content: card });
      setRustPolicyEnabled(
        rustPolicyShouldEnable({
          card,
          verifyCommand: options.verifyCommand,
        }),
      );
    }
  } catch {
    // optional
  }
  const prompt = options.prompt ?? "Complete the golden task.";
  setRustUserTask(prompt);
  messages.push({
    role: "user",
    content: prompt,
  });

  try {
  const loop = await runAgentLoop({
    extras,
    messages,
    tools: catalog,
    maxSteps: options.maxSteps === undefined ? null : options.maxSteps,
    doomLoopThreshold:
      options.doomLoopThreshold === undefined
        ? undefined
        : options.doomLoopThreshold,
    holdCompletionWhileOracleRed: options.holdCompletionWhileOracleRed,
    abortOnCancelled: true,
    missingToolMessage: (name) => `Tool "${name}" is not in the eval catalog.`,
    executeTool: async (tool, args) => {
      const name = tool.function.name;
      let output: ContextItem[];
      if (
        (name === BuiltInToolNames.RunTerminalCommand ||
          name === BuiltInToolNames.Build) &&
        options.evaluateCommand
      ) {
        output = await options.evaluateCommand(args, snapshotFiles(store));
        if (name === BuiltInToolNames.Build) {
          output = attachBuildDiagnostics(output);
        }
      } else if (
        name === BuiltInToolNames.AwaitShell &&
        options.evaluateAwaitShell
      ) {
        output = await options.evaluateAwaitShell(args, snapshotFiles(store));
      } else if (name === BuiltInToolNames.Qemu && options.evaluateQemu) {
        output = attachBuildDiagnostics(
          await options.evaluateQemu(args, snapshotFiles(store)),
        );
      } else {
        output = await callTool(
          tool,
          args,
          { ...extras, tool },
          {
            retry: false,
            timeout: false,
            circuitBreaker: false,
            logging: false,
            agentPolicy: options.policy ?? null,
            workspaceDirs: [EVAL_WORKSPACE_URI],
          },
        );
      }

      if (options.verifyCommand && shouldVerifyTool(name)) {
        const parsedArgs = parseToolArgs(args) ?? {};
        const filesNow = snapshotFiles(store);
        const extra = await runPostEditBuildVerify({
          toolName: name,
          command: options.verifyCommand,
          maxIterations: options.verifyMaxIterations,
          circuitKey: `eval:${options.verifyCommand}`,
          filePath: extractVerifiedFilePath(name, args),
          cargoToml: filesNow["Cargo.toml"],
          isLib: resolveRustIsLib({
            filePath: extractVerifiedFilePath(name, args),
            cargoToml: filesNow["Cargo.toml"],
            libRsExists: Boolean(filesNow["src/lib.rs"]),
          }),
          unsafeTouched: blobTouchedUnsafe(
            [
              parsedArgs.new_string,
              parsedArgs.contents,
              parsedArgs.patch,
              parsedArgs.diff,
            ]
              .filter((part): part is string => typeof part === "string")
              .join("\n"),
          ),
          run: async (command) => {
            if (options.evaluateCommand) {
              return options.evaluateCommand(
                { command },
                snapshotFiles(store),
              );
            }
            return callTool(
              runTerminalCommandTool,
              { command },
              { ...extras, tool: runTerminalCommandTool },
              {
                retry: false,
                timeout: false,
                circuitBreaker: false,
                logging: false,
                agentPolicy: options.policy ?? null,
                workspaceDirs: [EVAL_WORKSPACE_URI],
              },
            );
          },
        });
        output = [...output, ...extra];
      }
      return output;
    },
    onStep: (step) => {
      for (const result of step.results) {
        toolTrace.push({
          name: result.name,
          args: result.args,
          ok: result.ok,
          error: result.error,
          output: renderContextItems(result.output),
        });
      }
    },
  });

  const files = snapshotFiles(store);
  const rustWorkspace =
    Boolean(files["Cargo.toml"]) ||
    /^\s*cargo\b/i.test(options.verifyCommand ?? "");
  return {
    stoppedReason: loop.stoppedReason,
    steps: loop.steps,
    summary:
      loop.summary.trim() ||
      (loop.stoppedReason === "error"
        ? `Eval error: ${loop.summary}`
        : "(no summary)"),
    files,
    toolTrace,
    rustMetrics: rustWorkspace ? summarizeRustEval({ toolTrace }) : undefined,
  };
  } finally {
    resetRustPolicyForTests();
  }
}
