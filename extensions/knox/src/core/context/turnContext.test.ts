import { describe, expect, it } from "vitest";

import { buildTurnContext, TURN_CONTEXT_MARKER } from "./turnContext";

describe("buildTurnContext", () => {
  it("names the active file, open editors, git porcelain, and diagnostics", () => {
    const text = buildTurnContext({
      activePath: "file:///work/src/vs/foo.ts",
      cursorLine: 12,
      openPaths: [
        "file:///work/src/vs/foo.ts",
        "file:///work/extensions/knox/src/core/agent/loop.ts",
      ],
      gitPorcelain: " M extensions/knox/src/core/agent/loop.ts\n?? new.ts\n",
      problems: [
        {
          filepath: "file:///work/src/vs/foo.ts",
          range: {
            start: { line: 11, character: 0 },
            end: { line: 11, character: 4 },
          },
          message: "Cannot find name 'x'",
          severity: "error",
        },
        {
          filepath: "file:///work/extensions/knox/src/core/agent/loop.ts",
          range: {
            start: { line: 3, character: 0 },
            end: { line: 3, character: 1 },
          },
          message: "unused import",
          severity: "warning",
        },
      ],
    });
    expect(text).toContain(TURN_CONTEXT_MARKER);
    expect(text).toContain("foo.ts:12");
    expect(text).toContain("loop.ts");
    expect(text).toContain("Git:");
    expect(text).toContain("Cannot find name 'x'");
    expect(text).toContain("1 error(s), 1 warning(s)");
    expect(text).toContain("warning unused import");
  });

  it("returns empty when there is nothing to inject", () => {
    expect(buildTurnContext({})).toBe("");
  });

  it("redacts secrets in git porcelain", () => {
    const text = buildTurnContext({
      gitPorcelain: "AKIAIOSFODNN7EXAMPLE secret line\n",
    });
    expect(text).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });
});
