import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { git, makeTempRepo, cleanupTempRepos } from "../test/tempRepo";

import type { IDE } from "..";

import {
  applyAgentWorktree,
  discardAgentWorktree,
  enterAgentWorktree,
  listWorktreeChangedFiles,
  parsePorcelainPaths,
  remapPathToWorktree,
  shouldSkipWorktreeApply,
  suggestWorktreeBranch,
  wrapIdeForWorktree,
} from "./worktree";

const makeRepo = () => makeTempRepo();

function mockIde(repo: string): IDE {
  const uri = pathToFileURL(repo).href;
  return {
    getWorkspaceDirs: async () => [uri],
    getGitRootPath: async () => uri,
    fileExists: async (fileUri: string) => {
      const p = fileUri.startsWith("file://") ? fileURLToPath(fileUri) : fileUri;
      try {
        readFileSync(p);
        return true;
      } catch {
        return false;
      }
    },
    readFile: async (fileUri: string) => {
      const p = fileUri.startsWith("file://") ? fileURLToPath(fileUri) : fileUri;
      return readFileSync(p, "utf-8");
    },
    writeFile: async (fileUri: string, contents: string) => {
      const p = fileUri.startsWith("file://") ? fileURLToPath(fileUri) : fileUri;
      await mkdir(path.dirname(p), { recursive: true });
      writeFileSync(p, contents);
    },
    removeFile: async (fileUri: string) => {
      const p = fileUri.startsWith("file://") ? fileURLToPath(fileUri) : fileUri;
      await rm(p, { force: true });
    },
    subprocess: async (command: string, cwd?: string) => {
      const [bin, ...args] = command.split(" ");
      try {
        const stdout = execFileSync(bin, args, {
          cwd: cwd ?? repo,
          encoding: "utf-8",
        });
        return [stdout, ""];
      } catch (error: any) {
        throw new Error(error?.stderr?.toString?.() || error.message);
      }
    },
  } as unknown as IDE;
}

const cleanup: string[] = [];

afterEach(async () => {
  cleanupTempRepos();
  for (const dir of cleanup.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("worktree path helpers", () => {
  it("suggests a knox/agent branch", () => {
    expect(suggestWorktreeBranch("abc-def-12")).toBe("knox/agent-abcdef12");
  });

  it("remaps workspace URIs and relative paths onto the worktree", () => {
    const state = {
      workspaceUri: "file:///repo",
      worktreeUri: "file:///tmp/wt",
    };
    expect(remapPathToWorktree("file:///repo/src/a.ts", state)).toBe(
      "file:///tmp/wt/src/a.ts",
    );
    expect(remapPathToWorktree("src/a.ts", state)).toBe(
      path.join("/tmp/wt", "src/a.ts"),
    );
    expect(remapPathToWorktree("file:///tmp/wt/src/a.ts", state)).toBe(
      "file:///tmp/wt/src/a.ts",
    );
    expect(remapPathToWorktree("file:///elsewhere/x.ts", state)).toBe(
      "file:///elsewhere/x.ts",
    );
  });

  it("parses porcelain status paths including renames", () => {
    expect(
      parsePorcelainPaths(" M src/a.ts\n?? new.ts\nR  old.ts -> dest.ts\n"),
    ).toEqual(["src/a.ts", "new.ts", "dest.ts"]);
  });

  it("skips vmlinux and *.ko on apply (HL-42)", () => {
    expect(shouldSkipWorktreeApply("vmlinux")).toBe(true);
    expect(shouldSkipWorktreeApply("drivers/foo.ko")).toBe(true);
    expect(shouldSkipWorktreeApply("mm/filemap.c")).toBe(false);
  });
});

describe("git worktree isolation", () => {
  it("creates a worktree, isolates writes, applies back, then discards", async () => {
    const repo = makeRepo();
    cleanup.push(repo);
    const ide = mockIde(repo);

    const state = await enterAgentWorktree(ide, "session-worktree-1");
    cleanup.push(state.worktreePath);
    expect(state.branch).toMatch(/^knox\/agent-/);
    expect(readFileSync(path.join(state.worktreePath, "readme.md"), "utf-8")).toBe(
      "hello\n",
    );

    const wrapped = wrapIdeForWorktree(ide, state);
    const dirs = await wrapped.getWorkspaceDirs();
    expect(dirs[0]).toBe(state.worktreeUri);

    await wrapped.writeFile(
      pathToFileURL(path.join(repo, "readme.md")).href,
      "isolated\n",
    );
    expect(readFileSync(path.join(repo, "readme.md"), "utf-8")).toBe("hello\n");
    expect(
      readFileSync(path.join(state.worktreePath, "readme.md"), "utf-8"),
    ).toBe("isolated\n");

    const changed = await listWorktreeChangedFiles(ide, state);
    expect(changed).toContain("readme.md");

    const applied = await applyAgentWorktree(ide, state);
    expect(applied).toContain("readme.md");
    expect(readFileSync(path.join(repo, "readme.md"), "utf-8")).toBe(
      "isolated\n",
    );

    await discardAgentWorktree(ide, state);
    const listed = git(repo, ["worktree", "list"]);
    expect(listed).not.toContain(state.worktreePath);
  });

  it("reuses an existing worktree instead of creating a second one", async () => {
    const repo = makeRepo();
    cleanup.push(repo);
    const ide = mockIde(repo);
    const first = await enterAgentWorktree(ide, "same-session");
    cleanup.push(first.worktreePath);
    const second = await enterAgentWorktree(ide, "other", first);
    expect(second.worktreePath).toBe(first.worktreePath);
    await discardAgentWorktree(ide, first);
  });

  it("sparse-checkout keeps only requested paths", async () => {
    const repo = makeRepo();
    cleanup.push(repo);
    await mkdir(path.join(repo, "mm"), { recursive: true });
    await mkdir(path.join(repo, "fs"), { recursive: true });
    writeFileSync(path.join(repo, "mm", "file.c"), "mm\n");
    writeFileSync(path.join(repo, "fs", "file.c"), "fs\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-m", "more"]);
    const ide = mockIde(repo);
    const state = await enterAgentWorktree(ide, "sparse-session", null, {
      sparsePaths: ["mm"],
    });
    cleanup.push(state.worktreePath);
    expect(state.sparsePaths).toEqual(["mm"]);
    expect(
      readFileSync(path.join(state.worktreePath, "mm", "file.c"), "utf-8"),
    ).toBe("mm\n");
    await discardAgentWorktree(ide, state);
  });
});

describe("isSafeWorktreeApplyPath", () => {
  it("rejects traversal, absolute paths and symlinks that leave the trees", async () => {
    const fs = await import("fs");
    const os = await import("os");
    const pathMod = await import("path");
    const { isSafeWorktreeApplyPath } = await import("./worktree");
    const base = fs.realpathSync(fs.mkdtempSync(pathMod.join(os.tmpdir(), "knox-wt-")));
    try {
      const ws = pathMod.join(base, "ws");
      const wt = pathMod.join(base, "wt");
      const outside = pathMod.join(base, "outside");
      for (const d of [ws, wt, outside]) fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(pathMod.join(outside, "secret"), "x");
      fs.writeFileSync(pathMod.join(wt, "ok.ts"), "x");
      expect(isSafeWorktreeApplyPath("ok.ts", ws, wt)).toBe(true);
      expect(isSafeWorktreeApplyPath("new/dir/file.ts", ws, wt)).toBe(true);
      expect(isSafeWorktreeApplyPath("../outside/secret", ws, wt)).toBe(false);
      expect(isSafeWorktreeApplyPath("a/../../x", ws, wt)).toBe(false);
      expect(isSafeWorktreeApplyPath("/etc/passwd", ws, wt)).toBe(false);
      if (process.platform !== "win32") {
        fs.symlinkSync(pathMod.join(outside, "secret"), pathMod.join(wt, "leak"));
        fs.symlinkSync(outside, pathMod.join(ws, "outlink"));
        expect(isSafeWorktreeApplyPath("leak", ws, wt)).toBe(false);
        expect(isSafeWorktreeApplyPath("outlink/file", ws, wt)).toBe(false);
      }
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});
