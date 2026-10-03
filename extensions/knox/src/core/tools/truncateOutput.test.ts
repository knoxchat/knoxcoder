import { describe, expect, it, vi } from "vitest";

import type { IDE, ToolExtras } from "..";
import { exactSearchImpl } from "./implementations/exactSearch";
import { readFileImpl } from "./implementations/readFile";
import {
  capChars,
  capLines,
  DEFAULT_MAX_OUTPUT_CHARS,
  headTail,
} from "./truncateOutput";

function extras(ide: Partial<IDE>): ToolExtras {
  return {
    ide: ide as IDE,
    llm: {} as ToolExtras["llm"],
    fetch: vi.fn(),
    tool: { function: { name: "x" } } as ToolExtras["tool"],
  };
}

describe("truncateOutput", () => {
  it("capLines keeps the head and gives a continuation line", () => {
    const text = Array.from({ length: 50 }, (_, i) => `l${i + 1}`).join("\n");
    const r = capLines(text, { maxLines: 10 });
    expect(r.truncated).toBe(true);
    expect(r.text).toContain("startLine=11");
    expect(r.text).not.toContain("l11\n");
  });

  it("headTail drops the middle", () => {
    const text = Array.from({ length: 100 }, (_, i) => `l${i}`).join("\n");
    const r = headTail(text, { head: 3, tail: 3 });
    expect(r.omittedLines).toBe(94);
    expect(r.text).toContain("l99");
    expect(r.text).not.toContain("l50");
  });

  it("capChars leaves small text alone and bounds big text", () => {
    expect(capChars("abc").truncated).toBe(false);
    const big = "x".repeat(100) + "\n";
    const r = capChars(big.repeat(2000), 1000);
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeLessThan(1200);
  });
});

describe("readonly tool output size", () => {
  it("read_file caps a 5000-line range read with a continuation hint", async () => {
    const body = Array.from({ length: 5000 }, (_, i) => `a${i + 1}`).join("\n");
    const ide = {
      getWorkspaceDirs: vi.fn(async () => ["file:///tmp/ws"]),
      fileExists: vi.fn(async () => true),
      readFile: vi.fn(async () => body),
      readRangeInFile: vi.fn(async () => body),
    };
    const r = await readFileImpl({ filepath: "a.txt", startLine: 1, endLine: 5000 }, extras(ide));
    expect(r[0].content).toContain("Continue with startLine=2001");
    expect(r[0].content).not.toContain("a3000");
  });

  it("exact_search output is bounded", async () => {
    const huge = Array.from({ length: 20000 }, (_, i) => `f.ts:${i}: ${"y".repeat(30)}`).join("\n");
    const ide = {
      getSearchResults: vi.fn(async () => huge),
      getWorkspaceDirs: vi.fn(async () => ["file:///tmp/ws"]),
      fileExists: vi.fn(async () => false),
      readFile: vi.fn(async () => ""),
      getFileStats: vi.fn(async () => ({})),
      listDir: vi.fn(async () => []),
    };
    const r = await exactSearchImpl({ query: "y" }, extras(ide));
    expect(r[0].content.length).toBeLessThan(DEFAULT_MAX_OUTPUT_CHARS + 500);
  });
});
