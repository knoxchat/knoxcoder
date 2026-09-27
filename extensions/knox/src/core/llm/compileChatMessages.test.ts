import { describe, expect, it } from "vitest";

import { ChatMessage } from "../index.js";
import { compileChatMessages } from "./countTokens.js";

describe("compileChatMessages memory inject", () => {
  it("preserves mid-list system memory context in the compiled system message", () => {
    const msgs: ChatMessage[] = [
      { role: "system", content: "Default rules" },
      {
        role: "system",
        content:
          "## Relevant Memory Context\n<memory-context>\npinned fact about auth\n</memory-context>",
      },
      { role: "user", content: "How does auth work?" },
    ];

    const compiled = compileChatMessages(
      "gpt-4o",
      msgs,
      128_000,
      2048,
      false,
    );

    expect(compiled[0]?.role).toBe("system");
    const systemText =
      typeof compiled[0].content === "string"
        ? compiled[0].content
        : JSON.stringify(compiled[0].content);
    expect(systemText).toContain("Default rules");
    expect(systemText).toContain("Relevant Memory Context");
    expect(systemText).toContain("pinned fact about auth");
    expect(compiled.some((m) => m.role === "user")).toBe(true);
  });

  it("merges multiple system messages rather than keeping only the first", () => {
    const msgs: ChatMessage[] = [
      { role: "system", content: "A" },
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "system", content: "B-memory" },
      { role: "user", content: "again" },
    ];

    const compiled = compileChatMessages(
      "gpt-4o",
      msgs,
      128_000,
      2048,
      false,
    );

    const systemText =
      typeof compiled[0].content === "string"
        ? compiled[0].content
        : JSON.stringify(compiled[0].content);
    expect(systemText).toContain("A");
    expect(systemText).toContain("B-memory");
  });

  it("keeps gcc errors and verifyCommand after compile-time compaction", () => {
    const cc = Array.from(
      { length: 40 },
      (_, i) => `  CC      kernel/foo${i}.o`,
    ).join("\n");
    const msgs: ChatMessage[] = [
      { role: "system", content: "Default rules\nverifyCommand: make" },
      { role: "user", content: "fix the build" },
      { role: "assistant", content: "running make" },
      {
        role: "tool",
        toolCallId: "b1",
        content: `${cc}\nmm/filemap.c:42:5: error: implicit declaration of function 'copy_to_user'`,
      },
    ];
    for (let i = 0; i < 14; i++) {
      msgs.push({ role: "user", content: `filler ${i} `.repeat(40) });
      msgs.push({ role: "assistant", content: `ack ${i} `.repeat(40) });
    }
    msgs.push({ role: "user", content: "what failed?" });

    const compiled = compileChatMessages("gpt-4o", msgs, 4_000, 500, false);
    const joined = compiled
      .map((m) => (typeof m.content === "string" ? m.content : ""))
      .join("\n");
    expect(joined).toContain("mm/filemap.c");
    expect(joined).toMatch(/copy_to_user/);
    expect(joined).toMatch(/verifyCommand:\s*make/);
  });
});
