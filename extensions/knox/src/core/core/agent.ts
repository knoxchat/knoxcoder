import { gateToolCall } from "../jev/toolGate";
import { t } from "../i18n/index.js";
import { BrainManager } from "../context/memory/brain/BrainManager";
import { recordSoulEvent } from "../context/soul/recordSoulEvent.js";
import {
  cancelAllBackgroundJobs,
  handleAgentJobsRequest,
  listAgentBackgroundJobs,
  toAgentBackgroundJob,
} from "../tools/agentJobs";
import { subscribeShellJobs } from "../tools/shellJobs";
import {
  applyAgentWorktree,
  discardAgentWorktree,
  enterAgentWorktree,
  worktreeActionResult,
} from "../tools/worktree";

import type { CoreRuntime } from "./runtime";

export function registerAbortAndAgentHandlers(core: CoreRuntime): void {
  const on = core.messenger.on.bind(core.messenger);

  // Special
  on("abort", (msg) => {
    core.abortedMessageIds.add(msg.messageId);
    // If this abort targets an in-flight tools/call, stop it (e.g. terminal).
    core.abortActiveTools(msg.messageId);
  });

  on("tools/cancel", () => {
    core.abortActiveTools();
    // Background shells (block_until_ms: 0) and builtin_task children are
    // not in activeToolAborts once they detach. Stop them on user Stop.
    const jobs = cancelAllBackgroundJobs();
    core.send("agent/jobUpdate", {
      event: "updated",
      job: jobs[0] ?? {
        id: "cancel",
        kind: "shell",
        title: "",
        status: "killed",
      },
      jobs,
    });
  });

  on("jev/gateTool", async () => {
    return gateToolCall();
  });

  subscribeShellJobs((event, snapshot) => {
    core.send("agent/jobUpdate", {
      event,
      job: toAgentBackgroundJob(snapshot),
      jobs: listAgentBackgroundJobs(),
    });
    if (event !== "completed") {
      return;
    }
    const soulSession = BrainManager.getActiveSessionId();
    if (!soulSession) {
      return;
    }
    const killed = snapshot.status === "killed";
    const failed =
      !killed && snapshot.exitCode !== null && snapshot.exitCode !== 0;
    void recordSoulEvent({
      sessionId: soulSession,
      kind: failed || killed ? "tool_error" : "tool_success",
      toolName: "builtin_run_terminal_command",
      files: [],
      ok: !failed && !killed,
      summary: killed
        ? `Background job ${snapshot.id} killed: ${snapshot.command}`
        : `Background job ${snapshot.id} exited ${snapshot.exitCode ?? "?"}: ${snapshot.command}`,
      metadata: {
        jobId: snapshot.id,
        exitCode: snapshot.exitCode,
        status: snapshot.status,
      },
    }).catch(() => {});
  });

  on("agent/jobs", (msg) => {
    return handleAgentJobsRequest(msg.data);
  });

  on("agent/worktree", async (msg) => {
    const action = msg.data.action;
    const sessionId = msg.data.sessionId || "default";
    try {
      if (action === "enter") {
        core.agentWorktree = await enterAgentWorktree(
          core.ide,
          sessionId,
          core.agentWorktree,
        );
        return await worktreeActionResult(core.ide, core.agentWorktree);
      }
      if (action === "status") {
        return await worktreeActionResult(core.ide, core.agentWorktree);
      }
      if (!core.agentWorktree) {
        return { ok: false, error: t("worktreeNotActive"), state: { enabled: false, files: [] } };
      }
      if (action === "apply") {
        const soulSession =
          sessionId !== "default"
            ? sessionId
            : BrainManager.getActiveSessionId() || sessionId;
        let checkpointId: string | undefined;
        if (typeof core.ide.ensureTurnCheckpoint === "function") {
          try {
            checkpointId = await core.ide.ensureTurnCheckpoint({
              sessionId: soulSession,
              turnId: `worktree-apply-${soulSession}`,
              toolName: "agent_worktree_apply",
            });
          } catch {
            // Apply still proceeds if the safety CP fails.
          }
        }
        const files = await applyAgentWorktree(core.ide, core.agentWorktree);
        void recordSoulEvent({
          sessionId: soulSession,
          kind: "tool_success",
          toolName: "agent_worktree_apply",
          files,
          workspaceCheckpointId: checkpointId,
          ok: true,
          summary: `Applied ${files.length} file${
            files.length === 1 ? "" : "s"
          } from worktree ${core.agentWorktree.branch}`,
        }).catch(() => {});
        const result = await worktreeActionResult(core.ide, core.agentWorktree);
        if (result.state) {
          result.state.files = files;
        }
        return result;
      }
      const discardSession =
        sessionId !== "default"
          ? sessionId
          : BrainManager.getActiveSessionId() || sessionId;
      const discardedBranch = core.agentWorktree.branch;
      await discardAgentWorktree(core.ide, core.agentWorktree);
      core.agentWorktree = null;
      void recordSoulEvent({
        sessionId: discardSession,
        kind: "tool_success",
        toolName: "agent_worktree_discard",
        files: [],
        ok: true,
        summary: `Discarded isolated worktree ${discardedBranch} without applying files`,
      }).catch(() => {});
      return { ok: true, state: { enabled: false, files: [] } };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: message,
        state: core.agentWorktree
          ? {
              enabled: true,
              branch: core.agentWorktree.branch,
              path: core.agentWorktree.worktreePath,
              files: [],
            }
          : { enabled: false, files: [] },
      };
    }
  });

  on("ping", (msg) => {
    if (msg.data !== "ping") {
      throw new Error(t("pingIncorrect"));
    }
    return "pong";
  });
}
