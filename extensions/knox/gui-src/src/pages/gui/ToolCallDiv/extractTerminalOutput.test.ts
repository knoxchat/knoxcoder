import { describe, expect, it } from "vitest";

import { extractTerminalOutput } from "./extractTerminalOutput";

describe("extractTerminalOutput", () => {
  it("reads the P1.9 Terminal name", () => {
    expect(
      extractTerminalOutput([
        { name: "Terminal", description: "Terminal command exited 0", content: "hi" },
      ]),
    ).toBe("hi");
  });

  it("reads builtin_build output named Build, not diagnostics", () => {
    expect(
      extractTerminalOutput([
        {
          name: "Build",
          description: "Terminal command running (sh_1)",
          content: "Compiling foo",
        },
        {
          name: "Build diagnostics",
          description: "clean",
          content: "no errors",
        },
      ]),
    ).toBe("Compiling foo");
  });

  it("falls back to the first item", () => {
    expect(
      extractTerminalOutput([{ name: "Other", content: "fallback" }]),
    ).toBe("fallback");
  });

  it("returns empty for missing items", () => {
    expect(extractTerminalOutput(undefined)).toBe("");
    expect(extractTerminalOutput([])).toBe("");
  });
});
