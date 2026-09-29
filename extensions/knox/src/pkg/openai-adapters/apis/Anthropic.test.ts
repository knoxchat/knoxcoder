import { beforeEach, describe, expect, it, vi } from "vitest";

import { promptToString } from "../util.js";

const fetchImpl = vi.fn();

vi.mock("../util.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../util.js")>();
  return {
    ...actual,
    customFetch: () => fetchImpl,
  };
});

// Import after mock so AnthropicApi picks up stubbed customFetch
const { AnthropicApi } = await import("./Anthropic.js");

describe("promptToString", () => {
  it("handles string, array, and empty prompts", () => {
    expect(promptToString("hello")).toBe("hello");
    expect(promptToString(["a", "b"])).toBe("ab");
    expect(promptToString(null)).toBe("");
    expect(promptToString(undefined)).toBe("");
  });
});

describe("AnthropicApi", () => {
  beforeEach(() => {
    fetchImpl.mockReset();
  });

  function api() {
    return new AnthropicApi({
      provider: "anthropic",
      apiKey: "test-key",
      apiBase: "https://api.anthropic.com/v1/",
    });
  }

  it("shims completionNonStream through the Messages API", async () => {
    fetchImpl.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        id: "msg_1",
        content: [{ type: "text", text: "done" }],
        usage: { input_tokens: 3, output_tokens: 1 },
      }),
      text: async () => "",
    });

    const result = await api().completionNonStream(
      {
        model: "claude-sonnet-4",
        prompt: "Say hi",
        max_tokens: 16,
      },
      new AbortController().signal,
    );

    expect(result.object).toBe("text_completion");
    expect(result.choices[0].text).toBe("done");
    expect(result.model).toBe("claude-sonnet-4");

    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.messages).toEqual([{ role: "user", content: "Say hi" }]);
    expect(body.stream).toBe(false);
  });

  it("lists models from GET /v1/models", async () => {
    fetchImpl.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        data: [
          {
            id: "claude-sonnet-4-20250514",
            display_name: "Claude Sonnet 4",
            created_at: "2025-05-14T00:00:00Z",
            type: "model",
          },
        ],
      }),
      text: async () => "",
    });

    const models = await api().list();
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe("claude-sonnet-4-20250514");
    expect(models[0].owned_by).toBe("anthropic");

    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain("/models");
    expect(init.method).toBe("GET");
  });
});
