import { describe, expect, it } from "vitest";

import {
  isQuestionnaireAnswered,
  splitChoiceText,
} from "./questionnaire";

describe("splitChoiceText", () => {
  it("splits an em-dash title and description", () => {
    expect(
      splitChoiceText(
        "Terminal game (crossterm) — runs in your terminal, keyboard controls",
      ),
    ).toEqual({
      value:
        "Terminal game (crossterm) — runs in your terminal, keyboard controls",
      label: "Terminal game (crossterm)",
      description: "runs in your terminal, keyboard controls",
    });
  });

  it("splits a hyphen title and description", () => {
    expect(splitChoiceText("Browser game - compiles Rust to WASM")).toEqual({
      value: "Browser game - compiles Rust to WASM",
      label: "Browser game",
      description: "compiles Rust to WASM",
    });
  });

  it("keeps a plain option as the label", () => {
    expect(splitChoiceText("Desktop GUI")).toEqual({
      value: "Desktop GUI",
      label: "Desktop GUI",
    });
  });
});

describe("isQuestionnaireAnswered", () => {
  it("requires a non-empty string or list", () => {
    expect(isQuestionnaireAnswered(undefined)).toBe(false);
    expect(isQuestionnaireAnswered("")).toBe(false);
    expect(isQuestionnaireAnswered("   ")).toBe(false);
    expect(isQuestionnaireAnswered([])).toBe(false);
    expect(isQuestionnaireAnswered("bevy")).toBe(true);
    expect(isQuestionnaireAnswered(["bevy"])).toBe(true);
  });
});
