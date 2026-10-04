import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { knoxCliVersion, KNOX_CLI_VERSION_FALLBACK } from "./version";

const dirs: string[] = [];
afterEach(() => {
  delete process.env.KNOX_VERSION;
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("knoxCliVersion", () => {
  it("prefers KNOX_VERSION", () => {
    process.env.KNOX_VERSION = "9.9.9-test";
    expect(knoxCliVersion(os.tmpdir())).toBe("9.9.9-test");
  });

  it("reads the @knoxchat/cli package when the CLI is installed out of tree", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "knox-cli-ver-"));
    dirs.push(dir);
    const dist = path.join(dir, "dist");
    fs.mkdirSync(dist);
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "@knoxchat/cli", version: "2.0.0-rc.9", bin: { knox: "dist/knox.js" } }),
    );
    expect(knoxCliVersion(dist)).toBe("2.0.0-rc.9");
  });

  it("falls back when no package is nearby", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "knox-cli-ver-empty-"));
    dirs.push(dir);
    expect(knoxCliVersion(dir)).toBe(KNOX_CLI_VERSION_FALLBACK);
  });
});
