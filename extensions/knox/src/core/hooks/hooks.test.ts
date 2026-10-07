import { describe, expect, it } from "vitest";

import {
  HookAuditEntry,
  HookExec,
  HookRunner,
  defaultHookExec,
  hookMatches,
  loadHooksConfig,
  parseHooksConfig,
} from "./hooks";

const ok = (stdout = "", code = 0, stderr = "") => ({
  code,
  stdout,
  stderr,
  timedOut: false,
});

describe("parseHooksConfig / hookMatches", () => {
  it("parses valid entries and drops invalid ones", () => {
    const cfg = parseHooksConfig({
      hooks: {
        PreToolUse: [{ command: "a", matcher: "x" }, { command: "" }, 5],
        Bogus: [{ command: "b" }],
      },
    });
    expect(cfg).toEqual({ PreToolUse: [{ command: "a", matcher: "x" }] });
  });

  it("matches with and without the builtin_ prefix", () => {
    expect(hookMatches({ command: "c", matcher: "edit_file|write_file" }, "builtin_edit_file")).toBe(true);
    expect(hookMatches({ command: "c", matcher: "edit_file" }, "builtin_edit_file_x")).toBe(false);
    expect(hookMatches({ command: "c" }, "anything")).toBe(true);
    expect(hookMatches({ command: "c", matcher: "[" }, "x")).toBe(false);
  });

  it("loads from .knoxcoder/hooks.json and tolerates absence", async () => {
    const cfg = await loadHooksConfig(async (u) => {
      expect(u).toBe("file:///w/.knoxcoder/hooks.json");
      return JSON.stringify({ hooks: { Stop: [{ command: "s" }] } });
    }, "file:///w/");
    expect(cfg.Stop).toHaveLength(1);
    expect(await loadHooksConfig(async () => { throw new Error("nope"); }, "file:///w")).toEqual({});
  });
});

describe("HookRunner", () => {
  it("denies on exit 2 and on JSON decision, and stops later hooks", async () => {
    const calls: string[] = [];
    const exec: HookExec = async (cmd) => {
      calls.push(cmd);
      if (cmd === "exit2") return ok("", 2, "no rm");
      if (cmd === "json") return ok('{"decision":"deny","reason":"nope"}');
      return ok();
    };
    const a = await new HookRunner({ PreToolUse: [{ command: "exit2" }, { command: "after" }] }, { exec }).run("PreToolUse", { toolName: "t" });
    expect(a.denied).toEqual({ reason: "no rm", command: "exit2" });
    expect(calls).toEqual(["exit2"]);
    const b = await new HookRunner({ PreToolUse: [{ command: "json" }] }, { exec }).run("PreToolUse", { toolName: "t" });
    expect(b.denied?.reason).toBe("nope");
  });

  it("chains argument modification in order", async () => {
    const seen: unknown[] = [];
    const exec: HookExec = async (cmd, stdin) => {
      seen.push(JSON.parse(stdin).args);
      return ok(JSON.stringify({ updatedArgs: { n: cmd === "one" ? 1 : 2 } }));
    };
    const out = await new HookRunner({ PreToolUse: [{ command: "one" }, { command: "two" }] }, { exec }).run("PreToolUse", { toolName: "t", args: { n: 0 } });
    expect(seen).toEqual([{ n: 0 }, { n: 1 }]);
    expect(out.args).toEqual({ n: 2 });
  });

  it("uses per-hook cwd when stamped", async () => {
    const cwds: Array<string | undefined> = [];
    const exec: HookExec = async (_cmd, _stdin, opts) => {
      cwds.push(opts.cwd);
      return ok("ok");
    };
    await new HookRunner(
      { SessionStart: [{ command: "a", cwd: "/app" }, { command: "b", cwd: "/lib" }] },
      { exec, cwd: "/fallback" },
    ).run("SessionStart", {});
    expect(cwds).toEqual(["/app", "/lib"]);
  });

  it("collects context from PostToolUse, ignores deny there", async () => {
    const exec: HookExec = async (cmd) =>
      cmd === "d" ? ok("", 2, "x") : ok("lint: 2 warnings");
    const out = await new HookRunner({ PostToolUse: [{ command: "d" }, { command: "c" }] }, { exec }).run("PostToolUse", { toolName: "t", result: "r" });
    expect(out.denied).toBeUndefined();
    expect(out.additionalContext).toEqual(["lint: 2 warnings"]);
  });

  it("skips non-matching hooks, never blocks on errors or timeouts, and audits", async () => {
    const audit: HookAuditEntry[] = [];
    const exec: HookExec = async (cmd) =>
      cmd === "slow" ? { code: null, stdout: "", stderr: "", timedOut: true } : cmd === "crash" ? ok("", 1, "boom") : ok();
    const runner = new HookRunner(
      { PreToolUse: [{ command: "skip", matcher: "other" }, { command: "slow" }, { command: "crash" }] },
      { exec, onAudit: (e) => audit.push(e) },
    );
    const out = await runner.run("PreToolUse", { toolName: "builtin_read_file" });
    expect(out.denied).toBeUndefined();
    expect(audit.map((a) => [a.command, a.outcome])).toEqual([["slow", "timeout"], ["crash", "error"]]);
  });

  it("really times out a stuck process", async () => {
    const res = await defaultHookExec("sleep 5", "{}", { timeoutMs: 100 });
    expect(res.timedOut).toBe(true);
  });

  it("really runs a shell hook with stdin", async () => {
    const res = await defaultHookExec("cat", '{"a":1}', { timeoutMs: 3000 });
    expect(res.stdout).toBe('{"a":1}');
  });
});

describe("config.yaml hooks (K-023)", () => {
  it("parses a hooks block from YAML and ignores bad input", async () => {
    const { parseHooksFromYaml, mergeHooksConfigs } = await import("./hooks");
    const cfg = parseHooksFromYaml(
      "name: x\nhooks:\n  PreToolUse:\n    - matcher: edit_file\n      command: ./a.sh\n      timeoutMs: 500\n  Stop:\n    - command: ./b.sh\n",
    );
    expect(cfg.PreToolUse).toEqual([
      { matcher: "edit_file", command: "./a.sh", timeoutMs: 500 },
    ]);
    expect(cfg.Stop?.[0].command).toBe("./b.sh");
    expect(parseHooksFromYaml("::: not yaml [")).toEqual({});
    expect(parseHooksFromYaml("name: x")).toEqual({});
    const merged = mergeHooksConfigs(cfg, { PreToolUse: [{ command: "./c.sh" }] });
    expect(merged.PreToolUse?.map((d) => d.command)).toEqual(["./a.sh", "./c.sh"]);
  });

  it("workspace runner merges global yaml, workspace yaml and hooks.json, and logs audits", async () => {
    const os = await import("node:os");
    const fsp = await import("node:fs/promises");
    const path = await import("node:path");
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "knox-hooks-"));
    const prev = process.env.KNOX_GLOBAL_DIR;
    process.env.KNOX_GLOBAL_DIR = tmp;
    try {
      await fsp.writeFile(
        path.join(tmp, "config.yaml"),
        "hooks:\n  SessionStart:\n    - command: echo global\n",
      );
      const files: Record<string, string> = {
        [`${tmp}/.knoxcoder/config.yaml`]: "hooks:\n  SessionStart:\n    - command: echo wsyaml\n",
        [`${tmp}/.knoxcoder/hooks.json`]: JSON.stringify({
          hooks: { SessionStart: [{ command: "echo json" }] },
        }),
      };
      const ide = {
        getWorkspaceDirs: async () => [tmp],
        fileExists: async (u: string) => u in files,
        readFile: async (u: string) => {
          if (!(u in files)) throw new Error("ENOENT");
          return files[u];
        },
      } as never;
      const { getWorkspaceHookRunner } = await import("./workspaceHooks");
      const { getHookLogEntries, clearHookLog } = await import("./auditLog");
      clearHookLog();
      const runner = await getWorkspaceHookRunner(ide, () => undefined);
      expect(runner).not.toBeNull();
      const out = await runner!.run("SessionStart", {});
      expect(out.additionalContext).toEqual(["global", "wsyaml", "json"]);
      expect(getHookLogEntries().map((e) => e.command)).toEqual([
        "echo global",
        "echo wsyaml",
        "echo json",
      ]);
    } finally {
      if (prev === undefined) delete process.env.KNOX_GLOBAL_DIR;
      else process.env.KNOX_GLOBAL_DIR = prev;
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  });

  it("merges hooks.json from every workspace root and stamps cwd", async () => {
    const os = await import("node:os");
    const fsp = await import("node:fs/promises");
    const path = await import("node:path");
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "knox-hooks-multi-"));
    const a = path.join(tmp, "app");
    const b = path.join(tmp, "lib");
    await fsp.mkdir(path.join(a, ".knoxcoder"), { recursive: true });
    await fsp.mkdir(path.join(b, ".knoxcoder"), { recursive: true });
    await fsp.writeFile(
      path.join(a, ".knoxcoder", "hooks.json"),
      JSON.stringify({ hooks: { SessionStart: [{ command: "echo app" }] } }),
    );
    await fsp.writeFile(
      path.join(b, ".knoxcoder", "hooks.json"),
      JSON.stringify({ hooks: { SessionStart: [{ command: "echo lib" }] } }),
    );
    const prev = process.env.KNOX_GLOBAL_DIR;
    process.env.KNOX_GLOBAL_DIR = path.join(tmp, "empty-global");
    await fsp.mkdir(process.env.KNOX_GLOBAL_DIR);
    try {
      const files: Record<string, string> = {
        [`${a}/.knoxcoder/hooks.json`]: JSON.stringify({
          hooks: { SessionStart: [{ command: "echo app" }] },
        }),
        [`${b}/.knoxcoder/hooks.json`]: JSON.stringify({
          hooks: { SessionStart: [{ command: "echo lib" }] },
        }),
      };
      const ide = {
        getWorkspaceDirs: async () => [a, b],
        fileExists: async (u: string) => u in files,
        readFile: async (u: string) => {
          if (!(u in files)) throw new Error("ENOENT");
          return files[u];
        },
      } as never;
      const { getWorkspaceHookRunner } = await import("./workspaceHooks");
      const runner = await getWorkspaceHookRunner(ide, () => undefined);
      expect(runner).not.toBeNull();
      const out = await runner!.run("SessionStart", {});
      expect(out.additionalContext).toEqual(["app", "lib"]);
    } finally {
      if (prev === undefined) delete process.env.KNOX_GLOBAL_DIR;
      else process.env.KNOX_GLOBAL_DIR = prev;
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  });
});
