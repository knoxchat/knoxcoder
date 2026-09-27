import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IDE, ILLM, SymbolWithRange } from "../index.js";
import generateRepoMap, {
  formatFileEntry,
  formatSymbolSignature,
} from "./generateRepoMap.js";

function treeFromPaths(paths: string[]): Record<string, [string, number][]> {
  const tree: Record<string, [string, number][]> = { "": [] };
  for (const filePath of paths) {
    const parts = filePath.split("/").filter(Boolean);
    let acc = "";
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const parent = acc;
      const isFile = i === parts.length - 1;
      if (!tree[parent]) {
        tree[parent] = [];
      }
      if (!tree[parent].some(([existing]) => existing === name)) {
        tree[parent].push([name, isFile ? 1 : 2]);
      }
      if (!isFile) {
        acc = acc ? `${acc}/${name}` : name;
        if (!tree[acc]) {
          tree[acc] = [];
        }
      }
    }
  }
  return tree;
}

function mockIde(paths: string[], contents: Record<string, string> = {}): IDE {
  const tree = treeFromPaths(paths);
  return {
    getWorkspaceDirs: vi.fn(async () => ["file:///tmp/ws"]),
    listDir: vi.fn(async (uri: string) => {
      const rel =
        uri === "file:///tmp/ws" || uri === "file:///tmp/ws/"
          ? ""
          : uri.replace("file:///tmp/ws/", "");
      return tree[rel] ?? [];
    }),
    readFile: vi.fn(async (uri: string) => {
      const rel = uri.replace("file:///tmp/ws/", "");
      return contents[rel] ?? contents[uri] ?? "int foo(void) { return 0; }\n";
    }),
    getFileStats: vi.fn(async (uris: string[]) => {
      const out: Record<string, { size: number; lastModified: number }> = {};
      for (const uri of uris) {
        out[uri] = { size: 10, lastModified: 1 };
      }
      return out;
    }),
    subprocess: vi.fn(async () => ["", ""] as [string, string]),
    fileExists: vi.fn(async (uri: string) => {
      if (uri === "file:///tmp/ws" || uri === "file:///tmp/ws/") {
        return true;
      }
      const rel = uri.replace("file:///tmp/ws/", "");
      if (contents[rel] !== undefined) {
        return true;
      }
      if (tree[rel]) {
        return true;
      }
      const parent = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
      const name = rel.split("/").pop();
      return (tree[parent] ?? []).some(([existing]) => existing === name);
    }),
  } as unknown as IDE;
}

function mockLlm(contextLength = 32_000): ILLM {
  return {
    contextLength,
    model: "gpt-4o",
    countTokens: (text: string) => Math.max(1, Math.ceil(text.length / 4)),
  } as ILLM;
}

function kernelFixture(fileCount: number): string[] {
  const paths = ["Makefile", "Kconfig", "MAINTAINERS", "mm/filemap.c"];
  let n = 0;
  const extra = Math.max(0, fileCount - paths.length);
  for (let d = 0; n < extra; d++) {
    for (let f = 0; f < 100 && n < extra; f++) {
      paths.push(`drivers/d${d}/f${f}.c`);
      n++;
    }
  }
  return paths;
}

describe("formatSymbolSignature", () => {
  it("uses the first line of the symbol content", () => {
    const symbol: SymbolWithRange = {
      filepath: "src/a.ts",
      type: "function_declaration",
      name: "hello",
      range: {
        start: { line: 0, character: 0 },
        end: { line: 2, character: 1 },
      },
      content: "export function hello(name: string) {\n  return name;\n}",
    };
    expect(formatSymbolSignature(symbol)).toBe(
      "export function hello(name: string) {",
    );
  });

  it("falls back to type + name when content is empty", () => {
    const symbol: SymbolWithRange = {
      filepath: "src/a.ts",
      type: "class_declaration",
      name: "Foo",
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 3 },
      },
      content: "   ",
    };
    expect(formatSymbolSignature(symbol)).toBe("class_declaration Foo");
  });
});

describe("formatFileEntry", () => {
  it("lists path only when there are no signatures", () => {
    expect(formatFileEntry("src/a.ts", [])).toBe("src/a.ts\n");
  });

  it("indents signature lines under the path", () => {
    expect(
      formatFileEntry("src/a.ts", [
        "export class Foo {",
        "export function bar() {",
      ]),
    ).toBe(
      "src/a.ts:\n\texport class Foo {\n\texport function bar() {\n",
    );
  });
});

describe("generateRepoMap kernel-scale (HL-20)", () => {
  let tmp: string;
  let prevKnox: string | undefined;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "knox-repomap-"));
    prevKnox = process.env.KNOX_GLOBAL_DIR;
    process.env.KNOX_GLOBAL_DIR = tmp;
  });

  afterEach(() => {
    if (prevKnox === undefined) {
      delete process.env.KNOX_GLOBAL_DIR;
    } else {
      process.env.KNOX_GLOBAL_DIR = prevKnox;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("includes subsystem counts even under a tight token budget", async () => {
    const files = kernelFixture(5_000);
    const map = await generateRepoMap(mockLlm(2_000), mockIde(files), {
      outputRelativeUriPaths: true,
      includeSignatures: false,
      skipCache: true,
    });
    expect(map).toContain("## Subsystems");
    expect(map).toContain("drivers/");
    expect(map).toContain("mm/");
    expect(map).toContain("MAINTAINERS");
  });

  it("scopes to path=mm and omits drivers/", async () => {
    const files = kernelFixture(200);
    const map = await generateRepoMap(mockLlm(), mockIde(files), {
      outputRelativeUriPaths: true,
      includeSignatures: false,
      skipCache: true,
      path: "mm",
    });
    expect(map).toContain("filemap.c");
    expect(map).not.toContain("drivers/");
  });

  it("serves a 5k-file map from cache in under 2s", async () => {
    const files = kernelFixture(5_000);
    const ide = mockIde(files);
    const llm = mockLlm(200_000);
    const options = {
      outputRelativeUriPaths: true,
      includeSignatures: false,
    } as const;

    const first = await generateRepoMap(llm, ide, options);
    expect(first).toContain("drivers/");

    const t0 = Date.now();
    const second = await generateRepoMap(llm, ide, options);
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(2_000);
    expect(second).toContain("## Subsystems");
    expect(second).toContain("drivers/");
    expect(second).toBe(first);
  });

  it("extracts SYM_FUNC_START / asmlinkage from a .S file without wasm (HL-23)", async () => {
    const asm = [
      '#include <linux/linkage.h>',
      'asmlinkage',
      'SYM_FUNC_START(copy_to_user)',
      '\tret',
      'SYM_FUNC_END(copy_to_user)',
      'ENTRY(memcpy)',
      '\tret',
      'END(memcpy)',
      "",
    ].join("\n");
    const map = await generateRepoMap(
      mockLlm(),
      mockIde(
        ["Makefile", "Kconfig", "arch/x86/entry.S", "mm/filemap.c"],
        { "arch/x86/entry.S": asm },
      ),
      {
        outputRelativeUriPaths: true,
        includeSignatures: true,
        skipCache: true,
      },
    );
    expect(map).toContain("entry.S");
    expect(map).toMatch(/SYM_FUNC_START\(copy_to_user\)/);
    expect(map).toMatch(/ENTRY\(memcpy\)/);
    expect(map).toMatch(/asmlinkage/);
  });

  it("omits gitignored generated files from the map (HL-19)", async () => {
    const map = await generateRepoMap(
      mockLlm(),
      mockIde(
        [
          ".gitignore",
          "Makefile",
          "Kconfig",
          "mm/filemap.c",
          "generated/foo.c",
          "vmlinux",
        ],
        { ".gitignore": "generated/\nvmlinux\n" },
      ),
      {
        outputRelativeUriPaths: true,
        includeSignatures: false,
        skipCache: true,
      },
    );
    expect(map).toContain("mm/filemap.c");
    expect(map).not.toContain("generated/");
    expect(map).not.toContain("vmlinux");
  });
});
