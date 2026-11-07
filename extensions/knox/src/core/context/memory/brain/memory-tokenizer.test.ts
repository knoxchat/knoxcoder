/**
 * MEM-69 — C_* sizes use the routed model's tokenizer plus tokenizer_margin.
 */
import { describe, expect, it } from "vitest";

import {
  applyTokenizerMargin,
  countRoutedTokens,
  TOKENIZER_MARGIN_DEFAULT,
} from "../../../agent/contextBudget.js";
import { countMemoryTokens } from "./window.js";

describe("MEM-69 routed tokenizer + margin", () => {
  it("prefers llm.countTokens and falls back to chars/4", () => {
    const llm = { model: "tok", countTokens: (t: string) => t.split(" ").length };
    expect(countRoutedTokens("one two three", llm)).toBe(3);
    expect(countRoutedTokens("abcd")).toBe(1);
  });

  it("inflates every estimated C_* size by tokenizer_margin (5%)", () => {
    expect(TOKENIZER_MARGIN_DEFAULT).toBe(0.05);
    expect(applyTokenizerMargin(1000, 0.05)).toBe(1050);
    const llm = { countTokens: (t: string) => t.length };
    expect(countMemoryTokens("abcd", { llm, margin: 0.05 })).toBe(5);
    expect(countMemoryTokens("abcd", { margin: 0 })).toBe(1);
  });
});
