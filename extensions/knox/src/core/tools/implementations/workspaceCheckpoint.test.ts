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
            branch: "main",
            label: "Add JWT middleware",
          },
        ],
      }),
    );
    expect(result[0].content).toContain("cp-1");
    expect(result[0].content).toContain("before edit");
    expect(result[0].content).toContain("label=Add JWT middleware");
    expect(result[0].content).toContain("branch=main");
    expect(result[0].content).toContain("files=3");
  });

  it("creates a checkpoint branch through the IDE hook", async () => {
    const createBranch = vi.fn(async () => ({
      success: true,
      branchId: "br_1",
      name: "feature",
      headCheckpointId: "cp-1",
    }));
    const result = await workspaceCheckpointImpl(
      { action: "create_branch", name: "feature", checkpoint_id: "cp-1" },
      extras({ createWorkspaceCheckpointBranch: createBranch }),
    );
    expect(createBranch).toHaveBeenCalledWith({
      name: "feature",
      checkpointId: "cp-1",
      description: undefined,
    });
    expect(result[0].description).toBe("branched");
    expect(result[0].content).toContain("feature");
    expect(result[0].content).toContain("br_1");
    expect(result[0].content).toContain("cp-1");
  });

  it("requires a name for create_branch", async () => {
    await expect(
      workspaceCheckpointImpl({ action: "create_branch" }, extras({
        createWorkspaceCheckpointBranch: async () => ({ success: true }),
      })),
    ).rejects.toThrow(/name/);
  });

  it("reports create_branch unavailable on non-VS-Code hosts", async () => {
    const result = await workspaceCheckpointImpl(
      { action: "create_branch", name: "feature" },
      extras({}),
    );
    expect(result[0].description).toBe("unavailable");
    expect(result[0].content).toContain("VS Code host");
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

  it("stashes dirty files through the IDE hook", async () => {
    const stash = vi.fn(async () => ({
      success: true,
      empty: false,
      stashId: "st_1",
      fileCount: 2,
    }));
    const result = await workspaceCheckpointImpl(
      { action: "stash", label: "wip" },
      extras({ stashWorkspaceCheckpoint: stash }),
    );
    expect(stash).toHaveBeenCalledWith({ message: "wip" });
    expect(result[0].description).toBe("stashed");
    expect(result[0].content).toContain("st_1");
  });

  it("lists stashes from the IDE hook", async () => {
    const result = await workspaceCheckpointImpl(
      { action: "stash_list" },
      extras({
        listWorkspaceStashes: async () => [
          {
            id: "st_1",
            message: "wip",
            created: "2026-10-29T00:00:00.000Z",
            fileCount: 2,
          },
        ],
      }),
    );
    expect(result[0].content).toContain("st_1");
    expect(result[0].content).toContain("note=wip");
    expect(result[0].content).toContain("files=2");
  });

  it("pops a stash through the IDE hook", async () => {
    const pop = vi.fn(async () => ({
      success: true,
      stashId: "st_1",
      restoredFiles: ["a.ts"],
      removedFiles: [],
      conflicts: [],
    }));
    const result = await workspaceCheckpointImpl(
      { action: "stash_pop", stash_id: "st_1" },
      extras({ popWorkspaceStash: pop }),
    );
    expect(pop).toHaveBeenCalledWith({ stashId: "st_1" });
    expect(result[0].description).toBe("popped");
    expect(result[0].content).toContain("st_1");
  });

  it("reports stash conflicts without claiming a pop", async () => {
    const result = await workspaceCheckpointImpl(
      { action: "stash_pop" },
      extras({
        popWorkspaceStash: async () => ({
          success: false,
          stashId: "st_1",
          restoredFiles: [],
          removedFiles: [],
          conflicts: [{ path: "a.ts" }],
        }),
      }),
    );
    expect(result[0].description).toBe("conflicts");
    expect(result[0].content).toContain("a.ts");
    expect(result[0].content).toContain("unchanged");
  });

  it("switches a checkpoint branch through the IDE hook", async () => {
    const switchBranch = vi.fn(async () => ({
      success: true,
      branchId: "br_1",
      headCheckpointId: "cp-2",
      stashed: true,
      stashId: "st_1",
    }));
    const result = await workspaceCheckpointImpl(
      { action: "switch_branch", name: "feature" },
      extras({ switchWorkspaceCheckpointBranch: switchBranch }),
    );
    expect(switchBranch).toHaveBeenCalledWith({ name: "feature", branchId: undefined });
    expect(result[0].description).toBe("switched");
    expect(result[0].content).toContain("br_1");
    expect(result[0].content).toContain("st_1");
  });

  it("checks out a checkpoint through the IDE hook", async () => {
    const checkout = vi.fn(async () => ({
      success: true,
      checkpointId: "cp-mid",
      detached: true,
    }));
    const result = await workspaceCheckpointImpl(
      { action: "checkout", checkpoint_id: "cp-mid" },
      extras({ checkoutWorkspaceCheckpoint: checkout }),
    );
    expect(checkout).toHaveBeenCalledWith({ checkpointId: "cp-mid" });
    expect(result[0].description).toBe("detached");
    expect(result[0].content).toContain("cp-mid");
  });

  it("cherry-picks a checkpoint through the IDE hook", async () => {
    const cherryPick = vi.fn(async () => ({
      success: true,
      checkpointId: "cp-new",
      restoredFiles: ["a.ts"],
      removedFiles: [],
      conflicts: [],
    }));
    const result = await workspaceCheckpointImpl(
      { action: "cherry_pick", checkpoint_id: "cp-feat" },
      extras({ cherryPickWorkspaceCheckpoint: cherryPick }),
    );
    expect(cherryPick).toHaveBeenCalledWith({ checkpointId: "cp-feat" });
    expect(result[0].description).toBe("cherry-picked");
    expect(result[0].content).toContain("cp-new");
  });

  it("reverts a checkpoint through the IDE hook", async () => {
    const revert = vi.fn(async () => ({
      success: true,
      checkpointId: "cp-revert",
      restoredFiles: ["a.ts"],
      removedFiles: [],
      conflicts: [],
    }));
    const result = await workspaceCheckpointImpl(
      { action: "revert", checkpoint_id: "cp-b" },
      extras({ revertWorkspaceCheckpoint: revert }),
    );
    expect(revert).toHaveBeenCalledWith({ checkpointId: "cp-b" });
    expect(result[0].description).toBe("reverted");
    expect(result[0].content).toContain("cp-revert");
    expect(result[0].content).toContain("still in history");
  });

  it("reports cherry-pick conflicts without claiming a write", async () => {
    const result = await workspaceCheckpointImpl(
      { action: "cherry_pick", checkpoint_id: "cp-feat" },
      extras({
        cherryPickWorkspaceCheckpoint: async () => ({
          success: false,
          restoredFiles: [],
          removedFiles: [],
          conflicts: [{ path: "a.ts" }],
        }),
      }),
    );
    expect(result[0].description).toBe("conflicts");
    expect(result[0].content).toContain("a.ts");
    expect(result[0].content).toContain("continue");
  });

  it("continues an in-progress merge through the IDE hook", async () => {
    const mergeContinue = vi.fn(async () => ({
      success: true,
      checkpointId: "cp-merged",
      conflicts: [],
    }));
    const result = await workspaceCheckpointImpl(
      { action: "merge_continue" },
      extras({ continueWorkspaceCheckpointMerge: mergeContinue }),
    );
    expect(mergeContinue).toHaveBeenCalled();
    expect(result[0].description).toBe("continued");
    expect(result[0].content).toContain("cp-merged");
  });

  it("aborts an in-progress merge through the IDE hook", async () => {
    const mergeAbort = vi.fn(async () => ({ success: true }));
    const result = await workspaceCheckpointImpl(
      { action: "merge_abort" },
      extras({ abortWorkspaceCheckpointMerge: mergeAbort }),
    );
    expect(mergeAbort).toHaveBeenCalled();
    expect(result[0].description).toBe("aborted");
    expect(result[0].content).toContain("pre-merge");
  });

  it("never claims switch_branch on a headless IDE", async () => {
    const result = await workspaceCheckpointImpl(
      { action: "switch_branch", name: "feature" },
      extras({}),
    );
    expect(result[0].description).toBe("unavailable");
  });

  it("materializes a worktree through the IDE hook", async () => {
    const materialize = vi.fn(async () => ({
      success: true,
      worktreeId: "wt_1",
      path: "/tmp/wt",
      fileCount: 2,
    }));
    const result = await workspaceCheckpointImpl(
      { action: "materialize_worktree", checkpoint_id: "cp-1" },
      extras({ materializeWorkspaceCheckpointWorktree: materialize }),
    );
    expect(materialize).toHaveBeenCalledWith({ checkpointId: "cp-1" });
    expect(result[0].content).toContain("wt_1");
    expect(result[0].content).toContain("/tmp/wt");
  });

  it("blames a file through the IDE hook", async () => {
    const blame = vi.fn(async () => ({
      relativePath: "a.ts",
      ranges: [
        { startLine: 1, endLine: 2, checkpointId: "cp-a", description: "first" },
        { startLine: 3, endLine: 3, checkpointId: "cp-b", description: "second" },
      ],
    }));
    const result = await workspaceCheckpointImpl(
      { action: "blame", path: "a.ts" },
      extras({ blameWorkspaceCheckpoint: blame }),
    );
    expect(blame).toHaveBeenCalledWith({ path: "a.ts", atCheckpointId: undefined });
    expect(result[0].content).toContain("1-2  cp-a");
    expect(result[0].content).toContain("3  cp-b");
  });

  it("exports a readonly patch", async () => {
    const exportPatch = vi.fn(async () => ({
      success: true,
      patch: "From cp-1\nSubject: add\nX-Knox-Checkpoint: cp-1\n\ndiff --git a/a.ts b/a.ts\n",
      checkpointId: "cp-1",
      fileCount: 1,
    }));
    const result = await workspaceCheckpointImpl(
      { action: "export_patch", checkpoint_id: "cp-1" },
      extras({ exportWorkspaceCheckpointPatch: exportPatch }),
    );
    expect(exportPatch).toHaveBeenCalledWith({ checkpointId: "cp-1" });
    expect(result[0].content).toContain("X-Knox-Checkpoint: cp-1");
    expect(result[0].content).toContain("No files written");
  });

  it("applies a patch through the IDE hook", async () => {
    const applyPatch = vi.fn(async () => ({
      success: true,
      checkpointId: "cp-new",
      restoredFiles: ["a.ts"],
      removedFiles: [],
      conflicts: [],
    }));
    const result = await workspaceCheckpointImpl(
      { action: "apply_patch", patch: "diff --git a/a.ts b/a.ts\n" },
      extras({ applyWorkspaceCheckpointPatch: applyPatch }),
    );
    expect(applyPatch).toHaveBeenCalledWith({ patch: "diff --git a/a.ts b/a.ts\n" });
    expect(result[0].description).toBe("applied");
    expect(result[0].content).toContain("cp-new");
  });

  it("reports patch conflicts without claiming a write", async () => {
    const result = await workspaceCheckpointImpl(
      { action: "apply_patch", patch: "diff --git a/a.ts b/a.ts\n" },
      extras({
        applyWorkspaceCheckpointPatch: async () => ({
          success: false,
          restoredFiles: [],
          removedFiles: [],
          conflicts: [{ path: "a.ts" }],
        }),
      }),
    );
    expect(result[0].description).toBe("conflicts");
    expect(result[0].content).toContain("unchanged");
    expect(result[0].content).toContain("a.ts");
  });

  it("lists file history following renames", async () => {
    const history = vi.fn(async () => [
      {
        checkpointId: "cp-1",
        description: "created a.ts",
        created: "2026-10-29T00:00:00.000Z",
        relativePath: "a.ts",
        hash: "aa".repeat(32),
        deleted: false,
      },
      {
        checkpointId: "cp-2",
        description: "renamed",
        created: "2026-10-29T01:00:00.000Z",
        relativePath: "b.ts",
        hash: "bb".repeat(32),
        deleted: false,
      },
    ]);
    const result = await workspaceCheckpointImpl(
      { action: "file_history", path: "b.ts" },
      extras({ listWorkspaceCheckpointFileHistory: history }),
    );
    expect(history).toHaveBeenCalledWith({ path: "b.ts", follow: true });
    expect(result[0].content).toContain("No files written");
    expect(result[0].content).toContain("was=a.ts");
    expect(result[0].content).toContain("cp-1");
  });

  it("formats renamed diffs with the old path", async () => {
    const result = await workspaceCheckpointImpl(
      { action: "diff", checkpoint_id: "cp-1" },
      extras({
        diffWorkspaceCheckpoint: async () => ({
          oldCheckpoint: { id: "cp-0", description: "old", created: "2026-10-29T00:00:00.000Z" },
          newCheckpoint: { id: "cp-1", description: "new", created: "2026-10-29T01:00:00.000Z" },
          files: [
            {
              relativePath: "b.ts",
              status: "renamed" as const,
              oldPath: "a.ts",
              additions: 0,
              deletions: 0,
              hunkCount: 1,
            },
          ],
        }),
      }),
    );
    expect(result[0].content).toContain("b.ts ← a.ts");
    expect(result[0].content).toContain("renamed");
  });
});
