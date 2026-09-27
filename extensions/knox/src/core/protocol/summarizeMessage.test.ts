import { describe, expect, it } from "vitest";

import {
  summarizeProtocolMessage,
  summarizeProtocolPayload,
} from "./summarizeMessage";

describe("summarizeProtocolMessage (CSLD-22)", () => {
  it("truncates long strings instead of dumping them", () => {
    const huge = "x".repeat(50_000);
    const summarized = summarizeProtocolPayload(huge);
    expect(String(summarized).length).toBeLessThan(500);
    expect(String(summarized)).toContain("50000 chars");
  });

  it("does not include full stream payloads in error logs", () => {
    const msg = {
      messageType: "llm/streamChat",
      messageId: "abc",
      data: {
        messages: [{ role: "assistant", content: "y".repeat(200_000) }],
        title: "model",
      },
    };
    const logged = summarizeProtocolMessage(msg);
    expect(logged.length).toBeLessThan(2_000);
    expect(logged).toContain("llm/streamChat");
    expect(logged).not.toContain("y".repeat(1_000));
  });

  it("handles circular-ish unserializable objects without throwing", () => {
    const data: Record<string, unknown> = {};
    data.self = data;
    expect(() => summarizeProtocolPayload(data, 0)).not.toThrow();
    expect(summarizeProtocolMessage("raw")).toBe("raw");
  });
});
