import { exec } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";
import type { IDE, ToolExtras } from "../..";

import { gitBisectImpl } from "./gitBisect";

const execAsync = promisify(exec);

function extras(
  subprocess: ReturnType<typeof vi.fn>,
  cwd: string,
  abort?: AbortSignal,
): ToolExtras {
  const ide = {
    getWorkspaceDirs: vi.fn(async () => [pathToFileURL(cwd).href]),
    getGitRootPath: vi.fn(async () => pathToFileURL(cwd).href),
    subprocess,
  } as unknown as IDE;
  return {
    ide,
    llm: {} as ToolExtras["llm"],
    fetch: vi.fn(),
    abortSignal: abort,
    tool: { function: { name: "builtin_git_bisect" } } as ToolExtras["tool"],
  };
}

function realGitExtras(cwd: string, abort?: AbortSignal): ToolExtras {
  return extras(
    vi.fn(
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
    ),
    cwd,
    abort,
  );
}

async function git(cwd: string, args: string): Promise<string> {
  const { stdout } = await execAsync(`git ${args}`, { cwd });
  return stdout.trim();
}

const cleanup: string[] = [];

afterEach(async () => {
  for (const dir of cleanup.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("git bisect (HL-30)", () => {
  it("refuses force and unknown actions", async () => {
    const subprocess = vi.fn(
      async (_command: string, _cwd?: string): Promise<[string, string]> => ["", ""],
    );
    const forced = await gitBisectImpl(
      { action: "reset", force: true },
      extras(subprocess, "/tmp/ws"),
    );
    expect(forced[0].content).toMatch(/never force/i);
    expect(subprocess).not.toHaveBeenCalled();

    const unknown = await gitBisectImpl(
      { action: "rebase" },
      extras(subprocess, "/tmp/ws"),
    );
    expect(unknown[0].content).toMatch(/Unknown action/);
  });

  it("resets on abort before mutating", async () => {
    const controller = new AbortController();
    controller.abort();
    const subprocess = vi.fn(
      async (_command: string, _cwd?: string): Promise<[string, string]> => [
        "Reset successful",
        "",
      ],
    );
    const result = await gitBisectImpl(
      { action: "start", bad: "HEAD", good: "abc" },
      extras(subprocess, "/tmp/ws", controller.signal),
    );
    expect(result[0].content).toMatch(/Aborted/);
    expect(subprocess.mock.calls[0][0]).toBe("git bisect reset");
  });

  it("finds the first bad commit in an 8-commit fixture via scripted oracle", async () => {
    const dir = await mkdtemp(join(tmpdir(), "knox-bisect-"));
    cleanup.push(dir);
    await git(dir, "init");
    await git(dir, "config user.email test@knox");
    await git(dir, "config user.name Knox");
    await git(dir, "config commit.gpgsign false");

    const hashes: string[] = [];
    for (let i = 1; i <= 8; i++) {
      const status = i >= 5 ? "BAD" : "GOOD";
      await writeFile(join(dir, "STATUS"), `${status}\n`);
      await writeFile(join(dir, "n.txt"), `${i}\n`);
      await git(dir, "add STATUS n.txt");
      await git(dir, `commit -m c${i}`);
      hashes.push(await git(dir, "rev-parse HEAD"));
    }
    const good = hashes[0];
    const expectedBad = hashes[4];

    const started = await gitBisectImpl(
      { action: "start", bad: "HEAD", good },
      realGitExtras(dir),
    );
    expect(started[0].description).toBe("started");

    const oracle = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(
      "process.exit(require('fs').readFileSync('STATUS','utf8').includes('GOOD')?0:1)",
    )}`;
    const ran = await gitBisectImpl(
      { action: "run", command: oracle, loop: true },
      realGitExtras(dir),
    );
    expect(ran[0].content).toMatch(/is the first '?bad'? commit/i);
    expect(ran[0].content).toContain(expectedBad.slice(0, 7));

    const reset = await gitBisectImpl({ action: "reset" }, realGitExtras(dir));
    expect(reset[0].description).toBe("reset");
    const head = await git(dir, "rev-parse HEAD");
    expect(head).toBe(hashes[7]);
  });
});
