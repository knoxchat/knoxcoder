import { BrainManager } from "../context/memory/brain/BrainManager";
import {
  autoStoreTask,
  getLastSoulEvent,
  recordSoulEvent,
} from "../context/soul/recordSoulEvent.js";

import type { CoreRuntime } from "./runtime";

export function registerBrainHandlers(core: CoreRuntime): void {
  const on = core.messenger.on.bind(core.messenger);

  // ── Memory Brain Handlers (Knox-MS-style persistent brain memory) ──
  on("brain/dispatch", async (msg) => {
    const result = await BrainManager.dispatch(msg.data.action, msg.data);
    return { result };
  });

  on("brain/trackSession", async (msg) => {
    await BrainManager.trackSession(
      msg.data.sessionId,
      msg.data.title,
      msg.data.workspaceDir,
    );
  });

  on("brain/recordMessage", async (msg) => {
    const id = await BrainManager.recordMessage(
      msg.data.sessionId,
      msg.data.role,
      msg.data.content,
      {
        type: msg.data.type as any,
        tokenCount: msg.data.tokenCount,
        importance: msg.data.importance,
        metadata: msg.data.metadata,
      },
    );
    return { id };
  });

  on("brain/recordSoulEvent", async (msg) => {
    const id = await recordSoulEvent({
      sessionId: msg.data.sessionId,
      kind: msg.data.kind,
      toolName: msg.data.toolName,
      files: msg.data.files ?? [],
      workspaceCheckpointId: msg.data.workspaceCheckpointId,
      memoryCheckpointId: msg.data.memoryCheckpointId,
      ok: msg.data.ok,
      policy: msg.data.policy,
      summary: msg.data.summary,
    });
    return { id };
  });

  on("brain/getLastSoulEvent", async (msg) => {
    const event = getLastSoulEvent(msg.data.sessionId) ?? null;
    return { event };
  });

  on("brain/autoStore", async (msg) => {
    try {
      await autoStoreTask({
        taskDescription: msg.data.taskDescription,
        filesModified: msg.data.filesModified,
        sessionSummary: msg.data.sessionSummary,
        sessionId: msg.data.sessionId,
      });
      return { success: true };
    } catch {
      return { success: false };
    }
  });

  on("brain/buildContext", async (msg) => {
    const result = await BrainManager.buildContextDetailed(
      msg.data.message,
      msg.data.sessionId,
      msg.data.maxTokens,
      {
        goal: msg.data.goal,
        memory_mode: msg.data.memoryMode,
      },
    );
    return { context: result.context, items: result.items };
  });

  on("brain/runPipeline", async (msg) => {
    const result = await BrainManager.runPipeline({
      mode: msg.data.mode as any,
      message: msg.data.message,
      session_id: msg.data.sessionId,
      role: msg.data.role,
      goal: msg.data.goal,
      max_tokens: msg.data.maxTokens,
      turn_content: msg.data.turnContent,
    });
    return {
      phases: result.phases ?? [],
      context: result.context?.context,
      items: result.context?.items,
      extracted: (result as any).extracted,
    };
  });

  on("brain/getEffectiveContext", async () => {
    return await BrainManager.getEffectiveContext();
  });

  on("brain/getPhaseStatus", async () => {
    return BrainManager.getPhaseStatus();
  });

  on("brain/getReviewDue", async (msg) => {
    const items = await BrainManager.getReviewDue(msg.data?.limit ?? 10);
    return { items, count: items.length };
  });

  on("brain/getEbbinghausStats", async () => {
    return await BrainManager.getEbbinghausStats();
  });

  on("brain/routeTask", async (msg) => {
    return BrainManager.routeTask({
      message: msg.data.message,
      toolCount: msg.data.toolCount,
      codeBlockCount: msg.data.codeBlockCount,
    });
  });

  on("brain/getSessionHistory", async (msg) => {
    return BrainManager.getSessionHistoryFull(msg.data.sessionId, {
      episodicLimit: msg.data.episodicLimit,
      semanticLimit: msg.data.semanticLimit,
    });
  });

  on("brain/pinMemory", async (msg) => {
    const success = await BrainManager.pinMemory(msg.data.id);
    return { success };
  });

  on("brain/unpinMemory", async (msg) => {
    const success = await BrainManager.unpinMemory(msg.data.id);
    return { success };
  });

  on("brain/mismatchMemory", async (msg) => {
    const success = await BrainManager.recordMismatch(
      msg.data.id,
      msg.data.sessionId,
    );
    return { success };
  });

  on("brain/getAuditLog", async (msg) => {
    const { BrainStore } =
      await import("../context/memory/brain/BrainStore.js");
    const entries = await BrainStore.getAuditLog({
      action: msg.data?.action,
      limit: msg.data?.limit ?? 50,
      since: msg.data?.since,
    });
    return {
      entries: entries.map((e) => {
        let details: unknown = e.details;
        if (typeof e.details === "string") {
          try {
            details = JSON.parse(e.details);
          } catch {
            details = e.details;
          }
        }
        return { ...e, details };
      }),
    };
  });

  on("brain/pinMemories", async (msg) => {
    return BrainManager.pinMemories(msg.data.ids ?? []);
  });

  on("brain/unpinMemories", async (msg) => {
    return BrainManager.unpinMemories(msg.data.ids ?? []);
  });

  on("brain/deleteMemories", async (msg) => {
    const result = await BrainManager.forgetMany(msg.data.ids ?? []);
    return {
      deleted: result.deleted,
      failed: result.failed,
      errors: result.errors,
    };
  });

  on("brain/store", async (msg) => {
    const id = await BrainManager.store(msg.data);
    return { id };
  });

  on("brain/recall", async (msg) => {
    const result = await BrainManager.recall(msg.data);
    return { result };
  });

  on("brain/stats", async () => {
    const stats = await BrainManager.getStats();
    return { stats };
  });

  on("brain/deleteMemory", async (msg) => {
    const result = await BrainManager.forget(msg.data.id);
    return { success: result };
  });

  on("brain/searchMemories", async (msg) => {
    try {
      const { BrainStore } =
        await import("../context/memory/brain/BrainStore.js");
      const annotatePinned = async (memories: any[]) => {
        if (!memories.length) return memories;
        const ids = memories.map((m) => m.id).filter((id) => typeof id === "number");
        if (!ids.length) return memories;
        const db = await BrainStore.get();
        const placeholders = ids.map(() => "?").join(",");
        const pinnedRows = await db.all(
          `SELECT memory_id FROM brain_tags
             WHERE memory_type = 'semantic' AND tag = 'pinned'
             AND memory_id IN (${placeholders})`,
          ids,
        );
        const pinned = new Set(pinnedRows.map((r: any) => r.memory_id));
        return memories.map((m) => ({ ...m, pinned: pinned.has(m.id) }));
      };

      if (msg.data.query && msg.data.query !== "*") {
        const result = await BrainManager.recall({
          query: msg.data.query,
          category: msg.data.category as any,
          limit: msg.data.limit,
        });
        let memories = await annotatePinned(result?.semantic ?? []);
        if (msg.data.tier) {
          memories = memories.filter((m: any) => m.tier === msg.data.tier);
        }
        if (msg.data.pinned === true) {
          memories = memories.filter((m: any) => m.pinned);
        } else if (msg.data.pinned === false) {
          memories = memories.filter((m: any) => !m.pinned);
        }
        return { memories };
      }
      // Browse all — use BrainStore directly
      const db = await BrainStore.get();
      const conditions: string[] = [];
      const sqlParams: any[] = [];
      if (msg.data.category) {
        conditions.push("category = ?");
        sqlParams.push(msg.data.category);
      }
      if (msg.data.tier) {
        conditions.push("tier = ?");
        sqlParams.push(msg.data.tier);
      }
      if (msg.data.pinned === true) {
        conditions.push(
          `id IN (SELECT memory_id FROM brain_tags WHERE memory_type = 'semantic' AND tag = 'pinned')`,
        );
      } else if (msg.data.pinned === false) {
        conditions.push(
          `id NOT IN (SELECT memory_id FROM brain_tags WHERE memory_type = 'semantic' AND tag = 'pinned')`,
        );
      }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      sqlParams.push(msg.data.limit ?? 100, msg.data.offset ?? 0);
      const rows = await db.all(
        `SELECT * FROM brain_semantic ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        sqlParams,
      );
      return { memories: await annotatePinned(rows ?? []) };
    } catch {
      return { memories: [] };
    }
  });

  on("brain/consolidate", async () => {
    const result = await BrainManager.consolidate();
    return { result };
  });

  on("brain/listSessions", async (msg) => {
    const sessions = await BrainManager.listSessions(
      msg.data?.limit,
      msg.data?.workspace_directory,
    );
    return { sessions };
  });

  on("brain/summarizeSession", async (msg) => {
    const summary = await BrainManager.summarizeSession(msg.data);
    return { summary };
  });

  on("brain/searchBacklogs", async (msg) => {
    const result = await BrainManager.searchBacklogs(msg.data);
    return { result };
  });

  on("brain/llmExtractEntities", async (msg) => {
    const result = await BrainManager.llmExtractEntities(
      msg.data.text,
      msg.data.session_id,
    );
    return { result };
  });

  on("brain/llmSummarizeSession", async (msg) => {
    const result = await BrainManager.llmSummarizeSession(
      msg.data.session_id,
      msg.data.detail_level as any,
    );
    return { summary: result.summary, llm_used: result.llm_used };
  });

  on("brain/llmEvaluateImportance", async (msg) => {
    const result = await BrainManager.llmEvaluateImportance(
      msg.data.content,
      msg.data.role,
      msg.data.context,
    );
    return result;
  });

  on("brain/llmPostActionMemory", async (msg) => {
    const result = await BrainManager.llmPostActionMemory(
      msg.data.action_description,
      msg.data.action_result,
      msg.data.session_id,
    );
    return { result };
  });

  on("brain/createCheckpoint", async (msg) => {
    const checkpoint = await BrainManager.createCheckpoint(msg.data.label);
    return { checkpoint };
  });

  on("brain/listCheckpoints", async (msg) => {
    const checkpoints = await BrainManager.listCheckpoints(msg.data?.limit);
    return { checkpoints };
  });

  on("brain/rollbackCheckpoint", async (msg) => {
    const result = await BrainManager.rollbackCheckpoint(
      msg.data.checkpoint_id,
    );
    return { result };
  });

  on("brain/deleteCheckpoint", async (msg) => {
    const success = await BrainManager.deleteCheckpoint(
      msg.data.checkpoint_id,
    );
    return { success };
  });
}
