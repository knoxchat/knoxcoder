import { describe, expect, it } from "vitest";

import {
  buildNextEditPrompt,
  findAssistTargets,
  shouldOfferNextEdit,
  targetAtLine,
} from "./editAssist";

describe("findAssistTargets", () => {
  it("offers a generate lens for an empty or whitespace file", () => {
    for (const text of ["", "  \n\n"]) {
      const t = findAssistTargets(text, "typescript");
      expect(t).toHaveLength(1);
      expect(t[0].kind).toBe("emptyFile");
      expect(t[0].lensLine).toBe(0);
    }
  });

  it("finds empty, TODO and not-implemented brace stubs but not real bodies", () => {
    const src = [
      "export function a(x: number) {",
      "}",
      "",
      "function b() { }",
      "",
      "class C {",
      "  run(y: string): void {",
      "    // TODO: write me",
      "  }",
      "  real(z: number) {",
      "    return z + 1;",
      "  }",
      "  nope() {",
      '    throw new Error("not implemented");',
      "  }",
      "}",
      "if (a) { }",
    ].join("\n");
    const targets = findAssistTargets(src, "typescript");
    const stubs = targets.filter((t) => t.kind === "stub");
    expect(stubs.map((t) => t.startLine)).toEqual([0, 3, 6, 12]);
    expect(stubs[0].endLine).toBe(1);
    expect(stubs[2].endLine).toBe(8);
    // The TODO inside a stub does not get its own lens.
    expect(targets.some((t) => t.kind === "todo")).toBe(false);
  });

  it("finds python stubs and respects real bodies", () => {
    const src = [
      "def a(x):",
      "    pass",
      "",
      "def b(x):",
      '    """Doc."""',
      "    raise NotImplementedError",
      "",
      "def c(x):",
      "    return x * 2",
    ].join("\n");
    const stubs = findAssistTargets(src, "python");
    expect(stubs.map((t) => t.startLine)).toEqual([0, 3]);
    expect(stubs[1].endLine).toBe(5);
  });

  it("finds TODO/FIXME comments with their following lines", () => {
    const src = [
      "const a = 1;",
      "// TODO: validate input",
      "const b = a;",
      "",
      "# fixme handle errors",
      "x = 2",
    ].join("\n");
    const t = findAssistTargets(src, "typescript");
    expect(t.map((x) => [x.kind, x.startLine, x.endLine])).toEqual([
      ["todo", 1, 2],
      ["todo", 4, 5],
    ]);
    expect(t[0].prompt).toContain("validate input");
  });

  it("does not flag loops, conditionals or catch blocks", () => {
    const src = "try {\n  x();\n} catch (e) {}\nwhile (a) {}\nfor (;;) {}\n";
    expect(findAssistTargets(src, "typescript")).toEqual([]);
  });
});

describe("targetAtLine", () => {
  it("returns the narrowest target containing the line", () => {
    const targets = findAssistTargets(
      "class C {\n  m() {\n  }\n}\n// TODO: x\nfoo();\n",
      "typescript",
    );
    expect(targetAtLine(targets, 1)?.kind).toBe("stub");
    expect(targetAtLine(targets, 5)?.kind).toBe("todo");
    expect(targetAtLine(targets, 3)).toBeUndefined();
  });
});

describe("next edit", () => {
  it("is offered once, for the same file, when enabled", () => {
    const s = { fileUri: "file:///a.ts", prompt: "p", followUp: false };
    expect(shouldOfferNextEdit(s, "file:///a.ts", true)).toBe(true);
    expect(shouldOfferNextEdit(s, "file:///b.ts", true)).toBe(false);
    expect(shouldOfferNextEdit(s, "file:///a.ts", false)).toBe(false);
    expect(shouldOfferNextEdit({ ...s, followUp: true }, "file:///a.ts", true)).toBe(false);
    expect(shouldOfferNextEdit(undefined, "file:///a.ts", true)).toBe(false);
  });

  it("asks for at most one change", () => {
    expect(buildNextEditPrompt("rename x")).toContain("at most ONE");
  });
});
