/**
 * Checkpoint store upgrade/multi-window tests that need no editor: they drive
 * the persistence functions against a stub host and a temp store.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHECKPOINT_SCHEMA_VERSION_V1,
  computeCheckpointContentSha256,
} from "../store/checkpointIntegrity";

let store: string;
let ws: string;

beforeEach(() => {
  store = fs.mkdtempSync(path.join(os.tmpdir(), "knox-cpstore-"));
  ws = fs.mkdtempSync(path.join(os.tmpdir(), "knox-cpws-"));
  vi.resetModules();
});
afterEach(() => {
  fs.rmSync(store, { recursive: true, force: true });
  fs.rmSync(ws, { recursive: true, force: true });
});

function makeHost(): any {
  const host: any = {
    initialized: true,
    whenReady: async () => {},
    currentWorkspacePath: ws,
    workspaceFolderPaths: [ws],
    messageCheckpoints: {},
    stableIdCheckpoints: {},
    checkpointHistory: [],
    branches: [],
    activeBranchId: undefined,
    healthIssues: [],
    lastCheckpointLoad: null,
    lastSnapshotHashes: new Map(),
    previousCheckpointFiles: new Set(),
    lastCheckpointTime: 0,
    enableCompression: false,
    encryptAtRest: false,
    encryptionKeyProvider: undefined,
    extensionContext: undefined,
    getStoragePath: () => store,
  };
  return host;
}

/** A schema-1 manifest with inlined content, as written by 1.138.x / 2.0.0-beta. */
function writeV1Manifest(id: string, files: Record<string, string>, created: string) {
  const fileSnapshots = Object.entries(files).map(([relativePath, content]) => ({
    relativePath,
    content,
    encoding: "utf8",
    lastModified: created,
    size: Buffer.byteLength(content),
  }));
  const fileInventory = Object.keys(files);
  const contentSha256 = computeCheckpointContentSha256({
    id,
    schemaVersion: CHECKPOINT_SCHEMA_VERSION_V1,
    fileInventory,
    skippedFiles: [],
    fileSnapshots,
  });
  fs.writeFileSync(
    path.join(store, `${id}.json`),
    JSON.stringify({
      id,
      description: id,
      created,
      workspacePath: ws,
      fileInventory,
      skippedFiles: [],
      schemaVersion: CHECKPOINT_SCHEMA_VERSION_V1,
      contentSha256,
      fileSnapshots,
    }),
  );
}

describe("checkpoint store upgrade", () => {
  it("loads schema-1 (inline content) manifests and an unversioned index, backs the index up once", async () => {
    writeV1Manifest("cp_1", { "a.ts": "const a = 1;\n" }, "2026-01-01T00:00:00.000Z");
    writeV1Manifest("cp_2", { "a.ts": "const a = 2;\n", "b.ts": "b" }, "2026-01-02T00:00:00.000Z");
    // Old index: no indexVersion, fat (carries file inventory).
    const legacyIndex = JSON.stringify({
      messageCheckpoints: { m1: "cp_1" },
      stableIdCheckpoints: {},
      checkpointHistory: [
        { id: "cp_1", description: "one", created: "2026-01-01T00:00:00.000Z", fileInventory: ["a.ts"], fileSnapshots: [] },
        { id: "cp_2", description: "two", created: "2026-01-02T00:00:00.000Z", fileInventory: ["a.ts", "b.ts"], fileSnapshots: [] },
      ],
    });
    fs.writeFileSync(path.join(store, "index.json"), legacyIndex);

    const p = await import("./persistence");
    const host = makeHost();
    host.saveCheckpointHistory = () => p.saveCheckpointHistory(host);
    await p.loadCheckpointHistory(host, { globalStorageUri: { fsPath: path.join(ws, "gs") } } as any);

    expect(host.checkpointHistory.map((c: any) => c.id)).toEqual(["cp_1", "cp_2"]);
    expect(host.messageCheckpoints).toEqual({ m1: "cp_1" });

    // Every checkpoint still loads and restores its exact bytes.
    const cp2 = await p.loadCheckpointFromDisk(host, "cp_2");
    expect(cp2?.fileSnapshots?.map((s: any) => [s.relativePath, s.content])).toEqual([
      ["a.ts", "const a = 2;\n"],
      ["b.ts", "b"],
    ]);

    // Index rewritten in the current format, original kept exactly once.
    expect(JSON.parse(fs.readFileSync(path.join(store, "index.json"), "utf8")).indexVersion).toBe(p.CHECKPOINT_INDEX_VERSION);
    expect(fs.readFileSync(path.join(store, "index.json.v0.bak"), "utf8")).toBe(legacyIndex);
    // Manifests are untouched by loading.
    expect(JSON.parse(fs.readFileSync(path.join(store, "cp_1.json"), "utf8")).schemaVersion).toBe(1);
  });

  it("a missing index is rebuilt from manifests", async () => {
    writeV1Manifest("cp_1", { "a.ts": "x" }, "2026-01-01T00:00:00.000Z");
    const p = await import("./persistence");
    const host = makeHost();
    host.saveCheckpointHistory = () => p.saveCheckpointHistory(host);
    await p.loadCheckpointHistory(host, { globalStorageUri: { fsPath: path.join(ws, "gs") } } as any);
    expect(host.checkpointHistory.map((c: any) => c.id)).toEqual(["cp_1"]);
    expect(fs.existsSync(path.join(store, "index.json"))).toBe(true);
  });

  it("new saves are schema 2 and survive large and binary content", async () => {
    const p = await import("./persistence");
    const host = makeHost();
    host.saveCheckpointHistory = () => p.saveCheckpointHistory(host);
    const big = "line\n".repeat(400_000); // ~2 MB
    const bin = Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 256));
    const info: any = {
      id: "cp_new",
      description: "new",
      created: new Date("2026-02-01T00:00:00Z"),
      fileInventory: ["big.txt", "img.bin", "gone.txt"],
      skippedFiles: [],
      fileSnapshots: [
        { relativePath: "big.txt", content: big, encoding: "utf8", lastModified: new Date(), size: big.length },
        { relativePath: "img.bin", content: bin.toString("base64"), encoding: "base64", lastModified: new Date(), size: bin.length },
        { relativePath: "gone.txt", content: "", encoding: "utf8", lastModified: new Date(), size: 0, deleted: true, changeType: "deleted" },
      ],
    };
    await p.saveCheckpointToDisk(host, info);
    expect(JSON.parse(fs.readFileSync(path.join(store, "cp_new.json"), "utf8")).schemaVersion).toBe(2);

    const loaded = await p.loadCheckpointFromDisk(host, "cp_new");
    const by = Object.fromEntries((loaded!.fileSnapshots ?? []).map((s: any) => [s.relativePath, s]));
    expect(by["big.txt"].content).toBe(big);
    expect(Buffer.from(by["img.bin"].content, "base64").equals(bin)).toBe(true);
    expect(by["gone.txt"].deleted).toBe(true);
  });
});

describe("multi-window", () => {
  it("two stores writing concurrently keep every checkpoint; deletes stay deleted", async () => {
    const p = await import("./persistence");
    const a = makeHost();
    const b = makeHost();
    for (const h of [a, b]) h.saveCheckpointHistory = () => p.saveCheckpointHistory(h);

    const mk = (id: string, n: number): any => ({
      id,
      description: id,
      created: new Date(2026, 0, n),
      fileInventory: ["f.ts"],
      skippedFiles: [],
      fileSnapshots: [{ relativePath: "f.ts", content: `v${n}`, encoding: "utf8", lastModified: new Date(), size: 2 }],
    });
    const add = async (h: any, cp: any) => {
      await p.saveCheckpointToDisk(h, cp);
      h.checkpointHistory.push(p.toIndexRecord(cp));
      await h.saveCheckpointHistory();
    };
    await Promise.all([
      (async () => { for (let i = 1; i <= 5; i++) await add(a, mk(`cp_a${i}`, i)); })(),
      (async () => { for (let i = 1; i <= 5; i++) await add(b, mk(`cp_b${i}`, 10 + i)); })(),
    ]);
    // Each window saves once more so both merge the other's entries.
    await a.saveCheckpointHistory();
    await b.saveCheckpointHistory();

    const idx = JSON.parse(fs.readFileSync(path.join(store, "index.json"), "utf8"));
    expect(idx.checkpointHistory.map((c: any) => c.id).sort()).toEqual(
      [...Array.from({ length: 5 }, (_, i) => `cp_a${i + 1}`), ...Array.from({ length: 5 }, (_, i) => `cp_b${i + 1}`)].sort(),
    );

    // Window A deletes one of B's checkpoints on disk and in memory; B's stale view must not resurrect it.
    p.markCheckpointRemoved(a, "cp_b1");
    a.checkpointHistory = a.checkpointHistory.filter((c: any) => c.id !== "cp_b1");
    await p.deleteCheckpointFromDisk(a, "cp_b1");
    await a.saveCheckpointHistory();
    const after = JSON.parse(fs.readFileSync(path.join(store, "index.json"), "utf8"));
    expect(after.checkpointHistory.map((c: any) => c.id)).not.toContain("cp_b1");
    // Surviving manifests still load (their blobs were not collected).
    expect((await p.loadCheckpointFromDisk(a, "cp_b2"))?.fileSnapshots?.[0].content).toBe("v12");
  });
});
