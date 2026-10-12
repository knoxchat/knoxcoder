import { describe, expect, it } from "vitest";

import { extractSlots, isSafeSlotValue } from "./slots";

const comp = (name: string) => ({
  path: `src/components/${name}.tsx`,
  content: `export function ${name}() { return <div>${name}</div>; }`,
});

describe("extractSlots", () => {
  it("yields a componentName slot from a 'create React component X' pair", () => {
    const slots = extractSlots(
      { intentText: "Create a React component Button", files: [comp("Button")] },
      { intentText: "Create a React component Card", files: [comp("Card")] },
    );
    expect(slots).toEqual([{ slot: { name: "componentName", kind: "identifier" }, values: ["Button", "Card"] }]);
  });

  it("works when the name comes before the keyword and from paths alone", () => {
    const slots = extractSlots(
      { intentText: "add a Button component", files: [{ path: "src/Button.tsx" }] },
      { intentText: "add a Card component", files: [{ path: "src/Card.tsx" }] },
    );
    expect(slots.map((s) => s.slot)).toEqual([{ name: "componentName", kind: "identifier" }]);
  });

  it("detects package names", () => {
    const slots = extractSlots(
      { intentText: "install package lodash", files: [{ path: "package.json", content: '"lodash": "^4"' }] },
      { intentText: "install package zod", files: [{ path: "package.json", content: '"zod": "^3"' }] },
    );
    expect(slots[0].slot).toEqual({ name: "packageName", kind: "package" });
  });

  it("detects paths", () => {
    const slots = extractSlots(
      { intentText: "create file src/a/util.ts", files: [{ path: "src/a/util.ts" }] },
      { intentText: "create file src/b/util.ts", files: [{ path: "src/b/util.ts" }] },
    );
    expect(slots[0].slot).toEqual({ name: "targetPath", kind: "path" });
  });

  it("ignores wording changes that do not appear in the output", () => {
    expect(
      extractSlots(
        { intentText: "please create a Button component", files: [comp("Button")] },
        { intentText: "quickly create a Button component", files: [comp("Button")] },
      ),
    ).toEqual([]);
  });

  it("ignores differing words that are not in either run's output", () => {
    expect(
      extractSlots(
        { intentText: "create a red component Button", files: [comp("Button")] },
        { intentText: "create a blue component Button", files: [comp("Button")] },
      ),
    ).toEqual([]);
  });

  it("does not make a slot when both values appear in the same output", () => {
    const both = [comp("Button"), comp("Card")];
    expect(
      extractSlots(
        { intentText: "create component Button", files: both },
        { intentText: "create component Card", files: both },
      ),
    ).toEqual([]);
  });

  it("gives distinct names to several slots of the same kind", () => {
    const slots = extractSlots(
      {
        intentText: "create component Button and component Icon",
        files: [comp("Button"), comp("Icon")],
      },
      {
        intentText: "create component Card and component Badge",
        files: [comp("Card"), comp("Badge")],
      },
    );
    expect(slots.map((s) => s.slot.name)).toEqual(["componentName", "componentName2"]);
  });

  it("is case-insensitive on intent matching", () => {
    const slots = extractSlots(
      { intentText: "CREATE component Button", files: [comp("Button")] },
      { intentText: "create component Card", files: [comp("Card")] },
    );
    expect(slots).toHaveLength(1);
  });
});

describe("isSafeSlotValue", () => {
  it("accepts identifiers, scoped packages and relative paths", () => {
    for (const v of ["Button", "@scope/pkg", "src/a-b/c.ts", "my_hook2"]) expect(isSafeSlotValue(v)).toBe(true);
  });
  it("refuses traversal, absolute paths and shell metacharacters", () => {
    for (const v of ["../etc", "a/../b", "/etc/passwd", "~/x", "C:\\x", "a;rm", "a b", "$(x)", "a|b", "`x`", "", "a\nb"]) {
      expect(isSafeSlotValue(v)).toBe(false);
    }
  });
  it("never yields an unsafe slot value", () => {
    const slots = extractSlots(
      { intentText: "create file ../evil.ts", files: [{ path: "../evil.ts" }] },
      { intentText: "create file ok.ts", files: [{ path: "ok.ts" }] },
    );
    expect(slots).toEqual([]);
  });
});
