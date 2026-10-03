import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createScriptedLlm, type ScriptedTurn } from "../eval/harness";
import {
  exitCodeFor,
  catalogForProfile,
  parseCliArgs,
  runHeadless,
  type HeadlessPermission,
} from "./headless";

const dirs: string[] = [];
function tmp(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "knox-headless-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const run = (
  dir: string,
  script: ScriptedTurn[],
  permission?: HeadlessPermission,
  maxSteps?: number,
) =>
  runHeadless({
    task: "do it",
    workspaceDir: dir,
    llm: createScriptedLlm(script) as never,
    permission,
    maxSteps,
    systemPrompt: "test",
  });

describe("headless run (K-029)", () => {
  it("edits a real file end to end and exits 0", async () => {
    const dir = tmp({ "a.txt": "hello world\n" });
    const r = await run(dir, [
      {
        toolCalls: [
          { name: "builtin_read_file", args: { filepath: "a.txt" } },
        ],
      },
      {
        toolCalls: [
          {
            name: "builtin_edit_file",
            args: {
              filepath: "a.txt",
              old_string: "world",
              new_string: "knox",
            },
          },
        ],
      },
      { content: "Changed greeting." },
    ]);
    expect(r.stoppedReason).toBe("completed");
    expect(r.exitCode).toBe(0);
    expect(r.summary).toContain("Changed greeting");
    expect(fs.readFileSync(path.join(dir, "a.txt"), "utf-8")).toBe(
      "hello knox\n",
    );
    expect(r.tools.map((t) => t.name)).toEqual([
      "builtin_read_file",
      "builtin_edit_file",
    ]);
  });

  it("denies shell in acceptEdits (nobody to ask) and runs it in fullAuto", async () => {
    const script: ScriptedTurn[] = [
      {
        toolCalls: [
          {
            name: "builtin_run_terminal_command",
            args: { command: "echo hi > out.txt" },
          },
        ],
      },
      { content: "done" },
    ];
    const dirA = tmp({});
    const a = await run(dirA, script, "acceptEdits");
    expect(a.denied).toEqual(["builtin_run_terminal_command"]);
    expect(fs.existsSync(path.join(dirA, "out.txt"))).toBe(false);

    const dirB = tmp({});
    const b = await run(dirB, script, "fullAuto");
    expect(b.denied).toEqual([]);
    expect(fs.readFileSync(path.join(dirB, "out.txt"), "utf-8").trim()).toBe(
      "hi",
    );
  });

  it("still blocks destructive commands in fullAuto", async () => {
    const dir = tmp({ "keep.txt": "x" });
    const r = await run(
      dir,
      [
        {
          toolCalls: [
            {
              name: "builtin_run_terminal_command",
              args: { command: "git reset --hard HEAD" },
            },
          ],
        },
        { content: "done" },
      ],
      "fullAuto",
    );
    expect(r.denied).toEqual(["builtin_run_terminal_command"]);
  });

  it("searches the real tree", async () => {
    const dir = tmp({ "src/x.ts": "const needle = 1;\n", "y.ts": "none\n" });
    const r = await run(dir, [
      {
        toolCalls: [
          { name: "builtin_exact_search", args: { query: "needle" } },
        ],
      },
      { content: "found" },
    ]);
    expect(r.tools[0].ok).toBe(true);
    expect(r.tools[0].output).toContain("src/x.ts");
  });

  it("stops at the step cap with exit code 2", async () => {
    const dir = tmp({ "a.txt": "1" });
    const call = {
      toolCalls: [{ name: "builtin_read_file", args: { filepath: "a.txt" } }],
    };
    const r = await run(dir, [call, call, call, { content: "stopped" }], undefined, 1);
    expect(r.stoppedReason).toBe("max_steps");
    expect(r.exitCode).toBe(2);
  });

  it("maps stop reasons to exit codes", () => {
    expect(exitCodeFor("completed")).toBe(0);
    expect(exitCodeFor("error")).toBe(1);
    expect(exitCodeFor("aborted")).toBe(130);
    expect(exitCodeFor("doom_loop")).toBe(2);
  });
});

describe("cli args", () => {
  it("parses a task and flags", () => {
    const a = parseCliArgs([
      "run",
      "fix",
      "the",
      "bug",
      "--permission",
      "fullAuto",
      "--json",
      "--max-steps",
      "5",
    ]);
    expect(a).toMatchObject({
      task: "fix the bug",
      permission: "fullAuto",
      json: true,
      maxSteps: 5,
    });
  });
  it("parses --stream-json", () => {
    expect(parseCliArgs(["run", "x", "--stream-json"])).toMatchObject({
      streamJson: true,
      json: false,
    });
    expect(parseCliArgs(["run", "x"])).toMatchObject({ streamJson: false });
  });
  it("parses --profile and picks the catalog", () => {
    expect(parseCliArgs(["x", "--profile", "systems"])).toMatchObject({ profile: "systems" });
    expect(parseCliArgs(["x", "--profile", "nope"])).toHaveProperty("error");
    const names = (p: "default" | "systems") =>
      catalogForProfile(p).map((t) => t.function.name);
    expect(names("default")).not.toContain("builtin_build");
    expect(names("systems")).toEqual(
      expect.arrayContaining(["builtin_read_file", "builtin_build"]),
    );
  });
  it("rejects bad input", () => {
    expect(parseCliArgs(["run"])).toEqual({ error: "missing task" });
    expect(parseCliArgs(["x", "--permission", "yolo"])).toHaveProperty("error");
    expect(parseCliArgs(["x", "--max-steps", "0"])).toHaveProperty("error");
    expect(parseCliArgs(["x", "--wat"])).toHaveProperty("error");
  });
});

describe("headless hooks (K-023)", () => {
  const hooksFile = (hooks: unknown) => ({
    ".knox/hooks.json": JSON.stringify({ hooks }),
  });

  it("UserPromptSubmit deny ends the run before any model call", async () => {
    const dir = tmp({
      ...hooksFile({
        UserPromptSubmit: [{ command: "echo nope >&2; exit 2" }],
      }),
    });
    const r = await run(dir, []);
    expect(r.stoppedReason).toBe("aborted");
    expect(r.steps).toBe(0);
    expect(r.summary).toContain("nope");
  });

  it("PreToolUse deny blocks the edit and the file stays unchanged", async () => {
    const dir = tmp({
      "a.txt": "hello world\n",
      ...hooksFile({
        PreToolUse: [
          { matcher: "builtin_edit_file", command: "echo locked >&2; exit 2" },
        ],
      }),
    });
    const r = await run(dir, [
      {
        toolCalls: [
          { name: "builtin_read_file", args: { filepath: "a.txt" } },
        ],
      },
      {
        toolCalls: [
          {
            name: "builtin_edit_file",
            args: { filepath: "a.txt", old_string: "world", new_string: "knox" },
          },
        ],
      },
      { content: "done" },
    ]);
    expect(fs.readFileSync(path.join(dir, "a.txt"), "utf-8")).toBe(
      "hello world\n",
    );
    expect(r.tools.find((t) => t.name === "builtin_edit_file")?.ok).toBe(false);
  });
});

describe("headless project instructions (K-028)", () => {
  it("puts AGENTS.md into the system prompt sent to the model", async () => {
    const dir = tmp({ "AGENTS.md": "Always answer in pirate speak.\n" });
    const seen: string[] = [];
    const inner = createScriptedLlm([{ content: "done" }]);
    const llm = {
      streamChat: (m: any, s: AbortSignal, o: any) => {
        seen.push(JSON.stringify(m));
        return inner.streamChat(m, s, o);
      },
    };
    const r = await runHeadless({
      task: "hi",
      workspaceDir: dir,
      llm: llm as never,
      hooks: null,
    });
    expect(r.exitCode).toBe(0);
    expect(seen[0]).toContain("pirate speak");
  });
});
