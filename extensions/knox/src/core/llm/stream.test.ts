import { describe, expect, it } from "vitest";

import { parseSseLine } from "./stream";

describe("parseSseLine", () => {
  it("does not treat keepalive pings as the end of the stream", () => {
    expect(parseSseLine(": ping")).toEqual({ done: false, data: undefined });
    expect(parseSseLine(": ping - 2026-08-16")).toEqual({
      done: false,
      data: undefined,
    });
    expect(parseSseLine(": OPENROUTER PROCESSING")).toEqual({
      done: false,
      data: undefined,
    });
    expect(parseSseLine(": keep-alive")).toEqual({
      done: false,
      data: undefined,
    });
  });

  it("ends only on data: [DONE]", () => {
    expect(parseSseLine("data: [DONE]")).toEqual({
      done: true,
      data: undefined,
    });
    expect(parseSseLine("data:[DONE]\r")).toEqual({
      done: true,
      data: undefined,
    });
  });

  it("parses a normal data chunk", () => {
    const line = 'data: {"choices":[{"delta":{"content":"hi"}}]}';
    expect(parseSseLine(line)).toEqual({
      done: false,
      data: { choices: [{ delta: { content: "hi" } }] },
    });
  });

  it("skips malformed data lines instead of aborting", () => {
    expect(parseSseLine("data: {not-json")).toEqual({
      done: false,
      data: undefined,
    });
    expect(parseSseLine("data: ")).toEqual({ done: false, data: undefined });
    expect(parseSseLine("event: message")).toEqual({
      done: false,
      data: undefined,
    });
  });

  it("still surfaces provider error objects", () => {
    expect(() =>
      parseSseLine('data: {"error":"rate limited"}'),
    ).toThrow(/rate limited/);
  });
});
