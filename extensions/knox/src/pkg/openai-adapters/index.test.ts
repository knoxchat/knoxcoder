import { createServer, type IncomingMessage, type Server } from "node:http";
import { describe, expect, it } from "vitest";

import { constructLlmApi } from "./index.js";
import { OpenAIApi } from "./apis/OpenAI.js";
import { LLMConfig, LLMConfigSchema } from "./types.js";

function headerMap(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = req.rawHeaders;
  for (let i = 0; i < raw.length; i += 2) {
    out[raw[i]] = raw[i + 1];
  }
  return out;
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (typeof addr === "object" && addr) {
        resolve(addr.port);
        return;
      }
      reject(new Error("server did not bind a port"));
    });
    server.once("error", reject);
  });
}

describe("constructLlmApi", () => {
  it("builds an OpenAI-compatible client for openrouter with the OpenRouter base URL", () => {
    const api = constructLlmApi({
      provider: "openrouter",
      apiKey: "sk-or-test",
    });
    expect(api).toBeInstanceOf(OpenAIApi);
    expect((api as OpenAIApi).apiBase).toBe("https://openrouter.ai/api/v1/");
    const openai = (api as OpenAIApi).openai as unknown as {
      _options?: { defaultHeaders?: Record<string, string> };
    };
    const headers = openai._options?.defaultHeaders ?? {};
    expect(headers["HTTP-Referer"]).toBe(
      "https://github.com/knoxchat/knoxcoder",
    );
    expect(headers["X-OpenRouter-Title"]).toBe("KnoxCoder");
    expect(headers["X-Title"]).toBe("KnoxCoder");
    expect(headers["Referer"]).toBeUndefined();
  });

  it("accepts openrouter in the config schema and rejects unknown providers", () => {
    expect(
      LLMConfigSchema.safeParse({ provider: "openrouter", apiKey: "sk" })
        .success,
    ).toBe(true);
    expect(
      LLMConfigSchema.safeParse({ provider: "knoxchat", apiKey: "sk" }).success,
    ).toBe(true);
    expect(
      LLMConfigSchema.safeParse({ provider: "not-a-provider" }).success,
    ).toBe(false);
    expect(
      constructLlmApi({
        provider: "not-a-provider",
        apiKey: "x",
      } as LLMConfig),
    ).toBeUndefined();
  });

  it("sends HTTP-Referer and X-OpenRouter-Title on every chat completion", async () => {
    const captured: Record<string, string>[] = [];
    const server = createServer((req, res) => {
      captured.push(headerMap(req));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: "cmpl-test",
          object: "chat.completion",
          created: 0,
          model: "openai/gpt-4o",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "ok" },
              finish_reason: "stop",
            },
          ],
        }),
      );
    });
    const port = await listen(server);
    try {
      const api = constructLlmApi({
        provider: "openrouter",
        apiKey: "sk-or-test",
        apiBase: `http://127.0.0.1:${port}/`,
      }) as OpenAIApi;
      const signal = new AbortController().signal;
      const body = {
        model: "openai/gpt-4o",
        messages: [{ role: "user" as const, content: "hi" }],
        stream: false as const,
      };
      await api.chatCompletionNonStream(body, signal);
      await api.chatCompletionNonStream(
        { ...body, messages: [{ role: "user", content: "follow-up" }] },
        signal,
      );
      expect(captured.length).toBeGreaterThanOrEqual(2);
      for (const headers of captured) {
        const referer = headers["HTTP-Referer"] ?? headers["http-referer"];
        const title =
          headers["X-OpenRouter-Title"] ?? headers["x-openrouter-title"];
        expect(referer).toBe("https://github.com/knoxchat/knoxcoder");
        expect(title).toBe("KnoxCoder");
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });
});
