import { describe, expect, it } from "vitest";

import { commonDir, deriveCheckpointLabel, normalizeIntent, TurnIntentRegistry } from "./turnIntent";

describe("deriveCheckpointLabel (MC-60)", () => {
  it("strips polite filler and adds the file scope", () => {
    expect(
      deriveCheckpointLabel({
        intent: "Can you please add JWT middleware to the API?",
        files: ["src/auth/jwt.ts", "src/auth/middleware.ts", "src/auth/index.ts"],
      }),
    ).toBe("Add JWT middleware to the API · 3 files in src/auth");
  });

  it("names the single file", () => {
    expect(deriveCheckpointLabel({ intent: "fix the typo", files: ["a/b/readme.md"] })).toBe("Fix the typo · readme.md");
  });

  it("falls back to files, then to empty", () => {
    expect(deriveCheckpointLabel({ files: ["x.ts"] })).toBe("Edited x.ts");
    expect(deriveCheckpointLabel({})).toBe("");
  });

  it("never exceeds the cap and keeps the scope", () => {
    const label = deriveCheckpointLabel({ intent: "refactor ".repeat(40), files: ["src/a.ts", "src/b.ts"] });
    expect(label.length).toBeLessThanOrEqual(80);
    expect(label.endsWith("· 2 files in src")).toBe(true);
  });

  it("keeps CJK intent as is", () => {
    expect(deriveCheckpointLabel({ intent: "添加登录接口", files: ["src/api.ts"] })).toBe("添加登录接口 · api.ts");
  });

  it("never carries a secret into a label", () => {
    const label = deriveCheckpointLabel({ intent: "use key sk-abcdefghijklmnopqrstuvwxyz0123456789 for the call" });
    expect(label).not.toContain("sk-abcdefghijklmnopqrstuvwxyz0123456789");
  });
});

describe("helpers", () => {
  it("commonDir", () => {
    expect(commonDir(["a/b/c.ts", "a/b/d/e.ts"])).toBe("a/b");
    expect(commonDir(["a.ts", "b/c.ts"])).toBe("");
  });
  it("normalizeIntent collapses whitespace and caps", () => {
    expect(normalizeIntent("a \n\n b")).toBe("a b");
    expect(normalizeIntent("x".repeat(1000)).length).toBeLessThanOrEqual(280);
  });
});

describe("TurnIntentRegistry (MC-61)", () => {
  it("tracks intent and checkpoints per session and ends once", () => {
    const r = new TurnIntentRegistry();
    r.begin("s1", "add login");
    expect(r.intentFor("s1")).toBe("add login");
    r.attach("s1", "cp1");
    r.attach("s1", "cp1");
    r.attach("s2", "cpX");
    expect(r.finish("s1")).toEqual({ intent: "add login", checkpointIds: ["cp1"] });
    expect(r.finish("s1")).toBeUndefined();
    expect(r.intentFor("s1")).toBeUndefined();
  });

  it("a new turn replaces the previous one", () => {
    const r = new TurnIntentRegistry();
    r.begin("s", "one");
    r.attach("s", "cp1");
    r.begin("s", "two");
    expect(r.finish("s")).toEqual({ intent: "two", checkpointIds: [] });
  });
});
