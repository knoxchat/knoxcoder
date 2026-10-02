import { fetchwithRequestOptions } from "knoxdev-package/fetch";

import {
  detectWorkspaceKindFromIde,
  resolveAgentLoopSettings,
  workspaceKindHints,
} from "../config/agentProfile";
import { BrainManager } from "../context/memory/brain/BrainManager";
import { confirmAutoProfile } from "../jev/profileConfirm";
import { getActiveJevRuntime, getJevConfirmedProfile } from "../jev/config";
import { resolveAutonomousToolApproval } from "../agent/autonomousApproval";
import { DEFAULT_PERMISSION_MODE } from "../agent/permissions";
import { callTool } from "../tools/callTool";
import { executeToolWithSoulHooks } from "../tools/mutatingToolHooks";
import { resolveConfigAgentPolicy } from "../tools/toolPolicy";
import { wrapIdeForWorktree } from "../tools/worktree";

import type { ToolExtras } from "..";
import type { CoreRuntime } from "./runtime";

export function registerBrainLoopHandlers(core: CoreRuntime): void {
  const on = core.messenger.on.bind(core.messenger);

  on("brain/runAutonomousLoop", async (msg) => {
    const { config } = await core.configHandler.loadConfig();
    let chatLlm = config?.selectedModelByRole?.chat ?? null;
    if (msg.data.modelTitle) {
      try {
        chatLlm =
          (await core.configHandler.llmFromTitle(msg.data.modelTitle)) ??
          chatLlm;
      } catch {
        // keep config chat model
      }
    }
    if (chatLlm) {
      BrainManager.setLlm(chatLlm);
    }

    const { allTools } = await import("../tools");
    const { loadCodebaseCard, setCodebaseCardInject } = await import(
      "../context/codebaseCard"
    );
    const { loadSerialContextFromJobs, setSerialContextInject } = await import(
      "../context/serialContext"
    );
    const { listShellJobs } = await import("../tools/shellJobs");
    const catalog =
      config?.tools?.filter((tool) => tool.function?.name) ?? allTools;
    const toolIde = core.agentWorktree
      ? wrapIdeForWorktree(core.ide, core.agentWorktree)
      : core.ide;
    try {
      const card = await loadCodebaseCard(toolIde);
      setCodebaseCardInject(card);
      const { rustPolicyShouldEnable, setRustPolicyEnabled, setRustUserTask } =
        await import("../context/rustPolicy");
      setRustPolicyEnabled(rustPolicyShouldEnable({ card }));
      setRustUserTask(
        typeof msg.data?.goal === "string" ? msg.data.goal : "",
      );
    } catch {
      setCodebaseCardInject("");
    }
    try {
      setSerialContextInject(loadSerialContextFromJobs(listShellJobs()));
    } catch {
      setSerialContextInject("");
    }
    const sessionId = msg.data.sessionId;
    const loopLlm = chatLlm;
    const extras = loopLlm
      ? {
          ide: toolIde,
          llm: loopLlm,
          fetch: ((url: string, init?: RequestInit) =>
            fetchwithRequestOptions(
              url,
              init,
              config?.requestOptions,
            )) as ToolExtras["fetch"],
          abortSignal: undefined as AbortSignal | undefined,
        }
      : undefined;

    let workspaceHints = workspaceKindHints(null);
    try {
      workspaceHints = workspaceKindHints(
        await detectWorkspaceKindFromIde(toolIde),
      );
    } catch {
      workspaceHints = workspaceKindHints(null);
    }
    await confirmAutoProfile({
      setting:
        config?.experimental?.agentProfileSetting ??
        config?.experimental?.agentProfile,
      workspaceHints,
      userMessage:
        typeof msg.data?.goal === "string" ? msg.data.goal : "",
      runtime: getActiveJevRuntime(),
    });
    const loopSettings = resolveAgentLoopSettings(
      config?.experimental,
      workspaceHints,
      getJevConfirmedProfile(),
    );

    let workspaceDirs: string[] = [];
    try {
      workspaceDirs = await toolIde.getWorkspaceDirs();
    } catch {
      workspaceDirs = [];
    }

    const result = await BrainManager.runAutonomousLoop({
      session_id: sessionId,
      goal: msg.data.goal,
      max_iterations: msg.data.maxIterations,
      ensureWorkspaceCheckpoint: async (iteration) => {
        if (typeof core.ide.ensureTurnCheckpoint !== "function") {
          return undefined;
        }
        return core.ide.ensureTurnCheckpoint({
          sessionId,
          turnId: `autonomous-${sessionId}-${iteration}`,
          toolName: "autonomous_loop",
        });
      },
      resolveModel: async (modelId: string) => {
        try {
          return (await core.configHandler.llmFromTitle(modelId)) ?? null;
        } catch {
          return null;
        }
      },
      toolRuntime:
        loopLlm && extras && catalog.length
          ? {
              catalog,
              extras,
              sessionId,
              onEvent: (type, data) => BrainManager.publishEvent(type, data),
              executeTool: async (tool, args) => {
                const workspaceDirs = await toolIde.getWorkspaceDirs();
                return executeToolWithSoulHooks({
                  tool,
                  toolName: tool.function.name,
                  rawArgs: args,
                  ide: toolIde,
                  selectedModelTitle: loopLlm.title ?? loopLlm.model,
                  sessionId,
                  execute: () =>
                    callTool(
                      tool,
                      args,
                      {
                        ide: toolIde,
                        llm: loopLlm,
                        fetch: extras.fetch,
                        tool,
                        abortSignal: extras.abortSignal,
                      },
                      {
                        agentPolicy: resolveConfigAgentPolicy(
                          config?.experimental,
                        ),
                        workspaceDirs,
                      },
                    ),
                });
              },
              maxStepsPerIteration: loopSettings.maxSteps,
              doomLoopThreshold: loopSettings.doomLoopThreshold,
              permission: {
                mode: msg.data.permissionMode ?? DEFAULT_PERMISSION_MODE,
                toolSettings: msg.data.toolSettings ?? {},
                sessionAllowlist: [...(msg.data.sessionAllowlist ?? [])],
                policy: config?.experimental?.agentPolicy ?? null,
                policyFromRules:
                  config?.experimental?.agentPolicyFromRules ?? null,
                workspaceDirs,
              },
            }
          : undefined,
    });
    return result;
  });

  on("brain/resolveAutonomousTool", async (msg) => {
    const ok = resolveAutonomousToolApproval({
      sessionId: msg.data.sessionId,
      callId: msg.data.callId,
      allow: msg.data.allow,
      always: msg.data.always,
    });
    return { ok };
  });

  on("brain/cancelAutonomousLoop", async (msg) => {
    const cancelled = BrainManager.cancelAutonomousLoop(msg.data.sessionId);
    return { cancelled };
  });

  on("brain/getAutonomousLoopStatus", async (msg) => {
    return BrainManager.getAutonomousLoopStatus(msg.data.sessionId);
  });
}
