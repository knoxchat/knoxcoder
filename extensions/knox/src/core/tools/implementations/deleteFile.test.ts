import { describe, expect, it, vi } from "vitest";

import type { FileType, IDE, ToolExtras } from "../..";
import { deleteFileImpl } from "./deleteFile";

function mockIde(overrides: Partial<IDE> = {}): IDE {
  return {
    fileExists: vi.fn(async () => true),
    readFile: vi.fn(async () => "x"),
    writeFile: vi.fn(async () => {}),
    removeFile: vi.fn(async () => {}),
    listDir: vi.fn(async () => {
      throw new Error("ENOTDIR");
    }),
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
    tool: { function: { name: "builtin_delete_file" } } as ToolExtras["tool"],
  };
}

describe("deleteFileImpl", () => {
  it("deletes a workspace file", async () => {
    const ide = mockIde();
    const result = await deleteFileImpl({ filepath: "src/old.ts" }, extras(ide));
    expect(ide.removeFile).toHaveBeenCalledWith("file:///tmp/ws/src/old.ts");
    expect(result[0].description).toMatch(/Deleted/);
  });

  it("is idempotent when the file is already gone", async () => {
    const ide = mockIde({ fileExists: vi.fn(async () => false) });
    const result = await deleteFileImpl({ filepath: "src/old.ts" }, extras(ide));
    expect(ide.removeFile).not.toHaveBeenCalled();
    expect(result[0].description).toMatch(/Already absent/);
  });

  it("refuses directories", async () => {
    const ide = mockIde({
      listDir: vi.fn(async (): Promise<[string, FileType][]> => [["a.ts", 1 as FileType]]),
    });
    await expect(deleteFileImpl({ filepath: "src" }, extras(ide))).rejects.toThrow(
      /director/i,
    );
    expect(ide.removeFile).not.toHaveBeenCalled();
  });

  it("refuses secret files, absolute paths, and parent traversal", async () => {
    const ide = mockIde();
    await expect(deleteFileImpl({ filepath: ".env" }, extras(ide))).rejects.toThrow(
      /secret/i,
    );
    await expect(
      deleteFileImpl({ filepath: "../outside.ts" }, extras(ide)),
    ).rejects.toThrow(/workspace/i);
    await expect(
      deleteFileImpl({ filepath: "/etc/passwd" }, extras(ide)),
    ).rejects.toThrow(/workspace/i);
    expect(ide.removeFile).not.toHaveBeenCalled();
  });

  it("rejects a missing filepath", async () => {
    const ide = mockIde();
    await expect(deleteFileImpl({}, extras(ide))).rejects.toThrow(/filepath/i);
  });
});
