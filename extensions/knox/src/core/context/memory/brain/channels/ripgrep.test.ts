/**
 * MEM-23 — ripgrep channel (pure).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  countCorpusMatches,
  extractRipgrepNeedles,
  filePathMatches,
  hasRipgrepHit,
  looksLikeRegex,
  needleWeight,
  normalizeRelPath,
  parseMemoryKey,
  parseRipgrepContentHits,
  unwrapRegexLiteral,
  workspaceNeedles,
} from "./ripgrep.js";

describe("MEM-23 ripgrep needles", () => {
  it("extracts identifiers, paths, quotes, and long content words", () => {
    const needles = extractRipgrepNeedles(
      'fix AuthService in `src/auth.ts` plus knoxRgCorpusTokenAlpha',
    );
    const patterns = needles.map((n) => n.pattern);
    expect(patterns).toEqual(
      expect.arrayContaining(["AuthService", "src/auth.ts", "knoxrgcorpustokenalpha"]),
    );
    expect(needles.find((n) => n.pattern === "AuthService")?.kind).toBe("identifier");
    expect(needles.find((n) => n.pattern === "src/auth.ts")?.wholeWord).toBe(false);
  });

  it("does not turn conversational stopwords into needles", () => {
    const needles = extractRipgrepNeedles("please continue the work now");
    expect(needles).toEqual([]);
  });

  it("treats /pattern/ and foo|bar as regex", () => {
    expect(looksLikeRegex("/oauth.*token/i")).toBe(true);
    expect(unwrapRegexLiteral("/oauth.*token/i")).toBe("oauth.*token");
    expect(looksLikeRegex("foo|bar")).toBe(true);
    expect(looksLikeRegex("fn ui(&mut self,")).toBe(false);
    const needles = extractRipgrepNeedles("foo|bar");
    expect(needles.some((n) => n.kind === "regex" && n.pattern === "foo|bar")).toBe(true);
  });

  it("workspace needles skip short generic exact words", () => {
    const needles = extractRipgrepNeedles("alpha knoxRgFileTokenAlpha src/auth.ts");
    const ws = workspaceNeedles(needles);
    expect(ws.every((n) => n.pattern !== "alpha")).toBe(true);
    expect(ws.some((n) => /knoxrgfiletokenalpha|src\/auth\.ts/i.test(n.pattern))).toBe(true);
  });

  it("identifier weight is higher than file-map weight", () => {
    expect(needleWeight("identifier")).toBeGreaterThan(needleWeight("exact"));
    expect(needleWeight("exact")).toBeGreaterThan(needleWeight("regex"));
  });
});

describe("MEM-23 path + parse helpers", () => {
  it("normalizes workspace-relative paths", () => {
    expect(normalizeRelPath("./src/auth.ts", "/proj")).toBe("src/auth.ts");
    expect(normalizeRelPath("/proj/src/auth.ts", "/proj")).toBe("src/auth.ts");
    expect(filePathMatches("src/auth.ts", "src/auth.ts")).toBe(true);
    expect(filePathMatches("auth.ts", "src/auth.ts")).toBe(true);
    expect(filePathMatches("src/auth.ts", "lib/auth.ts")).toBe(false);
  });

  it("parses heading content hits and corpus line maps", () => {
    const output = [
      "src/auth.ts",
      "12:  knoxRgFileTokenAlpha",
      "18:  knoxRgFileTokenAlpha()",
      "",
      "lib/other.ts",
      "3: mention",
    ].join("\n");
    expect(parseRipgrepContentHits(output)).toEqual([
      { file: "src/auth.ts", matches: 2 },
      { file: "lib/other.ts", matches: 1 },
    ]);
    expect(parseRipgrepContentHits("No matches found")).toEqual([]);

    const lineToKey = new Map<number, string>([
      [12, "semantic:4"],
      [18, "semantic:4"],
      [3, "episodic:9"],
    ]);
    const counts = countCorpusMatches(
      ["corpus.txt", "12: hit", "18: hit", "3: other"].join("\n"),
      lineToKey,
    );
    expect(counts.get("semantic:4")).toBe(2);
    expect(counts.get("episodic:9")).toBe(1);
    expect(parseMemoryKey("semantic:4")).toEqual({ type: "semantic", id: 4 });
  });

  it("hasRipgrepHit reads ranks or scores", () => {
    expect(hasRipgrepHit({ ranks: { ripgrep: 2 } })).toBe(true);
    expect(hasRipgrepHit({ scores: { ripgrep: 0.8 } })).toBe(true);
    expect(hasRipgrepHit({ ranks: { lexical: 1 }, scores: { ripgrep: 0 } })).toBe(false);
    expect(hasRipgrepHit(undefined)).toBe(false);
  });

  it("reuses bundled ripgrep helpers and does not shell out", () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "ripgrep.ts"),
      "utf8",
    );
    expect(src).toMatch(/searchWorkspaceWithRipgrep/);
    expect(src).toMatch(/runRipgrepSearch/);
    expect(src).toMatch(/knoxignore|knoxIgnoreFilesFor|searchWorkspaceWithRipgrep/);
    expect(src).not.toMatch(/execSync|shell:\s*true|(?<!\.)\bexec\(/);
    expect(src).not.toMatch(/from ["']node:child_process["']/);
  });
});
