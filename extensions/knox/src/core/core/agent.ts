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
import {
  applyStaged,
  discardStaged,
  listStaged,
  stagedDiffText,
} from "../tools/stagedEdits";
import {
  enableReview,
  ensureReviewLoaded,
  persistReview,
  writeReviewPreference,
} from "../tools/reviewStore";
import { clearHookLog, getHookLogEntries } from "../hooks/auditLog";
import { HOOK_EVENTS } from "../hooks/hooks";
import { getWorkspaceHookRunner } from "../hooks/workspaceHooks";
import { subscribeShellJobs } from "../tools/shellJobs";
import {
  applyAgentWorktree,
  discardAgentWorktree,
  enterAgentWorktree,
  worktreeActionResult,
  wrapIdeForWorktree,
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

  on("tools/cancel", (msg) => {
    core.abortActiveTools();
    // Cancelling one tool card must not kill unrelated background jobs.
    if ((msg?.data as { toolCallId?: string } | undefined)?.toolCallId) {
      return;
    }
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

  on("agent/hooks", async (msg) => {
    if (msg.data.action === "clear") {
      clearHookLog();
    }
    const runner = await getWorkspaceHookRunner(core.ide, () => undefined).catch(
      () => null,
    );
    const limit = Math.max(1, Math.min(200, msg.data.limit ?? 50));
    return {
      events: runner ? HOOK_EVENTS.filter((e) => runner.has(e)) : [],
      entries: getHookLogEntries()
        .slice(-limit)
        .map((e) => ({
          at: e.at,
          event: e.event,
          toolName: e.toolName,
          command: e.command,
          outcome: e.outcome,
          durationMs: e.durationMs,
          detail: e.detail,
        })),
    };
  });

  on("agent/review", async (msg) => {
    const { action, fileUris } = msg.data;
    const sessionId = msg.data.sessionId || "default";
    const state = () => {
      const staged = core.stagedReview.get(sessionId);
      return {
        enabled: staged !== undefined,
        files: staged ? listStaged(staged) : [],
      };
    };
    try {
      ensureReviewLoaded(core, sessionId);
      if (action === "enable") {
        enableReview(core, sessionId);
        persistReview(core, sessionId);
        writeReviewPreference(true);
        return { ok: true, ...state() };
      }
      const staged = core.stagedReview.get(sessionId);
      if (action === "status") {
        return { ok: true, ...state() };
      }
      if (!staged) {
        return { ok: false, error: "Review mode is not active", ...state() };
      }
      if (action === "diff") {
        const target = fileUris?.[0];
        const file = target ? staged.files.get(target) : undefined;
        if (!file) {
          return { ok: false, error: "File is not staged", ...state() };
        }
        return {
          ok: true,
          ...state(),
          diff: stagedDiffText(file),
          before: file.before,
          after: file.after,
        };
      }
      if (action === "discard") {
        discardStaged(staged, fileUris);
        persistReview(core, sessionId);
        return { ok: true, ...state() };
      }
      if (action === "disable") {
        // Leaving review mode never drops edits silently: unapplied files stay discarded only on explicit discard.
        if (staged.size > 0) {
          return {
            ok: false,
            error: "Apply or discard the staged edits first",
            ...state(),
          };
        }
        core.stagedReview.delete(sessionId);
        persistReview(core, sessionId, false);
        writeReviewPreference(false);
        return { ok: true, ...state() };
      }
      // apply
      const base = core.agentWorktree
        ? wrapIdeForWorktree(core.ide, core.agentWorktree)
        : core.ide;
      let checkpointId: string | undefined;
      if (typeof core.ide.ensureTurnCheckpoint === "function") {
        try {
          checkpointId = await core.ide.ensureTurnCheckpoint({
            sessionId,
            turnId: `review-apply-${sessionId}`,
            toolName: "agent_review_apply",
          });
        } catch {
          // Apply still proceeds if the safety checkpoint fails.
        }
      }
      const result = await applyStaged(
        base,
        staged,
        fileUris,
        await core.ide.getWorkspaceDirs().catch(() => []),
      );
      persistReview(core, sessionId);
      if (result.applied.length > 0) {
        void recordSoulEvent({
          sessionId,
          kind: "tool_success",
          toolName: "agent_review_apply",
          files: result.applied,
          workspaceCheckpointId: checkpointId,
          ok: result.failed.length === 0,
          summary: `Applied ${result.applied.length} reviewed file${
            result.applied.length === 1 ? "" : "s"
          }`,
        }).catch(() => {});
      }
      return {
        ok: result.failed.length === 0,
        error: result.failed.length
          ? `${result.failed.length} file(s) failed to apply`
          : undefined,
        ...state(),
        applied: result.applied,
        failed: result.failed,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        ...state(),
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
