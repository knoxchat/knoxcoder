import { describe, expect, it, vi } from "vitest";

import type { IDE, ToolExtras } from "../..";
import { globImpl } from "./glob";

function mockIde(
  tree: Record<string, [string, number][]>,
  files: Record<string, string> = {},
): IDE {
  const relOf = (uri: string) =>
    uri === "file:///tmp/ws" || uri === "file:///tmp/ws/"
      ? ""
      : uri.replace("file:///tmp/ws/", "");
  const hasFile = (rel: string) => {
    if (rel in files || rel in tree) {
      return true;
    }
    const parent = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
    const name = rel.split("/").pop();
    return (tree[parent] ?? []).some(([existing]) => existing === name);
  };
  return {
    getWorkspaceDirs: vi.fn(async () => ["file:///tmp/ws"]),
    getCurrentFile: vi.fn(async () => undefined),
    fileExists: vi.fn(async (uri: string) => {
      if (uri === "file:///tmp/ws") {
        return true;
      }
      return hasFile(relOf(uri));
    }),
    readFile: vi.fn(async (uri: string) => {
      const rel = relOf(uri);
      if (rel in files) {
        return files[rel];
      }
      throw new Error(`missing ${uri}`);
    }),
    listDir: vi.fn(async (uri: string) => tree[relOf(uri)] ?? []),
  } as unknown as IDE;
}

function extras(ide: IDE): ToolExtras {
  return {
    ide,
    llm: {} as ToolExtras["llm"],
    fetch: vi.fn(),
    tool: { function: { name: "builtin_glob" } } as ToolExtras["tool"],
  };
}

describe("globImpl", () => {
  const tree: Record<string, [string, number][]> = {
    "": [
      ["src", 2],
      ["README.md", 1],
      ["node_modules", 2],
    ],
    src: [
      ["a.ts", 1],
      ["b.tsx", 1],
      ["nested", 2],
    ],
    "src/nested": [["c.ts", 1]],
    node_modules: [["pkg", 2]],
  };

  it("finds **/*.ts and skips node_modules", async () => {
    const ide = mockIde(tree);
    const result = await globImpl({ pattern: "**/*.ts" }, extras(ide));
    expect(result[0].content).toContain("src/a.ts");
    expect(result[0].content).toContain("src/nested/c.ts");
    expect(result[0].content).not.toContain("node_modules");
    expect(result[0].content).not.toContain("b.tsx");
  });

  it("respects max_results", async () => {
    const ide = mockIde(tree);
    const result = await globImpl(
      { pattern: "**/*", max_results: 1 },
      extras(ide),
    );
    const paths = result[0].content
      .split("\n")
      .filter((l) => l.includes("/") || l.endsWith(".md") || l.endsWith(".ts"));
    expect(result[0].content).toMatch(/truncated|Found 1/);
    expect(paths.length).toBeGreaterThanOrEqual(1);
  });

  it("requires pattern", async () => {
    const ide = mockIde(tree);
    await expect(globImpl({}, extras(ide))).rejects.toThrow(/pattern/i);
  });

  it("skips *.o unless the pattern asks for them", async () => {
    const withObjects: Record<string, [string, number][]> = {
      "": [
        ["foo.c", 1],
        ["foo.o", 1],
      ],
    };
    const ide = mockIde(withObjects);
    const all = await globImpl({ pattern: "**/*" }, extras(ide));
    expect(all[0].content).toContain("foo.c");
    expect(all[0].content).not.toContain("foo.o");

    const objects = await globImpl({ pattern: "**/*.o" }, extras(ide));
    expect(objects[0].content).toContain("foo.o");
  });

  it("walks build/ when it contains Makefile (QEMU in-tree)", async () => {
    const qemu: Record<string, [string, number][]> = {
      "": [["build", 2]],
      build: [
        ["Makefile", 1],
        ["qemu-system-x86_64", 1],
        ["softmmu", 2],
      ],
      "build/softmmu": [["main.c", 1]],
    };
    const ide = mockIde(qemu);
    const result = await globImpl({ pattern: "**/*.c" }, extras(ide));
    expect(result[0].content).toContain("build/softmmu/main.c");
  });

  it("skips empty cmake-style build/ without a makefile", async () => {
    const cmake: Record<string, [string, number][]> = {
      "": [
        ["src", 2],
        ["build", 2],
      ],
      src: [["a.c", 1]],
      build: [["CMakeCache.txt", 1]],
    };
    const ide = mockIde(cmake);
    const result = await globImpl({ pattern: "**/*" }, extras(ide));
    expect(result[0].content).toContain("src/a.c");
    expect(result[0].content).not.toContain("CMakeCache.txt");
  });

  it("honors .gitignore generated/ and *.ko (HL-19)", async () => {
    const kernel: Record<string, [string, number][]> = {
      "": [
        [".gitignore", 1],
        ["mm", 2],
        ["generated", 2],
        ["vmlinux", 1],
      ],
      mm: [
        ["filemap.c", 1],
        ["filemap.ko", 1],
      ],
      generated: [["foo.c", 1]],
    };
    const ide = mockIde(kernel, {
      ".gitignore": "*.ko\ngenerated/\nvmlinux\n",
    });
    const result = await globImpl({ pattern: "**/*" }, extras(ide));
    expect(result[0].content).toContain("mm/filemap.c");
    expect(result[0].content).not.toContain("generated/foo.c");
    expect(result[0].content).not.toContain("filemap.ko");
    expect(result[0].content).not.toContain("vmlinux");
  });

  it("returns a truncation footer for **/*.c on a 15k-file tree", async () => {
    const big: Record<string, [string, number][]> = { "": [] };
    for (let i = 0; i < 150; i++) {
      const dir = `d${i}`;
      big[""].push([dir, 2]);
      big[dir] = [];
      for (let j = 0; j < 100; j++) {
        big[dir].push([`f${j}.c`, 1]);
      }
    }
    const ide = mockIde(big);
    const result = await globImpl({ pattern: "**/*.c" }, extras(ide));
    expect(result[0].content).toMatch(/truncated at 200|stopped at walk cap/);
    expect(result[0].content).not.toMatch(/^Found 200 file\(s\) matching "\*\*\/\*\.c"\.\s*$/m);
    const paths = result[0].content
      .split("\n")
      .filter((line) => line.endsWith(".c"));
    expect(paths.length).toBe(200);
  });

  it("honors nested .knoxignore", async () => {
    const tree: Record<string, [string, number][]> = {
      "": [
        ["pkg", 2],
        ["keep.ts", 1],
      ],
      pkg: [
        [".knoxignore", 1],
        ["ok.ts", 1],
        ["secret", 2],
      ],
      "pkg/secret": [["hidden.ts", 1]],
    };
    const ide = mockIde(tree, { "pkg/.knoxignore": "secret/\n" });
    const result = await globImpl({ pattern: "**/*.ts" }, extras(ide));
    expect(result[0].content).toContain("pkg/ok.ts");
    expect(result[0].content).toContain("keep.ts");
    expect(result[0].content).not.toContain("hidden.ts");
  });

  it("globs every workspace root when target_directory is .", async () => {
    const ide = {
      getWorkspaceDirs: vi.fn(async () => ["file:///tmp/app", "file:///tmp/lib"]),
      getCurrentFile: vi.fn(async () => undefined),
      fileExists: vi.fn(async () => false),
      readFile: vi.fn(async () => {
        throw new Error("missing");
      }),
      listDir: vi.fn(async (uri: string) => {
        const u = uri.replace(/\/$/, "");
        if (u === "file:///tmp/app") {
          return [["a.ts", 1]];
        }
        if (u === "file:///tmp/lib") {
          return [["b.ts", 1]];
        }
        return [];
      }),
    } as unknown as IDE;
    const result = await globImpl({ pattern: "**/*.ts" }, extras(ide));
    expect(result[0].content).toContain("a.ts");
    expect(result[0].content).toMatch(/b\.ts/);
    expect(result[0].content).toContain("/tmp/lib/b.ts");
  });
});
