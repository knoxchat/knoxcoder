/**
 * REL-15 — Sleep distill per topic.
 */
import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDir = path.join(os.tmpdir(), `brain-sleep-distill-${Date.now()}`);

let BrainManager: typeof import("./BrainManager.js").BrainManager;
let BrainStore: typeof import("./BrainStore.js").BrainStore;
let SleepConsolidation: typeof import("./SleepConsolidation.js").SleepConsolidation;

beforeAll(async () => {
  fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
  process.env.KNOX_GLOBAL_DIR = testDir;
  ({ BrainManager } = await import("./BrainManager.js"));
  ({ BrainStore } = await import("./BrainStore.js"));
  ({ SleepConsolidation } = await import("./SleepConsolidation.js"));
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
  await db.exec("DELETE FROM brain_semantic");
  await db.exec("DELETE FROM brain_episodic");
  await db.exec("DELETE FROM brain_session_topics");
  await db.exec("DELETE FROM brain_sessions");
}

async function seedWarmSession(
  sessionId: string,
  topic: string,
  keyword: string,
): Promise<void> {
  await BrainManager.trackSession(sessionId, topic, testDir);
  await BrainStore.addSessionTopic(sessionId, topic, topic, 0, 2, 0.9);
  await BrainManager.recordMessage(
    sessionId,
    "user",
    `We keep hitting ${keyword} while working on ${topic}.`,
  );
  await BrainManager.recordMessage(
    sessionId,
    "assistant",
    `${keyword} showed up again in the ${topic} notes.`,
  );
  const db = await BrainStore.get();
  await db.run(`UPDATE brain_episodic SET tier = 'warm' WHERE session_id = ?`, [sessionId]);
}

describe("REL-15 sleep distill per topic", () => {
  it("does not merge a keyword across unrelated topics into one pattern", async () => {
    await reset();
    const keyword = "galaxyfoo";
    await seedWarmSession("sleep-auth", "OAuth login", keyword);
    await seedWarmSession("sleep-readme", "README badges", keyword);
    await seedWarmSession("sleep-css", "Button styles", keyword);

    const distilled = await SleepConsolidation.remDistill();
    expect(distilled).toBe(0);

    const db = await BrainStore.get();
    const rows = (await db.all(
      `SELECT title, content, topic_id, source_session_id FROM brain_semantic WHERE category = 'insight'`,
    )) as { title: string; content: string }[];
    expect(rows.some((r) => r.title === `Recurring pattern: ${keyword}`)).toBe(false);
    expect(rows.some((r) => /OAuth login/.test(r.content) && /README badges/.test(r.content))).toBe(
      false,
    );
  });
});
