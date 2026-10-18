import { describe, expect, it } from "vitest";

import {
  applyHunksToContent,
  extractPatchFilePaths,
  parseApplyPatch,
} from "./applyPatchFormat";

const SAMPLE = `*** Begin Patch
*** Add File: src/new.ts
+export const x = 1;
*** Update File: src/a.ts
@@
 const a = 1;
-const b = 2;
+const b = 3;
*** Delete File: src/gone.ts
*** End Patch`;

describe("parseApplyPatch", () => {
  it("parses add, update, and delete", () => {
    const ops = parseApplyPatch(SAMPLE);
    expect(ops).toHaveLength(3);
    expect(ops[0]).toEqual({
      type: "add",
      path: "src/new.ts",
      content: "export const x = 1;\n",
    });
    expect(ops[1].type).toBe("update");
    if (ops[1].type === "update") {
      expect(ops[1].path).toBe("src/a.ts");
      expect(ops[1].hunks).toHaveLength(1);
      expect(ops[1].hunks[0].lines.map((l) => l.kind).join("")).toBe(" -+");
    }
    expect(ops[2]).toEqual({ type: "delete", path: "src/gone.ts" });
  });

  it("strips a leading > from patch file headers", () => {
    const ops = parseApplyPatch(`*** Begin Patch
*** Add File: >src/new.ts
+export const x = 1;
*** End Patch`);
    expect(ops[0]).toMatchObject({ type: "add", path: "src/new.ts" });
  });

  it("parses move + update", () => {
    const ops = parseApplyPatch(`*** Begin Patch
*** Update File: old.ts
*** Move to: new.ts
@@
-old
+new
*** End Patch`);
    expect(ops[0]).toMatchObject({
      type: "update",
      path: "old.ts",
      moveTo: "new.ts",
    });
  });

  it("strips markdown fences", () => {
    const ops = parseApplyPatch("```patch\n" + SAMPLE + "\n```");
    expect(ops).toHaveLength(3);
  });

  it("rejects empty or header-less patches", () => {
    expect(() => parseApplyPatch("")).toThrow(/empty/i);
    expect(() => parseApplyPatch("just text")).toThrow(/Invalid patch line/);
  });
});

describe("extractPatchFilePaths", () => {
  it("returns unique paths including move targets", () => {
    expect(extractPatchFilePaths(SAMPLE)).toEqual([
      "src/new.ts",
      "src/a.ts",
      "src/gone.ts",
    ]);
    expect(
      extractPatchFilePaths(`*** Begin Patch
*** Update File: a.ts
*** Move to: b.ts
@@
-a
+b
*** End Patch`),
    ).toEqual(["a.ts", "b.ts"]);
  });

  it("returns empty on invalid input", () => {
    expect(extractPatchFilePaths(null)).toEqual([]);
    expect(extractPatchFilePaths("not a patch")).toEqual([]);
  });
});

describe("applyHunksToContent", () => {
  it("applies a unique hunk", () => {
    const ops = parseApplyPatch(`*** Begin Patch
*** Update File: a.ts
@@
 const a = 1;
-const b = 2;
+const b = 3;
*** End Patch`);
    expect(ops[0].type).toBe("update");
    if (ops[0].type !== "update") {
      return;
    }
    expect(
      applyHunksToContent("const a = 1;\nconst b = 2;\n", ops[0].hunks, "a.ts"),
    ).toBe("const a = 1;\nconst b = 3;\n");
  });

  it("fails when context is missing or not unique", () => {
    const ops = parseApplyPatch(`*** Begin Patch
*** Update File: a.ts
@@
-foo
+bar
*** End Patch`);
    const op = ops[0];
    if (op.type !== "update") {
      return;
    }
    expect(() => applyHunksToContent("zzz\n", op.hunks, "a.ts")).toThrow(
      /did not match/,
    );
    expect(() => applyHunksToContent("foo\nfoo\n", op.hunks, "a.ts")).toThrow(
      /2 times|unique/i,
    );
  });

  it("uses @@ locator to disambiguate", () => {
    const ops = parseApplyPatch(`*** Begin Patch
*** Update File: a.ts
@@ function b
 function b
-  return 1;
+  return 2;
*** End Patch`);
    if (ops[0].type !== "update") {
      return;
    }
    const file = "function a\n  return 1;\nfunction b\n  return 1;\n";
    expect(applyHunksToContent(file, ops[0].hunks, "a.ts")).toBe(
      "function a\n  return 1;\nfunction b\n  return 2;\n",
    );
  });

  it("matches hunks with trailing whitespace drift", () => {
    const ops = parseApplyPatch(`*** Begin Patch
*** Update File: a.ts
@@
-const b = 2;
+const b = 3;
*** End Patch`);
    if (ops[0].type !== "update") {
      return;
    }
    expect(
      applyHunksToContent("const a = 1;\nconst b = 2;  \n", ops[0].hunks, "a.ts"),
    ).toBe("const a = 1;\nconst b = 3;\n");
  });

  it("matches hunks with the wrong indent and re-indents the replacement", () => {
    const ops = parseApplyPatch(`*** Begin Patch
*** Update File: a.ts
@@
-  const b = 2;
+  const b = 3;
*** End Patch`);
    if (ops[0].type !== "update") {
      return;
    }
    expect(
      applyHunksToContent("const a = 1;\n    const b = 2;\n", ops[0].hunks, "a.ts"),
    ).toBe("const a = 1;\n    const b = 3;\n");
  });

  it("matches a hunk whose context is wrapped differently than the file", () => {
    const ops = parseApplyPatch(`*** Begin Patch
*** Update File: knox-impl.md
@@
 spliced at \`msgsCopy.splice(-1, 0, ...)\` (\`countTokens.ts:440-452\`), then moves it to
 the head
-(\`:509\`). The volatile plan/serial injects therefore sit inside the same system message that
+(\`:507-508\`). The volatile plan/serial injects therefore sit inside the same system message that
*** End Patch`);
    if (ops[0].type !== "update") {
      return;
    }
    const file =
      "The helper is spliced at `msgsCopy.splice(-1, 0, ...)` (`countTokens.ts:440-452`), then moves it to the head (`:509`). The volatile plan/serial injects therefore sit inside the same system message that\n";
    expect(applyHunksToContent(file, ops[0].hunks, "knox-impl.md")).toContain(":507-508");
  });

  it("matches a partial first context line as a substring", () => {
    const ops = parseApplyPatch(`*** Begin Patch
*** Update File: knox-impl.md
@@
 is what
-chatTurn.ts:157
+chatTurn.ts:169-170
*** End Patch`);
    if (ops[0].type !== "update") {
      return;
    }
    expect(
      applyHunksToContent(
        "This is what\nchatTurn.ts:157\nconstraint noted\n",
        ops[0].hunks,
        "knox-impl.md",
      ),
    ).toBe("This is what\nchatTurn.ts:169-170\nconstraint noted\n");
  });

  it("ignores unified-diff ---/+++ headers inside an Update File hunk", () => {
    const ops = parseApplyPatch(`*** Begin Patch
*** Update File: a.ts
--- a/a.ts
+++ b/a.ts
@@
 const a = 1;
-const b = 2;
+const b = 3;
*** End Patch`);
    if (ops[0].type !== "update") {
      return;
    }
    expect(
      applyHunksToContent("const a = 1;\nconst b = 2;\n", ops[0].hunks, "a.ts"),
    ).toBe("const a = 1;\nconst b = 3;\n");
  });

  it("drops stale leading context when the deleted lines are unique", () => {
    const ops = parseApplyPatch(`*** Begin Patch
*** Update File: a.ts
@@
 stale context that is not in the file
 const a = 1;
-const b = 2;
+const b = 3;
*** End Patch`);
    if (ops[0].type !== "update") {
      return;
    }
    expect(
      applyHunksToContent("const a = 1;\nconst b = 2;\n", ops[0].hunks, "a.ts"),
    ).toBe("const a = 1;\nconst b = 3;\n");
  });

  it("lists closest lines when a hunk still cannot match", () => {
    const ops = parseApplyPatch(`*** Begin Patch
*** Update File: a.ts
@@
-const b = 99;
+bar
*** End Patch`);
    if (ops[0].type !== "update") {
      return;
    }
    const hunks = ops[0].hunks;
    expect(() =>
      applyHunksToContent("const a = 1;\nconst b = 2;\n", hunks, "a.ts"),
    ).toThrow(/did not match[\s\S]*Closest lines/i);
  });

  it("parses a raw unified diff", () => {
    const ops = parseApplyPatch(`--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,2 @@
 const a = 1;
-const b = 2;
+const b = 3;
`);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ type: "update", path: "src/a.ts" });
    if (ops[0].type !== "update") {
      return;
    }
    expect(
      applyHunksToContent("const a = 1;\nconst b = 2;\n", ops[0].hunks, "src/a.ts"),
    ).toBe("const a = 1;\nconst b = 3;\n");
  });
});
