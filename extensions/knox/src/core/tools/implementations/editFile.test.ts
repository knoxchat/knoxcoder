import { describe, expect, it, vi } from "vitest";

import type { IDE, ToolExtras } from "../..";
import {
  countExactOccurrences,
  editFileImpl,
  noteFileContent,
  resetFileTracking,
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

  it("lists the closest lines when old_string misses", async () => {
    const ide = mockIde({
      readFile: vi.fn(async () => 'const a = 1;\nconst  b   = 2;\n'),
    });
    await expect(
      editFileImpl(
        { filepath: "a.ts", old_string: "const b = 3;", new_string: "x" },
        extras(ide),
      ),
    ).rejects.toThrow(/Closest lines[\s\S]*2: const {2}b/);
  });

  it("matches CRLF files when old_string uses LF", async () => {
    const ide = mockIde({
      readFile: vi.fn(async () => "one\r\ntwo\r\nthree\r\n"),
    });
    await editFileImpl(
      { filepath: "a.txt", old_string: "one\ntwo", new_string: "1\n2" },
      extras(ide),
    );
    expect(ide.writeFile).toHaveBeenCalledWith(
      "file:///tmp/ws/a.txt",
      "1\r\n2\r\nthree\r\n",
    );
  });

  describe("tolerant matching", () => {
    const RUST = [
      "impl P {",
      "    fn step(self, dir: Dir) -> Option<Self> {",
      "        let (dx, dy) = dir.delta();   ",
      "        Some(self)",
      "    }",
      "}",
      "",
    ].join("\n");

    it("recovers when old_string has the wrong indentation", async () => {
      const ide = mockIde({ readFile: vi.fn(async () => RUST) });
      await editFileImpl(
        {
          filepath: "src/main.rs",
          old_string: "fn step(self, dir: Dir) -> Option<Self> {\n    let (dx, dy) = dir.delta();",
          new_string: "fn step(self, dir: Dir) -> Option<Self> {\n    let (dx, dy) = dir.delta();\n    let _z = 0;",
        },
        extras(ide),
      );
      expect(ide.writeFile).toHaveBeenCalledWith(
        "file:///tmp/ws/src/main.rs",
        RUST.replace(
          "    fn step(self, dir: Dir) -> Option<Self> {\n        let (dx, dy) = dir.delta();   ",
          "    fn step(self, dir: Dir) -> Option<Self> {\n        let (dx, dy) = dir.delta();\n        let _z = 0;",
        ),
      );
    });

    it("recovers when old_string was copied with read_file line numbers", async () => {
      const ide = mockIde();
      await editFileImpl(
        {
          filepath: "a.ts",
          old_string: "  1 | const a = 1;\n  2 | const b = 2;",
          new_string: "const a = 1;\nconst b = 3;",
        },
        extras(ide),
      );
      expect(ide.writeFile).toHaveBeenCalledWith(
        "file:///tmp/ws/a.ts",
        "const a = 1;\nconst b = 3;\n",
      );
    });

    it("refuses an ambiguous whitespace-insensitive match", async () => {
      const ide = mockIde({
        readFile: vi.fn(async () => "  foo();\n\tfoo();\n"),
      });
      await expect(
        editFileImpl(
          { filepath: "a.ts", old_string: "  foo();  ", new_string: "bar();" },
          extras(ide),
        ),
      ).rejects.toThrow(/not found/i);
      expect(ide.writeFile).not.toHaveBeenCalled();
    });
  });

  describe("Knox-normalized Rust pins", () => {
    const CARGO = `[package]\nname = "demo"\nversion = "0.1.0"\nedition = "2024"\nrust-version = "1.98.1"\n`;

    it("matches edition 2021 old_string against the rewritten 2024 file", async () => {
      const ide = mockIde({ readFile: vi.fn(async () => CARGO) });
      const result = await editFileImpl(
        {
          filepath: "Cargo.toml",
          old_string: 'version = "0.1.0"\nedition = "2021"',
          new_string: 'version = "0.2.0"\nedition = "2021"',
        },
        extras(ide),
      );
      expect(ide.writeFile).toHaveBeenCalledWith(
        "file:///tmp/ws/Cargo.toml",
        CARGO.replace('version = "0.1.0"', 'version = "0.2.0"'),
      );
      expect(result[0].content).toMatch(/aligning/);
    });

    it("treats 2021 -> 2024 on an already-2024 Cargo.toml as up to date", async () => {
      const ide = mockIde({ readFile: vi.fn(async () => CARGO) });
      const result = await editFileImpl(
        {
          filepath: "Cargo.toml",
          old_string: 'edition = "2021"',
          new_string: 'edition = "2024"',
        },
        extras(ide),
      );
      expect(ide.writeFile).not.toHaveBeenCalled();
      expect(result[0].description).toMatch(/Already up to date/);
    });

    it("does not touch exact matches (existing 2021 crates stay editable)", async () => {
      const legacy = CARGO.replace('edition = "2024"', 'edition = "2021"');
      const ide = mockIde({ readFile: vi.fn(async () => legacy) });
      await editFileImpl(
        {
          filepath: "Cargo.toml",
          old_string: 'edition = "2021"',
          new_string: 'edition = "2018"',
        },
        extras(ide),
      );
      expect(ide.writeFile).toHaveBeenCalledWith(
        "file:///tmp/ws/Cargo.toml",
        legacy.replace('edition = "2021"', 'edition = "2018"'),
      );
    });

    it("does not align pins in non-Cargo files", async () => {
      const ide = mockIde({ readFile: vi.fn(async () => 'edition = "2024"\n') });
      await expect(
        editFileImpl(
          {
            filepath: "notes.txt",
            old_string: 'edition = "2021"',
            new_string: "x",
          },
          extras(ide),
        ),
      ).rejects.toThrow(/not found/i);
    });
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

describe("K-032 edit reliability", () => {
  it("applies multi-edit atomically", async () => {
    const ide = mockIde();
    await expect(
      editFileImpl(
        {
          filepath: "a.ts",
          edits: [
            { old_string: "const a = 1;", new_string: "const a = 9;" },
            { old_string: "does not exist", new_string: "x" },
          ],
        },
        extras(ide),
      ),
    ).rejects.toThrow(/Edit 2 of 2 failed \(no changes written\)/);
    expect(ide.writeFile).not.toHaveBeenCalled();

    const out = await editFileImpl(
      {
        filepath: "a.ts",
        edits: [
          { old_string: "const a = 1;", new_string: "const a = 9;" },
          { old_string: "const b = 2;", new_string: "const b = 8;" },
        ],
      },
      extras(ide),
    );
    expect(ide.writeFile).toHaveBeenCalledWith(
      "file:///tmp/ws/a.ts",
      "const a = 9;\nconst b = 8;\n",
    );
    expect(out[0].content).toContain("2 edits");
  });

  it("later edits see earlier edits", async () => {
    const ide = mockIde();
    await editFileImpl(
      {
        filepath: "a.ts",
        edits: [
          { old_string: "const a = 1;", new_string: "const z = 1;" },
          { old_string: "const z = 1;", new_string: "const z = 2;" },
        ],
      },
      extras(ide),
    );
    expect(ide.writeFile).toHaveBeenCalledWith(
      "file:///tmp/ws/a.ts",
      "const z = 2;\nconst b = 2;\n",
    );
  });

  it("returns a compact diff", async () => {
    const out = await editFileImpl(
      { filepath: "a.ts", old_string: "const b = 2;", new_string: "const b = 3;" },
      extras(mockIde()),
    );
    expect(out[0].content).toContain("-const b = 2;");
    expect(out[0].content).toContain("+const b = 3;");
    expect(out[0].content).toContain("@@ line 2");
  });

  it("keeps CRLF files CRLF when new_string uses LF", async () => {
    const ide = mockIde({ readFile: vi.fn(async () => "a\r\nb\r\nc\r\n") });
    await editFileImpl(
      { filepath: "a.ts", old_string: "b", new_string: "b1\nb2" },
      extras(ide),
    );
    expect(ide.writeFile).toHaveBeenCalledWith("file:///tmp/ws/a.ts", "a\r\nb1\r\nb2\r\nc\r\n");
  });

  it("preserves a BOM", async () => {
    const ide = mockIde({ readFile: vi.fn(async () => "\uFEFFhello\n") });
    await editFileImpl({ filepath: "a.ts", old_string: "hello", new_string: "bye" }, extras(ide));
    expect(ide.writeFile).toHaveBeenCalledWith("file:///tmp/ws/a.ts", "\uFEFFbye\n");
  });

  it("matches tabs vs spaces and reports near matches on a miss", async () => {
    const ide = mockIde({ readFile: vi.fn(async () => "\tfoo();\n\tbar();\n") });
    await editFileImpl({ filepath: "a.ts", old_string: "    foo();", new_string: "    baz();" }, extras(ide));
    expect(ide.writeFile).toHaveBeenCalledWith("file:///tmp/ws/a.ts", "\tbaz();\n\tbar();\n");
    await expect(
      editFileImpl({ filepath: "a.ts", old_string: "foo(1);", new_string: "x" }, extras(ide)),
    ).rejects.toThrow(/1: .*foo/);
  });

  it("warns when the file changed since it was read", async () => {
    resetFileTracking();
    noteFileContent("file:///tmp/ws/a.ts", "old content that differs");
    const out = await editFileImpl(
      { filepath: "a.ts", old_string: "const b = 2;", new_string: "const b = 3;" },
      extras(mockIde()),
    );
    expect(out[0].content).toMatch(/changed on disk since you last read/);

    const again = await editFileImpl(
      { filepath: "a.ts", old_string: "const b = 3;", new_string: "const b = 4;" },
      extras(mockIde({ readFile: vi.fn(async () => "const a = 1;\nconst b = 3;\n") })),
    );
    expect(again[0].content).not.toMatch(/changed on disk/);
  });
});
