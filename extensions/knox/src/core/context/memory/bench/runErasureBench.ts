/**
 * MEM-80: erasure bench. Plant unique memories, forget them, then search
 * every index, edge, summary, and snapshot for leftover content. Gate is
 * zero hits.
 */
import fs from "fs";
import os from "os";
import path from "path";

export interface ErasureHit {
  where: string;
  detail: string;
}

export interface ErasureBenchReport {
  planted: number;
  forgotten: number;
  hits: number;
  hit_details: ErasureHit[];
  erasure_met: boolean;
  seedMs: number;
}

const NONCE = "zephyrerasurebenchxyz";

export async function runErasureBench(): Promise<ErasureBenchReport> {
  const dir = path.join(os.tmpdir(), `brain-erasure-bench-${process.pid}-${Date.now()}`);
  fs.mkdirSync(path.join(dir, "memory"), { recursive: true });
  const prevGlobal = process.env.KNOX_GLOBAL_DIR;
  process.env.KNOX_GLOBAL_DIR = dir;

  const { close } = await import("../brain/store/connection.js");
  await close();

  const { BrainManager } = await import("../brain/BrainManager.js");
  const { BrainStore } = await import("../brain/BrainStore.js");
  const { RetrievalFusion } = await import("../brain/RetrievalFusion.js");
  const { Hippocampus } = await import("../brain/regions/Hippocampus.js");
  const { checkErasure } = await import("../brain/invariants.js");

  const seedStart = performance.now();
  try {
    await BrainStore.get();
    await BrainStore.saveConfig("auto_extract_enabled", "false");
    await BrainStore.saveConfig("enable_knowledge_extraction", "false");

    const sessionId = "erasure-bench";
    await BrainManager.trackSession(sessionId, "Erasure bench", dir);
    const tokenA = `${NONCE}alpha`;
    const tokenB = `${NONCE}beta`;
    const keepId = await BrainManager.store({
      category: "fact",
      title: "Keep companion",
      content: "companion fact stays live after the planted leaves are erased",
      keywords: "companion",
      importance: 0.7,
      session_id: sessionId,
    });
    const idA = await BrainManager.store({
      category: "fact",
      title: `Erase ZephyrErasureOnlyEntity`,
      content: `The ${tokenA} document names ZephyrErasureOnlyEntity only here.`,
      keywords: tokenA,
      importance: 0.8,
      session_id: sessionId,
    });
    const idB = await BrainManager.store({
      category: "fact",
      title: `${tokenB} leaf`,
      content: `Planted erasure fact about ${tokenB} unique-erase-b`,
      keywords: tokenB,
      importance: 0.8,
      session_id: sessionId,
    });
    await BrainStore.createAssociation({
      source_type: "semantic",
      source_id: idA,
      target_type: "semantic",
      target_id: keepId,
      relationship: "related",
      strength: 0.8,
    });
    const { KnowledgeGraph } = await import("../brain/KnowledgeGraph.js");
    await KnowledgeGraph.addEntity({
      name: "ZephyrErasureOnlyEntity",
      entity_type: "concept",
      description: "only evidence is the forgotten leaf",
    });
    await Hippocampus.persistToLongTerm(sessionId, { semantic_count: 3, entity_count: 1 });
    const checkpoint = await BrainManager.createCheckpoint("complete");

    await BrainManager.forget(idA);
    await BrainManager.forget(idB);

    const hits: ErasureHit[] = [];
    const db = await BrainStore.get();

    for (const [token, id] of [[tokenA, idA], [tokenB, idB]] as const) {
      const fusion = await RetrievalFusion.search({
        query: token,
        includeEpisodic: false,
        limit: 20,
      });
      if (fusion.some((h) => h.type === "semantic" && h.id === id)) {
        hits.push({ where: "fusion", detail: token });
      }
      for (const table of ["brain_semantic_fts", "brain_semantic_fts_frozen"]) {
        try {
          const rows = await db.all(
            `SELECT rowid FROM ${table} WHERE ${table} MATCH ?`,
            [token],
          );
          if ((rows as unknown[]).length > 0) {
            hits.push({ where: table, detail: token });
          }
        } catch {
          // frozen segment may be absent
        }
      }
      const row = await BrainStore.getSemanticById(id);
      if (String(row?.title ?? "").trim() || String(row?.content ?? "").trim()) {
        hits.push({ where: "row-content", detail: token });
      }
      const tree = await db.get<{ text: string | null }>(
        `SELECT text FROM brain_summary_tree WHERE kind = 'leaf' AND leaf_type = 'semantic' AND leaf_id = ?`,
        [String(id)],
      );
      if (tree && String(tree.text ?? "").trim()) {
        hits.push({ where: "tree-text", detail: token });
      }
    }

    const entity = await db.get("SELECT id FROM brain_entities WHERE name = ?", [
      "ZephyrErasureOnlyEntity",
    ]);
    if (entity) hits.push({ where: "graph-entity", detail: "ZephyrErasureOnlyEntity" });

    try {
      const snapshot = BrainStore.readKnowledgeSnapshot(checkpoint.snapshot_path);
      for (const mem of snapshot.semantic ?? []) {
        if (Number(mem.id) !== idA && Number(mem.id) !== idB) continue;
        if (String(mem.content ?? "").trim() || String(mem.title ?? "").trim()) {
          hits.push({ where: "snapshot", detail: String(mem.id) });
        }
      }
    } catch {
      hits.push({ where: "snapshot", detail: "unreadable" });
    }

    const erasure = await checkErasure();
    return {
      planted: 2,
      forgotten: 2,
      hits: hits.length,
      hit_details: hits,
      erasure_met: erasure.met && hits.length === 0,
      seedMs: Math.round(performance.now() - seedStart),
    };
  } finally {
    try {
      await close();
    } catch {
      // best effort
    }
    if (prevGlobal === undefined) delete process.env.KNOX_GLOBAL_DIR;
    else process.env.KNOX_GLOBAL_DIR = prevGlobal;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // temp dir cleanup is best effort
    }
  }
}
