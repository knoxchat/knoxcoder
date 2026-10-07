import { afterEach, describe, expect, it } from "vitest";

import {
  autodetectPromptTemplates,
  autodetectTemplateFunction,
  autodetectTemplateType,
  llmCanGenerateInParallel,
  modelSupportsImages,
} from "./autodetect.js";
import { __resetKnoxChatModelsCacheForTests, seedKnoxChatModelsCache } from "./knoxChatModels.js";
import { __resetOpenRouterModelsCacheForTests, seedOpenRouterModelsCache } from "./openrouterModels.js";
import { PROVIDER_TOOL_SUPPORT } from "./toolSupport.js";
import { claudeEditPrompt, gptEditPrompt } from "./templates/edit.js";

describe("autodetectTemplateType", () => {
  it("returns undefined for gpt-family models", () => {
    expect(autodetectTemplateType("gpt-4o")).toBeUndefined();
  });

  it("returns none for Claude / Anthropic chat models", () => {
    expect(autodetectTemplateType("claude-sonnet-4")).toBe("none");
    expect(autodetectTemplateType("sonnet-4")).toBe("none");
  });

  it("returns undefined when no special template applies", () => {
    expect(autodetectTemplateType("knox-custom-model")).toBeUndefined();
  });
});

describe("autodetectPromptTemplates", () => {
  it("uses Claude edit prompt for none / anthropic templates", () => {
    expect(autodetectPromptTemplates("claude-3-5-sonnet").edit).toBe(
      claudeEditPrompt,
    );
    expect(autodetectPromptTemplates("x", "anthropic").edit).toBe(
      claudeEditPrompt,
    );
    expect(autodetectPromptTemplates("x", "none").edit).toBe(claudeEditPrompt);
  });

  it("uses gpt edit prompt for provider-native models", () => {
    expect(autodetectPromptTemplates("gpt-4o").edit).toBe(gptEditPrompt);
    expect(autodetectPromptTemplates("knox-router").edit).toBe(gptEditPrompt);
  });

  it("never leaves dead branches selecting osModelsEditPrompt for Claude", () => {
    const templates = autodetectPromptTemplates("claude-opus-4");
    expect(templates.edit).toBe(claudeEditPrompt);
    expect(templates.edit).not.toBe(gptEditPrompt);
  });
});

describe("openrouter catalog provider", () => {
  it("lets OpenRouter handle its own chat templating", () => {
    expect(autodetectTemplateFunction("openai/gpt-4o", "openrouter")).toBeNull();
    expect(
      autodetectTemplateFunction("anthropic/claude-sonnet-4.6", "openrouter"),
    ).toBeNull();
  });

  it("treats OpenRouter like KnoxChat for images and parallel generation", () => {
    expect(
      modelSupportsImages("openrouter", "openai/gpt-6-luna", undefined, undefined),
    ).toBe(true);
    expect(llmCanGenerateInParallel("openrouter", "openai/gpt-6-luna")).toBe(true);
  });

  it("reads tool support from the OpenRouter catalog, not KnoxChat", () => {
    seedOpenRouterModelsCache([
      {
        id: "anthropic/claude-sonnet-4.6",
        supported_parameters: ["tools", "tool_choice"],
      },
    ]);
    seedKnoxChatModelsCache([
      { id: "anthropic/claude-sonnet-4.6", supported_parameters: ["temperature"] },
    ]);
    expect(PROVIDER_TOOL_SUPPORT.openrouter?.("anthropic/claude-sonnet-4.6")).toBe(
      true,
    );
    expect(PROVIDER_TOOL_SUPPORT.knoxchat?.("anthropic/claude-sonnet-4.6")).toBe(
      false,
    );
  });
});

afterEach(() => {
  __resetOpenRouterModelsCacheForTests();
  __resetKnoxChatModelsCacheForTests();
});
