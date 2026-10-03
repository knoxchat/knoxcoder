import { describe, expect, it } from "vitest";

import { searchSessions, searchSessionText } from "./sessionSearch";
import { SESSION_TRUNCATION_MARKER, capSessionForStorage } from "./sessionSizeCap";

const msg = (role: string, content: unknown): any => ({ message: { role, content }, contextItems: [] });

describe("K-043 session content search", () => {
  it("finds text case-insensitively and returns a one-line snippet around it", () => {
    const hit = searchSessionText({ history: [msg("user", "hello"), msg("assistant", `${"a".repeat(100)}\nThe Needle is here\n${"b".repeat(100)}`)] }, "needle");
    expect(hit).toContain("The Needle is here");
    expect(hit).not.toContain("\n");
    expect(hit!.startsWith("…") && hit!.endsWith("…")).toBe(true);
  });

  it("reads array content parts, skips tool output and short queries", () => {
    expect(searchSessionText({ history: [msg("user", [{ type: "text", text: "find me" }])] }, "find")).toBe("find me");
    expect(searchSessionText({ history: [msg("tool", "secret dump")] }, "secret")).toBeUndefined();
    expect(searchSessionText({ history: [msg("user", "abc")] }, "a")).toBeUndefined();
  });

  it("limits hits, and one unreadable session does not stop the search", () => {
    const entries = [
      { sessionId: "bad", read: () => { throw new Error("corrupt"); } },
      ...["a", "b", "c"].map((id) => ({ sessionId: id, read: () => ({ history: [msg("user", "needle")] }) })),
      { sessionId: "none", read: () => undefined },
    ];
    expect(searchSessions(entries, "needle", 2).map((h) => h.sessionId)).toEqual(["a", "b"]);
  });
});

describe("K-043 stored session size cap", () => {
  const big = (n: number) => msg("tool", "x".repeat(n));

  it("leaves a small session untouched (same object)", () => {
    const session: any = { sessionId: "s", title: "t", workspaceDirectory: "", history: [msg("user", "hi")] };
    expect(capSessionForStorage(session).session).toBe(session);
  });

  it("shrinks the oldest big messages first, keeps every message and the recent ones", () => {
    const session: any = { sessionId: "s", title: "t", workspaceDirectory: "", history: [big(50_000), big(50_000), big(50_000)] };
    const { session: out, shrunk, bytes } = capSessionForStorage(session, 110_000);
    expect(out.history).toHaveLength(3);
    expect(shrunk).toBe(1);
    expect(out.history[0].message.content).toContain(SESSION_TRUNCATION_MARKER);
    expect(out.history[2]).toBe(session.history[2]);
    expect(bytes).toBeLessThanOrEqual(110_000);
    expect(session.history[0].message.content).toHaveLength(50_000);
  });
});
