/**
 * Headless agent run (K-029): `knox run "<task>"` for CI and scripting.
 *
 * Runs the shared `runAgentLoop` against a real directory with a
 * non-interactive permission policy: whatever the mode would ask about is
 * denied (nobody is there to answer), and hard-policy denies always apply.
 */

import type { ChatMessage, ContextItem, Tool, ToolExtras } from "..";
import {
  runAgentLoop,
  type AgentLoopStoppedReason,
} from "../agent/loop";
import {
  isHardPolicyDeny,
  isToolAutoApproved,
  type PermissionMode,
  type ToolSetting,
} from "../agent/permissions";
import { buildSystemPrompt } from "../llm/systemPrompt";
import { callTool } from "../tools/callTool";
import {
  applyPatchTool,
  editFileTool,
  exactSearchTool,
  globTool,
  readFileTool,
  runTerminalCommandTool,
  viewSubdirectoryTool,
  writeFileTool,
  buildTool,
  kconfigTool,
  maintainersTool,
  qemuTool,
} from "../tools";
import type { AgentToolPolicy } from "../tools/toolPolicy";
import { getWorkspaceHookRunner } from "../hooks/workspaceHooks";
import type { HookRunner } from "../hooks/hooks";
import { loadProjectInstructions } from "../config/rules";
import { mergeAgentToolPolicies } from "../tools/toolPolicy";
import { renderContextItems } from "../util/messageContent";
import { createNodeIde } from "./nodeIde";
import { pathToFileURL } from "node:url";
import path from "node:path";

export const HEADLESS_CATALOG: Tool[] = [
  readFileTool,
  editFileTool,
  writeFileTool,
  applyPatchTool,
  runTerminalCommandTool,
  exactSearchTool,
  globTool,
  viewSubdirectoryTool,
];

/** Exit codes: 0 done, 1 error, 2 step cap / doom loop, 130 aborted. */
export function exitCodeFor(reason: AgentLoopStoppedReason): number {
  switch (reason) {
    case "completed":
      return 0;
    case "error":
      return 1;
    case "aborted":
      return 130;
    default:
      return 2;
  }
}

export type HeadlessProfile = "default" | "systems";

/** `--profile systems` adds the kernel/firmware tools that need no live PTY. */
export function catalogForProfile(profile: HeadlessProfile = "default"): Tool[] {
  return profile === "systems"
    ? [...HEADLESS_CATALOG, buildTool, kconfigTool, maintainersTool, qemuTool]
    : HEADLESS_CATALOG;
}

export type HeadlessPermission = "default" | "acceptEdits" | "fullAuto";

export interface HeadlessOptions {
  task: string;
  workspaceDir: string;
  llm: ToolExtras["llm"];
  permission?: HeadlessPermission;
  profile?: HeadlessProfile;
  maxSteps?: number | null;
  systemPrompt?: string;
  /** Extra system rules, e.g. the project's AGENTS.md. */
  policy?: AgentToolPolicy | null;
  abortSignal?: AbortSignal;
  /** Hook runner override; undefined loads `.knox/hooks.json`, null disables. */
  hooks?: HookRunner | null;
  /**
   * Run hooks defined in the repository (`.knox/hooks.json`, `.knox/config.yaml`).
   * Off by default: a cloned repo or PR must not execute its own shell commands
   * in CI. Also enabled by `KNOX_TRUST_WORKSPACE_HOOKS=1`.
   */
  trustWorkspaceHooks?: boolean;
  /** Live progress (the CLI prints these to stderr). */
  onEvent?: (event: HeadlessEvent) => void;
}

export type HeadlessEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string; args: Record<string, unknown>; ok: boolean; error?: string }
  | { type: "denied"; name: string };

export interface HeadlessToolRecord {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  error?: string;
  output: string;
}

export interface HeadlessResult {
  stoppedReason: AgentLoopStoppedReason;
  exitCode: number;
  steps: number;
  summary: string;
  tools: HeadlessToolRecord[];
  denied: string[];
}

export async function runHeadless(
  options: HeadlessOptions,
): Promise<HeadlessResult> {
  const workspaceDir = path.resolve(options.workspaceDir);
  const workspaceUri = pathToFileURL(workspaceDir).href;
  const ide = createNodeIde(workspaceDir);
  const mode: PermissionMode = options.permission ?? "acceptEdits";
  const toolSettings: Record<string, ToolSetting> = {};
  const tools: HeadlessToolRecord[] = [];
  const denied: string[] = [];

  const extras: ToolExtras = {
    ide,
    llm: options.llm,
    fetch: (async () => new Response()) as ToolExtras["fetch"],
    tool: readFileTool,
    abortSignal: options.abortSignal,
  };

  // K-023: `.knox/hooks.json` applies to headless runs too. `options.hooks`
  // overrides (null = none); audit lines go to stderr so --json stays clean.
  const hooks: HookRunner | null =
    options.hooks !== undefined
      ? options.hooks
      : await getWorkspaceHookRunner(ide, (line) => console.error(line), {
          trustWorkspace:
            options.trustWorkspaceHooks ??
            process.env.KNOX_TRUST_WORKSPACE_HOOKS === "1",
        });
  const hookContext: string[] = [];
  if (hooks?.has("SessionStart")) {
    const started = await hooks.run("SessionStart", {}).catch(() => null);
    hookContext.push(...(started?.additionalContext ?? []));
  }
  if (hooks?.has("UserPromptSubmit")) {
    const submitted = await hooks
      .run("UserPromptSubmit", { prompt: options.task })
      .catch(() => null);
    if (submitted?.denied) {
      return {
        stoppedReason: "aborted",
        exitCode: exitCodeFor("aborted"),
        steps: 0,
        summary: `Blocked by hook: ${submitted.denied.reason}`,
        tools,
        denied,
      };
    }
    hookContext.push(...(submitted?.additionalContext ?? []));
  }

  // K-028: project rules / AGENTS.md (+ their tool policy) apply to CI runs.
  const instructions = await loadProjectInstructions(ide).catch(() => null);
  for (const w of instructions?.warnings ?? []) {
    console.error(`[instructions] ${w}`);
  }
  const policy = mergeAgentToolPolicies(
    options.policy ?? {},
    instructions?.policy ?? {},
  );
  const catalog = catalogForProfile(options.profile);
  const basePrompt =
    options.systemPrompt ??
    buildSystemPrompt({
      systems: options.profile === "systems",
      tools: catalog.map((t) => t.function.name),
    });

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: instructions?.systemPrompt
        ? `${basePrompt}\n\n${instructions.systemPrompt}`
        : basePrompt,
    },
    {
      role: "user",
      content: hookContext.length
        ? `${options.task}\n\n<hook_context>\n${hookContext.join("\n")}\n</hook_context>`
        : options.task,
    },
  ];

  const loop = await runAgentLoop({
    extras,
    messages,
    tools: catalog,
    maxSteps: options.maxSteps === undefined ? 40 : options.maxSteps,
    abortOnCancelled: true,
    onChunk: (chunk) => {
      if (chunk.role === "assistant" && typeof chunk.content === "string") {
        options.onEvent?.({ type: "text", text: chunk.content });
      }
    },
    approveTool: async (tool, args) => {
      const name = tool.function.name;
      const input = {
        toolName: name,
        args,
        policy,
        workspaceDirs: [workspaceUri],
      };
      const allowed =
        !isHardPolicyDeny(input) &&
        isToolAutoApproved({
          ...input,
          toolSettings,
          permissionMode: mode,
        });
      if (!allowed) {
        denied.push(name);
        options.onEvent?.({ type: "denied", name });
      }
      return allowed ? "allow" : "deny";
    },
    executeTool: async (tool, args): Promise<ContextItem[]> =>
      callTool(
        tool,
        args,
        { ...extras, tool },
        {
          retry: false,
          timeout: false,
          circuitBreaker: false,
          logging: false,
          agentPolicy: policy,
          workspaceDirs: [workspaceUri],
          hooks,
        },
      ),
    onStep: (step) => {
      for (const r of step.results) {
        tools.push({
          name: r.name,
          args: r.args,
          ok: r.ok,
          error: r.error,
          output: renderContextItems(r.output),
        });
        options.onEvent?.({
          type: "tool",
          name: r.name,
          args: r.args,
          ok: r.ok,
          error: r.error,
        });
      }
    },
  });

  if (hooks?.has("Stop")) {
    await hooks.run("Stop", { result: loop.summary }).catch(() => undefined);
  }

  return {
    stoppedReason: loop.stoppedReason,
    exitCode: exitCodeFor(loop.stoppedReason),
    steps: loop.steps,
    summary: loop.summary,
    tools,
    denied,
  };
}

// ---- argument parsing --------------------------------------------------

export interface CliArgs {
  task: string;
  dir: string;
  permission: HeadlessPermission;
  json: boolean;
  /** Newline-delimited JSON events on stdout (K-028). */
  streamJson: boolean;
  profile: HeadlessProfile;
  maxSteps?: number;
  model?: string;
  /** `--trust-hooks`: run hooks defined in the repository. */
  trustHooks?: boolean;
  help: boolean;
}

export const CLI_USAGE = `Usage: knox run "<task>" [options]

  --dir <path>          workspace directory (default: cwd)
  --permission <mode>   default | acceptEdits | fullAuto (default: acceptEdits)
                        Anything that would need approval is denied.
  --profile <name>      default | systems (adds build, kconfig, maintainers, qemu)
  --max-steps <n>       cap tool rounds (default: 40)
  --model <id>          model id (default: qwen/qwen3-coder)
  --trust-hooks         run hooks from the repo's .knox/ (ignored by default; also KNOX_TRUST_WORKSPACE_HOOKS=1)
  --json                print one JSON result on stdout
  --stream-json         print one JSON event per line (text, tool, denied, result)
  -h, --help

Sign in first with: knox login (OAuth; no API keys or env vars).
Exit codes: 0 completed, 1 error, 2 step/doom-loop stop, 130 aborted, 64 usage.`;

export function parseCliArgs(argv: string[]): CliArgs | { error: string } {
  const args = [...argv];
  if (args[0] === "run") {
    args.shift();
  }
  const out: CliArgs = {
    task: "",
    dir: process.cwd(),
    permission: "acceptEdits",
    json: false,
    streamJson: false,
    profile: "default",
    help: false,
  };
  const positional: string[] = [];
  const num = (flag: string, v: string | undefined): number | string => {
    const n = Number(v);
    return v !== undefined && Number.isFinite(n) && n > 0
      ? n
      : `${flag} needs a positive number`;
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = () => args[++i];
    switch (a) {
      case "-h":
      case "--help":
        out.help = true;
        break;
      case "--json":
        out.json = true;
        break;
      case "--trust-hooks":
        out.trustHooks = true;
        break;
      case "--profile": {
        const v = next();
        if (v !== "default" && v !== "systems") {
          return { error: "--profile must be default or systems" };
        }
        out.profile = v;
        break;
      }
      case "--stream-json":
        out.streamJson = true;
        break;
      case "--dir":
        out.dir = next() ?? "";
        if (!out.dir) return { error: "--dir needs a path" };
        break;
      case "--permission": {
        const v = next();
        if (v !== "default" && v !== "acceptEdits" && v !== "fullAuto") {
          return { error: "--permission must be default, acceptEdits or fullAuto" };
        }
        out.permission = v;
        break;
      }
      case "--max-steps": {
        const n = num(a, next());
        if (typeof n === "string") return { error: n };
        out.maxSteps = n;
        break;
      }
      case "--model":
        out.model = next();
        break;
      default:
        if (a.startsWith("-")) {
          return { error: `unknown option ${a}` };
        }
        positional.push(a);
    }
  }
  out.task = positional.join(" ").trim();
  if (!out.help && !out.task) {
    return { error: "missing task" };
  }
  return out;
}
