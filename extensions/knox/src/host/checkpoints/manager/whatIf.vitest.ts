import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildCheckpointGraph } from "./graphPayload";
import { createWhatIfBranch, whatIfBranchName } from "./branches";

let store: string;
beforeEach(() => {
  store = fs.mkdtempSync(path.join(os.tmpdir(), "knox-whatif-"));
});
afterEach(() => fs.rmSync(store, { recursive: true, force: true }));

function makeHost(): any {
  const created = new Date("2026-02-01T00:00:00Z");
  const host: any = {
    initialized: true,
    currentWorkspacePath: store,
    checkpointHistory: [{ id: "cp_base", description: "base", created, workspacePath: store, workspaceKey: undefined }],
    branches: [],
    activeBranchId: undefined,
    getStoragePath: () => store,
    saveCheckpointHistory: async () => {},
    appendAuditEvent: async () => true,
    lastSnapshotHashes: new Map(),
    previousCheckpointFiles: new Set(),
  };
  return host;
}

describe("what-if branch (MC-62)", () => {
  it("names are unique and tidy", () => {
    expect(whatIfBranchName([], "ab12cd34ef56")).toBe("what-if/ab12cd34");
    expect(whatIfBranchName([{ name: "what-if/ab12cd34" }], "ab12cd34ef56")).toBe("what-if/ab12cd34-2");
    expect(whatIfBranchName([{ name: "what-if/ab12cd34" }, { name: "what-if/ab12cd34-2" }], "ab12cd34ef56")).toBe("what-if/ab12cd34-3");
    expect(whatIfBranchName([], "../..")).toBe("what-if/recipe");
  });

  it("forks at the base checkpoint, is visible in the graph, and a second run does not collide", async () => {
    const host = makeHost();
    const first = await createWhatIfBranch(host, "cp_base", "ab12cd34ef56", "create Header component");
    expect(first?.name).toBe("what-if/ab12cd34");
    expect(first?.baseCheckpointId).toBe("cp_base");
    expect(first?.description).toBe("Recipe replay: create Header component");

    const graph = buildCheckpointGraph({ history: host.checkpointHistory, branches: host.branches, activeBranchId: host.activeBranchId });
    expect(graph.branches.map((b) => b.name)).toContain("what-if/ab12cd34");
    expect(graph.branches.find((b) => b.name === "what-if/ab12cd34")?.isActive).toBe(true);

    const second = await createWhatIfBranch(host, "cp_base", "ab12cd34ef56");
    expect(second?.name).toBe("what-if/ab12cd34-2");
  });

  it("returns null instead of throwing for an unknown checkpoint", async () => {
    expect(await createWhatIfBranch(makeHost(), "cp_missing", "abc")).toBeNull();
  });
});
