/**
 * Run a background agent inside a git worktree (P3.1).
 *
 * Same product path as GUI Agent: `runChatTurn` → `callTool`. The IDE is a
 * FileSystemIde pointed at the job worktree so writes never touch the parent
 * checkout. Permission cards cannot wait: unattended mode auto-approves what
 * Edits/Auto would, and denies the rest.
 */

import type { ChatMessage, ILLM, Tool, ToolExtras } from "..";
import { runChatTurn } from "../agent/chatTurn";
import {
  DEFAULT_PERMISSION_MODE,
  type PermissionMode,
} from "../agent/permissions";
import {
  detectWorkspaceKindFromIde,
  resolveUnattendedMaxSteps,
  workspaceKindHints,
  type ResolvedAgentProfile,
} from "../config/agentProfile";
import { loadCodebaseCard } from "../context/codebaseCard";
import { buildSystemPrompt } from "../llm/systemPrompt";
import { callTool } from "../tools/callTool";
import { withIdePorts } from "../tools/toolPorts";
import { selectAgentTools } from "../tools/catalog";
import { shouldPromoteLsp, splitDeferredTools } from "../tools/deferred";
import FileSystemIde from "../util/filesystem";
import { localPathToUri } from "../util/pathToUri";

import {
  type BgJob,
  type BgRunResult,
  bgRoot,
  runJob,
  startJob,
} from "./background";

export interface BackgroundRunOptions {
  llm: ILLM;
  tools: Tool[];
  permissionMode?: PermissionMode;
  systems?: boolean;
  deferTools?: boolean;
  enableCompositeTools?: boolean;
}

export async function runBackgroundAgent(
  job: BgJob,
  signal: AbortSignal,
  opts: BackgroundRunOptions,
): Promise<BgRunResult> {
  const workspaceUri = localPathToUri(job.worktree);
  const ide = new FileSystemIde(workspaceUri);
  const catalog = selectAgentTools(opts.tools, {
    systems: opts.systems,
    enableCompositeTools: opts.enableCompositeTools,
  });
  const kind = await detectWorkspaceKindFromIde(ide).catch(() => null);
  const hints = workspaceKindHints(kind);
  const profile: ResolvedAgentProfile = opts.systems
    ? "systems"
    : hints.systems
      ? "systems"
      : hints.cargo
        ? "rust"
        : "default";
  const split =
    opts.deferTools === false
      ? { active: catalog, deferred: [] as Tool[] }
      : splitDeferredTools(catalog, {
          systems: opts.systems,
          lspActive: shouldPromoteLsp(kind, opts.systems === true),
          enableCompositeTools: opts.enableCompositeTools,
        });
  const extras: ToolExtras = {
    ...withIdePorts(ide),
    llm: opts.llm,
    fetch: (async () => new Response()) as ToolExtras["fetch"],
    tool: (split.active[0] ?? catalog[0]) as Tool,
    abortSignal: signal,
  };
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt({ systems: opts.systems === true }),
    },
  ];
  try {
    const card = await loadCodebaseCard(ide);
    if (card) {
      messages.push({ role: "system", content: card });
    }
  } catch {
    // Card is optional; the loop can still search.
  }
  messages.push({ role: "user", content: job.task });

  const result = await runChatTurn({
    sessionId: `bg:${job.id}`,
    extras: { llm: opts.llm, abortSignal: signal },
    messages,
    tools: split.active,
    deferredTools: split.deferred.length ? split.deferred : undefined,
    maxSteps: resolveUnattendedMaxSteps(undefined, profile),
    holdCompletionWhileOracleRed: true,
    permission: {
      mode: opts.permissionMode ?? DEFAULT_PERMISSION_MODE,
      toolSettings: {},
      sessionAllowlist: [],
      workspaceDirs: [workspaceUri],
      unattended: true,
    },
    emit: () => undefined,
    executeTool: async (tool, args) =>
      callTool(
        tool,
        args,
        { ...extras, tool, abortSignal: signal },
        { workspaceDirs: [workspaceUri] },
      ),
  });
  return {
    stoppedReason: result.stoppedReason,
    steps: result.steps,
    summary: result.summary,
  };
}

export async function startBackgroundAgentJob(opts: {
  dir: string;
  task: string;
  llm: ILLM;
  tools: Tool[];
  permissionMode?: PermissionMode;
  systems?: boolean;
  deferTools?: boolean;
  enableCompositeTools?: boolean;
  notify?: (title: string, body: string) => void;
  onUpdate?: () => void;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const task = opts.task.trim();
  if (!task) {
    return { ok: false, error: "Task is empty" };
  }
  const root = bgRoot();
  let job: BgJob;
  try {
    job = startJob({ root, dir: opts.dir, task });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  opts.onUpdate?.();
  void runJob({
    root,
    id: job.id,
    run: (running, signal) => runBackgroundAgent(running, signal, opts),
    notify: opts.notify,
  })
    .then(() => opts.onUpdate?.())
    .catch(() => opts.onUpdate?.());
  return { ok: true, id: job.id };
}
