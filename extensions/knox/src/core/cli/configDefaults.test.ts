import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { cliModelFromConfig, configYamlPath } from "./configDefaults";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("cli config.yaml defaults", () => {
  it("reads the first model id", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "knox-cfg-"));
    dirs.push(dir);
    const file = path.join(dir, "config.yaml");
    fs.writeFileSync(
      file,
      "models:\n  - model: anthropic/claude-sonnet-4\n    provider: knoxchat\n",
    );
    expect(cliModelFromConfig(file)).toBe("anthropic/claude-sonnet-4");
  });

  it("returns undefined when the file is missing", () => {
    expect(
      cliModelFromConfig(path.join(os.tmpdir(), "knox-no-such-config.yaml")),
    ).toBeUndefined();
  });

  it("honors KNOX_GLOBAL_DIR", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "knox-cfg-"));
    dirs.push(dir);
    expect(configYamlPath({ KNOX_GLOBAL_DIR: dir })).toBe(
      path.join(dir, "config.yaml"),
    );
  });
});
