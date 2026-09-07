import { describe, expect, it } from "vitest";

import {
  expandPromptSlashCommand,
  extractSlashUserInput,
  isPromptBasedSlashCommand,
} from "./slashCommandPrompt";

describe("extractSlashUserInput", () => {
  it("strips /name prefix", () => {
    expect(extractSlashUserInput("/explain this file", "explain")).toBe(
      "this file",
    );
  });

  it("returns original when prefix missing", () => {
    expect(extractSlashUserInput("plain text", "explain")).toBe("plain text");
  });
});

describe("expandPromptSlashCommand", () => {
  it("substitutes {{{ input }}}", () => {
    expect(
      expandPromptSlashCommand("Focus on {{{ input }}} please", "auth"),
    ).toBe("Focus on auth please");
  });

  it("appends user input when no template placeholder", () => {
    expect(expandPromptSlashCommand("Review carefully", "src/a.ts")).toBe(
      "Review carefully\n\nsrc/a.ts",
    );
  });

  it("returns prompt alone when input empty", () => {
    expect(expandPromptSlashCommand("Just this", "")).toBe("Just this");
  });
});

describe("isPromptBasedSlashCommand", () => {
  it("detects prompt-bearing commands", () => {
    expect(isPromptBasedSlashCommand({ prompt: "do X" })).toBe(true);
    expect(isPromptBasedSlashCommand({})).toBe(false);
    expect(isPromptBasedSlashCommand({ prompt: "" })).toBe(false);
  });
});
