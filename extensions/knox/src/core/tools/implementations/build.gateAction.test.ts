import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ContextItem, IDE, ToolExtras } from "../..";
import { bundledGateScriptPath } from "../build/rustGate";
import { resetShellJobs } from "../shellJobs";
import { buildImpl } from "./build";

const hasBin = (bin: string, arg = "--version") =>
  spawnSync(bin, [arg], { encoding: "utf8" }).status === 0;
const HAS_RUST = hasBin("cargo") && hasBin("bash") && hasBin("git");

function fsIde(root: string): IDE {
  const toPath = (uri: string) => fileURLToPath(uri);
  return {
    getIdeInfo: vi.fn(async () => ({ remoteName: "local" })),
    getWorkspaceDirs: vi.fn(async () => [`file://${root}`]),
    fileExists: vi.fn(async (uri: string) => fs.existsSync(toPath(uri))),
    readFile: vi.fn(async (uri: string) => fs.readFileSync(toPath(uri), "utf8")),
    writeFile: vi.fn(async (uri: string, contents: string) => {
      fs.mkdirSync(path.dirname(toPath(uri)), { recursive: true });
      fs.writeFileSync(toPath(uri), contents);
    }),
    listDir: vi.fn(async (uri: string) =>
      fs.readdirSync(toPath(uri)).map((name) => [name, 0] as [string, number]),
    ),
    subprocess: vi.fn(async (command: string) => {
      const r = spawnSync("sh", ["-c", command], { encoding: "utf8" });
      return [r.stdout, r.stderr] as [string, string];
    }),
  } as unknown as IDE;
}

function extras(ide: IDE): ToolExtras {
  return {
    ide,
    llm: {} as ToolExtras["llm"],
    fetch: vi.fn(),
    tool: { function: { name: "builtin_build" } } as ToolExtras["tool"],
  };
}

function write(root: string, files: Record<string, string>) {
  for (const [rel, body] of Object.entries(files)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  }
}

const gateItem = (items: ContextItem[]) =>
  items.find((i) => i.name === "Rust gate");

const CARGO_TOML = `[package]
name = "gate_probe"
version = "0.1.0"
edition = "2021"

[lib]
path = "src/lib.rs"
`;

const LIB_GOOD = `pub fn add(a: i32, b: i32) -> i32 {
    a + b
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds() {
        assert_eq!(add(2, 3), 5);
    }
}
`;

describe("builtin_build action=gate / gate_init (real cargo)", () => {
  let root: string;

  beforeEach(() => {
    root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "knox-gate-action-")),
    );
    spawnSync("git", ["init", "-q"], { cwd: root });
    write(root, { ".gitignore": "/target/\n" });
  });
  afterEach(() => {
    resetShellJobs();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const run = (args: Record<string, unknown>) =>
    buildImpl(args, extras(fsIde(root)));

  it.skipIf(!HAS_RUST)(
    "gate_init installs an executable script and refuses to overwrite",
    async () => {
      write(root, { "Cargo.toml": CARGO_TOML, "src/lib.rs": LIB_GOOD });
      const first = gateItem(await run({ action: "gate_init" }))!;
      expect(first.description).toBe("installed");
      const script = path.join(root, "scripts", "pre-commit.sh");
      expect(fs.readFileSync(script, "utf8")).toBe(
        fs.readFileSync(bundledGateScriptPath(), "utf8"),
      );
      if (process.platform !== "win32") {
        expect(fs.statSync(script).mode & 0o111).not.toBe(0);
      }
      expect(first.content).toMatch(/USER runs .*--install-hook/);

      fs.appendFileSync(script, "# local edit\n");
      const again = gateItem(await run({ action: "gate_init" }))!;
      expect(again.description).toBe("already installed");
      expect(fs.readFileSync(script, "utf8")).toContain("# local edit");

      const forced = gateItem(await run({ action: "gate_init", force: true }))!;
      expect(forced.description).toBe("replaced");
      expect(fs.readFileSync(script, "utf8")).not.toContain("# local edit");
    },
    60_000,
  );

  it.skipIf(!HAS_RUST)(
    "gate via the installed script: red on failing test, green once fixed",
    async () => {
      write(root, {
        "Cargo.toml": CARGO_TOML,
        "src/lib.rs": LIB_GOOD.replace("a + b", "a - b"),
      });
      await run({ action: "gate_init" });

      const red = await run({ action: "gate", mode: "full" });
      const failing = gateItem(red)!;
      expect(failing.description).toBe("fail");
      expect(failing.content).toContain("FAILED (full): test");
      expect(failing.content).toMatch(/Do not claim done/);

      const quick = gateItem(await run({ action: "gate", mode: "quick" }))!;
      expect(quick.description).toBe("pass");

      fs.writeFileSync(path.join(root, "src", "lib.rs"), LIB_GOOD);
      const green = gateItem(await run({ action: "gate" }))!;
      expect(green.description).toBe("pass");
      expect(green.content).toContain("PASSED (full)");
    },
    180_000,
  );

  it.skipIf(!HAS_RUST)(
    "gate catches fmt and clippy violations before tests",
    async () => {
      write(root, {
        "Cargo.toml": CARGO_TOML,
        "src/lib.rs": "pub fn   ugly( ) ->i32{1}\n",
      });
      await run({ action: "gate_init" });
      const fmtRed = gateItem(await run({ action: "gate", mode: "quick" }))!;
      expect(fmtRed.description).toBe("fail");
      expect(fmtRed.content).toContain("fmt");

      // --fix rewrites formatting; the gate is then green.
      const fixed = gateItem(
        await run({ action: "gate", mode: "quick", extraArgs: "--fix" }),
      )!;
      expect(fixed.description).toBe("pass");

      write(root, {
        "src/lib.rs":
          "pub fn f(v: &Vec<i32>) -> usize {\n    v.len()\n}\n",
      });
      const clippyRed = gateItem(
        await run({ action: "gate", mode: "quick" }),
      )!;
      expect(clippyRed.description).toBe("fail");
      expect(clippyRed.content).toContain("clippy");
    },
    180_000,
  );

  it.skipIf(!HAS_RUST)(
    "gate without a script falls back to an inline cargo chain",
    async () => {
      write(root, {
        "Cargo.toml": CARGO_TOML,
        "src/lib.rs": LIB_GOOD.replace("a + b", "a - b"),
      });
      const red = await run({ action: "gate" });
      const item = gateItem(red)!;
      expect(item.content).toMatch(/inline cargo chain/);
      expect(item.content).toMatch(/gate_init/);
      // No result line in the fallback, but the red exit must not read as done.
      expect(item.description).not.toBe("pass");
      expect(item.content).not.toMatch(/PASSED/);

      fs.writeFileSync(path.join(root, "src", "lib.rs"), LIB_GOOD);
      const all = await run({ action: "gate" });
      const log = all.map((i) => i.content).join("\n");
      expect(log).toContain("test result: ok");
      expect(fs.existsSync(path.join(root, "target"))).toBe(true);
    },
    180_000,
  );

  it("refuses to manage git hooks", async () => {
    write(root, { "Cargo.toml": CARGO_TOML, "src/lib.rs": LIB_GOOD });
    const items = await run({ action: "gate", extraArgs: "--install-hook" });
    expect(items[0].description).toBe("refused");
    expect(items[0].content).toMatch(/git hooks/);
    expect(fs.existsSync(path.join(root, ".git", "hooks", "pre-commit"))).toBe(
      false,
    );
  });
});
