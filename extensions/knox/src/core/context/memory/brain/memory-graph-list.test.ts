/**
 * Dashboard entity browse (Graph tab) must list every entity, including
 * common-noun ones, without a search query and without LRU side effects.
 */
import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDir = path.join(os.tmpdir(), `brain-graph-list-${Date.now()}`);

let BrainStore: typeof import("./BrainStore.js").BrainStore;
let KnowledgeGraph: typeof import("./KnowledgeGraph.js").KnowledgeGraph;

beforeAll(async () => {
  fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
  process.env.KNOX_GLOBAL_DIR = testDir;
  ({ BrainStore } = await import("./BrainStore.js"));
  ({ KnowledgeGraph } = await import("./KnowledgeGraph.js"));
  await BrainStore.get();
});

afterAll(() => {
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch {}
});

async function seed() {
  const db = await BrainStore.get();
  await db.exec("DELETE FROM brain_graph_edges");
  await db.exec("DELETE FROM brain_entities");
  const add = (name: string, entity_type: any, description = "") =>
    BrainStore.addEntity({ name, entity_type, description, properties: {}, confidence: 0.8 } as any);
  const react = await add("React", "framework", "UI library");
  const ts = await add("TypeScript", "language");
  const file = await add("file", "concept");
  await BrainStore.addEdge({ source_entity_id: react, target_entity_id: ts, relationship: "written_in" });
  await BrainStore.addEdge({ source_entity_id: ts, target_entity_id: file, relationship: "compiles" });
  await BrainStore.addEdge({ source_entity_id: react, target_entity_id: file, relationship: "uses" });
  return { react, ts, file };
}

describe("BrainStore.listEntities", () => {
  it("lists all entities with no query (the old '*' query returned nothing)", async () => {
    await seed();
    expect(await BrainStore.searchEntities("*", undefined, 50)).toEqual([]);

    const all = await BrainStore.listEntities({});
    expect(all.total).toBe(3);
    expect(all.entities.map((e) => e.name).sort()).toEqual(["React", "TypeScript", "file"]);
    expect(all.entities.find((e) => e.name === "React")!.edge_count).toBe(2);

    expect((await BrainStore.listEntities({ query: "*" })).total).toBe(3);
  });

  it("filters by substring and type, and paginates", async () => {
    await seed();
    const byName = await BrainStore.listEntities({ query: "scri" });
    expect(byName.entities.map((e) => e.name)).toEqual(["TypeScript"]);

    const byDesc = await BrainStore.listEntities({ query: "ui lib" });
    expect(byDesc.entities.map((e) => e.name)).toEqual(["React"]);

    const byType = await BrainStore.listEntities({ entityType: "concept" });
    expect(byType.total).toBe(1);

    const literalPercent = await BrainStore.listEntities({ query: "%" });
    expect(literalPercent.total).toBe(0);

    const p1 = await BrainStore.listEntities({ limit: 2, offset: 0 });
    const p2 = await BrainStore.listEntities({ limit: 2, offset: 2 });
    expect(p1.total).toBe(3);
    expect(p1.entities).toHaveLength(2);
    expect(p2.entities).toHaveLength(1);
  });

  it("does not bump updated_at (no LRU touch)", async () => {
    await seed();
    const db = await BrainStore.get();
    await db.exec("UPDATE brain_entities SET updated_at = '2000-01-01 00:00:00'");
    await BrainStore.listEntities({});
    const row = (await db.get("SELECT MAX(updated_at) AS m FROM brain_entities")) as any;
    expect(row.m).toBe("2000-01-01 00:00:00");
  });
});

describe("KnowledgeGraph.explore", () => {
  it("returns each edge once even when both endpoints are expanded", async () => {
    const { react } = await seed();
    const result = await KnowledgeGraph.explore({ entity_id: react, depth: 3 });
    const ids = result.edges.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(3);
  });
});
