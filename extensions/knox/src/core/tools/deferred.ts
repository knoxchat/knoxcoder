/**
 * K-021: deferred tool loading.
 *
 * Every tool schema is sent on every model call, which costs tokens and
 * weakens tool choice on small models. With deferral on, a core set is sent
 * and the rest sit behind `builtin_tool_search`: the model asks for a tool by
 * name or keyword, the loop adds its schema to the live tool list, and the
 * next round can call it. Permissions still apply to the loaded tool itself.
 */

import type { ContextItem, Tool } from "..";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "./builtIn";

const N = BuiltInToolNames;

/** Sent every turn on the default profile. */
export const CORE_TOOL_NAMES: ReadonlySet<string> = new Set<string>([
  N.ReadFile,
  N.ReadCurrentlyOpenFile,
  N.CreateNewFile,
  N.EditFile,
  N.WriteFile,
  N.ApplyPatch,
  N.RunTerminalCommand,
  N.AwaitShell,
  N.ViewSubdirectory,
  N.Glob,
  N.ViewRepoMap,
  N.ExactSearch,
  N.Plan,
  N.AskUser,
  N.Task,
  N.Skill,
]);

/** The systems profile (kernel, QEMU, serial) keeps its own tools in front. */
export const SYSTEMS_CORE_TOOL_NAMES: ReadonlySet<string> = new Set<string>([
  N.Build,
  N.PtyStart,
  N.PtySend,
  N.PtyRead,
  N.Qemu,
  N.Debug,
  N.Kconfig,
  N.Maintainers,
]);

export function isCoreTool(name: string, systems = false): boolean {
  return (
    CORE_TOOL_NAMES.has(name) || (systems && SYSTEMS_CORE_TOOL_NAMES.has(name))
  );
}

export interface DeferredToolSplit {
  /** Sent to the model now (core tools, user-defined tools, plus tool search). */
  active: Tool[];
  /** Available through `builtin_tool_search`. */
  deferred: Tool[];
}

function isBuiltIn(name: string): boolean {
  return name.startsWith("builtin_");
}

function firstSentence(text: string | undefined): string {
  const line = (text ?? "").trim().split(/\n/)[0] ?? "";
  const cut = line.search(/[.!?](\s|$)/);
  const sentence = cut >= 0 ? line.slice(0, cut + 1) : line;
  return sentence.length > 72 ? `${sentence.slice(0, 69)}...` : sentence;
}

export function buildToolSearchTool(deferred: Tool[]): Tool {
  const catalog = deferred
    .map(
      (tool) =>
        `- ${tool.function.name}: ${firstSentence(tool.function.description)}`,
    )
    .join("\n");
  return {
    type: "function",
    displayTitle: "Tool search",
    wouldLikeTo: "search for tools",
    isCurrently: "searching for tools",
    hasAlready: "searched for tools",
    group: BUILT_IN_GROUP_NAME,
    readonly: true,
    function: {
      name: N.ToolSearch,
      description: `Load extra tools that are not in your list yet. Pass exact tool names, or a short keyword query. The matching tools become callable on your next step.\n\nNot loaded yet:\n${catalog}`,
      parameters: {
        type: "object",
        properties: {
          names: {
            type: "array",
            items: { type: "string" },
            description: "Exact tool names to load.",
          },
          query: {
            type: "string",
            description: "Keywords, for example \"git blame\" or \"memory\".",
          },
        },
      },
    },
  };
}

/**
 * Split a catalog into the always-sent set and the deferred set. User-defined
 * (non-builtin) tools are never deferred. Nothing is deferred when it would
 * save fewer than two tools.
 */
export function splitDeferredTools(
  tools: Tool[],
  opts: { systems?: boolean } = {},
): DeferredToolSplit {
  const active: Tool[] = [];
  const deferred: Tool[] = [];
  for (const tool of tools) {
    const name = tool.function.name;
    if (name === N.ToolSearch) {
      continue;
    }
    if (!isBuiltIn(name) || isCoreTool(name, opts.systems)) {
      active.push(tool);
    } else {
      deferred.push(tool);
    }
  }
  if (deferred.length < 2) {
    return { active: tools.filter((x) => x.function.name !== N.ToolSearch), deferred: [] };
  }
  active.push(buildToolSearchTool(deferred));
  return { active, deferred };
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1);
}

/** Deferred tools matching exact names first, then keyword score. */
export function searchDeferredTools(
  deferred: Tool[],
  args: { names?: unknown; query?: unknown },
  limit = 6,
): Tool[] {
  const picked: Tool[] = [];
  const add = (tool: Tool | undefined) => {
    if (tool && !picked.includes(tool)) {
      picked.push(tool);
    }
  };
  const names = Array.isArray(args.names)
    ? args.names.filter((n): n is string => typeof n === "string")
    : typeof args.names === "string"
      ? [args.names]
      : [];
  for (const raw of names) {
    const wanted = raw.trim().toLowerCase();
    add(
      deferred.find((tool) => {
        const name = tool.function.name.toLowerCase();
        return name === wanted || name === `builtin_${wanted}`;
      }),
    );
  }
  const query = typeof args.query === "string" ? args.query : "";
  const terms = words(query);
  if (terms.length > 0) {
    const scored = deferred
      .map((tool) => {
        const name = words(tool.function.name);
        const desc = words(firstSentence(tool.function.description));
        let score = 0;
        for (const term of terms) {
          if (name.includes(term)) {
            score += 3;
          } else if (name.some((w) => w.startsWith(term))) {
            score += 2;
          }
          if (desc.includes(term)) {
            score += 1;
          }
        }
        return { tool, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    for (const { tool } of scored) {
      add(tool);
    }
  }
  return picked.slice(0, limit);
}

/**
 * Execute `builtin_tool_search`: push matches onto the live `active` list
 * (the loop reads it every round) and describe what was loaded.
 */
export function runToolSearch(
  args: Record<string, unknown>,
  deferred: Tool[],
  active: Tool[],
): ContextItem[] {
  const matches = searchDeferredTools(deferred, args);
  const loaded: string[] = [];
  const already: string[] = [];
  for (const tool of matches) {
    if (active.some((x) => x.function.name === tool.function.name)) {
      already.push(tool.function.name);
    } else {
      active.push(tool);
      loaded.push(tool.function.name);
    }
  }
  const lines: string[] = [];
  if (loaded.length) {
    lines.push(`Loaded: ${loaded.join(", ")}. Call them on your next step.`);
  }
  if (already.length) {
    lines.push(`Already available: ${already.join(", ")}.`);
  }
  if (!matches.length) {
    lines.push(
      `No tool matched. Available to load: ${deferred
        .map((tool) => tool.function.name)
        .join(", ")}.`,
    );
  }
  return [
    {
      name: "Tool search",
      description: "Tool search",
      content: lines.join("\n"),
    },
  ];
}

/** Rough schema cost: JSON length over four. For budgets and regression tests. */
export function estimateToolSchemaTokens(tools: Tool[]): number {
  return Math.ceil(
    tools.reduce(
      (sum, tool) => sum + JSON.stringify(tool.function ?? {}).length,
      0,
    ) / 4,
  );
}
