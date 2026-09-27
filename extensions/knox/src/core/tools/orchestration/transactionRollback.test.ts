import { describe, expect, it, vi } from "vitest";

import type { IDE } from "../..";
import {
  applyDefaultFileRollback,
  extractTransactionFilePath,
  isFileMutatingTool,
} from "./transactionRollback";

function mockIde(overrides: Partial<IDE> = {}): IDE {
  return {
    fileExists: vi.fn(async () => false),
    readFile: vi.fn(async () => ""),
    writeFile: vi.fn(async () => {}),
    removeFile: vi.fn(async () => {}),
    getWorkspaceDirs: vi.fn(async () => ["file:///tmp/ws"]),
    ...overrides,
  } as unknown as IDE;
}

describe("transactionRollback helpers", () => {
  it("detects file-mutating tools", () => {
    expect(isFileMutatingTool("builtin_create_new_file")).toBe(true);
    expect(isFileMutatingTool("builtin_edit_file")).toBe(true);
    expect(isFileMutatingTool("builtin_write_file")).toBe(true);
    expect(isFileMutatingTool("builtin_apply_patch")).toBe(true);
    expect(isFileMutatingTool("composite_smart_edit")).toBe(true);
    expect(isFileMutatingTool("builtin_read_file")).toBe(false);
  });

  it("extracts filepath from known arg shapes", () => {
    expect(
      extractTransactionFilePath("builtin_create_new_file", {
        filepath: "src/a.ts",
      }),
    ).toBe("src/a.ts");
    expect(
      extractTransactionFilePath("composite_smart_edit", { filepath: "b.ts" }),
    ).toBe("b.ts");
    expect(
      extractTransactionFilePath("builtin_apply_patch", {
        patch: `*** Begin Patch
*** Add File: src/new.ts
+x
*** End Patch`,
      }),
    ).toBe("src/new.ts");
    expect(
      extractTransactionFilePath("builtin_generate_tests", {
        filepath: "src/a.ts",
        outputPath: "src/a.test.ts",
      }),
    ).toBe("src/a.test.ts");
    expect(
      extractTransactionFilePath("builtin_read_file", { filepath: "x.ts" }),
    ).toBeUndefined();
  });

  it("deletes created files on rollback when removeFile exists", async () => {
    const ide = mockIde({
      fileExists: vi.fn(async () => true),
    });

    await applyDefaultFileRollback(
      "builtin_create_new_file",
      { filepath: "file:///tmp/ws/new.ts" },
      {
        filepath: "file:///tmp/ws/new.ts",
        existed: false,
        content: null,
      },
      ide,
    );

    expect(ide.removeFile).toHaveBeenCalledWith("file:///tmp/ws/new.ts");
    expect(ide.writeFile).not.toHaveBeenCalled();
  });

  it("restores prior content for edited files", async () => {
    const ide = mockIde();

    await applyDefaultFileRollback(
      "composite_smart_edit",
      { filepath: "file:///tmp/ws/a.ts" },
      {
        filepath: "file:///tmp/ws/a.ts",
        existed: true,
        content: "old",
      },
      ide,
    );

    expect(ide.writeFile).toHaveBeenCalledWith("file:///tmp/ws/a.ts", "old");
    expect(ide.removeFile).not.toHaveBeenCalled();
  });

  it("throws when create-rollback needs removeFile but IDE lacks it", async () => {
    const ide = mockIde();
    delete (ide as { removeFile?: unknown }).removeFile;

    await expect(
      applyDefaultFileRollback(
        "builtin_create_new_file",
        { filepath: "file:///tmp/ws/new.ts" },
        {
          filepath: "file:///tmp/ws/new.ts",
          existed: false,
          content: null,
        },
        ide,
      ),
    ).rejects.toThrow(/removeFile is not available/);
  });
});
