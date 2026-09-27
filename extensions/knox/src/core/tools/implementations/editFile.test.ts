import { describe, expect, it, vi } from "vitest";

import type { IDE, ToolExtras } from "../..";
import {
  countExactOccurrences,
  editFileImpl,
  replaceAllExact,
  replaceFirstExact,
} from "./editFile";

function mockIde(overrides: Partial<IDE> = {}): IDE {
  return {
    fileExists: vi.fn(async () => true),
    readFile: vi.fn(async () => "const a = 1;\nconst b = 2;\n"),
    writeFile: vi.fn(async () => {}),
    openFile: vi.fn(async () => {}),
    getWorkspaceDirs: vi.fn(async () => ["file:///tmp/ws"]),
    getCurrentFile: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as IDE;
}

function extras(ide: IDE, aborted = false): ToolExtras {
  return {
    ide,
    llm: {} as ToolExtras["llm"],
    fetch: vi.fn(),
    tool: { function: { name: "builtin_edit_file" } } as ToolExtras["tool"],
    abortSignal: aborted ? AbortSignal.abort() : undefined,
  };
}

describe("edit string helpers", () => {
  it("counts non-overlapping exact matches", () => {
    expect(countExactOccurrences("aaa", "aa")).toBe(1);
    expect(countExactOccurrences("ababab", "ab")).toBe(3);
    expect(countExactOccurrences("hello", "x")).toBe(0);
    expect(countExactOccurrences("hello", "")).toBe(0);
  });

  it("replaces first vs all", () => {
    expect(replaceFirstExact("foo foo", "foo", "bar")).toBe("bar foo");
    expect(replaceAllExact("foo foo", "foo", "bar")).toBe("bar bar");
  });
});

describe("editFileImpl", () => {
  it("replaces a unique match", async () => {
    const ide = mockIde();
    const result = await editFileImpl(
      {
        filepath: "src/a.ts",
        old_string: "const a = 1;",
        new_string: "const a = 2;",
      },
      extras(ide),
    );

    expect(ide.writeFile).toHaveBeenCalledWith(
      "file:///tmp/ws/src/a.ts",
      "const a = 2;\nconst b = 2;\n",
    );
    expect(result[0].description).toContain("src/a.ts");
  });

  it("fails when old_string is missing", async () => {
    const ide = mockIde();
    await expect(
      editFileImpl(
        {
          filepath: "src/a.ts",
          old_string: "not in file",
          new_string: "x",
        },
        extras(ide),
      ),
    ).rejects.toThrow(/not found/i);
    expect(ide.writeFile).not.toHaveBeenCalled();
  });

  it("fails when old_string is not unique unless replace_all", async () => {
    const ide = mockIde({
      readFile: vi.fn(async () => "foo\nfoo\n"),
    });
    await expect(
      editFileImpl(
        { filepath: "a.ts", old_string: "foo", new_string: "bar" },
        extras(ide),
      ),
    ).rejects.toThrow(/2 times|not unique|replace_all/i);

    const result = await editFileImpl(
      {
        filepath: "a.ts",
        old_string: "foo",
        new_string: "bar",
        replace_all: true,
      },
      extras(ide),
    );
    expect(ide.writeFile).toHaveBeenCalledWith("file:///tmp/ws/a.ts", "bar\nbar\n");
    expect(result[0].content).toMatch(/2 replacement/);
  });

  it("rejects empty or unchanged old_string", async () => {
    const ide = mockIde();
    await expect(
      editFileImpl(
        { filepath: "a.ts", old_string: "", new_string: "x" },
        extras(ide),
      ),
    ).rejects.toThrow(/empty/i);
    await expect(
      editFileImpl(
        { filepath: "a.ts", old_string: "same", new_string: "same" },
        extras(ide),
      ),
    ).rejects.toThrow(/identical|unchanged/i);
  });

  it("fails when the file does not exist", async () => {
    const ide = mockIde({ fileExists: vi.fn(async () => false) });
    await expect(
      editFileImpl(
        { filepath: "missing.ts", old_string: "a", new_string: "b" },
        extras(ide),
      ),
    ).rejects.toThrow(/does not exist/i);
  });
});
