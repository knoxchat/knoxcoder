import { describe, expect, it, vi } from "vitest";

import type { IDE } from "..";
import {
  createWalkIgnoreMatcher,
  loadWalkIgnore,
} from "./walkIgnore";

describe("walkIgnore matcher", () => {
  it("matches F-style globs relative to the ignore file root", () => {
    const matcher = createWalkIgnoreMatcher();
    matcher.addLayer(
      "file:///tmp/ws",
      ["*.ko", "vmlinux", "generated/", "!.gitignore"].join("\n"),
    );
    expect(matcher.ignores("file:///tmp/ws/mm/filemap.ko")).toBe(true);
    expect(matcher.ignores("file:///tmp/ws/vmlinux")).toBe(true);
    expect(matcher.ignores("file:///tmp/ws/generated", true)).toBe(true);
    expect(matcher.ignores("file:///tmp/ws/generated/foo.c")).toBe(true);
    expect(matcher.ignores("file:///tmp/ws/mm/filemap.c")).toBe(false);
    expect(matcher.ignores("file:///tmp/ws/.gitignore")).toBe(false);
  });

  it("applies nested ignore files only under that directory", () => {
    const matcher = createWalkIgnoreMatcher();
    matcher.addLayer("file:///tmp/ws", "*.o\n");
    matcher.addLayer("file:///tmp/ws/drivers", "staging/\n");
    expect(matcher.ignores("file:///tmp/ws/mm/filemap.o")).toBe(true);
    expect(matcher.ignores("file:///tmp/ws/drivers/staging", true)).toBe(true);
    expect(matcher.ignores("file:///tmp/ws/mm/staging/foo.c")).toBe(false);
  });
});

describe("loadWalkIgnore", () => {
  it("reads .gitignore and .knoxignore from the workspace root", async () => {
    const files: Record<string, string> = {
      "file:///tmp/ws/.gitignore": "*.ko\n",
      "file:///tmp/ws/.knoxignore": "vmlinux\n",
    };
    const ide = {
      fileExists: vi.fn(async (uri: string) => uri in files),
      readFile: vi.fn(async (uri: string) => {
        const text = files[uri];
        if (text === undefined) {
          throw new Error("missing");
        }
        return text;
      }),
    } as unknown as IDE;

    const matcher = await loadWalkIgnore(ide, ["file:///tmp/ws"]);
    expect(matcher.ignores("file:///tmp/ws/mm/foo.ko")).toBe(true);
    expect(matcher.ignores("file:///tmp/ws/vmlinux")).toBe(true);
    expect(matcher.ignores("file:///tmp/ws/mm/foo.c")).toBe(false);
  });
});
