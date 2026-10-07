import { describe, expect, it } from "vitest";

import {
  TRANSCRIPT_MAX_BYTES,
  parseTranscriptMarkdown,
  transcriptToSession,
} from "./transcriptImport";

const SAMPLE = [
  "### [Knox](https://knox.chat) Session Transcript",
  " Exported: 1/1/2026",
  "",
  "#### _User_",
  "",
  "> add a retry",
  "> to fetch",
  "",
  "#### _Assistant_",
  "",
  "> Done:",
  "> ```ts",
  "> #### _User_",
  "> ```",
].join("\n");

describe("parseTranscriptMarkdown", () => {
  it("round-trips the /share format, unquoting and ignoring fenced headings", () => {
    const p = parseTranscriptMarkdown(SAMPLE)!;
    expect(p.messages).toEqual([
      { role: "user", content: "add a retry\nto fetch" },
      { role: "assistant", content: "Done:\n```ts\n#### _User_\n```" },
    ]);
    expect(p.title).toBe("Imported: add a retry to fetch");
  });

  it("accepts plain headings without quotes", () => {
    const p = parseTranscriptMarkdown("## User\nhi\n## Assistant\nhello")!;
    expect(p.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("rejects text without turns and oversized input", () => {
    expect(parseTranscriptMarkdown("just notes")).toBeNull();
    expect(parseTranscriptMarkdown("x".repeat(TRANSCRIPT_MAX_BYTES + 1))).toBeNull();
  });

  it("redacts secrets when building the session", () => {
    const p = parseTranscriptMarkdown(
      "#### _User_\n\nmy key AKIAABCDEFGHIJKLMNOP and ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    )!;
    const s = transcriptToSession(p, "/w", "id1");
    const content = String(s.history[0].message.content);
    expect(content).not.toContain("AKIAABCDEFGHIJKLMNOP");
    expect(s.sessionId).toBe("id1");
  });
});
