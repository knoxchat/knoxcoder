import { describe, expect, it, vi } from "vitest";

import type { IDE } from "..";
import { walkDir } from "./walkDir";

const FILE = 1;
const DIR = 2;

function mockIde(
  tree: Record<string, [string, number][]>,
  files: Record<string, string> = {},
): IDE {
  const fileAt = (uri: string): string => {
    if (uri === "file:///tmp/ws" || uri === "file:///tmp/ws/") {
      return "";
    }
    return uri.replace("file:///tmp/ws/", "");
  };
  return {
    listDir: vi.fn(async (uri: string) => tree[fileAt(uri)] ?? []),
    fileExists: vi.fn(async (uri: string) => {
      const rel = fileAt(uri);
      return rel in files || rel in tree;
    }),
    readFile: vi.fn(async (uri: string) => {
      const rel = fileAt(uri);
      if (rel in files) {
        return files[rel];
      }
      throw new Error(`missing ${uri}`);
    }),
  } as unknown as IDE;
}

describe("walkDir", () => {
  const tree: Record<string, [string, number][]> = {
    "": [
      ["Makefile", FILE],
      ["arch", DIR],
      ["node_modules", DIR],
      [".git", DIR],
    ],
    arch: [["x86", DIR]],
    "arch/x86": [["foo.c", FILE]],
    node_modules: [["pkg", DIR]],
    "node_modules/pkg": [["index.js", FILE]],
    ".git": [["HEAD", FILE]],
  };

  it("recurses into nested directories without includeDirs", async () => {
    const uris = await walkDir("file:///tmp/ws", mockIde(tree), {
      source: "test",
    });
    expect(uris).toContain("file:///tmp/ws/Makefile");
    expect(uris).toContain("file:///tmp/ws/arch/x86/foo.c");
    expect(uris.every((uri) => !uri.endsWith("/arch"))).toBe(true);
    expect(uris.every((uri) => !uri.endsWith("/x86"))).toBe(true);
  });

  it("skips node_modules and .git", async () => {
    const uris = await walkDir("file:///tmp/ws", mockIde(tree));
    expect(uris.join("\n")).not.toContain("node_modules");
    expect(uris.join("\n")).not.toContain(".git");
  });

  it("emits directory URIs when includeDirs is true", async () => {
    const uris = await walkDir("file:///tmp/ws", mockIde(tree), {
      includeDirs: true,
    });
    expect(uris).toContain("file:///tmp/ws/arch");
    expect(uris).toContain("file:///tmp/ws/arch/x86");
    expect(uris).toContain("file:///tmp/ws/arch/x86/foo.c");
  });

  it("honors maxEntries", async () => {
    const uris = await walkDir("file:///tmp/ws", mockIde(tree), {
      maxEntries: 1,
    });
    expect(uris).toHaveLength(1);
  });

  it("honors .gitignore and .knoxignore (HL-19)", async () => {
    const withIgnore: Record<string, [string, number][]> = {
      "": [
        [".gitignore", FILE],
        [".knoxignore", FILE],
        ["Makefile", FILE],
        ["vmlinux", FILE],
        ["mm", DIR],
        ["generated", DIR],
      ],
      mm: [
        ["filemap.c", FILE],
        ["filemap.ko", FILE],
      ],
      generated: [["foo.c", FILE]],
    };
    const files = {
      ".gitignore": "*.ko\ngenerated/\n",
      ".knoxignore": "vmlinux\n",
    };
    const uris = await walkDir("file:///tmp/ws", mockIde(withIgnore, files));
    expect(uris).toContain("file:///tmp/ws/Makefile");
    expect(uris).toContain("file:///tmp/ws/mm/filemap.c");
    expect(uris.join("\n")).not.toContain("generated");
    expect(uris.join("\n")).not.toContain("filemap.ko");
    expect(uris.join("\n")).not.toContain("vmlinux");
  });

  it("honors a nested .knoxignore under that directory only", async () => {
    const withNested: Record<string, [string, number][]> = {
      "": [
        ["keep.c", FILE],
        ["pkg", DIR],
      ],
      pkg: [
        [".knoxignore", FILE],
        ["ok.c", FILE],
        ["secret", DIR],
      ],
      "pkg/secret": [["hidden.c", FILE]],
    };
    const uris = await walkDir(
      "file:///tmp/ws",
      mockIde(withNested, { "pkg/.knoxignore": "secret/\n" }),
    );
    expect(uris).toContain("file:///tmp/ws/keep.c");
    expect(uris).toContain("file:///tmp/ws/pkg/ok.c");
    expect(uris.join("\n")).not.toContain("hidden.c");
  });

  it("skips vmlinux / *.ko even without an ignore file", async () => {
    const artifacts: Record<string, [string, number][]> = {
      "": [
        ["mm", DIR],
        ["vmlinux", FILE],
      ],
      mm: [
        ["filemap.c", FILE],
        ["filemap.ko", FILE],
      ],
    };
    const uris = await walkDir("file:///tmp/ws", mockIde(artifacts));
    expect(uris).toContain("file:///tmp/ws/mm/filemap.c");
    expect(uris.join("\n")).not.toMatch(/vmlinux|\.ko/);
  });
});
