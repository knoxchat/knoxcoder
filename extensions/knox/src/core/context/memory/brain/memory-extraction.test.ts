/**
 * REL-08 — Extraction quality: dedup, less greedy heuristics, split turns.
 */
import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AutoMemory,
  EXPLICIT_REMEMBER_IMPORTANCE,
  HEURISTIC_IMPORTANCE,
} from "./AutoMemory.js";

const testDir = path.join(os.tmpdir(), `brain-extract-${Date.now()}`);

let BrainManager: typeof import("./BrainManager.js").BrainManager;
let BrainStore: typeof import("./BrainStore.js").BrainStore;
let Hippocampus: typeof import("./regions/Hippocampus.js").Hippocampus;

beforeAll(async () => {
  fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
  process.env.KNOX_GLOBAL_DIR = testDir;
  ({ BrainManager } = await import("./BrainManager.js"));
  ({ BrainStore } = await import("./BrainStore.js"));
  ({ Hippocampus } = await import("./regions/Hippocampus.js"));
  await BrainStore.get();
  await BrainStore.saveConfig("auto_extract_enabled", "true");
  await BrainStore.saveConfig("enable_knowledge_extraction", "true");
});

afterAll(() => {
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch {}
});

async function reset(): Promise<void> {
  const db = await BrainStore.get();
  await db.exec("DELETE FROM brain_semantic");
  await db.exec("DELETE FROM brain_session_topics");
  await db.exec("DELETE FROM brain_sessions");
  AutoMemory.resetTopicTracking();
}

describe("REL-08 heuristics", () => {
  it("extracts a user decision about SQLite", () => {
    const memories = AutoMemory.extractSemanticMemories(
      "We decided to use SQLite for the brain",
      "user",
    );
    expect(memories.some((m) => m.category === "decision")).toBe(true);
    expect(memories[0].importance).toBe(HEURISTIC_IMPORTANCE);
    expect(memories[0].content.toLowerCase()).toContain("sqlite");
  });

  it("creates zero semantic rows for generic assistant filler", () => {
    expect(
      AutoMemory.extractSemanticMemories("I'll update the file", "assistant"),
    ).toHaveLength(0);
    expect(
      AutoMemory.extractSemanticMemories(
        "I'll update the file with the latest changes from the branch now.",
        "assistant",
      ),
    ).toHaveLength(0);
    expect(
      AutoMemory.extractSemanticMemories("Let me look at this next.", "assistant"),
    ).toHaveLength(0);
  });

  it("requires a content noun after we should", () => {
    expect(
      AutoMemory.extractSemanticMemories("We should do it now please.", "user"),
    ).toHaveLength(0);
    const kept = AutoMemory.extractSemanticMemories(
      "We should use SQLite for the local brain store.",
      "user",
    );
    expect(kept.some((m) => m.category === "decision")).toBe(true);
  });

  it("drops this-project sentences without a concrete claim", () => {
    expect(
      AutoMemory.extractSemanticMemories(
        "This project is interesting to work on today.",
        "user",
      ),
    ).not.toContainEqual(expect.objectContaining({ category: "project_context" }));
    const kept = AutoMemory.extractSemanticMemories(
      "This project uses SQLite for the brain storage layer.",
      "user",
    );
    expect(kept.some((m) => m.category === "project_context")).toBe(true);
  });

  it("scores explicit remember higher than heuristic hits", () => {
    const explicit = AutoMemory.extractSemanticMemories(
      "Remember that the brain sqlite file lives under ~/.knox/memory.",
      "user",
    );
    expect(explicit[0].importance).toBe(EXPLICIT_REMEMBER_IMPORTANCE);
  });
});

describe("REL-08 store path", () => {
  it("storing the same decision twice boosts one row", async () => {
    await reset();
    const sessionId = "rel08-dedup";
    await BrainManager.trackSession(sessionId, "Dedup", testDir);
    const text = "We decided to use SQLite for the brain storage layer.";

    await AutoMemory.extract(text, "user", sessionId);
    await AutoMemory.extract(text, "user", sessionId);

    const db = await BrainStore.get();
    const rows = await db.all(
      "SELECT id, importance_score FROM brain_semantic WHERE source_session_id = ?",
      [sessionId],
    );
    expect(rows.length).toBe(1);
    expect((rows[0] as { importance_score: number }).importance_score).toBeGreaterThan(
      HEURISTIC_IMPORTANCE,
    );
  });

  it("extract() stores zero rows for I'll-update filler", async () => {
    await reset();
    const sessionId = "rel08-filler";
    await BrainManager.trackSession(sessionId, "Filler", testDir);
    const result = await AutoMemory.extract(
      "I'll update the file with the latest changes from the branch now.",
      "assistant",
      sessionId,
    );
    expect(result.semantic_count).toBe(0);
    const db = await BrainStore.get();
    const row = await db.get(
      "SELECT COUNT(*) as c FROM brain_semantic WHERE source_session_id = ?",
      [sessionId],
    );
    expect((row as { c: number }).c).toBe(0);
  });

  it("extractTurn keeps the user decision and skips assistant filler", async () => {
    await reset();
    const sessionId = "rel08-split";
    await BrainManager.trackSession(sessionId, "Split", testDir);
    const result = await AutoMemory.extractTurn({
      sessionId,
      userMessage: "We decided to use SQLite for the brain storage layer.",
      assistantMessage: "I'll update the file with the latest changes now.",
      toolSummary: "Ran search_files over src with 12 matches.",
    });
    expect(result.semantic_count).toBeGreaterThan(0);
    const db = await BrainStore.get();
    const rows = (await db.all(
      "SELECT title, content FROM brain_semantic WHERE source_session_id = ?",
      [sessionId],
    )) as { title: string; content: string }[];
    expect(rows.some((r) => /sqlite/i.test(r.content))).toBe(true);
    expect(rows.some((r) => /I'll update the file/i.test(r.content))).toBe(false);
  });

  it("Hippocampus.encode splits labeled User/Assistant blobs", async () => {
    await reset();
    const sessionId = "rel08-labeled";
    await BrainManager.trackSession(sessionId, "Labeled", testDir);
    const result = await Hippocampus.encode(
      "User: We decided to use SQLite for the brain.\nAssistant: I'll update the file with the latest changes now.",
      "assistant",
      sessionId,
    );
    expect(result.semantic_count).toBeGreaterThan(0);
    const db = await BrainStore.get();
    const rows = (await db.all(
      "SELECT content FROM brain_semantic WHERE source_session_id = ?",
      [sessionId],
    )) as { content: string }[];
    expect(rows.some((r) => /sqlite/i.test(r.content))).toBe(true);
  });
});
