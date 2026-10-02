import { describe, expect, it } from "vitest";

import { dispatchProtocolHandlers, isAsyncIterable } from "./dispatchHandlers";

async function* tokens(values: string[]): AsyncGenerator<string, string> {
  for (const value of values) {
    yield value;
  }
  return "done";
}

describe("dispatchProtocolHandlers", () => {
  it("streams only the first generator so duplicate llm/streamChat handlers cannot triple tokens", async () => {
    const replies: unknown[] = [];
    let second = 0;
    const result = await dispatchProtocolHandlers(
      [
        () => tokens(["Since", " this"]),
        () => {
          second += 1;
          return tokens(["Since", " this"]);
        },
      ],
      {},
      (payload) => replies.push(payload),
    );
    expect(result).toEqual({ kind: "stream" });
    expect(second).toBe(0);
    expect(replies).toEqual([
      { done: false, content: "Since", status: "success" },
      { done: false, content: " this", status: "success" },
      { done: true, content: "done", status: "success" },
    ]);
  });

  it("skips void handlers and uses the first value", async () => {
    const replies: unknown[] = [];
    let side = 0;
    const result = await dispatchProtocolHandlers(
      [
        () => {
          side += 1;
        },
        async () => ({ ok: true }),
        async () => ({ ok: false }),
      ],
      {},
      (payload) => replies.push(payload),
    );
    expect(side).toBe(1);
    expect(result).toEqual({ kind: "value" });
    expect(replies).toEqual([{ done: true, content: { ok: true }, status: "success" }]);
  });

  it("stops after the first throwing handler", async () => {
    let second = 0;
    const result = await dispatchProtocolHandlers(
      [
        () => {
          throw new Error("boom");
        },
        () => {
          second += 1;
          return { ok: true };
        },
      ],
      {},
      () => undefined,
    );
    expect(second).toBe(0);
    expect(result.kind).toBe("error");
    expect(result.kind === "error" && result.error.message).toBe("boom");
  });

  it("acks once when every handler is void", async () => {
    const replies: unknown[] = [];
    let ran = 0;
    const result = await dispatchProtocolHandlers(
      [
        () => {
          ran += 1;
        },
        () => {
          ran += 1;
        },
      ],
      {},
      (payload) => replies.push(payload),
    );
    expect(ran).toBe(2);
    expect(result).toEqual({ kind: "value" });
    expect(replies).toEqual([{ done: true, content: undefined, status: "success" }]);
  });

  it("does not ack when there are no handlers", async () => {
    const replies: unknown[] = [];
    const result = await dispatchProtocolHandlers([], {}, (payload) => replies.push(payload));
    expect(result).toEqual({ kind: "empty" });
    expect(replies).toEqual([]);
  });

  it("detects async generators", () => {
    expect(isAsyncIterable(tokens(["a"]))).toBe(true);
    expect(isAsyncIterable({ content: "a" })).toBe(false);
  });
});
