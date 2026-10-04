import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { evaluateToolPolicy, isPathOutsideWorkspace } from "./toolPolicy";

let base: string;
let ws: string;
let outside: string;
let home: string;
const symlinksWork = process.platform !== "win32";

beforeAll(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "knox-boundary-")));
  ws = path.join(base, "ws");
  outside = path.join(base, "outside");
  home = path.join(base, "home");
  fs.mkdirSync(path.join(ws, "src"), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.mkdirSync(path.join(home, ".ssh"), { recursive: true });
  fs.writeFileSync(path.join(outside, "secret.txt"), "x");
  fs.writeFileSync(path.join(home, ".ssh", "id_rsa"), "x");
  fs.writeFileSync(path.join(ws, "src", "a.ts"), "x");
  if (symlinksWork) {
    fs.symlinkSync(outside, path.join(ws, "link-out"));
    fs.symlinkSync(path.join(outside, "secret.txt"), path.join(ws, "file-link"));
    fs.symlinkSync(path.join(home, ".ssh"), path.join(ws, "ssh-link"));
    fs.symlinkSync(path.join(ws, "src"), path.join(ws, "link-in"));
    fs.symlinkSync("../../outside", path.join(ws, "src", "rel-out"));
    fs.symlinkSync(path.join(outside, "not-yet"), path.join(ws, "dangling"));
  }
});

afterAll(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

describe("path boundary: lexical escapes", () => {
  it.each([
    "../outside/secret.txt",
    "src/../../outside/secret.txt",
    "./src/../../../etc/passwd",
    "src/./../../outside",
  ])("treats %s as outside", (p) => {
    expect(isPathOutsideWorkspace(p, [ws], home)).toBe(true);
  });

  it("treats a sibling with the same prefix as outside", () => {
    expect(isPathOutsideWorkspace(ws + "-evil/x", [ws], home)).toBe(true);
  });

  it("keeps normal in-workspace paths inside", () => {
    expect(isPathOutsideWorkspace("src/a.ts", [ws], home)).toBe(false);
    expect(isPathOutsideWorkspace("src/new/dir/file.ts", [ws], home)).toBe(false);
    expect(isPathOutsideWorkspace(path.join(ws, "src", "a.ts"), [ws], home)).toBe(false);
    expect(isPathOutsideWorkspace("file://" + path.join(ws, "src"), [ws], home)).toBe(false);
  });
});

describe.skipIf(!symlinksWork)("path boundary: symlink escapes", () => {
  it.each(["link-out/secret.txt", "link-out/new-file.txt", "file-link", "src/rel-out/secret.txt", "dangling"])(
    "treats %s as outside (existing and not-yet-created targets)",
    (p) => {
      expect(isPathOutsideWorkspace(p, [ws], home)).toBe(true);
    },
  );

  it("allows a symlink that stays inside the workspace", () => {
    expect(isPathOutsideWorkspace("link-in/a.ts", [ws], home)).toBe(false);
  });

  it("works when the workspace root itself is reached through a symlink", () => {
    const viaLink = path.join(base, "ws-alias");
    fs.symlinkSync(ws, viaLink);
    expect(isPathOutsideWorkspace(path.join(viaLink, "src", "a.ts"), [viaLink], home)).toBe(false);
    expect(isPathOutsideWorkspace(path.join(viaLink, "link-out", "secret.txt"), [viaLink], home)).toBe(true);
  });

  it.each([
    ["builtin_read_file", { filepath: "link-out/secret.txt" }],
    ["builtin_create_new_file", { filepath: "link-out/new.txt", contents: "x" }],
    ["builtin_edit_file", { filepath: "file-link", old_string: "a", new_string: "b" }],
  ])("%s through a symlink out of the workspace is not auto-allowed", (toolName, args) => {
    const d = evaluateToolPolicy({ toolName, args, workspaceDirs: [ws], home });
    expect(d.action === "ask" || d.action === "deny").toBe(true);
  });

  it("hard-denies a symlink that points into ~/.ssh", () => {
    const d = evaluateToolPolicy({
      toolName: "builtin_read_file",
      args: { filepath: "ssh-link/id_rsa" },
      workspaceDirs: [ws],
      home,
    });
    expect(d.action).toBe("deny");
  });

  it("treats a cwd that is a symlink out of the workspace as external", () => {
    const d = evaluateToolPolicy({
      toolName: "builtin_run_terminal_command",
      args: { command: "ls", working_directory: "link-out" },
      workspaceDirs: [ws],
      home,
    });
    expect(d.action === "ask" || d.action === "deny").toBe(true);
  });
});

describe("staged edit apply: re-check at write time", () => {
  it.skipIf(!symlinksWork)("refuses a staged file whose directory became a symlink out of the workspace", async () => {
    const { applyStaged, StagedEdits } = await import("./stagedEdits");
    const written: string[] = [];
    const ide = {
      getWorkspaceDirs: async () => [ws],
      writeFile: async (u: string) => void written.push(u),
      removeFile: async (u: string) => void written.push(u),
    } as any;
    const staged = new StagedEdits();
    const escaped = path.join(ws, "link-out", "evil.txt");
    const fine = path.join(ws, "src", "ok.ts");
    staged.files.set(escaped, { before: null, after: "x" });
    staged.files.set(fine, { before: null, after: "y" });
    const res = await applyStaged(ide, staged);
    expect(res.applied).toEqual([fine]);
    expect(res.failed.map((f) => f.fileUri)).toEqual([escaped]);
    expect(res.failed[0].error).toMatch(/outside the workspace/);
    expect(written).toEqual([fine]);
    expect(staged.files.has(escaped)).toBe(true);
  });

  it.skipIf(!symlinksWork)("refuses hard-denied targets such as ~/.ssh via a symlink", async () => {
    const { applyStaged, StagedEdits } = await import("./stagedEdits");
    const ide = { getWorkspaceDirs: async () => [ws], writeFile: async () => { throw new Error("must not write"); } } as any;
    const staged = new StagedEdits();
    staged.files.set(path.join(ws, "ssh-link", "authorized_keys"), { before: null, after: "k" });
    const res = await applyStaged(ide, staged);
    expect(res.applied).toEqual([]);
    expect(res.failed).toHaveLength(1);
  });
});
