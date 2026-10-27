import { describe, expect, it } from "vitest";

import type { Recipe } from "./types";
import { applySlots, extractSlots, fillSlotsFromMessage, isSafeSlotValue } from "./slots";

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

describe("fillSlotsFromMessage (P1.5)", () => {
  it("fills an identifier from the new message", () => {
    const slots = [{ name: "componentName", kind: "identifier" as const }];
    expect(fillSlotsFromMessage(slots, "please create a React component Button")).toEqual({
      values: { componentName: "Button" },
      unfilled: 0,
      fromMessage: 1,
      guessed: {},
    });
  });

  it("fills a different path than the captured intent (parameterized exact)", () => {
    const slots = [{ name: "targetPath", kind: "path" as const }];
    expect(fillSlotsFromMessage(slots, "create file src/b/util.ts")).toEqual({
      values: { targetPath: "src/b/util.ts" },
      unfilled: 0,
      fromMessage: 1,
      guessed: {},
    });
  });

  it("does not treat filler words as identifiers", () => {
    const slots = [{ name: "x", kind: "identifier" as const }];
    expect(fillSlotsFromMessage(slots, "add a lint script to package.json").unfilled).toBe(1);
  });

  it("returns unfilled 0 when the recipe has no slots", () => {
    expect(fillSlotsFromMessage([], "create a React component Button")).toEqual({
      values: {},
      unfilled: 0,
      fromMessage: 0,
      guessed: {},
    });
  });

  it("ignores unsafe path values", () => {
    const slots = [{ name: "targetPath", kind: "path" as const }];
    expect(fillSlotsFromMessage(slots, "create file ../evil.ts").unfilled).toBe(1);
  });

  it("fills from open editors and @-mentions when the sentence has no name", () => {
    const slots = [{ name: "componentName", kind: "identifier" as const }];
    const fill = fillSlotsFromMessage(slots, "create a component", {
      extra: { paths: ["src/Header.tsx"], identifiers: ["Header"] },
    });
    expect(fill).toMatchObject({ values: { componentName: "Header" }, unfilled: 0, fromMessage: 0 });
    expect(fill.guessed.componentName).toBe("Header");
  });
});

describe("applySlots (P1.4)", () => {
  const button = `export function Button() { return <div>Button</div>; }`;
  function recipe(): Recipe {
    return {
      id: "r",
      projectId: "p",
      scope: "project",
      status: "verified",
      title: "Create Button",
      intentText: "Create a React component Button",
      intentFingerprint: "create react component button",
      slots: [{ name: "componentName", kind: "identifier", examples: ["Button", "Card"] }],
      slotValues: { componentName: "Button" },
      preconditions: [{ kind: "file_absent", value: "src/components/Button.tsx" }],
      steps: [{ kind: "write_file", path: "src/components/Button.tsx", blobHash: "h" }],
      sourceCheckpointIds: [],
      stats: { replays: 0, ok: 0, reverted: 0, failedVerify: 0 },
      captureCount: 1,
      createdAt: "",
      updatedAt: "",
    };
  }

  it("substitutes an identifier into the path and file text", () => {
    const applied = applySlots(recipe(), { componentName: "Card" }, new Map([["src/components/Button.tsx", button]]));
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.recipe.steps[0].path).toBe("src/components/Card.tsx");
    expect(applied.merged.get("src/components/Card.tsx")).toBe(`export function Card() { return <div>Card</div>; }`);
    expect(applied.recipe.preconditions[0].value).toBe("src/components/Card.tsx");
  });

  it("refuses traversal, absolute paths, and shell-bearing values", () => {
    for (const hostile of ["../Evil", "/etc/passwd", "$TOKEN"]) {
      const applied = applySlots(recipe(), { componentName: hostile }, new Map([["src/components/Button.tsx", button]]));
      expect(applied.ok, hostile).toBe(false);
    }
  });

  it("is a no-op when the filled value is the captured one", () => {
    const applied = applySlots(recipe(), { componentName: "Button" }, new Map([["src/components/Button.tsx", button]]));
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.recipe.steps[0].path).toBe("src/components/Button.tsx");
    expect(applied.merged.get("src/components/Button.tsx")).toBe(button);
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
