import { describe, expect, it } from "vitest";

import { globToRegExp, matchGlob, normalizeGlobPattern } from "./globMatch";

describe("normalizeGlobPattern", () => {
  it("prefixes bare filename globs with **/", () => {
    expect(normalizeGlobPattern("*.ts")).toBe("**/*.ts");
    expect(normalizeGlobPattern("README.md")).toBe("**/README.md");
  });

  it("leaves path-aware patterns alone", () => {
    expect(normalizeGlobPattern("src/**/*.ts")).toBe("src/**/*.ts");
    expect(normalizeGlobPattern("**/*.tsx")).toBe("**/*.tsx");
  });
});

describe("matchGlob", () => {
  it("matches **/*.ts at any depth", () => {
    expect(matchGlob("a.ts", "**/*.ts")).toBe(true);
    expect(matchGlob("src/a.ts", "**/*.ts")).toBe(true);
    expect(matchGlob("src/foo/a.ts", "**/*.ts")).toBe(true);
    expect(matchGlob("src/a.js", "**/*.ts")).toBe(false);
  });

  it("matches src/**/*.tsx", () => {
    expect(matchGlob("src/a.tsx", "src/**/*.tsx")).toBe(true);
    expect(matchGlob("src/components/B.tsx", "src/**/*.tsx")).toBe(true);
    expect(matchGlob("lib/a.tsx", "src/**/*.tsx")).toBe(false);
  });

  it("treats *.json as any-depth", () => {
    expect(matchGlob("package.json", "*.json")).toBe(true);
    expect(matchGlob("src/tsconfig.json", "*.json")).toBe(true);
  });

  it("supports ?", () => {
    const re = globToRegExp("file?.ts");
    expect(re.test("file1.ts")).toBe(true);
    expect(re.test("file12.ts")).toBe(false);
  });
});
