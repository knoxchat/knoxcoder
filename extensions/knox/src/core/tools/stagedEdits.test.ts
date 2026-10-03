import { describe, expect, it } from "vitest";
import type { IDE } from "..";
import { callTool } from "./callTool";
import {
  applyStaged,
  discardStaged,
  listStaged,
  StagedEdits,
  stagedDiffText,
  stagedDiskNotice,
  wrapIdeForStaging,
} from "./stagedEdits";

function fakeIde(initial: Record<string, string>) {
  const disk = new Map(Object.entries(initial));
  const writes: string[] = [];
  const ide = {
    readFile: async (u: string) => {
      if (!disk.has(u)) throw new Error("ENOENT");
      return disk.get(u)!;
    },
    fileExists: async (u: string) => disk.has(u),
    writeFile: async (u: string, c: string) => {
      writes.push(u);
      disk.set(u, c);
    },
    removeFile: async (u: string) => void disk.delete(u),
    openFile: async () => undefined,
    getWorkspaceDirs: async () => ["file:///ws"],
  } as unknown as IDE;
  return { ide, disk, writes };
}

describe("staged edits (K-026)", () => {
  it("holds writes in memory, shows them to later reads, and leaves disk alone", async () => {
    const { ide, disk, writes } = fakeIde({ "file:///ws/a.ts": "one\ntwo\n" });
    const staged = new StagedEdits();
    const wrapped = wrapIdeForStaging(ide, staged);

    await wrapped.writeFile("file:///ws/a.ts", "one\nTWO\nthree\n");
    await wrapped.writeFile("file:///ws/new.ts", "hi\n");

    expect(writes).toEqual([]);
    expect(disk.get("file:///ws/a.ts")).toBe("one\ntwo\n");
    expect(await wrapped.readFile("file:///ws/a.ts")).toBe("one\nTWO\nthree\n");
    expect(await wrapped.fileExists("file:///ws/new.ts")).toBe(true);
    expect(await ide.fileExists("file:///ws/new.ts")).toBe(false);

    // A second edit keeps the original "before".
    await wrapped.writeFile("file:///ws/a.ts", "one\nTWO\n");
    const summary = listStaged(staged);
    expect(summary).toEqual([
      { fileUri: "file:///ws/a.ts", kind: "modify", added: 1, removed: 1 },
      { fileUri: "file:///ws/new.ts", kind: "create", added: 1, removed: 0 },
    ]);
  });

  it("the edit tool works on top of staging, twice in a row", async () => {
    const { ide, disk } = fakeIde({ "file:///ws/a.ts": "alpha\nbeta\n" });
    const staged = new StagedEdits();
    const wrapped = wrapIdeForStaging(ide, staged);
    const tool = { function: { name: "builtin_edit_file" } } as any;
    const extras = (): any => ({ ide: wrapped, llm: {}, fetch: fetch, tool });
    const opts = { workspaceDirs: ["file:///ws"] } as any;

    await callTool(
      tool,
      JSON.stringify({ filepath: "a.ts", old_string: "alpha", new_string: "ALPHA" }),
      extras(),
      opts,
    );
    await callTool(
      tool,
      JSON.stringify({ filepath: "a.ts", old_string: "beta", new_string: "BETA" }),
      extras(),
      opts,
    );
    expect(disk.get("file:///ws/a.ts")).toBe("alpha\nbeta\n");
    expect(staged.files.get("file:///ws/a.ts")?.after).toBe("ALPHA\nBETA\n");
  });

  it("staged delete hides the file; apply writes, deletes and clears", async () => {
    const { ide, disk } = fakeIde({
      "file:///ws/a.ts": "a\n",
      "file:///ws/b.ts": "b\n",
    });
    const staged = new StagedEdits();
    const wrapped = wrapIdeForStaging(ide, staged);
    await (wrapped as any).removeFile("file:///ws/b.ts");
    await wrapped.writeFile("file:///ws/a.ts", "A\n");
    expect(await wrapped.fileExists("file:///ws/b.ts")).toBe(false);
    await expect(wrapped.readFile("file:///ws/b.ts")).rejects.toThrow();

    const only = await applyStaged(ide, staged, ["file:///ws/a.ts"]);
    expect(only.applied).toEqual(["file:///ws/a.ts"]);
    expect(disk.get("file:///ws/a.ts")).toBe("A\n");
    expect(disk.has("file:///ws/b.ts")).toBe(true);
    expect(staged.size).toBe(1);

    const rest = await applyStaged(ide, staged);
    expect(rest.applied).toEqual(["file:///ws/b.ts"]);
    expect(disk.has("file:///ws/b.ts")).toBe(false);
    expect(staged.size).toBe(0);
  });

  it("discard drops staged files without touching disk; failed applies stay staged", async () => {
    const { ide, disk } = fakeIde({ "file:///ws/a.ts": "a\n" });
    const staged = new StagedEdits();
    const wrapped = wrapIdeForStaging(ide, staged);
    await wrapped.writeFile("file:///ws/a.ts", "X\n");
    expect(discardStaged(staged)).toEqual(["file:///ws/a.ts"]);
    expect(disk.get("file:///ws/a.ts")).toBe("a\n");
    expect(staged.size).toBe(0);

    await wrapped.writeFile("file:///ws/a.ts", "Y\n");
    (ide as any).writeFile = async () => {
      throw new Error("disk full");
    };
    const result = await applyStaged(ide, staged);
    expect(result.failed[0]).toMatchObject({ fileUri: "file:///ws/a.ts", error: "disk full" });
    expect(staged.size).toBe(1);
  });

  it("a staged file edited back to its original is not listed", async () => {
    const { ide } = fakeIde({ "file:///ws/a.ts": "a\n" });
    const staged = new StagedEdits();
    const wrapped = wrapIdeForStaging(ide, staged);
    await wrapped.writeFile("file:///ws/a.ts", "b\n");
    await wrapped.writeFile("file:///ws/a.ts", "a\n");
    expect(listStaged(staged)).toEqual([]);
  });

  it("diff text marks added and removed lines and trims long context", () => {
    const before = Array.from({ length: 10 }, (_, i) => `l${i}`).join("\n") + "\n";
    const after = before.replace("l5", "L5");
    const text = stagedDiffText({ before, after });
    expect(text).toContain("-l5");
    expect(text).toContain("+L5");
    expect(text).toContain("...");
    expect(text).not.toContain(" l0");
    expect(stagedDiffText({ before: null, after: "x\n" })).toBe("+x");
    expect(stagedDiffText({ before: "x\n", after: null })).toBe("-x");
  });
});

describe("stagedDiskNotice", () => {
  it("warns shell tools only while edits are staged", async () => {
    const { ide } = fakeIde({ "file:///ws/a.ts": "a\n" });
    const staged = new StagedEdits();
    expect(stagedDiskNotice("builtin_run_terminal_command", staged)).toBeUndefined();
    await wrapIdeForStaging(ide, staged).writeFile("file:///ws/a.ts", "b\n");
    expect(stagedDiskNotice("builtin_run_terminal_command", staged)).toContain("/ws/a.ts");
    expect(stagedDiskNotice("builtin_read_file", staged)).toBeUndefined();
    for (const name of ["builtin_pty_start", "builtin_pty_send", "builtin_qemu"]) {
      expect(stagedDiskNotice(name, staged)).toContain("NOT on disk");
    }
    expect(stagedDiskNotice("builtin_build", undefined)).toBeUndefined();
  });
});
