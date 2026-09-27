import { describe, expect, it } from "vitest";

import { renderChatMessage, stripImages } from "./messageContent";

describe("stripImages (CSLD-19)", () => {
  it("returns strings unchanged", () => {
    expect(stripImages("hello")).toBe("hello");
  });

  it("joins text parts and drops images", () => {
    expect(
      stripImages([
        { type: "text", text: "a" },
        { type: "imageUrl", imageUrl: { url: "data:image/png;base64,xx" } },
        { type: "text", text: "b" },
      ]),
    ).toBe("a\nb");
  });

  it("does not throw on null, objects, or malformed parts", () => {
    expect(stripImages(null as any)).toBe("");
    expect(stripImages(undefined as any)).toBe("");
    expect(stripImages({ text: "obj" } as any)).toBe("obj");
    expect(stripImages(12 as any)).toBe("");
    expect(
      stripImages([{ type: "text" }, { type: "text", text: "ok" }] as any),
    ).toBe("ok");
    expect(() =>
      renderChatMessage({ role: "assistant", content: { nested: true } as any }),
    ).not.toThrow();
  });
});
