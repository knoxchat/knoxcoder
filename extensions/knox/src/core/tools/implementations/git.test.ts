import { exec } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it, vi } from "vitest";
import type { IDE, ToolExtras } from "../..";

import {
  gitBlameImpl,
  gitCommitImpl,
  gitDiffImpl,
  gitLogImpl,
  gitStatusImpl,
} from "./git";

const execAsync = promisify(exec);

function extras(
  subprocess: ReturnType<typeof vi.fn>,
  cwd = "/tmp/ws",
  ideExtra: Partial<IDE> = {},
): ToolExtras {
  const ide = {
    getWorkspaceDirs: vi.fn(async () => [pathToFileURL(cwd).href]),
    getGitRootPath: vi.fn(async () => pathToFileURL(cwd).href),
    subprocess,
    ...ideExtra,
  } as unknown as IDE;
  return {
    ide,
    llm: {} as ToolExtras["llm"],
    fetch: vi.fn(),
    tool: { function: { name: "builtin_git_status" } } as ToolExtras["tool"],
  };
}

function realGitExtras(cwd: string): ToolExtras {
  const subprocess = vi.fn(
    (command: string, dir?: string) =>
      new Promise<[string, string]>((resolve, reject) => {
        exec(command, { cwd: dir ?? cwd }, (error, stdout, stderr) => {
          if (error) {
            reject(stderr || error.message);
            return;
          }
          resolve([stdout, stderr]);
        });
      }),
  );
  return extras(subprocess, cwd);
}

async function git(cwd: string, args: string): Promise<string> {
  const { stdout } = await execAsync(`git ${args}`, { cwd });
  return stdout.trim();
}

describe("git tools", () => {
  it("runs status", async () => {
    const subprocess = vi.fn(async () => ["## main\n M a.ts", ""]);
    const result = await gitStatusImpl({}, extras(subprocess));
    expect(subprocess).toHaveBeenCalledWith(
      "git status --porcelain=v1 -b",
      "/tmp/ws",
    );
    expect(result[0].content).toContain("## main");
  });

  it("diffs unstaged by default and staged when asked", async () => {
    const subprocess = vi.fn(async (cmd: string) => [`out:${cmd}`, ""]);
    await gitDiffImpl({}, extras(subprocess));
    expect(subprocess.mock.calls[0][0]).toMatch(/^git diff/);
    expect(subprocess.mock.calls[0][0]).not.toContain("--cached");

    subprocess.mockClear();
    await gitDiffImpl({ staged: true }, extras(subprocess));
    expect(subprocess.mock.calls[0][0]).toContain("--cached");
  });

  it("logs with a clamped count", async () => {
    const subprocess = vi.fn(async (_cmd: string) => ["abc commit", ""]);
    await gitLogImpl({ max_count: 99 }, extras(subprocess));
    expect(subprocess.mock.calls[0][0]).toContain("-n50");
  });

  it("logs pickaxe -S and -G", async () => {
    const subprocess = vi.fn(async (_cmd: string) => ["abc added copy_to_user", ""]);
    await gitLogImpl({ search: "copy_to_user", max_count: 10 }, extras(subprocess));
    expect(subprocess.mock.calls[0][0]).toContain("-S'copy_to_user'");
    expect(subprocess.mock.calls[0][0]).toContain("-n10");

    subprocess.mockClear();
    await gitLogImpl({ regex: "copy_to_user\\(", path: "mm/" }, extras(subprocess));
    expect(subprocess.mock.calls[0][0]).toContain("-G'copy_to_user\\('");
    expect(subprocess.mock.calls[0][0]).toContain("-- mm/");
  });

  it("blames a file with an optional line range", async () => {
    const subprocess = vi.fn(async (_cmd: string) => ["^abc (Alice 2024-01-01 1) int foo", ""]);
    await gitBlameImpl(
      { filepath: "mm/filemap.c", start_line: 10, end_line: 20 },
      extras(subprocess),
    );
    expect(subprocess.mock.calls[0][0]).toBe(
      "git blame --date=short -L10,20 -- 'mm/filemap.c'",
    );
  });

  it("caps blame output and requires filepath", async () => {
    const lines = Array.from({ length: 250 }, (_, i) => `hash (A 2024-01-01 ${i + 1}) x`);
    const subprocess = vi.fn(async () => [lines.join("\n"), ""]);
    const result = await gitBlameImpl({ filepath: "foo.c" }, extras(subprocess));
    expect(result[0].content).toContain("truncated at 200 lines");
    expect(result[0].content.split("\n").filter((line) => /^\w/.test(line) && line.includes("hash")).length).toBe(200);

    await expect(gitBlameImpl({}, extras(vi.fn()))).rejects.toThrow(/filepath/);
  });

  it("commits with a quoted message", async () => {
    const subprocess = vi.fn(async (_cmd: string) => ["[main abc] ok", ""]);
    const result = await gitCommitImpl(
      { message: "fix stuff", add_all: true },
      extras(subprocess),
    );
    expect(subprocess.mock.calls[0][0]).toBe("git add -A");
    expect(subprocess.mock.calls[1][0]).toBe("git commit -m 'fix stuff'");
    expect(result[0].description).toBe("committed");
  });

  it("requires a commit message", async () => {
    await expect(gitCommitImpl({ message: "  " }, extras(vi.fn()))).rejects.toThrow(
      /message/,
    );
  });

  it("prefers the Git model for status and does not spawn git", async () => {
    const subprocess = vi.fn(async () => ["SHOULD NOT RUN", ""]);
    const result = await gitStatusImpl(
      {},
      extras(subprocess, "/tmp/ws", {
        getGitStatusPorcelain: async () => "## main\n M a.ts",
      }),
    );
    expect(subprocess).not.toHaveBeenCalled();
    expect(result[0].content).toContain("## main");
    expect(result[0].content).toContain(" M a.ts");
  });

  it("prefers the Git model for unstaged/staged diffs", async () => {
    const subprocess = vi.fn(async () => ["SHOULD NOT RUN", ""]);
    const result = await gitDiffImpl(
      { both: true },
      extras(subprocess, "/tmp/ws", {
        getGitDiffCached: async (cached: boolean) =>
          cached ? ["diff --cached"] : ["diff unstaged"],
      }),
    );
    expect(subprocess).not.toHaveBeenCalled();
    expect(result[0].content).toContain("diff unstaged");
    expect(result[0].content).toContain("diff --cached");
  });

  it("never pushes, force-pushes, or amends", async () => {
    const subprocess = vi.fn(async () => ["ok", ""]);
    await expect(
      gitCommitImpl({ message: "fix", amend: true }, extras(subprocess)),
    ).rejects.toThrow(/never pushes, force-pushes, or amends/);
    await expect(
      gitCommitImpl({ message: "fix", force: true }, extras(subprocess)),
    ).rejects.toThrow(/never pushes/);
    await expect(
      gitCommitImpl({ message: "fix", push: true }, extras(subprocess)),
    ).rejects.toThrow(/never pushes/);
    expect(subprocess).not.toHaveBeenCalled();
  });
});

describe("git blame fixture repo (HL-29)", () => {
  it("blames the commit that introduced a line", async () => {
    const dir = await mkdtemp(join(tmpdir(), "knox-blame-"));
    try {
      await git(dir, "init");
      await git(dir, "config user.email test@knox");
      await git(dir, "config user.name Knox");
      await git(dir, "config commit.gpgsign false");
      await writeFile(join(dir, "foo.c"), "int a;\n");
      await git(dir, "add foo.c");
      await git(dir, "commit -m first");
      await writeFile(join(dir, "foo.c"), "int a;\nint copy_to_user(void);\n");
      await git(dir, "add foo.c");
      await git(dir, "commit -m add-copy");
      const addHash = (await git(dir, "rev-parse --short HEAD")).slice(0, 7);

      const result = await gitBlameImpl(
        { filepath: "foo.c", start_line: 2, end_line: 2 },
        realGitExtras(dir),
      );
      expect(result[0].content).toContain("copy_to_user");
      expect(result[0].content).toContain(addHash.slice(0, 7));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("pickaxe finds the commit that added a string", async () => {
    const dir = await mkdtemp(join(tmpdir(), "knox-pickaxe-"));
    try {
      await git(dir, "init");
      await git(dir, "config user.email test@knox");
      await git(dir, "config user.name Knox");
      await git(dir, "config commit.gpgsign false");
      await writeFile(join(dir, "foo.c"), "int a;\n");
      await git(dir, "add foo.c");
      await git(dir, "commit -m first");
      await writeFile(join(dir, "foo.c"), "int a;\nint copy_to_user(void);\n");
      await git(dir, "add foo.c");
      await git(dir, "commit -m add-copy");

      const result = await gitLogImpl(
        { search: "copy_to_user", max_count: 10 },
        realGitExtras(dir),
      );
      expect(result[0].content).toContain("add-copy");
      expect(result[0].content).not.toContain("first\n");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
