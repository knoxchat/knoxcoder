import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ContextItem, ILLM, ToolExtras } from "../..";

vi.mock("../../context/providers/WebContextProvider", () => ({
  fetchSearchResults: vi.fn(),
}));

vi.mock("../../llm/autodetect", () => ({
  modelSupportsWebSearchCapability: vi.fn(() => false),
}));

import { fetchSearchResults } from "../../context/providers/WebContextProvider";
import { modelSupportsWebSearchCapability } from "../../llm/autodetect";
import { llmSupportsNativeWebSearch, searchWebImpl } from "./searchWeb";

const mockedFetchSearchResults = vi.mocked(fetchSearchResults);
const mockedCapability = vi.mocked(modelSupportsWebSearchCapability);

function makeLlm(overrides: Partial<ILLM> = {}): ILLM {
  return {
    providerName: "knoxchat",
    model: "test-model",
    capabilities: undefined,
    supportedParameters: undefined,
    complete: vi.fn(),
    ...overrides,
  } as unknown as ILLM;
}

function makeExtras(llm: ILLM): ToolExtras {
  return {
    ide: {} as ToolExtras["ide"],
    llm,
    fetch: vi.fn(),
    tool: { function: { name: "builtin_search_web" } } as ToolExtras["tool"],
  };
}

describe("llmSupportsNativeWebSearch", () => {
  beforeEach(() => {
    mockedCapability.mockReturnValue(false);
  });

  it("returns true from capabilities.webSearch", () => {
    expect(
      llmSupportsNativeWebSearch(
        makeLlm({ capabilities: { webSearch: true } }),
      ),
    ).toBe(true);
  });

  it("returns true from supportedParameters", () => {
    expect(
      llmSupportsNativeWebSearch(
        makeLlm({ supportedParameters: ["web_search"] }),
      ),
    ).toBe(true);
  });

  it("falls back to metadata capability helper", () => {
    mockedCapability.mockReturnValue(true);
    expect(llmSupportsNativeWebSearch(makeLlm())).toBe(true);
    expect(mockedCapability).toHaveBeenCalled();
  });
});

describe("searchWebImpl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedCapability.mockReturnValue(false);
  });

  it("returns Knox retrieval results on success", async () => {
    const items: ContextItem[] = [
      {
        name: "Result",
        description: "desc",
        content: "live hit",
      },
    ];
    mockedFetchSearchResults.mockResolvedValue(items);
    const llm = makeLlm();

    const result = await searchWebImpl({ query: "vite" }, makeExtras(llm));

    expect(result).toEqual(items);
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it("uses labeled native web_search when retrieval fails and model supports it", async () => {
    mockedFetchSearchResults.mockRejectedValue(new Error("endpoint down"));
    const llm = makeLlm({
      capabilities: { webSearch: true },
      complete: vi.fn().mockResolvedValue("native answer with sources"),
    });

    const result = await searchWebImpl({ query: "rust async" }, makeExtras(llm));

    expect(llm.complete).toHaveBeenCalledWith(
      expect.stringContaining("rust async"),
      expect.any(AbortSignal),
      { webSearch: true },
    );
    expect(result).toHaveLength(1);
    expect(result[0].content).toContain("native answer with sources");
    expect(result[0].content).toMatch(/web_search|native/i);
    expect(result[0].name).not.toBe("Web Search Results");
  });

  it("throws a clear error when retrieval fails and model lacks native search", async () => {
    mockedFetchSearchResults.mockRejectedValue(new Error("endpoint down"));
    const llm = makeLlm({
      capabilities: { webSearch: false },
      complete: vi.fn().mockResolvedValue("hallucinated fiction"),
    });

    await expect(
      searchWebImpl({ query: "secret facts" }, makeExtras(llm)),
    ).rejects.toThrow(/endpoint down|web search|web_search|retrieval/i);

    expect(llm.complete).not.toHaveBeenCalled();
  });

  it("never calls unlabeled llm.complete without webSearch on failure", async () => {
    mockedFetchSearchResults.mockRejectedValue(new Error("timeout"));
    const complete = vi.fn().mockResolvedValue("should not be used");
    const llm = makeLlm({ complete });

    await expect(
      searchWebImpl({ query: "q" }, makeExtras(llm)),
    ).rejects.toThrow();

    expect(complete).not.toHaveBeenCalled();
  });
});
