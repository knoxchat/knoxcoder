import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const knoxRoot = path.resolve(here, "../..");
const notices = path.join(knoxRoot, "docs", "third-party-notices.md");
const script = path.join(knoxRoot, "scripts", "knox-third-party-notices.mts");

describe("Knox third-party notices (P0-4)", () => {
  it("lists sqlite3, yaml, openai, i18next and matches package.json", () => {
    expect(fs.existsSync(notices)).toBe(true);
    const text = fs.readFileSync(notices, "utf8");
    for (const name of ["sqlite3", "yaml", "openai", "i18next", "web-tree-sitter"]) {
      expect(text).toContain(`\`${name}\``);
    }
    execFileSync(process.execPath, [script, "--check"], {
      cwd: knoxRoot,
      encoding: "utf8",
    });
  });
});
