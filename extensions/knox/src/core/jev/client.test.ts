import { afterEach, describe, expect, it, vi } from "vitest";

import { createHttpJevClient, JevClientError } from "./client";
import { resolveJevRuntime } from "./config";
import { clearKnoxChatOAuthSession } from "../auth/knoxOAuth/session";
import type { JevSystemOneResult } from "./types";

describe("resolveJevRuntime", () => {
  afterEach(() => {
    clearKnoxChatOAuthSession();
  });
  it("defaults to disabled without yaml", () => {
    const runtime = resolveJevRuntime();
    expect(runtime.enabled).toBe(false);
    expect(runtime.failOpen).toBe(true);
    expect(runtime.model).toBe("jev-1.13.0");
    expect(runtime.timeoutMs).toBe(8_000);
    expect(runtime.apiKey).toBe("");
    expect(runtime.baseUrl).toBe("https://api.knoxstudio.ai");
  });

  it("reads the API key from config.yaml jev.apiKey", () => {
    const runtime = resolveJevRuntime({
      enabled: true,
      apiKey: " sk-key ",
      model: "jev-1.13.0",
    });
    expect(runtime.enabled).toBe(true);
    expect(runtime.apiKey).toBe("sk-key");
    expect(runtime.model).toBe("jev-1.13.0");
  });

  it("always uses api.knoxstudio.ai even if yaml sets another host", () => {
    const runtime = resolveJevRuntime({
      enabled: true,
      baseUrl: "https://api.typesafe.ai",
    });
    expect(runtime.baseUrl).toBe("https://api.knoxstudio.ai");
  });

  it("does not read TYPESAFE_* environment variables", () => {
    const previous = process.env.TYPESAFE_API_KEY;
    process.env.TYPESAFE_API_KEY = "env-key";
    try {
      const runtime = resolveJevRuntime({ enabled: true });
      expect(runtime.apiKey).toBe("");
    } finally {
      if (previous === undefined) {
        delete process.env.TYPESAFE_API_KEY;
      } else {
        process.env.TYPESAFE_API_KEY = previous;
      }
    }
  });
});

describe("createHttpJevClient", () => {
  it("POSTs /v1/systemone and parses answers", async () => {
    const payload: JevSystemOneResult = {
      model: "jev-1.13.0",
      answers: {
        billing: { type: "noul", noul: 0.91 },
      },
    };
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(_url).toBe("https://api.knoxstudio.ai/v1/systemone");
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe("jev-1.13.0");
      expect(body.questions.billing.type).toBe("noul");
      return new Response(JSON.stringify(payload), { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    const client = createHttpJevClient({
      apiKey: "sk-key",
      baseUrl: "https://api.knoxstudio.ai",
      model: "jev-1.13.0",
      fetch,
    });
    const result = await client.systemOne({
      state: "I was charged twice",
      questions: {
        billing: { type: "noul", instructions: "Is this about billing?" },
      },
    });
    expect(result.answers.billing).toEqual({ type: "noul", noul: 0.91 });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("derives choice confidence from probabilities when the field is omitted", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            model: "jev-1.13.0",
            answers: {
              route: {
                type: "choice",
                choice: "chat",
                probabilities: { view_read: 0.05, chat: 0.9, clarify: 0.05 },
              },
            },
          }),
          { status: 200 },
        ),
    ) as unknown as typeof globalThis.fetch;
    const client = createHttpJevClient({
      apiKey: "sk-key",
      baseUrl: "https://api.knoxstudio.ai",
      model: "jev-1.13.0",
      fetch,
    });
    const result = await client.systemOne({
      state: "x",
      questions: {
        route: {
          type: "choice",
          instructions: "y",
          criteria: { view_read: null, chat: null, clarify: null },
        },
      },
    });
    expect(result.answers.route).toMatchObject({ type: "choice", choice: "chat" });
    expect(
      (result.answers.route as { confidence: number }).confidence,
    ).toBeGreaterThan(0.5);
  });

  it("retries 429 then succeeds", async () => {
    const payload: JevSystemOneResult = {
      model: "jev-1.13.0",
      answers: { a: { type: "noul", noul: 0.8 } },
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("slow down", { status: 429 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(payload), { status: 200 }),
      ) as unknown as typeof globalThis.fetch;
    const client = createHttpJevClient({
      apiKey: "sk-key",
      baseUrl: "https://api.knoxstudio.ai",
      model: "jev-1.13.0",
      fetch,
    });
    const result = await client.systemOne({
      state: "x",
      questions: { a: { type: "noul", instructions: "y" } },
    });
    expect(result.answers.a).toEqual({ type: "noul", noul: 0.8 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("clamps noul answers onto [0, 1]", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            model: "jev-1.13.0",
            answers: { a: { type: "noul", noul: 1.4 } },
          }),
          { status: 200 },
        ),
    ) as unknown as typeof globalThis.fetch;
    const client = createHttpJevClient({
      apiKey: "sk-key",
      baseUrl: "https://api.knoxstudio.ai",
      model: "jev-1.13.0",
      fetch,
    });
    const result = await client.systemOne({
      state: "x",
      questions: { a: { type: "noul", instructions: "y" } },
    });
    expect(result.answers.a).toEqual({ type: "noul", noul: 1 });
  });

  it("ignores a non-Knox baseUrl and still POSTs api.knoxstudio.ai", async () => {
    const fetch = vi.fn(async (_url: string) => {
      expect(_url).toBe("https://api.knoxstudio.ai/v1/systemone");
      return new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          answers: { a: { type: "noul", noul: 1 } },
        }),
        { status: 200 },
      );
    }) as unknown as typeof globalThis.fetch;

    const client = createHttpJevClient({
      apiKey: "sk-key",
      baseUrl: "https://api.typesafe.ai",
      model: "jev-1.13.0",
      fetch,
    });
    await client.systemOne({
      state: "x",
      questions: { a: { type: "noul", instructions: "y" } },
    });
  });

  it("throws on HTTP errors", async () => {
    const fetch = vi.fn(
      async () => new Response("nope", { status: 401 }),
    ) as unknown as typeof globalThis.fetch;
    const client = createHttpJevClient({
      apiKey: "sk-key",
      baseUrl: "https://api.knoxstudio.ai",
      model: "jev-1.13.0",
      fetch,
    });
    await expect(
      client.systemOne({
        state: "x",
        questions: { a: { type: "noul", instructions: "y" } },
      }),
    ).rejects.toBeInstanceOf(JevClientError);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("explains a 403 model allowlist miss", async () => {
    const fetch = vi.fn(
      async () => new Response('{"detail":"forbidden"}', { status: 403 }),
    ) as unknown as typeof globalThis.fetch;
    const client = createHttpJevClient({
      apiKey: "sk-key",
      baseUrl: "https://api.knoxstudio.ai",
      model: "jev-1.13.0",
      fetch,
    });
    await expect(
      client.systemOne({
        state: "x",
        questions: { a: { type: "noul", instructions: "y" } },
      }),
    ).rejects.toThrow(/allowlist does not include jev-\*/);
  });
});
