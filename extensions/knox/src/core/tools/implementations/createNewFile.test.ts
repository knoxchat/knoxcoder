import { describe, expect, it, vi } from "vitest";

import type { IDE, ToolExtras } from "../..";
import { createNewFileImpl } from "./createNewFile";

function mockIde(overrides: Partial<IDE> = {}): IDE {
  return {
    fileExists: vi.fn(async () => false),
    readFile: vi.fn(async () => ""),
    writeFile: vi.fn(async () => {}),
    openFile: vi.fn(async () => {}),
    getWorkspaceDirs: vi.fn(async () => ["file:///tmp/ws"]),
    getCurrentFile: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as IDE;
}

function extras(ide: IDE): ToolExtras {
  return {
    ide,
    llm: {} as ToolExtras["llm"],
    fetch: vi.fn(),
    tool: { function: { name: "builtin_create_new_file" } } as ToolExtras["tool"],
  };
}

describe("createNewFileImpl", () => {
  it("creates a missing file", async () => {
    const ide = mockIde();
    const result = await createNewFileImpl(
      { filepath: "src/new.ts", contents: "export const x = 1;\n" },
      extras(ide),
    );
    expect(ide.writeFile).toHaveBeenCalledWith(
      "file:///tmp/ws/src/new.ts",
      "export const x = 1;\n",
    );
    expect(result[0].description).toMatch(/Created/);
  });

  it("overwrites an existing file instead of failing", async () => {
    const ide = mockIde({ fileExists: vi.fn(async () => true) });
    const result = await createNewFileImpl(
      { filepath: "src/new.ts", contents: "next\n" },
      extras(ide),
    );
    expect(ide.writeFile).toHaveBeenCalledWith("file:///tmp/ws/src/new.ts", "next\n");
    expect(result[0].description).toMatch(/Updated/);
    expect(result[0].content).toMatch(/already existed|overwritten/i);
  });
});
