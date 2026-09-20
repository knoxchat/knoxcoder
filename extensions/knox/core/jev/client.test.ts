import { describe, expect, it, vi } from "vitest";

import { createHttpJevClient, JevClientError } from "./client";
import { resolveJevRuntime } from "./config";
import type { JevSystemOneResult } from "./types";

describe("resolveJevRuntime", () => {
  it("defaults to disabled without yaml", () => {
    const runtime = resolveJevRuntime();
    expect(runtime.enabled).toBe(false);
    expect(runtime.failOpen).toBe(true);
    expect(runtime.model).toBe("jev-1.13.0");
    expect(runtime.timeoutMs).toBe(400);
    expect(runtime.apiKey).toBe("");
  });

  it("reads the API key from config.yaml jev.apiKey", () => {
    const runtime = resolveJevRuntime({
      enabled: true,
      apiKey: " ts-key ",
      model: "jev-1.13.0",
    });
    expect(runtime.enabled).toBe(true);
    expect(runtime.apiKey).toBe("ts-key");
    expect(runtime.model).toBe("jev-1.13.0");
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
      expect(_url).toBe("https://api.typesafe.ai/v1/systemone");
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe("jev-1.13.0");
      expect(body.questions.billing.type).toBe("noul");
      return new Response(JSON.stringify(payload), { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    const client = createHttpJevClient({
      apiKey: "ts-key",
      baseUrl: "https://api.typesafe.ai",
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

  it("throws on HTTP errors", async () => {
    const fetch = vi.fn(
      async () => new Response("nope", { status: 401 }),
    ) as unknown as typeof globalThis.fetch;
    const client = createHttpJevClient({
      apiKey: "ts-key",
      baseUrl: "https://api.typesafe.ai",
      model: "jev-1.13.0",
      fetch,
    });
    await expect(
      client.systemOne({
        state: "x",
        questions: { a: { type: "noul", instructions: "y" } },
      }),
    ).rejects.toBeInstanceOf(JevClientError);
  });
});
