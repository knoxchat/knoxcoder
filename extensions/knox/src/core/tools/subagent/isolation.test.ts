import { exec } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import type { IDE } from "../..";
import { localPathOrUriToPath, localPathToUri } from "../../util/pathToUri.js";
import { cleanupTempRepos, makeTempRepo } from "../../test/tempRepo";
import { parseCustomAgent, loadCustomAgents } from "./customAgents";
import { runInWorktree } from "./isolation";
import {
  createMutex,
  resolveSubagentConcurrency,
  runWithConcurrency,
} from "./scheduler";

const execP = promisify(exec);

function realIde(root: string): IDE {
  const p = (u: string) => localPathOrUriToPath(u);
  return {
    getWorkspaceDirs: async () => [root],
    getGitRootPath: async () => root,
    subprocess: async (command: string, cwd?: string) => {
      const { stdout, stderr } = await execP(command, { cwd: cwd ?? root });
      return [stdout, stderr];
    },
    readFile: async (u: string) => readFileSync(p(u), "utf-8"),
    writeFile: async (u: string, c: string) => writeFileSync(p(u), c),
    fileExists: async () => true,
  } as unknown as IDE;
}

describe("scheduler", () => {
  it("caps concurrency and preserves order", async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await runWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 15));
      inFlight--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10]);
    expect(peak).toBe(2);
  });

  it("clamps requested concurrency", () => {
    expect(resolveSubagentConcurrency(100)).toBe(8);
    expect(resolveSubagentConcurrency(undefined)).toBeGreaterThanOrEqual(1);
  });

  it("mutex serialises", async () => {
    const lock = createMutex();
    const order: number[] = [];
    await Promise.all([
      lock(async () => {
        await new Promise((r) => setTimeout(r, 20));
        order.push(1);
      }),
      lock(async () => {
        order.push(2);
      }),
    ]);
    expect(order).toEqual([1, 2]);
  });
});

describe("custom agents", () => {
  it("parses frontmatter", () => {
    const def = parseCustomAgent(
      "---\nname: reviewer\ndescription: d\ntools: [a, b]\nreadonly: true\nmodel: fast\n---\nBe strict.",
      "reviewer.md",
    );
    expect(def).toMatchObject({
      name: "reviewer",
      tools: ["a", "b"],
      readonly: true,
      model: "fast",
      prompt: "Be strict.",
    });
  });

  it("falls back to file name and rejects empty/invalid", () => {
    expect(parseCustomAgent("Do x", "helper.md")?.name).toBe("helper");
    expect(parseCustomAgent("---\nname: x\n---\n", "x.md")).toBeNull();
    expect(parseCustomAgent("body", "bad name.md")).toBeNull();
  });

  it("loads custom agents from every workspace root", async () => {
    const files: Record<string, string> = {
      "file:///app/.knoxcoder/agents/reviewer.md":
        "---\nname: reviewer\n---\nReview app.",
      "file:///lib/.knoxcoder/agents/helper.md":
        "---\nname: helper\n---\nHelp lib.",
    };
    const ide = {
      getWorkspaceDirs: async () => ["file:///app", "file:///lib"],
      listDir: async (dir: string) => {
        // Windows rewrites file:///app to file:///C:/app, so match on the tail.
        if (/\/app\/\.knoxcoder\/agents$/.test(dir)) {
          return [["reviewer.md", 1]];
        }
        if (/\/lib\/\.knoxcoder\/agents$/.test(dir)) {
          return [["helper.md", 1]];
        }
        throw new Error("missing");
      },
      readFile: async (u: string) => {
        const key = Object.keys(files).find((k) =>
          u.endsWith(k.slice("file://".length)),
        );
        if (!key) {
          throw new Error("missing");
        }
        return files[key];
      },
    } as unknown as IDE;
    const agents = await loadCustomAgents(ide);
    expect(agents.map((a) => a.name).sort()).toEqual(["helper", "reviewer"]);
  });
});

describe("worktree isolation + merge-back", () => {
  afterEach(cleanupTempRepos);

  const editIn = (ide: IDE, root: string, file: string, content: string) =>
    ide.writeFile(localPathToUri(path.join(root, file)), content);

  it("merges disjoint parallel writers, conflicts on overlap", async () => {
    const base = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n") + "\n";
    const root = makeTempRepo({ "a.txt": base });
    const ide = realIde(root);

    // Barrier: every worktree must be seeded before any child finishes (and
    // merges). Otherwise a late-starting worktree is seeded with an earlier
    // merge's changes and applies cleanly, making the outcome timing-dependent.
    let arrived = 0;
    let release!: () => void;
    const allStarted = new Promise<void>((r) => (release = r));

    const edit = (line: number, text: string) => async (child: IDE) => {
      if (++arrived === 3) release();
      await allStarted;
      const lines = base.split("\n");
      lines[line] = text;
      return editIn(child, root, "a.txt", lines.join("\n"));
    };

    // Run sequentially-started but both branched from the same HEAD.
    const [first, second, third] = await Promise.all([
      runInWorktree(ide, "s", "one", edit(2, "ONE")),
      runInWorktree(ide, "s", "two", edit(25, "TWO")),
      runInWorktree(ide, "s", "three", edit(2, "THREE")),
    ]);
    const merges = [first, second, third].map((r) => r.merge.status).sort();
    // Two of the three non-overlapping/first edits land; the loser conflicts.
    expect(merges.filter((m) => m === "applied").length).toBe(2);
    expect(merges.filter((m) => m === "conflict").length).toBe(1);
    const final = readFileSync(path.join(root, "a.txt"), "utf-8");
    expect(final).toContain("TWO");
    expect(final.includes("ONE") !== final.includes("THREE")).toBe(true);
    const conflict = [first, second, third].find(
      (r) => r.merge.status === "conflict",
    )!;
    expect(conflict.merge.patchPath).toMatch(/\.patch$/);
  });

  it("captures new files and skips when child made no changes", async () => {
    const root = makeTempRepo();
    const ide = realIde(root);
    const added = await runInWorktree(ide, "s", "new", (child) =>
      editIn(child, root, "fresh.txt", "x\n"),
    );
    expect(added.merge.status).toBe("applied");
    expect(readFileSync(path.join(root, "fresh.txt"), "utf-8")).toBe("x\n");
    const none = await runInWorktree(ide, "s", "none", async () => undefined);
    expect(none.merge.status).toBe("no-changes");
  });

  it("children see the parent's uncommitted edits and merge only their own", async () => {
    const root = makeTempRepo({ "a.txt": "one\ntwo\nthree\n" });
    const ide = realIde(root);
    writeFileSync(path.join(root, "a.txt"), "ONE\ntwo\nthree\n"); // uncommitted
    writeFileSync(path.join(root, "new.txt"), "untracked\n"); // untracked
    let seen = "";
    let seenNew = "";
    const r = await runInWorktree(ide, "s", "seed", async (child) => {
      seen = await child.readFile(localPathToUri(path.join(root, "a.txt")));
      seenNew = await child.readFile(localPathToUri(path.join(root, "new.txt")));
      await editIn(child, root, "a.txt", "ONE\ntwo\nTHREE\n");
    });
    expect(seen).toBe("ONE\ntwo\nthree\n");
    expect(seenNew).toBe("untracked\n");
    expect(r.merge.status).toBe("applied");
    expect(r.merge.files).toEqual(["a.txt"]);
    expect(readFileSync(path.join(root, "a.txt"), "utf-8")).toBe(
      "ONE\ntwo\nTHREE\n",
    );
  });

  it("merges into an unsaved editor buffer and writes back through the IDE", async () => {
    const base = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n") + "\n";
    const root = makeTempRepo({ "a.txt": base });
    const disk = realIde(root);
    const target = path.join(root, "a.txt");
    const isReal = (u: string) => localPathOrUriToPath(u) === target;
    // The user has an unsaved edit on line 0: the buffer differs from disk.
    const buffer = base.replace("line 0", "line 0 (user)");
    const writes: string[] = [];
    const ide = {
      ...disk,
      readFile: async (u: string) => (isReal(u) ? buffer : disk.readFile(u)),
      writeFile: async (u: string, c: string) => {
        if (isReal(u)) {
          writes.push(c);
        } else {
          await disk.writeFile(u, c);
        }
      },
    } as unknown as IDE;
    const r = await runInWorktree(ide, "s", "buf", async (child) => {
      const lines = base.split("\n");
      lines[15] = "CHILD";
      await child.writeFile(localPathToUri(target), lines.join("\n"));
    });
    expect(r.merge.status).toBe("applied");
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("line 0 (user)"); // unsaved edit kept
    expect(writes[0]).toContain("CHILD"); // child's change merged
    // Disk was not touched behind the editor's back.
    expect(readFileSync(target, "utf-8")).toBe(base);
  });
});
