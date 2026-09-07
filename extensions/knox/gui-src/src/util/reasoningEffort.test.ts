import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("core/llm/knoxChatModels", () => ({
  checkKnoxChatReasoningSupportSync: vi.fn(() => true),
  findKnoxChatModelSync: vi.fn(() => undefined),
  modelSupportsParameter: vi.fn(
    (params?: string[], parameter?: string) =>
      !!params?.includes(parameter ?? ""),
  ),
  modelSupportsReasoningFromSupportedParameters: vi.fn(
    (params?: string[]) =>
      !!params?.some(
        (p) =>
          p === "reasoning" ||
          p === "reasoning_effort" ||
          p === "include_reasoning",
      ),
  ),
}));

vi.mock("core/llm/reasoningEffortConfig", async () => {
  const actual = await vi.importActual<
    typeof import("core/llm/reasoningEffortConfig")
  >("core/llm/reasoningEffortConfig");
  return {
    ...actual,
    resolveReasoningEffortConfigForModel: vi.fn(
      ({
        modelId,
        supportedParameters,
      }: {
        modelId?: string;
        supportedParameters?: string[];
      }) => {
        if (!supportedParameters?.includes("reasoning_effort")) {
          return null;
        }
        if (modelId?.includes("claude")) {
          return { allowed: ["low", "medium", "high"], default: "high" };
        }
        if (modelId?.includes("gpt")) {
          return {
            allowed: ["none", "low", "medium", "high"],
            default: "none",
          };
        }
        return {
          allowed: ["none", "low", "medium", "high"],
          default: "medium",
        };
      },
    ),
  };
});

import {
  getReasoningEffortConfig,
  getReasoningModelKey,
  getReasoningModelKeys,
  resolveReasoningEffort,
  shouldShowThinkingPlaceholder,
} from "./reasoningEffort";

describe("getReasoningModelKey", () => {
  it("normalizes provider-prefixed ids", () => {
    expect(
      getReasoningModelKey({
        provider: "knoxchat",
        model: "anthropic/claude-sonnet-4.6",
        title: "Claude",
      }),
    ).toBe("anthropic/claude-sonnet-4.6");
  });

  it("prefixes openai models", () => {
    expect(
      getReasoningModelKey({
        provider: "openai",
        model: "gpt-5.4",
        title: "GPT",
      }),
    ).toBe("openai/gpt-5.4");
  });

  it("includes title and raw id as lookup aliases", () => {
    expect(
      getReasoningModelKeys({
        provider: "knoxchat",
        model: "deepseek/deepseek-v4-flash",
        title: "DeepSeek: DeepSeek V4 Flash 0731",
      }),
    ).toEqual([
      "deepseek/deepseek-v4-flash",
      "DeepSeek: DeepSeek V4 Flash 0731",
      "deepseek: deepseek v4 flash 0731",
    ]);
  });
});

describe("resolveReasoningEffort", () => {
  const claude = {
    provider: "knoxchat",
    model: "anthropic/claude-sonnet-4.6",
    title: "Claude Sonnet",
    supportedParameters: ["reasoning_effort"],
  };
  const gpt = {
    provider: "knoxchat",
    model: "openai/gpt-5.4",
    title: "GPT 5.4",
    supportedParameters: ["reasoning_effort"],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses API/sidecar default when no sticky preference", () => {
    expect(resolveReasoningEffort(claude, {})).toBe("high");
    expect(resolveReasoningEffort(gpt, {})).toBe("none");
  });

  it("keeps sticky preferences per model", () => {
    const sticky = {
      "anthropic/claude-sonnet-4.6": "low",
      "openai/gpt-5.4": "high",
    };
    expect(resolveReasoningEffort(claude, sticky)).toBe("low");
    expect(resolveReasoningEffort(gpt, sticky)).toBe("high");
  });

  it("finds sticky effort stored under the model title", () => {
    expect(
      resolveReasoningEffort(claude, {
        "Claude Sonnet": "low",
      }),
    ).toBe("low");
  });

  it("does not carry another model's selection once sticky map is in use", () => {
    expect(
      resolveReasoningEffort(
        gpt,
        { "anthropic/claude-sonnet-4.6": "high" },
        "high",
      ),
    ).toBe("none");
  });

  it("honors legacy global effort only when sticky map is empty", () => {
    expect(resolveReasoningEffort(claude, {}, "medium")).toBe("medium");
    expect(
      resolveReasoningEffort(
        claude,
        { "openai/gpt-5.4": "high" },
        "medium",
      ),
    ).toBe("high"); // model default, not legacy medium
  });

  it("ignores sticky values outside the allowed set", () => {
    expect(
      resolveReasoningEffort(claude, {
        "anthropic/claude-sonnet-4.6": "xhigh",
      }),
    ).toBe("high");
  });
});

describe("getReasoningEffortConfig", () => {
  it("hides selector when model only has reasoning, not reasoning_effort", () => {
    expect(
      getReasoningEffortConfig({
        provider: "knoxchat",
        model: "google/gemma-4-31b-it",
        title: "Google: Gemma 4 31B",
        supportedParameters: ["reasoning", "include_reasoning", "tools"],
      }),
    ).toBeNull();
  });

  it("shows selector when reasoning_effort is advertised", () => {
    expect(
      getReasoningEffortConfig({
        provider: "knoxchat",
        model: "openai/gpt-5.6-luna",
        title: "GPT 5.6 Luna",
        supportedParameters: ["reasoning", "reasoning_effort"],
      }),
    ).toEqual({
      allowed: ["none", "low", "medium", "high"],
      default: "none",
    });
  });
});

describe("shouldShowThinkingPlaceholder", () => {
  it("shows for reasoning-capable models", () => {
    expect(
      shouldShowThinkingPlaceholder({
        provider: "knoxchat",
        model: "anthropic/claude-sonnet-4.6",
        title: "Claude",
        supportedParameters: ["reasoning_effort"],
      }),
    ).toBe(true);
  });

  it("still shows thinking for reasoning without effort", () => {
    expect(
      shouldShowThinkingPlaceholder({
        provider: "knoxchat",
        model: "google/gemma-4-31b-it",
        title: "Gemma",
        supportedParameters: ["reasoning", "include_reasoning"],
      }),
    ).toBe(true);
  });

  it("hides when model is missing", () => {
    expect(shouldShowThinkingPlaceholder(null)).toBe(false);
  });
});
