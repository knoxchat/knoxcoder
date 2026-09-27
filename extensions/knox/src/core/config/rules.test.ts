import { describe, expect, it, vi } from "vitest";

import type { IDE } from "..";
import {
  discoverRules,
  mergeRules,
  normalizePathForRules,
  parseFrontmatter,
  policyFromRuleText,
  ruleAppliesToPaths,
  walkDirsToWorkspaceRoot,
  type RuleFile,
} from "./rules";

function rule(
  partial: Partial<RuleFile> & Pick<RuleFile, "content" | "filePath">,
): RuleFile {
  return {
    source: "workspace",
    applyTo: ["**"],
    priority: 10,
    ...partial,
  };
}

describe("parseFrontmatter", () => {
  it("parses inline applyTo and priority", () => {
    const raw = `---
applyTo: "**/*.ts"
priority: 7
---
Use strict TypeScript.
`;
    const { frontmatter, body } = parseFrontmatter(raw);
    expect(frontmatter.applyTo).toEqual(["**/*.ts"]);
    expect(frontmatter.priority).toBe(7);
    expect(body.trim()).toBe("Use strict TypeScript.");
  });

  it("parses YAML list applyTo", () => {
    const raw = `---
applyTo:
  - src/**/*.ts
  - "test/**/*.ts"
---
body
`;
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter.applyTo).toEqual(["src/**/*.ts", "test/**/*.ts"]);
  });

  it("parses JSON-ish applyTo arrays", () => {
    const { frontmatter } = parseFrontmatter(`---
applyTo: ['*.py', "*.go"]
---
x
`);
    expect(frontmatter.applyTo).toEqual(["*.py", "*.go"]);
  });

  it("parses always/ask/never policy lists", () => {
    const raw = `---
always:
  - src/**
  - npm test*
ask: git *
never:
  - ~/.ssh/**
  - rm -rf *
---
body
`;
    const { frontmatter, body } = parseFrontmatter(raw);
    expect(frontmatter.always).toEqual(["src/**", "npm test*"]);
    expect(frontmatter.ask).toEqual(["git *"]);
    expect(frontmatter.never).toEqual(["~/.ssh/**", "rm -rf *"]);
    expect(body.trim()).toBe("body");
  });

  it("returns empty frontmatter when absent", () => {
    const { frontmatter, body } = parseFrontmatter("just content");
    expect(frontmatter).toEqual({});
    expect(body).toBe("just content");
  });
});

describe("ruleAppliesToPaths", () => {
  it("always matches universal globs", () => {
    expect(ruleAppliesToPaths({ applyTo: ["**"] }, [])).toBe(true);
    expect(ruleAppliesToPaths({ applyTo: ["*"] }, undefined)).toBe(true);
  });

  it("hides path-specific rules when no files are active", () => {
    expect(ruleAppliesToPaths({ applyTo: ["**/*.ts"] }, [])).toBe(false);
  });

  it("matches gitignore-style globs against relative paths", () => {
    expect(
      ruleAppliesToPaths({ applyTo: ["src/**/*.ts"] }, ["src/util/foo.ts"]),
    ).toBe(true);
    expect(
      ruleAppliesToPaths({ applyTo: ["src/**/*.ts"] }, ["README.md"]),
    ).toBe(false);
  });
});

describe("mergeRules", () => {
  it("orders by priority and filters applyTo", () => {
    const rules = [
      rule({
        filePath: "global",
        priority: 0,
        applyTo: ["**"],
        content: "global-{os}",
      }),
      rule({
        filePath: "ts-only",
        priority: 10,
        applyTo: ["**/*.ts"],
        content: "typescript",
      }),
      rule({
        filePath: "py-only",
        priority: 10,
        applyTo: ["**/*.py"],
        content: "python",
      }),
    ].sort((a, b) => a.priority - b.priority);

    const merged = mergeRules(rules, undefined, ["src/a.ts"]);
    expect(merged.sources).toEqual(["global", "ts-only"]);
    expect(merged.systemPrompt).toContain("typescript");
    expect(merged.systemPrompt).not.toContain("python");
    expect(merged.systemPrompt).toContain(`global-${process.platform}`);
  });

  it("keeps only universal rules when activePaths is empty", () => {
    const rules = [
      rule({
        filePath: "always",
        applyTo: ["**"],
        content: "always",
      }),
      rule({
        filePath: "ts",
        applyTo: ["*.ts"],
        content: "ts",
      }),
    ];
    const merged = mergeRules(rules, undefined, []);
    expect(merged.sources).toEqual(["always"]);
  });
});

describe("discoverRules agent instruction files", () => {
  it("loads AGENTS.md, CLAUDE.md, and .knoxrules with documented precedence", async () => {
    const files: Record<string, string> = {
      "file:///repo/CLAUDE.md": "claude-compat",
      "file:///repo/AGENTS.md": "agents-root",
      "file:///repo/.knox/AGENTS.md": "knox-agents",
      "file:///repo/.knoxrules": "knox-rules",
    };
    const ide = {
      fileExists: vi.fn(async (p: string) => p in files),
      readFile: vi.fn(async (p: string) => files[p]),
      getWorkspaceDirs: vi.fn(async () => ["file:///repo"]),
      getCurrentFile: vi.fn(async () => undefined),
      getOpenFiles: vi.fn(async () => []),
      listDir: vi.fn(async () => {
        throw new Error("no global rules dir");
      }),
    } as unknown as IDE;

    const rules = await discoverRules(ide);
    const workspace = rules.filter((r) => r.source === "workspace");
    expect(workspace.map((r) => r.content)).toEqual([
      "claude-compat",
      "agents-root",
      "knox-agents",
      "knox-rules",
    ]);
    expect(workspace.map((r) => r.priority)).toEqual([7, 8, 9, 10]);
  });
});

describe("policyFromRuleText", () => {
  it("merges frontmatter lists and markdown - always/ask/never items", () => {
    const { frontmatter, body } = parseFrontmatter(`---
never:
  - ~/.ssh/**
---
- always: src/**
- ask: git *
`);
    const policy = policyFromRuleText(frontmatter, body);
    expect(policy?.paths).toEqual(
      expect.arrayContaining([
        { pattern: "~/.ssh/**", action: "deny" },
        { pattern: "src/**", action: "allow" },
      ]),
    );
    expect(policy?.commands).toEqual(
      expect.arrayContaining([{ pattern: "git *", action: "ask" }]),
    );
  });
});

describe("walkDirsToWorkspaceRoot", () => {
  it("walks from a file up to the workspace root", () => {
    expect(
      walkDirsToWorkspaceRoot("file:///repo/src/pkg/a.ts", ["file:///repo"]),
    ).toEqual(["file:///repo/src/pkg", "file:///repo/src", "file:///repo"]);
  });

  it("stops at the workspace root", () => {
    expect(
      walkDirsToWorkspaceRoot("file:///repo/AGENTS.md", ["file:///repo"]),
    ).toEqual(["file:///repo"]);
  });
});

describe("normalizePathForRules", () => {
  it("strips workspace root prefix", () => {
    expect(
      normalizePathForRules("/repo/src/a.ts", ["/repo"]),
    ).toBe("src/a.ts");
  });
});
