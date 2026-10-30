/**
 * MEM-05 — summaries are pointers; leaf content is not overwritten.
 */
import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDir = path.join(os.tmpdir(), `brain-mem05-${Date.now()}`);

let BrainManager: typeof import("./BrainManager.js").BrainManager;
let BrainStore: typeof import("./BrainStore.js").BrainStore;
let Hippocampus: typeof import("./regions/Hippocampus.js").Hippocampus;
let SleepConsolidation: typeof import("./SleepConsolidation.js").SleepConsolidation;
let FiveTierHierarchy: typeof import("./advanced/fiveTierHierarchy.js").FiveTierHierarchy;
let summarizeSession: typeof import("./manager/summarize.js").summarizeSession;
let parseSummaryOf: typeof import("./store/summaryTree.js").parseSummaryOf;
let compressContent: typeof import("./store/compression.js").compressContent;

beforeAll(async () => {
  fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
  process.env.KNOX_GLOBAL_DIR = testDir;
  ({ BrainManager } = await import("./BrainManager.js"));
  ({ BrainStore } = await import("./BrainStore.js"));
  ({ Hippocampus } = await import("./regions/Hippocampus.js"));
  ({ SleepConsolidation } = await import("./SleepConsolidation.js"));
  ({ FiveTierHierarchy } = await import("./advanced/fiveTierHierarchy.js"));
  ({ summarizeSession } = await import("./manager/summarize.js"));
  ({ parseSummaryOf } = await import("./store/summaryTree.js"));
  ({ compressContent } = await import("./store/compression.js"));
  await BrainStore.get();
  await BrainStore.saveConfig("auto_extract_enabled", "false");
  await BrainStore.saveConfig("enable_knowledge_extraction", "false");
});

afterAll(() => {
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch {}
});

async function reset(): Promise<void> {
  const db = await BrainStore.get();
  await db.exec("DELETE FROM brain_summary_tree");
  await db.exec("DELETE FROM brain_tags");
  await db.exec("DELETE FROM brain_episodic");
  await db.exec("DELETE FROM brain_semantic");
  await db.exec("DELETE FROM brain_session_topics");
  await db.exec("DELETE FROM brain_sessions");
}

async function rawContent(kind: "semantic" | "episodic", id: number): Promise<string> {
  const db = await BrainStore.get();
  const table = kind === "semantic" ? "brain_semantic" : "brain_episodic";
  const row = await db.get<{ content: string }>(`SELECT content FROM ${table} WHERE id = ?`, [id]);
  return row?.content ?? "";
}

async function treeLists(kind: "semantic" | "episodic", id: number): Promise<boolean> {
  const db = await BrainStore.get();
  const row = await db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM brain_summary_tree
     WHERE kind = 'leaf' AND leaf_type = ? AND leaf_id = ?`,
    [kind, String(id)],
  );
  return (row?.n ?? 0) > 0;
}

const LONG_LEAF = (token: string) =>
  `${token} ${"alpha bravo charlie delta echo foxtrot golf hotel india ".repeat(8)}`;

describe("MEM-05 parseSummaryOf", () => {
  it("accepts a typed JSON list and bare ids", () => {
    expect(parseSummaryOf('[{"type":"semantic","id":4},{"type":"episodic","id":9}]')).toEqual([
      { type: "semantic", id: 4 },
      { type: "episodic", id: 9 },
    ]);
    expect(parseSummaryOf("[3, 5]")).toEqual([
      { type: "episodic", id: 3 },
      { type: "episodic", id: 5 },
    ]);
    expect(parseSummaryOf(null)).toEqual([]);
  });
});

describe("MEM-05 summaries are pointers", () => {
  it("Hippocampus persist writes a pointer and leaves warm content intact", async () => {
    await reset();
    const sessionId = "mem05-hippo";
    const token = "warmleafpointerxyz";
    const original = LONG_LEAF(token);
    await BrainManager.trackSession(sessionId, "MEM-05 hippo", testDir);
    const id = await BrainStore.storeSemantic({
      category: "fact",
      title: "Long warm fact",
      content: original,
      keywords: token,
      importance: 0.8,
      session_id: sessionId,
    });
    const db = await BrainStore.get();
    await db.run("UPDATE brain_semantic SET tier = 'warm' WHERE id = ?", [id]);

    const result = await Hippocampus.persistToLongTerm(sessionId, {
      semantic_count: 1,
      entity_count: 0,
    });
    expect(result.compressed).toBeGreaterThanOrEqual(1);
    expect(await rawContent("semantic", id)).toBe(original);
    expect((await rawContent("semantic", id)).startsWith("z:")).toBe(false);
    expect(await treeLists("semantic", id)).toBe(true);

    const again = await Hippocampus.persistToLongTerm(sessionId, {
      semantic_count: 1,
      entity_count: 0,
    });
    expect(again.compressed).toBe(0);
    expect(await rawContent("semantic", id)).toBe(original);
  });

  it("after sleep, originals match pre-sleep text and a summary node lists them", async () => {
    await reset();
    const sessionId = "mem05-sleep";
    const token = "sleeporiginalpointer";
    const original = LONG_LEAF(token);
    await BrainManager.trackSession(sessionId, "MEM-05 sleep", testDir);
    const id = await BrainStore.storeSemantic({
      category: "fact",
      title: "Cold leaf that must survive sleep",
      content: original,
      keywords: token,
      importance: 0.9,
      session_id: sessionId,
    });
    const db = await BrainStore.get();
    await db.run(
      `UPDATE brain_semantic
       SET importance_score = 0.9, i0 = 0.9, retrieval_count = 10, stability = 14,
           last_accessed_at = datetime('now', '-90 days')
       WHERE id = ?`,
      [id],
    );

    const cycle = await SleepConsolidation.runCycle();
    expect(cycle.compressed).toBeGreaterThanOrEqual(1);
    expect(await rawContent("semantic", id)).toBe(original);
    expect(await treeLists("semantic", id)).toBe(true);
  });

  it("five-tier frozen path does not gzip-replace leaf content", async () => {
    await reset();
    const sessionId = "mem05-frozen";
    const token = "frozenleafpointer";
    const original = LONG_LEAF(token);
    await BrainManager.trackSession(sessionId, "MEM-05 frozen", testDir);
    const id = await BrainStore.addEpisodic(
      sessionId,
      "user_message",
      "user",
      original,
      40,
      0.2,
    );
    const db = await BrainStore.get();
    await db.run(
      `UPDATE brain_episodic
       SET created_at = datetime('now', '-400 days'), stability = 1, i0 = 0.2
       WHERE id = ?`,
      [id],
    );

    const result = await FiveTierHierarchy.consolidate();
    expect(result.compressed).toBeGreaterThanOrEqual(1);
    expect(await rawContent("episodic", id)).toBe(original);
    expect((await rawContent("episodic", id)).startsWith("z:")).toBe(false);
    expect(await treeLists("episodic", id)).toBe(true);
  });

  it("remDistill links source episodic ids and leaves originals intact", async () => {
    await reset();
    const keyword = "quasarpine";
    const topic = "Auth tokens";
    const originals = new Map<string, string[]>();
    for (const sessionId of ["mem05-d1", "mem05-d2", "mem05-d3"]) {
      await BrainManager.trackSession(sessionId, topic, testDir);
      await BrainStore.addSessionTopic(sessionId, topic, topic, 0, 2, 0.9);
      const first = `We keep hitting ${keyword} while working on ${topic}.`;
      const second = `${keyword} showed up again in the ${topic} notes.`;
      await BrainManager.recordMessage(sessionId, "user", first);
      await BrainManager.recordMessage(sessionId, "assistant", second);
      originals.set(sessionId, [first, second]);
      const db = await BrainStore.get();
      await db.run(`UPDATE brain_episodic SET tier = 'warm' WHERE session_id = ?`, [sessionId]);
    }

    const distilled = await SleepConsolidation.remDistill();
    expect(distilled).toBeGreaterThanOrEqual(1);

    const db = await BrainStore.get();
    const insight = await db.get<{ id: number; summary_of: string }>(
      `SELECT id, summary_of FROM brain_semantic WHERE category = 'insight'`,
    );
    expect(insight?.summary_of).toBeTruthy();
    const refs = parseSummaryOf(insight!.summary_of);
    expect(refs.length).toBeGreaterThanOrEqual(2);
    expect(refs.every((r) => r.type === "episodic" && r.id > 0)).toBe(true);

    for (const [sessionId, texts] of originals) {
      const rows = (await db.all(
        `SELECT id, content, parent_id FROM brain_episodic WHERE session_id = ? ORDER BY id`,
        [sessionId],
      )) as { id: number; content: string; parent_id: number | null }[];
      expect(rows.map((r) => r.content)).toEqual(texts);
      expect(rows.some((r) => refs.some((ref) => ref.id === r.id))).toBe(true);
    }

    const leafCount = await db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM brain_summary_tree WHERE kind = 'leaf' AND leaf_type = 'episodic'`,
    );
    expect((leafCount?.n ?? 0)).toBeGreaterThanOrEqual(2);
  });

  it("session summary keeps the string and a tree node listing original turns", async () => {
    await reset();
    const sessionId = "mem05-session";
    const first = "We decided on oauth jwt refresh for the auth service.";
    const second = "Keep the refresh cookie http-only and rotate it.";
    await BrainManager.trackSession(sessionId, "MEM-05 session", testDir);
    await BrainManager.recordMessage(sessionId, "user", first);
    await BrainManager.recordMessage(sessionId, "assistant", second);

    const summary = await summarizeSession({ session_id: sessionId });
    expect(summary.length).toBeGreaterThan(20);

    const session = await BrainStore.getSession(sessionId);
    expect(session?.summary).toBe(summary);
    expect(session?.summary_node_id).toBeTruthy();

    const db = await BrainStore.get();
    const episodic = (await db.all(
      `SELECT id, content FROM brain_episodic WHERE session_id = ? ORDER BY id`,
      [sessionId],
    )) as { id: number; content: string }[];
    expect(episodic.map((r) => r.content)).toEqual([first, second]);

    const leaves = await BrainStore.listSummaryLeaves(session!.summary_node_id!);
    expect(leaves.map((l) => l.id).sort()).toEqual(episodic.map((r) => r.id).sort());

    const semantic = await db.get<{ summary_of: string }>(
      `SELECT summary_of FROM brain_semantic WHERE category = 'summary' AND source_session_id = ?`,
      [sessionId],
    );
    expect(parseSummaryOf(semantic?.summary_of).map((r) => r.id).sort()).toEqual(
      episodic.map((r) => r.id).sort(),
    );
  });

  it("legacy z: rows still decode through the mapper", async () => {
    await reset();
    const sessionId = "mem05-legacy-z";
    const original = LONG_LEAF("legacygzipdecode");
    await BrainManager.trackSession(sessionId, "MEM-05 legacy z", testDir);
    const id = await BrainStore.storeSemantic({
      category: "fact",
      title: "Already gzipped leaf",
      content: original,
      session_id: sessionId,
    });
    const zipped = compressContent(original);
    expect(zipped.startsWith("z:")).toBe(true);
    const db = await BrainStore.get();
    await db.run("UPDATE brain_semantic SET content = ? WHERE id = ?", [zipped, id]);

    expect(await rawContent("semantic", id)).toBe(zipped);
    const mapped = await BrainStore.getSemanticById(id);
    expect(mapped?.content).toBe(original);
  });
});
