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
});
