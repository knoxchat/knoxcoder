import { t } from "../../i18n/index.js";

import { ToolImpl } from ".";
import { detectSystemsWorkspace } from "../../config/agentProfile";
import { MAX_PARALLEL_EXPLORES } from "../subagent/jobs";
import type { SubagentRunResult } from "../subagent/runSubagent";

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
  if (
    (!args.prompt || typeof args.prompt !== "string" || !args.prompt.trim()) &&
    explores.length === 0
  ) {
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

  const sessionId =
    extras.soul?.sessionId ?? BrainManager.getActiveSessionId() ?? undefined;
  const systems = await detectSystemsWorkspace(extras.ide);
  const catalog = await resolveProductAgentTools(allTools, {
    systems,
    ide: extras.ide,
  });

  const runChild = (
    prompt: string,
    profile: unknown,
    readonlyMemory: boolean,
    jobTitle: string,
  ) =>
    runSubagent({
      prompt,
      profile,
      maxSteps: args.max_steps ?? args.maxSteps,
      extras: {
        ...extras,
        soul: { sessionId, turnId: extras.soul?.turnId, readonlyMemory },
      },
      catalog,
      executeTool: (tool, toolArgs) =>
        executeToolWithSoulHooks({
          tool,
          toolName: tool.function.name,
          rawArgs: toolArgs,
          ide: extras.ide,
          selectedModelTitle: extras.llm.title ?? extras.llm.model,
          sessionId,
          turnId: extras.soul?.turnId,
          execute: () =>
            callTool(tool, toolArgs, {
              ...extras,
              tool,
              soul: { sessionId, turnId: extras.soul?.turnId, readonlyMemory },
            }),
        }),
      systems,
      jobTitle,
    });

  if (explores.length > 1) {
    const results = await Promise.all(
      explores.map((spec) => {
        const scoped = spec.path
          ? `${spec.prompt}\n\nScope your search to path: ${spec.path}`
          : spec.prompt;
        return runChild(
          scoped,
          "explore",
          true,
          spec.path ? `explore ${spec.path}` : spec.prompt,
        );
      }),
    );
    return [
      {
        name: "subagent",
        description: `explore×${results.length} parallel`,
        content: formatFanout(results),
      },
    ];
  }

  const singlePrompt =
    explores.length === 1
      ? explores[0].path
        ? `${explores[0].prompt}\n\nScope your search to path: ${explores[0].path}`
        : explores[0].prompt
      : String(args.prompt).trim();
  const profile = explores.length === 1 ? "explore" : args.profile;
  const readonlyMemory = profile !== "general";
  const result = await runChild(
    singlePrompt,
    profile,
    readonlyMemory,
    explores[0]?.path ? `explore ${explores[0].path}` : singlePrompt,
  );

  return [
    {
      name: "subagent",
      description: `${result.profile} · ${result.stoppedReason} · ${result.steps} step${
        result.steps === 1 ? "" : "s"
      }`,
      content: formatSubagentResult(result),
    },
  ];
};
