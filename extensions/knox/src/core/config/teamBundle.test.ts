import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  exportTeamBundle,
  importTeamBundle,
  isAllowedBundlePath,
  parseTeamBundle,
} from "./teamBundle";

const dirs: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "knox-team-"));
  dirs.push(d);
  return d;
};
const put = (root: string, rel: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content);
};
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("team bundle", () => {
  it("round-trips rules, skills, agents and hooks", () => {
    const a = tmp();
    put(a, ".knoxrules", "be brief\n");
    put(a, "skills/deploy/SKILL.md", "---\nname: deploy\n---\nsteps\n");
    put(a, ".knoxcoder/agents/reviewer.md", "---\nname: reviewer\n---\nreview\n");
    put(a, ".knoxcoder/hooks.json", '{"hooks":{}}');
    put(a, ".knoxcoder/config.yaml", "apiKey: nope\n");
    put(a, "src/app.ts", "x");
    const { bundle, skipped } = exportTeamBundle(a, "team");
    expect(bundle.files.map((f) => f.path).sort()).toEqual([
      ".knoxcoder/agents/reviewer.md",
      ".knoxcoder/hooks.json",
      ".knoxrules",
      "skills/deploy/SKILL.md",
    ]);
    expect(skipped).toEqual([]);

    const b = tmp();
    const parsed = parseTeamBundle(JSON.stringify(bundle));
    expect("error" in parsed).toBe(false);
    const res = importTeamBundle(parsed as typeof bundle, b);
    expect(res.written).toContain(".knoxrules");
    // hooks need an explicit opt-in
    expect(res.written).not.toContain(".knoxcoder/hooks.json");
    expect(res.skipped.find((s) => s.path === ".knoxcoder/hooks.json")).toBeDefined();
    expect(fs.existsSync(path.join(b, ".knoxcoder/config.yaml"))).toBe(false);
    importTeamBundle(bundle, b, { allowHooks: true });
    expect(fs.readFileSync(path.join(b, ".knoxcoder/hooks.json"), "utf-8")).toBe('{"hooks":{}}');
  });

  it("keeps existing files unless forced", () => {
    const a = tmp();
    put(a, ".knoxrules", "new\n");
    const { bundle } = exportTeamBundle(a);
    const b = tmp();
    put(b, ".knoxrules", "mine\n");
    expect(importTeamBundle(bundle, b).written).toEqual([]);
    expect(fs.readFileSync(path.join(b, ".knoxrules"), "utf-8")).toBe("mine\n");
    importTeamBundle(bundle, b, { overwrite: true });
    expect(fs.readFileSync(path.join(b, ".knoxrules"), "utf-8")).toBe("new\n");
  });

  it("refuses secrets on export and traversal on import", () => {
    const a = tmp();
    put(a, ".knoxrules", "token sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789ABCDEF\n");
    put(a, "AGENTS.md", "ok\n");
    const { bundle, skipped } = exportTeamBundle(a);
    expect(bundle.files.map((f) => f.path)).toEqual(["AGENTS.md"]);
    expect(skipped[0].path).toBe(".knoxrules");

    const b = tmp();
    const evil = {
      ...bundle,
      files: [
        { path: "../escape.txt", content: "x" },
        { path: "skills/../../escape.txt", content: "x" },
        { path: "/etc/passwd", content: "x" },
        { path: "src/app.ts", content: "x" },
      ],
    };
    const res = importTeamBundle(evil, b);
    expect(res.written).toEqual([]);
    expect(res.skipped).toHaveLength(4);
    expect(isAllowedBundlePath("skills/a/SKILL.md")).toBe(true);
    expect(isAllowedBundlePath("skills")).toBe(false);
  });

  it("rejects bad or newer bundles", () => {
    expect(parseTeamBundle("nope")).toHaveProperty("error");
    expect(parseTeamBundle('{"format":"other"}')).toHaveProperty("error");
    expect(
      parseTeamBundle('{"format":"knox-team-bundle","version":99,"files":[]}'),
    ).toHaveProperty("error");
  });
});
