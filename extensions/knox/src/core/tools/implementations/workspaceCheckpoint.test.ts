import { describe, expect, it, vi } from "vitest";

import type { ToolExtras } from "../..";

import { workspaceCheckpointImpl } from "./workspaceCheckpoint";

function extras(ide: Partial<ToolExtras["ide"]>): ToolExtras {
  return {
    ide: ide as ToolExtras["ide"],
    llm: {} as ToolExtras["llm"],
    fetch: vi.fn(),
    tool: { function: { name: "builtin_workspace_checkpoint" } } as ToolExtras["tool"],
    soul: { sessionId: "sess-1" },
  };
}

describe("workspaceCheckpointImpl", () => {
  it("lists checkpoints from the IDE hook", async () => {
    const result = await workspaceCheckpointImpl(
      { action: "list", limit: 2 },
      extras({
        listWorkspaceCheckpoints: async () => [
          {
            id: "cp-1",
            description: "before edit",
            created: "2026-08-16T00:00:00.000Z",
            fileCount: 3,
          },
        ],
      }),
    );
    expect(result[0].content).toContain("cp-1");
    expect(result[0].content).toContain("before edit");
    expect(result[0].content).toContain("files=3");
  });

  it("creates a labeled checkpoint", async () => {
    const create = vi.fn(async () => "cp-new");
    const result = await workspaceCheckpointImpl(
      { action: "create", label: "safe point" },
      extras({ createWorkspaceCheckpoint: create }),
    );
    expect(create).toHaveBeenCalledWith({
      description: "safe point",
      sessionId: "sess-1",
    });
    expect(result[0].content).toContain("cp-new");
  });

  it("restores through the IDE hook", async () => {
    const restore = vi.fn(async () => ({
      success: true,
      restoredFiles: ["src/a.ts"],
    }));
    const result = await workspaceCheckpointImpl(
      { action: "restore", checkpoint_id: "cp-1" },
      extras({ restoreWorkspaceCheckpoint: restore }),
    );
    expect(restore).toHaveBeenCalledWith({
      checkpointId: "cp-1",
      rewindMemory: false,
    });
    expect(result[0].content).toContain("cp-1");
    expect(result[0].content).toContain("src/a.ts");
    expect(result[0].content).toContain("1 file written");
  });

  it("summarizes a large reconstructed restore instead of dumping paths", async () => {
    const restoredFiles = Array.from({ length: 21 }, (_, i) => `src/f${i}.ts`);
    const result = await workspaceCheckpointImpl(
      { action: "restore", checkpoint_id: "cp-big" },
      extras({
        restoreWorkspaceCheckpoint: async () => ({
          success: true,
          restoredFiles,
        }),
      }),
    );
    expect(result[0].content).toContain("21 files from reconstructed tree");
    expect(result[0].content).not.toContain("src/f0.ts");
  });

  it("surfaces failed and skipped files on restore", async () => {
    const result = await workspaceCheckpointImpl(
      { action: "restore", checkpoint_id: "cp-1" },
      extras({
        restoreWorkspaceCheckpoint: async () => ({
          success: false,
          restoredFiles: ["src/a.ts"],
          failedFiles: [{ path: "src/b.ts", error: "EACCES" }],
          skippedFiles: [{ path: "huge.bin", reason: "too_large" }],
          message: "Partial failure",
        }),
      }),
    );
    expect(result[0].description).toBe("failed");
    expect(result[0].content).toContain("Partial failure");
    expect(result[0].content).toContain("src/a.ts");
    expect(result[0].content).toContain("Failed (1): src/b.ts (EACCES)");
    expect(result[0].content).toContain(
      "Skipped at capture (1): huge.bin (too_large)",
    );
  });

  it("passes rewind_memory through to the IDE hook", async () => {
    const restore = vi.fn(async () => ({
      success: true,
      restoredFiles: ["src/a.ts"],
      memoryRewound: true,
      memoryMessage: "Rolled back memory checkpoint #3",
    }));
    const result = await workspaceCheckpointImpl(
      { action: "restore", checkpoint_id: "cp-1", rewind_memory: true },
      extras({ restoreWorkspaceCheckpoint: restore }),
    );
    expect(restore).toHaveBeenCalledWith({
      checkpointId: "cp-1",
      rewindMemory: true,
    });
    expect(result[0].content).toContain("Memory rewound");
  });

  it("requires checkpoint_id for restore", async () => {
    await expect(
      workspaceCheckpointImpl({ action: "restore" }, extras({})),
    ).rejects.toThrow(/checkpoint_id/);
  });

  it("requires checkpoint_id for preview_restore", async () => {
    await expect(
      workspaceCheckpointImpl({ action: "preview_restore" }, extras({})),
    ).rejects.toThrow(/checkpoint_id/);
  });

  it("previews restore without writing files", async () => {
    const preview = vi.fn(async () => ({
      checkpointId: "cp-1",
      description: "before edit",
      modified: 1,
      added: 1,
      deleted: 1,
      files: [
        {
          relativePath: "src/a.ts",
          action: "overwrite" as const,
          additions: 2,
          deletions: 1,
          hunkCount: 1,
        },
        {
          relativePath: "src/b.ts",
          action: "create" as const,
          additions: 4,
          deletions: 0,
          hunkCount: 1,
        },
        {
          relativePath: "src/c.ts",
          action: "delete" as const,
          additions: 0,
          deletions: 3,
          hunkCount: 1,
        },
      ],
      writePaths: ["src/a.ts", "src/b.ts"],
      extraPaths: ["src/c.ts"],
      skippedFiles: [],
    }));
    const result = await workspaceCheckpointImpl(
      { action: "preview_restore", checkpoint_id: "cp-1" },
      extras({ previewWorkspaceCheckpointRestore: preview }),
    );
    expect(preview).toHaveBeenCalledWith({ checkpointId: "cp-1" });
    expect(result[0].description).toBe("preview");
    expect(result[0].content).toContain("No files written");
    expect(result[0].content).toContain("1 modified, 1 added, 1 deleted");
    expect(result[0].content).toContain("src/a.ts");
    expect(result[0].content).toContain("overwrite");
  });

  it("reports preview_restore unavailable on non-VS-Code hosts", async () => {
    const result = await workspaceCheckpointImpl(
      { action: "preview_restore", checkpoint_id: "cp-1" },
      extras({}),
    );
    expect(result[0].description).toBe("unavailable");
    expect(result[0].content).toContain("VS Code host");
  });

  it("diffs against the workspace without writing files", async () => {
    const diff = vi.fn(async () => ({
      oldCheckpoint: {
        id: "cp-1",
        description: "before edit",
        created: "2026-08-16T00:00:00.000Z",
      },
      newCheckpoint: {
        id: "workspace",
        description: "Current workspace",
        created: "2026-08-17T00:00:00.000Z",
      },
      files: [
        {
          relativePath: "src/a.ts",
          status: "modified" as const,
          additions: 2,
          deletions: 1,
          hunkCount: 1,
        },
      ],
    }));
    const result = await workspaceCheckpointImpl(
      {
        action: "diff",
        checkpoint_id: "cp-1",
        compare_to_workspace: true,
      },
      extras({ diffWorkspaceCheckpoint: diff }),
    );
    expect(diff).toHaveBeenCalledWith({
      checkpointId: "cp-1",
      compareToCheckpointId: undefined,
      compareToWorkspace: true,
    });
    expect(result[0].description).toBe("diff");
    expect(result[0].content).toContain("No files written");
    expect(result[0].content).toContain("src/a.ts");
    expect(result[0].content).toContain("modified");
  });

  it("diffs against another checkpoint id", async () => {
    const diff = vi.fn(async () => ({
      oldCheckpoint: {
        id: "cp-0",
        description: "older",
        created: "2026-08-15T00:00:00.000Z",
      },
      newCheckpoint: {
        id: "cp-1",
        description: "newer",
        created: "2026-08-16T00:00:00.000Z",
      },
      files: [],
    }));
    const result = await workspaceCheckpointImpl(
      {
        action: "diff",
        checkpoint_id: "cp-1",
        compare_to_checkpoint_id: "cp-0",
      },
      extras({ diffWorkspaceCheckpoint: diff }),
    );
    expect(diff).toHaveBeenCalledWith({
      checkpointId: "cp-1",
      compareToCheckpointId: "cp-0",
      compareToWorkspace: false,
    });
    expect(result[0].content).toContain("No content differences");
  });

  it("reports diff unavailable on non-VS-Code hosts", async () => {
    const result = await workspaceCheckpointImpl(
      { action: "diff", checkpoint_id: "cp-1" },
      extras({}),
    );
    expect(result[0].description).toBe("unavailable");
    expect(result[0].content).toContain("VS Code host");
  });

  it("pins and unpins through the IDE hook", async () => {
    const pin = vi.fn(async () => ({ success: true }));
    const pinned = await workspaceCheckpointImpl(
      { action: "pin", checkpoint_id: "cp-1" },
      extras({ pinWorkspaceCheckpoint: pin }),
    );
    expect(pin).toHaveBeenCalledWith({ checkpointId: "cp-1", pinned: true });
    expect(pinned[0].description).toBe("pin");
    expect(pinned[0].content).toContain("Pinned checkpoint cp-1");

    const unpinned = await workspaceCheckpointImpl(
      { action: "unpin", checkpoint_id: "cp-1" },
      extras({ pinWorkspaceCheckpoint: pin }),
    );
    expect(pin).toHaveBeenCalledWith({ checkpointId: "cp-1", pinned: false });
    expect(unpinned[0].content).toContain("Unpinned checkpoint cp-1");
  });

  it("reports pin unavailable on non-VS-Code hosts", async () => {
    const result = await workspaceCheckpointImpl(
      { action: "pin", checkpoint_id: "cp-1" },
      extras({}),
    );
    expect(result[0].description).toBe("unavailable");
  });

  it("deletes through the IDE hook", async () => {
    const del = vi.fn(async () => ({ success: true }));
    const result = await workspaceCheckpointImpl(
      { action: "delete", checkpoint_id: "cp-1" },
      extras({ deleteWorkspaceCheckpoint: del }),
    );
    expect(del).toHaveBeenCalledWith({ checkpointId: "cp-1" });
    expect(result[0].description).toBe("deleted");
    expect(result[0].content).toContain("Deleted checkpoint cp-1");
  });

  it("requires checkpoint_id for delete", async () => {
    await expect(
      workspaceCheckpointImpl({ action: "delete" }, extras({})),
    ).rejects.toThrow(/checkpoint_id/);
  });

  it("reports delete unavailable on non-VS-Code hosts", async () => {
    const result = await workspaceCheckpointImpl(
      { action: "delete", checkpoint_id: "cp-1" },
      extras({}),
    );
    expect(result[0].description).toBe("unavailable");
    expect(result[0].content).toContain("VS Code host");
  });
});
