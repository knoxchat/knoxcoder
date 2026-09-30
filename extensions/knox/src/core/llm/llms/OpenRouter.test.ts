import { afterEach, describe, expect, it } from "vitest";

import {
  clearOpenRouterOAuthSession,
  setOpenRouterOAuthApiKey,
} from "../../auth/openrouterOAuth/session";
import { llmFromDescription, llmFromProviderAndOptions } from "./index";
import OpenRouter from "./OpenRouter";

describe("OpenRouter LLM", () => {
  afterEach(() => {
    clearOpenRouterOAuthSession();
  });

  it("constructs with the OpenRouter base URL and attribution headers", () => {
    const llm = new OpenRouter({
      model: "anthropic/claude-sonnet-4.6",
      apiKey: "sk-or-test",
    });
    expect(llm.providerName).toBe("openrouter");
    expect(llm.apiBase).toBe("https://openrouter.ai/api/v1/");
    expect(llm.useLegacyCompletionsEndpoint).toBeFalsy();

    const headers = (llm as any)._getHeaders() as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-or-test");
    expect(headers["HTTP-Referer"]).toBe(
      "https://github.com/knoxchat/knoxcoder",
    );
    expect(headers["X-OpenRouter-Title"]).toBe("KnoxCoder");
    expect(headers["X-Title"]).toBe("KnoxCoder");
    expect(headers["Referer"]).toBeUndefined();
    expect(llm.requestOptions?.headers?.["HTTP-Referer"]).toBe(
      "https://github.com/knoxchat/knoxcoder",
    );
    expect(llm.requestOptions?.headers?.["X-OpenRouter-Title"]).toBe(
      "KnoxCoder",
    );
    expect((llm as any).extraBodyProperties()).toEqual({});
  });

  it("llmFromDescription injects the session key when apiKey is empty", async () => {
    setOpenRouterOAuthApiKey("sk-or-oauth");
    const llm = await llmFromDescription(
      {
        title: "OpenRouter",
        provider: "openrouter",
        model: "openai/gpt-4o",
      },
      async () => "",
      "test-id",
      {},
      async () => undefined,
    );
    expect(llm).toBeInstanceOf(OpenRouter);
    expect(llm?.apiKey).toBe("sk-or-oauth");
    expect(llm?.apiBase).toBe("https://openrouter.ai/api/v1/");
  });

  it("lets an explicit model apiKey win over the session key", async () => {
    setOpenRouterOAuthApiKey("sk-or-oauth");
    const llm = await llmFromDescription(
      {
        title: "OpenRouter",
        provider: "openrouter",
        model: "openai/gpt-4o",
        apiKey: "sk-or-pasted",
      },
      async () => "",
      "test-id",
      {},
      async () => undefined,
    );
    expect(llm?.apiKey).toBe("sk-or-pasted");
  });

  it("fails closed for an unknown provider", async () => {
    expect(
      await llmFromDescription(
        {
          title: "Nope",
          provider: "not-a-provider",
          model: "gpt-4o",
        },
        async () => "",
        "test-id",
        {},
        async () => undefined,
      ),
    ).toBeUndefined();
    expect(() =>
      llmFromProviderAndOptions("not-a-provider", { model: "gpt-4o" }),
    ).toThrow(/Unknown LLM provider type "not-a-provider"/);
  });
});
