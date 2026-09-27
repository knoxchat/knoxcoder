import { describe, expect, it, vi } from "vitest";

import type { IDE, ToolExtras } from "../..";
import {
  kconfigImpl,
  listConfigSymbols,
  normalizeConfigSymbol,
  parseConfigValue,
} from "./kconfig";

const DOT_CONFIG = [
  "CONFIG_X86_64=y",
  "# CONFIG_MMU is not set",
  'CONFIG_LOCALVERSION="-knox"',
  "CONFIG_PRINTK=y",
].join("\n");

function extras(files: Record<string, string>): ToolExtras {
  const store = new Map(
    Object.entries(files).map(([rel, text]) => [
      rel.startsWith("file:") ? rel : `file:///tmp/ws/${rel}`,
      text,
    ]),
  );
  const root = "file:///tmp/ws";
  return {
    ide: {
      getWorkspaceDirs: async () => [root],
      fileExists: async (uri: string) => store.has(uri),
      readFile: async (uri: string) => {
        const text = store.get(uri);
        if (text === undefined) {
          throw new Error("missing");
        }
        return text;
      },
      getSearchResults: async (query: string) =>
        query.includes("PRINTK") || query.includes("printk")
          ? "lib/Kconfig.debug:10:config PRINTK"
          : "",
    } as unknown as IDE,
    llm: {} as ToolExtras["llm"],
    fetch: vi.fn(),
    tool: { function: { name: "builtin_kconfig" } } as ToolExtras["tool"],
  };
}

describe("kconfig lite (HL-34)", () => {
  it("normalizes and reads one symbol from .config", () => {
    expect(normalizeConfigSymbol("FOO")).toBe("CONFIG_FOO");
    expect(parseConfigValue(DOT_CONFIG, "X86_64")).toBe("y");
    expect(parseConfigValue(DOT_CONFIG, "CONFIG_MMU")).toBe("n (not set)");
    expect(parseConfigValue(DOT_CONFIG, "LOCALVERSION")).toBe('"-knox"');
  });

  it("lists a prefix without dumping the whole file", () => {
    const { lines, truncated } = listConfigSymbols(DOT_CONFIG, "CONFIG_P", 40);
    expect(truncated).toBe(false);
    expect(lines.some((line) => line.startsWith("CONFIG_PRINTK"))).toBe(true);
    expect(lines.join("\n")).not.toContain("CONFIG_X86_64=y");
  });

  it("get returns CONFIG_X86_64=y", async () => {
    const result = await kconfigImpl(
      { op: "get", symbol: "X86_64" },
      extras({ ".config": DOT_CONFIG, "scripts/config": "#!/bin/sh\n" }),
    );
    expect(result[0].content).toContain("CONFIG_X86_64=y");
    expect(result[0].content).toMatch(/scripts\/config/);
  });

  it("search hits Kconfig without dumping .config", async () => {
    const result = await kconfigImpl(
      { op: "search", symbol: "PRINTK" },
      extras({ ".config": DOT_CONFIG }),
    );
    expect(result[0].content).toContain("lib/Kconfig.debug");
    expect(result[0].content).not.toContain("CONFIG_X86_64=y");
  });
});
