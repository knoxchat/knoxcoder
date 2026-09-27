import { describe, expect, it, vi } from "vitest";

import type { IDE, ToolExtras } from "../..";
import {
  isRefusedBinaryPath,
  looksLikeBinaryContent,
  readFileImpl,
} from "./readFile";

function extras(ide: IDE): ToolExtras {
  return {
    ide,
    llm: {} as ToolExtras["llm"],
    fetch: vi.fn(),
    tool: { function: { name: "builtin_read_file" } } as ToolExtras["tool"],
  };
}

describe("readFile binary / truncation (HL-27)", () => {
  it("refuses vmlinux and object files by path", () => {
    expect(isRefusedBinaryPath("vmlinux")).toBe(true);
    expect(isRefusedBinaryPath("mm/filemap.o")).toBe(true);
    expect(isRefusedBinaryPath("mm/filemap.c")).toBe(false);
  });

  it("detects ELF magic", () => {
    expect(looksLikeBinaryContent("\u007fELF\u0002\u0001")).toBe(true);
    expect(looksLikeBinaryContent("int main(void) { return 0; }\n")).toBe(false);
  });

  it("reports truncation metadata on a 5000-line file without a range", async () => {
    const body = Array.from({ length: 5000 }, (_, i) =>
      `line ${i + 1} ${"x".repeat(24)}`,
    ).join("\n");
    const ide = {
      getWorkspaceDirs: vi.fn(async () => ["file:///tmp/ws"]),
      fileExists: vi.fn(async () => true),
      readFile: vi.fn(async () => body),
      getCurrentFile: vi.fn(async () => undefined),
    } as unknown as IDE;

    const result = await readFileImpl({ filepath: "mm/filemap.c" }, extras(ide));
    expect(result[0].content).toMatch(/5000 lines/);
    expect(result[0].content).toMatch(/startLine\/endLine/);
    expect(result[0].content).toContain("line 1 ");
    expect(result[0].content).toContain("line 5000 ");
    expect(result[0].content).toMatch(/truncated \d+ middle lines/);
    expect(result[0].content).not.toContain("line 2500 ");
  });

  it("returns a short refusal for vmlinux without reading", async () => {
    const readFile = vi.fn();
    const ide = {
      getWorkspaceDirs: vi.fn(async () => ["file:///tmp/ws"]),
      fileExists: vi.fn(async () => true),
      readFile,
    } as unknown as IDE;
    const result = await readFileImpl({ filepath: "vmlinux" }, extras(ide));
    expect(readFile).not.toHaveBeenCalled();
    expect(result[0].content).toMatch(/Refused to read binary/);
  });
});
