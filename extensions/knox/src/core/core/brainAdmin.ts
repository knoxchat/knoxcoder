import { BrainManager } from "../context/memory/brain/BrainManager";

import type { CoreRuntime } from "./runtime";

export function registerBrainAdminHandlers(core: CoreRuntime): void {
  const on = core.messenger.on.bind(core.messenger);

  on("brain/dashboard", async () => {
    try {
      const [
        stats,
        health,
        graphCap,
        sessionsData,
        healthScore,
        consolidation,
      ] = await Promise.all([
        BrainManager.getStats(),
        BrainManager.getHealth().catch(() => null),
        BrainManager.getGraphCapStatus().catch(() => null),
        BrainManager.listSessions(10).catch(() => []),
        BrainManager.getHealthScore().catch(() => null),
        Promise.resolve().then(() => {
          try {
            return BrainManager.getConsolidationStats();
          } catch {
            return null;
          }
        }),
      ]);
      // Best-effort metrics snapshot for trend dashboard (IMP-16).
      void BrainManager.storeMetricsSnapshot().catch(() => {});
      return {
        stats,
        health,
        graphStats: graphCap
          ? {
              total_entities: graphCap.entity_count,
              total_edges: graphCap.edges,
              entity_types: graphCap.entity_types,
              max_entities: graphCap.max_entities,
              cap_utilization: graphCap.cap_utilization,
              at_cap: graphCap.at_cap,
              max_depth: graphCap.max_depth,
              depth_decay_gamma: graphCap.depth_decay_gamma,
            }
          : null,
        sessions: sessionsData,
        healthScore,
        consolidation,
      };
    } catch (e) {
      return {
        stats: null,
        health: null,
        graphStats: null,
        sessions: [],
        healthScore: null,
        consolidation: null,
      };
    }
  });

  on("brain/getMetricsTrend", async (msg) => {
    return BrainManager.getMetricsTrend(msg.data?.hours ?? 24);
  });

  on("brain/graphStats", async () => {
    const [raw, cap] = await Promise.all([
      BrainManager.getGraphStats(),
      BrainManager.getGraphCapStatus(),
    ]);
    return {
      total_entities: raw?.entities ?? 0,
      total_edges: raw?.edges ?? 0,
      entity_types: raw?.entityTypes ?? {},
      max_entities: cap.max_entities,
      cap_utilization: cap.cap_utilization,
      at_cap: cap.at_cap,
      max_depth: cap.max_depth,
      depth_decay_gamma: cap.depth_decay_gamma,
    };
  });

  on("brain/searchEntities", async (msg) => {
    const entities = await BrainManager.searchEntities(
      msg.data.query,
      msg.data.entity_type,
      msg.data.limit,
    );
    return { entities: entities ?? [] };
  });

  on("brain/listEntities", async (msg) => {
    return BrainManager.listEntities({
      query: msg.data?.query,
      entityType: msg.data?.entity_type,
      limit: msg.data?.limit,
      offset: msg.data?.offset,
    });
  });

  on("brain/exploreGraph", async (msg) => {
    const config = BrainManager.getConfig();
    const result = await BrainManager.exploreGraph({
      entity_id: msg.data.entity_id,
      depth: msg.data.depth ?? config.graph_max_depth,
    });
    return { result };
  });

  on("brain/getConfig", async () => {
    const config = BrainManager.getConfig();
    return { config };
  });

  on("brain/updateConfig", async (msg) => {
    await BrainManager.updateConfig({
      key: msg.data.key,
      value: msg.data.value,
    } as any);
    // The scheduler captures the interval at start time — restart it so a
    // changed interval takes effect immediately.
    if (msg.data.key === "consolidation_interval_hours") {
      BrainManager.stopAutoConsolidation();
      BrainManager.startAutoConsolidation();
    }
    return { success: true };
  });

  on("brain/optimize", async () => {
    const result = await BrainManager.optimize();
    return { message: result };
  });

  on("brain/heal", async (msg) => {
    if (msg.data?.action) {
      const result = await BrainManager.runHealingAction(
        msg.data.action as any,
      );
      return { results: [result] };
    }
    const results = await BrainManager.autoHeal();
    return { results };
  });

  on("brain/export", async (msg) => {
    // Export writes a file to disk and returns the data as JSON string.
    // Optional password wraps the backup in AES-256-GCM (local only).
    const { BrainStore } =
      await import("../context/memory/brain/BrainStore.js");
    const exportData = await BrainStore.exportAll();
    const plaintext = JSON.stringify(exportData, null, 2);
    const password = msg.data?.password?.trim();
    let payload = plaintext;
    let encrypted = false;
    if (password) {
      const { encryptBrainExport } =
        await import("../context/memory/brain/exportCrypto.js");
      payload = JSON.stringify(encryptBrainExport(plaintext, password), null, 2);
      encrypted = true;
    }
    const { getMemoryBrainPath } = await import("../util/paths.js");
    const path = await import("path");
    const fs = await import("fs");
    const exportPath = path.join(
      getMemoryBrainPath(),
      `brain-export-${Date.now()}${encrypted ? ".enc" : ""}.json`,
    );
    fs.writeFileSync(exportPath, payload);
    return { data: payload, filePath: exportPath, encrypted };
  });

  on("brain/import", async (msg) => {
    // Webviews can't provide disk paths, so accept raw export JSON too.
    if (msg.data.data) {
      let parsed = JSON.parse(msg.data.data);
      const { isEncryptedBrainExport, decryptBrainExport } =
        await import("../context/memory/brain/exportCrypto.js");
      if (isEncryptedBrainExport(parsed)) {
        const decrypted = decryptBrainExport(parsed, msg.data.password ?? "");
        parsed = JSON.parse(decrypted);
      }
      if (!parsed.version) {
        throw new Error("Invalid export file: missing version field");
      }
      const { BrainStore } =
        await import("../context/memory/brain/BrainStore.js");
      const importResult = await BrainStore.importData(parsed);
      const summary = Object.entries(importResult.imported)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ");
      return { result: `Import complete: ${summary}` };
    }
    if (!msg.data.filePath) {
      throw new Error("brain/import requires filePath or data");
    }
    // File-path import: support encrypted envelopes when password provided
    const fs = await import("fs");
    const raw = fs.readFileSync(msg.data.filePath, "utf-8");
    let parsed = JSON.parse(raw);
    const { isEncryptedBrainExport, decryptBrainExport } =
      await import("../context/memory/brain/exportCrypto.js");
    if (isEncryptedBrainExport(parsed)) {
      const decrypted = decryptBrainExport(parsed, msg.data.password ?? "");
      parsed = JSON.parse(decrypted);
      const { BrainStore } =
        await import("../context/memory/brain/BrainStore.js");
      const importResult = await BrainStore.importData(parsed);
      const summary = Object.entries(importResult.imported)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ");
      return { result: `Import complete: ${summary}` };
    }
    const result = await BrainManager.importMemories(msg.data.filePath);
    return { result };
  });
}
