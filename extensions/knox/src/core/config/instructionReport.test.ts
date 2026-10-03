import { describe, expect, it } from "vitest";

import { buildAgentsMd } from "./agentsMd";
import {
  buildInstructionReport,
  formatInstructionReport,
  INSTRUCTION_FILE_WARN_TOKENS,
  INSTRUCTION_TOTAL_WARN_TOKENS,
} from "./instructionReport";
import type { RuleFile } from "./rules";
import { parseSkillGlobs, skillAppliesToPaths } from "../skills/skillManager";

const rule = (over: Partial<RuleFile>): RuleFile => ({
  source: "workspace",
  filePath: "/w/AGENTS.md",
  applyTo: [],
  priority: 8,
  content: "be careful",
  ...over,
});

describe("K-027 instruction report", () => {
  it("keeps load order and reports token cost per entry", () => {
    const report = buildInstructionReport({
      rules: [
        rule({ source: "global", filePath: "/h/.knoxrules", content: "a".repeat(400), priority: 0 }),
        rule({ filePath: "/w/AGENTS.md", content: "b".repeat(80) }),
      ],
      activePaths: [],
    });
    expect(report.entries.map((e) => e.name)).toEqual([".knoxrules", "AGENTS.md"]);
    expect(report.entries.map((e) => e.tokens)).toEqual([100, 20]);
    expect(report.loadedTokens).toBe(120);
    expect(report.warnings).toEqual([]);
  });

  it("skips rules whose applyTo does not match the open files", () => {
    const scoped = rule({ filePath: "/w/rust.md", applyTo: ["**/*.rs"], content: "rust rules" });
    const hit = buildInstructionReport({ rules: [scoped], activePaths: ["src/lib.rs"] });
    expect(hit.entries[0].loaded).toBe(true);
    const miss = buildInstructionReport({ rules: [scoped], activePaths: ["src/a.ts"] });
    expect(miss.entries[0]).toMatchObject({ loaded: false, skippedReason: "scoped out" });
    expect(miss.loadedTokens).toBe(0);
    const none = buildInstructionReport({ rules: [scoped], activePaths: undefined });
    expect(none.entries[0].loaded).toBe(false);
  });

  it("warns on an oversized file and on a large total", () => {
    const big = "x".repeat((INSTRUCTION_FILE_WARN_TOKENS + 1) * 4);
    const one = buildInstructionReport({ rules: [rule({ content: big })], activePaths: [] });
    expect(one.entries[0].oversized).toBe(true);
    expect(one.warnings[0]).toContain("AGENTS.md is large");

    const part = "y".repeat(INSTRUCTION_TOTAL_WARN_TOKENS * 3);
    const many = buildInstructionReport({
      rules: [rule({ filePath: "/a.md", content: part }), rule({ filePath: "/b.md", content: part })],
      activePaths: [],
    });
    expect(many.warnings.some((w) => w.includes("Always-on instructions total"))).toBe(true);
  });

  it("scopes skills by globs and prices listing versus body", () => {
    const skills = [
      { name: "rust", description: "Rust help", location: "/h/.knoxcoder/skills/rust/SKILL.md", content: "z".repeat(800), globs: ["**/*.rs"] },
      { name: "any", description: "General", location: "/w/skills/any/SKILL.md", content: "hi" },
    ];
    const report = buildInstructionReport({ rules: [], skills, activePaths: ["a.ts"] });
    const rust = report.entries.find((e) => e.name === "rust")!;
    const any = report.entries.find((e) => e.name === "any")!;
    expect(rust).toMatchObject({ loaded: false, source: "user", bodyTokens: 200 });
    expect(any).toMatchObject({ loaded: true, source: "project" });
    expect(formatInstructionReport(report)).toContain("skipped (scoped out)");
  });

  it("parses skill globs including braces and lists", () => {
    expect(parseSkillGlobs("src/**/*.{ts,tsx}, *.py")).toEqual(["src/**/*.{ts,tsx}", "*.py"]);
    expect(parseSkillGlobs('["a/**", "b"]')).toEqual(["a/**", "b"]);
    expect(parseSkillGlobs(undefined)).toEqual([]);
    expect(skillAppliesToPaths({ globs: ["**/*.rs"] }, ["x/y.rs"])).toBe(true);
    expect(skillAppliesToPaths({}, undefined)).toBe(true);
  });
});

describe("K-027 /init AGENTS.md", () => {
  it("uses real scripts, the detected oracle and the layout", () => {
    const md = buildAgentsMd({
      projectName: "demo",
      entries: ["package.json", "tsconfig.json", "src", "tests"],
      topDirs: ["src", "tests", ".git"],
      packageJson: JSON.stringify({ name: "@x/demo", scripts: { test: "vitest", build: "tsc" } }),
      hasTests: true,
    });
    expect(md).toContain("# @x/demo");
    expect(md).toContain("- `src/`");
    expect(md).not.toContain(".git");
    expect(md).toContain("npm run test");
    expect(md).toContain("`npx tsc --noEmit`");
    expect(md).toContain("Add or update a test");
  });

  it("leaves visible TODOs when nothing is known", () => {
    const md = buildAgentsMd({ projectName: "empty", entries: [], topDirs: [] });
    expect(md).toContain("TODO: add build and test commands.");
    expect(md).toContain("TODO: describe how tests are run");
  });
});
