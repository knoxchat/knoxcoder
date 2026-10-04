import { describe, expect, it } from "vitest";

import { LLMClasses, llmFromProviderAndOptions } from "./index";
import OpenAI from "./OpenAI";

describe("provider matrix (P1-6)", () => {
  it("registers openai, anthropic, knoxchat, openrouter, mock, and test", () => {
    expect(LLMClasses.map((cls) => cls.providerName).sort()).toEqual(
      ["anthropic", "knoxchat", "mock", "openai", "openrouter", "test"].sort(),
    );
  });

  it("constructs each provider without a network call", () => {
    for (const cls of LLMClasses) {
      const llm = llmFromProviderAndOptions(cls.providerName, {
        model: "test-model",
        apiKey: "sk-test",
      });
      expect(llm.providerName).toBe(cls.providerName);
    }
  });

  it("uses a custom OpenAI-compatible apiBase for local models", () => {
    const llm = new OpenAI({
      model: "llama3",
      apiKey: "ollama",
      apiBase: "http://127.0.0.1:11434/v1/",
    });
    expect(llm.apiBase).toBe("http://127.0.0.1:11434/v1/");
  });
});
