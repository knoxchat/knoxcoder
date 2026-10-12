/**
 * MC-12: blobs named by a pin provider (recipes) survive count, age and quota
 * eviction, and are freed once the provider stops naming them.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { blobExists, hashBlobBytes } from "../store/blobStore";

let store: string;
let ws: string;

beforeEach(() => {
  store = fs.mkdtempSync(path.join(os.tmpdir(), "knox-pin-store-"));
  ws = fs.mkdtempSync(path.join(os.tmpdir(), "knox-pin-ws-"));
  vi.resetModules();
});
afterEach(() => {
  fs.rmSync(store, { recursive: true, force: true });
  fs.rmSync(ws, { recursive: true, force: true });
});

const hashOf = (content: string) => hashBlobBytes(Buffer.from(content, "utf8"));

/** Three checkpoints that each rewrite f.ts, so v1/v2 blobs exist only in evictable checkpoints. */
async function setup(created: (n: number) => Date) {
  const p = await import("./persistence");
  const retention = await import("./retention");
  const pins = await import("../store/blobPins");
  const host: any = {
    initialized: true,
    whenReady: async () => {},
    currentWorkspacePath: ws,
    workspaceFolderPaths: [ws],
    messageCheckpoints: {},
    stableIdCheckpoints: {},
    checkpointHistory: [],
    branches: [],
    healthIssues: [],
    lastCheckpointLoad: null,
    lastSnapshotHashes: new Map(),
    previousCheckpointFiles: new Set(),
    enableCompression: false,
    encryptAtRest: false,
    getStoragePath: () => store,
    maxCheckpoints: 1,
    maxStorageBytes: 0,
    appendAuditEvent: async () => true,
    recordStorageSnapshot: async () => true,
  };
  host.saveCheckpointHistory = () => p.saveCheckpointHistory(host);
  host.deleteCheckpointFromDisk = (id: string) => p.deleteCheckpointFromDisk(host, id);

  for (let n = 1; n <= 3; n++) {
    const cp: any = {
      id: `cp_${n}`,
      description: `v${n}`,
      created: created(n),
      workspacePath: ws,
      fileInventory: ["f.ts"],
      skippedFiles: [],
      fileSnapshots: [
        { relativePath: "f.ts", content: `v${n}`, encoding: "utf8", lastModified: new Date(), size: 2 },
      ],
    };
    await p.saveCheckpointToDisk(host, cp);
    host.checkpointHistory.push(p.toIndexRecord(cp));
  }
  await host.saveCheckpointHistory();
  return { p, retention, pins, host };
}

const recent = (n: number) => new Date(Date.now() - (4 - n) * 1000);
const old = (n: number) => new Date(Date.now() - (40 - n) * 86_400_000);

describe("recipe blob pinning (MC-12)", () => {
  it("unpinned blobs of evicted checkpoints are freed (control)", async () => {
    const { retention, host } = await setup(recent);
    await retention.enforceMaxCheckpoints(host);
    expect(host.checkpointHistory.map((c: any) => c.id)).toEqual(["cp_3"]);
    expect(await blobExists(store, hashOf("v1"))).toBe(false);
    expect(await blobExists(store, hashOf("v2"))).toBe(false);
    expect(await blobExists(store, hashOf("v3"))).toBe(true);
  });

  it("pinned blobs survive max-count eviction and are freed after release", async () => {
    const { p, retention, pins, host } = await setup(recent);
    let wanted = [hashOf("v1")];
    pins.registerBlobPinProvider("recipes", () => wanted);

    await retention.enforceMaxCheckpoints(host);
    expect(host.checkpointHistory.map((c: any) => c.id)).toEqual(["cp_3"]); // checkpoint itself is evicted
    expect(await blobExists(store, hashOf("v1"))).toBe(true);
    expect(await blobExists(store, hashOf("v2"))).toBe(false);

    wanted = []; // recipe retired
    const gc = await p.gcUnreferencedCheckpointBlobs(host);
    expect(gc.deleted).toBe(1);
    expect(await blobExists(store, hashOf("v1"))).toBe(false);
    expect(await blobExists(store, hashOf("v3"))).toBe(true);
  });

  it("pinned blobs survive age eviction", async () => {
    const { retention, pins, host } = await setup(old);
    pins.registerBlobPinProvider("recipes", () => [hashOf("v2")]);
    expect(await retention.cleanupOldCheckpoints(host, 7)).toBe(2); // last one is always kept
    expect(await blobExists(store, hashOf("v2"))).toBe(true);
    expect(await blobExists(store, hashOf("v1"))).toBe(false);
  });

  it("pinned blobs survive storage-quota eviction", async () => {
    const { retention, pins, host } = await setup(recent);
    host.maxCheckpoints = 0;
    host.maxStorageBytes = 1; // always over quota
    pins.registerBlobPinProvider("recipes", () => [hashOf("v1")]);
    await retention.enforceStorageQuota(host);
    expect(host.checkpointHistory.map((c: any) => c.id)).toEqual(["cp_3"]);
    expect(await blobExists(store, hashOf("v1"))).toBe(true);
    expect(await blobExists(store, hashOf("v2"))).toBe(false);
  });

  it("a failing provider makes GC delete nothing", async () => {
    const { p, pins, host } = await setup(recent);
    // Orphan: not referenced by any manifest.
    const { putBlob } = await import("../store/blobStore");
    const orphan = await putBlob(store, Buffer.from("orphan"));
    const orphanHash = typeof orphan === "string" ? orphan : (orphan as any).hash;

    pins.registerBlobPinProvider("recipes", () => {
      throw new Error("db unavailable");
    });
    const gc = await p.gcUnreferencedCheckpointBlobs(host);
    expect(gc.deleted).toBe(0);
    expect(await blobExists(store, orphanHash)).toBe(true);
  });
});
