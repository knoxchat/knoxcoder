import { describe, expect, it } from "vitest";

import {
  clearRestoreNotice,
  getRestoreNotice,
  mergeInjectIntoMessages,
  setRestoreNotice,
} from "./injectedContextCache";

describe("mergeInjectIntoMessages", () => {
  it("appends inject into the leading system message", () => {
    const messages = [
      { role: "system", content: "Default rules" },
      { role: "user", content: "hello" },
    ];
    const merged = mergeInjectIntoMessages(
      messages,
      "## Relevant Memory Context\npinned fact",
    );
    expect(merged).toHaveLength(2);
    expect(merged[0].role).toBe("system");
    expect(merged[0].content).toContain("Default rules");
    expect(merged[0].content).toContain("Relevant Memory Context");
    expect(merged[0].content).toContain("pinned fact");
    expect(merged[1].role).toBe("user");
  });

  it("prepends a system message when none exists", () => {
    const messages = [{ role: "user", content: "hi" }];
    const merged = mergeInjectIntoMessages(messages, "memory-block");
    expect(merged[0]).toEqual({ role: "system", content: "memory-block" });
    expect(merged[1].role).toBe("user");
  });
});

describe("restore notice cache", () => {
  it("stores a notice only for the matching session", () => {
    setRestoreNotice("sess-1", "## Workspace restore\ncp-1");
    expect(getRestoreNotice("sess-1")).toContain("cp-1");
    expect(getRestoreNotice("sess-2")).toBeNull();
    clearRestoreNotice();
    expect(getRestoreNotice("sess-1")).toBeNull();
  });
});
