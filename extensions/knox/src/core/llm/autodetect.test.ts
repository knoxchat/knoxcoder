import { describe, expect, it } from "vitest";

import {
  autodetectPromptTemplates,
  autodetectTemplateType,
} from "./autodetect.js";
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
