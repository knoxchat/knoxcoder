import { t } from "../../i18n/index.js";

import { ToolImpl } from ".";
import { detectSystemsWorkspace } from "../../config/agentProfile";
import type { IDE } from "../..";
import { MAX_PARALLEL_EXPLORES } from "../subagent/jobs";
import {
  isReadonlySubagentProfile,
  resolveSubagentProfile,
} from "../subagent/profiles";
import {
  MAX_SUBAGENT_FANOUT,
  resolveSubagentConcurrency,
  runWithConcurrency,
} from "../subagent/scheduler";
import type {
  SubagentProgressEvent,
  SubagentRunResult,
} from "../subagent/runSubagent";
import type { SubagentMergeResult } from "../subagent/isolation";

interface ChildSpec {
  prompt: string;
  profile?: string;
  agent?: string;
  path?: string;
  isolate?: boolean;
}

function parseChildren(args: Record<string, unknown>): ChildSpec[] {
  const raw = args.children;
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: ChildSpec[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const r = item as Record<string, unknown>;
    const prompt = typeof r.prompt === "string" ? r.prompt.trim() : "";
    if (!prompt) {
      continue;
    }
    const str = (v: unknown) =>
      typeof v === "string" && v.trim() ? v.trim() : undefined;
    out.push({
      prompt,
      profile: str(r.profile),
      agent: str(r.agent),
      path: str(r.path),
      isolate: typeof r.isolate === "boolean" ? r.isolate : undefined,
    });
  }
  return out.slice(0, MAX_SUBAGENT_FANOUT);
}

interface ExploreSpec {
  prompt: string;
  path?: string;
}

function parseExplores(args: Record<string, unknown>): ExploreSpec[] {
  const raw = args.explores ?? args.prompts;
  if (!Array.isArray(raw)) {
    return [];
  }
  const specs: ExploreSpec[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.trim()) {
      specs.push({ prompt: item.trim() });
      continue;
    }
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      const prompt =
        typeof record.prompt === "string" ? record.prompt.trim() : "";
      if (!prompt) {
        continue;
      }
      const path =
        typeof record.path === "string" && record.path.trim()
          ? record.path.trim()
          : undefined;
      specs.push({ prompt, path });
    }
  }
  return specs.slice(0, MAX_PARALLEL_EXPLORES);
}

function formatFanout(results: SubagentRunResult[]): string {
  return results
    .map(
      (result, index) =>
        `### Explore ${index + 1}\n## Subagent (${result.profile})\nSteps: ${result.steps}\nStopped: ${result.stoppedReason}\nFiles touched: ${
          result.filesTouched.length > 0
            ? result.filesTouched.join(", ")
            : "(none recorded)"
        }\n\n${result.summary.trim() || "(no summary)"}`,
    )
    .join("\n\n");
}

export const taskImpl: ToolImpl = async (args, extras) => {
  const explores = parseExplores(args ?? {});
  const children = parseChildren(args ?? {});
  const hasPrompt =
    typeof args.prompt === "string" && args.prompt.trim().length > 0;
  if (!hasPrompt && explores.length === 0 && children.length === 0) {
    throw new Error(t("missingRequiredParam", { param: "prompt" }));
  }

  const { formatSubagentResult, runSubagent } = await import(
    "../subagent/runSubagent"
  );
  const { callTool } = await import("../callTool");
  const { executeToolWithSoulHooks } = await import("../mutatingToolHooks");
  const { BrainManager } = await import(
    "../../context/memory/brain/BrainManager.js"
  );
  const { allTools } = await import("../index");
  const { resolveProductAgentTools } = await import("../catalog");
  const { findCustomAgent } = await import("../subagent/customAgents");
  const { runInWorktree, formatMergeResult } = await import(
    "../subagent/isolation"
  );

  const sessionId =
    extras.soul?.sessionId ?? BrainManager.getActiveSessionId() ?? undefined;
  const systems = await detectSystemsWorkspace(extras.ide);
  const catalog = await resolveProductAgentTools(allTools, {
    systems,
    ide: extras.ide,
  });

  // Progress streamed into the parent tool card.
  const progress = new Map<string, string>();
  const emitProgress = (event: SubagentProgressEvent) => {
    const line =
      event.type === "start"
        ? "started"
        : event.type === "tool"
          ? `step ${event.step}: ${event.tool}`
          : `finished (${event.stoppedReason})`;
    progress.set(event.jobId, line);
    extras.onPartialOutput?.([
      {
        name: "subagent",
        description: "subagent progress",
        content: [...progress.entries()]
          .map(([id, status]) => `${id}: ${status}`)
          .join("\n"),
      },
    ]);
  };

  interface Unit {
    prompt: string;
    profile?: unknown;
    agent?: string;
    isolate: boolean;
    title: string;
    readonlyMemory: boolean;
  }

  const runUnit = async (
    unit: Unit,
  ): Promise<{ result: SubagentRunResult; merge?: SubagentMergeResult }> => {
    const custom = unit.agent
      ? await findCustomAgent(extras.ide, unit.agent)
      : undefined;
    if (unit.agent && !custom) {
      return {
        result: {
          profile: unit.agent,
          steps: 0,
          summary: `Unknown agent "${unit.agent}". Define it in .knox/agents/${unit.agent}.md.`,
          filesTouched: [],
          stoppedReason: "error",
        },
      };
    }
    // Custom agents may name a model; fall back to the parent's when unknown.
    let childLlm = extras.llm;
    let modelNote = "";
    if (custom?.model) {
      const resolved = await extras
        .resolveModel?.(custom.model)
        .catch(() => undefined);
      if (resolved) {
        childLlm = resolved;
      } else {
        modelNote = `\n(note: model "${custom.model}" not found; used the parent model)`;
      }
    }
    const runIn = async (ide: IDE) => {
      const childExtras = {
        ...extras,
        llm: childLlm,
        ide,
        soul: {
          sessionId,
          turnId: extras.soul?.turnId,
          readonlyMemory: unit.readonlyMemory,
        },
      };
      return runSubagent({
        prompt: unit.prompt,
        profile: unit.profile,
        maxSteps: args.max_steps ?? args.maxSteps,
        custom: custom
          ? {
              name: custom.name,
              prompt: custom.prompt,
              tools: custom.tools,
              readonly: custom.readonly,
            }
          : undefined,
        onProgress: emitProgress,
        extras: childExtras,
        catalog,
        executeTool: (tool, toolArgs) =>
          executeToolWithSoulHooks({
            tool,
            toolName: tool.function.name,
            rawArgs: toolArgs,
            ide,
            selectedModelTitle: childLlm.title ?? childLlm.model,
            sessionId,
            turnId: extras.soul?.turnId,
            execute: () =>
              callTool(tool, toolArgs, { ...childExtras, tool }),
          }),
        systems,
        jobTitle: unit.title,
      });
    };

    const withNote = (r: SubagentRunResult): SubagentRunResult =>
      modelNote ? { ...r, summary: `${r.summary}${modelNote}` } : r;
    if (!unit.isolate) {
      return { result: withNote(await runIn(extras.ide)) };
    }
    try {
      const { result, merge } = await runInWorktree(
        extras.ide,
        sessionId,
        unit.title.slice(0, 24),
        runIn,
        { shouldMerge: (r) => r.stoppedReason !== "aborted" },
      );
      return { result: withNote(result), merge };
    } catch (error) {
      return {
        result: {
          profile: custom?.name ?? String(unit.profile ?? "general"),
          steps: 0,
          summary: `Worktree isolation failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          filesTouched: [],
          stoppedReason: "error",
        },
      };
    }
  };

  const formatUnit = (
    out: { result: SubagentRunResult; merge?: SubagentMergeResult },
    heading?: string,
  ) =>
    `${heading ? `### ${heading}\n` : ""}${formatSubagentResult(out.result)}${
      out.merge ? `\n\n${formatMergeResult(out.merge)}` : ""
    }`;

  const scope = (prompt: string, path?: string) =>
    path ? `${prompt}\n\nScope your work to path: ${path}` : prompt;

  // New: heterogeneous fan-out with writers isolated in worktrees.
  if (children.length > 0) {
    const units: Unit[] = children.map((c) => {
      const writer = c.agent
        ? true // resolved precisely below via custom.readonly when known
        : !isReadonlySubagentProfile(resolveSubagentProfile(c.profile));
      return {
        prompt: scope(c.prompt, c.path),
        profile: c.profile,
        agent: c.agent,
        isolate: c.isolate ?? (writer && children.length > 1),
        title: c.path ? `${c.agent ?? c.profile ?? "explore"} ${c.path}` : c.prompt,
        readonlyMemory: c.agent ? false : !writer,
      };
    });
    const outs = await runWithConcurrency(
      units,
      resolveSubagentConcurrency(args.concurrency),
      runUnit,
      {
        signal: extras.abortSignal,
        skipped: (unit) => ({
          result: {
            profile: String(unit.agent ?? unit.profile ?? "explore"),
            steps: 0,
            summary: "Cancelled before start.",
            filesTouched: [],
            stoppedReason: "aborted" as const,
          },
        }),
      },
    );
    const conflicts = outs.filter((o) => o.merge?.status === "conflict").length;
    return [
      {
        name: "subagent",
        description: `${outs.length} children${
          conflicts ? ` · ${conflicts} merge conflict${conflicts === 1 ? "" : "s"}` : ""
        }`,
        content: outs
          .map((o, i) => formatUnit(o, `Child ${i + 1}`))
          .join("\n\n"),
      },
    ];
  }

  if (explores.length > 1) {
    const outs = await runWithConcurrency(
      explores,
      resolveSubagentConcurrency(args.concurrency),
      (spec) =>
        runUnit({
          prompt: scope(spec.prompt, spec.path),
          profile: "explore",
          isolate: false,
          readonlyMemory: true,
          title: spec.path ? `explore ${spec.path}` : spec.prompt,
        }),
    );
    return [
      {
        name: "subagent",
        description: `explore×${outs.length} parallel`,
        content: formatFanout(outs.map((o) => o.result)),
      },
    ];
  }

  const singlePrompt =
    explores.length === 1
      ? scope(explores[0].prompt, explores[0].path)
      : String(args.prompt).trim();
  const profile = explores.length === 1 ? "explore" : args.profile;
  const agent =
    typeof args.agent === "string" && args.agent.trim()
      ? args.agent.trim()
      : undefined;
  const out = await runUnit({
    prompt: singlePrompt,
    profile,
    agent,
    isolate: args.isolate === true,
    readonlyMemory: agent ? false : profile !== "general",
    title: explores[0]?.path ? `explore ${explores[0].path}` : singlePrompt,
  });

  return [
    {
      name: "subagent",
      description: `${out.result.profile} · ${out.result.stoppedReason} · ${out.result.steps} step${
        out.result.steps === 1 ? "" : "s"
      }`,
      content: formatUnit(out),
    },
  ];
};
