import { describe, expect, it } from "vitest";

import Anthropic from "./llms/Anthropic";
import OpenAI from "./llms/OpenAI";
import { llmFromProviderAndOptions } from "./llms/index";
import { toAnthropicImageSource } from "../util/messageContent";
import { toChatBody } from "./openaiTypeConverters";
import type { ChatMessage } from "../index";

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const JPG = "data:image/jpeg;base64,/9j/4AAQ";

describe("image attachments per provider (P1-6)", () => {
  it("Anthropic keeps the real media type (screenshots are PNG)", () => {
    expect(toAnthropicImageSource(PNG)).toEqual({
      type: "base64",
      media_type: "image/png",
      data: "iVBORw0KGgo=",
    });
    expect(toAnthropicImageSource(JPG).type).toBe("base64");
    expect((toAnthropicImageSource("data:image/jpg;base64,AA") as any).media_type).toBe("image/jpeg");
    expect((toAnthropicImageSource("data:image/webp;base64,AA") as any).media_type).toBe("image/webp");
  });

  it("Anthropic falls back to jpeg for unknown types and passes http URLs", () => {
    expect((toAnthropicImageSource("data:image/bmp;base64,AA") as any).media_type).toBe("image/jpeg");
    expect(toAnthropicImageSource("https://x.test/a.png")).toEqual({
      type: "url",
      url: "https://x.test/a.png",
    });
  });

  it("Anthropic convertMessage emits an image block with the PNG type", () => {
    const llm = new Anthropic({ model: "claude-sonnet-4", apiKey: "k" } as any);
    const msg: ChatMessage = {
      role: "user",
      content: [
        { type: "text", text: "what is this" },
        { type: "imageUrl", imageUrl: { url: PNG } },
      ],
    };
    const out = (llm as any).convertMessage(msg, false);
    expect(out.content[1]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" },
    });
  });

  it("OpenAI-format providers send image_url parts", () => {
    const body = toChatBody(
      [
        {
          role: "user",
          content: [
            { type: "text", text: "hi" },
            { type: "imageUrl", imageUrl: { url: PNG } },
          ],
        },
      ],
      { model: "gpt-6-luna" } as any,
    );
    const content = (body.messages[0] as any).content;
    expect(content[1]).toEqual({ type: "image_url", image_url: { url: PNG, detail: "auto" } });
  });

  it("text-only OpenAI-compatible servers get plain text when no image is attached", () => {
    const body = toChatBody(
      [{ role: "user", content: [{ type: "text", text: "hello" }] }],
      { model: "llama3" } as any,
    );
    expect((body.messages[0] as any).content).toBe("hello");
  });

  it.each([
    ["openai", "gpt-6-luna", true],
    ["openai", "llama3", false],
    ["openai", "deepseek-coder", false],
    ["anthropic", "claude-haiku-4.5", true],
  ])("%s / %s supportsImages=%s", (provider, model, expected) => {
    const llm = llmFromProviderAndOptions(provider, { model, apiKey: "k" });
    expect(llm.supportsImages()).toBe(expected);
  });

  it("capabilities.uploadImage overrides detection", () => {
    const llm = new OpenAI({
      model: "my-local-vlm",
      apiKey: "k",
      capabilities: { uploadImage: true },
    } as any);
    expect(llm.supportsImages()).toBe(true);
  });
});
