import { describe, expect, it, vi } from "vitest";

import type { IDE, Tool, ToolExtras } from "..";
import {
  toolEditor,
  toolFilesystem,
  toolGit,
  toolSearch,
  toolSubprocess,
  toolTerminal,
  withIdePorts,
} from "./toolPorts";

function extras(over: Partial<ToolExtras> = {}): ToolExtras {
  return {
    ide: {
      readFile: vi.fn(),
      subprocess: vi.fn(),
      getSearchResults: vi.fn(),
      getDiff: vi.fn(),
      getIdeInfo: vi.fn(),
      openFile: vi.fn(),
    } as unknown as IDE,
    llm: {} as ToolExtras["llm"],
    fetch: (async () => new Response()) as ToolExtras["fetch"],
    tool: { function: { name: "t" } } as Tool,
    ...over,
  };
}

describe("K-084 tool ports", () => {
  it("falls back to ide when ports are omitted", () => {
    const e = extras();
    expect(toolFilesystem(e)).toBe(e.ide);
    expect(toolSubprocess(e)).toBe(e.ide);
    expect(toolSearch(e)).toBe(e.ide);
    expect(toolGit(e)).toBe(e.ide);
    expect(toolTerminal(e)).toBe(e.ide);
    expect(toolEditor(e)).toBe(e.ide);
  });

  it("prefers explicit ports over ide", async () => {
    const fs = {
      readFile: vi.fn(async () => "from-fs"),
      writeFile: vi.fn(async () => {}),
      fileExists: vi.fn(async () => true),
      listDir: vi.fn(async () => []),
      getWorkspaceDirs: vi.fn(async () => ["file:///ws"]),
    };
    const proc = { subprocess: vi.fn(async () => ["out", ""] as [string, string]) };
    const search = {
      getSearchResults: vi.fn(async () => "hit.ts:1:match"),
    };
    const git = {
      getDiff: vi.fn(async () => ["diff --git a/x"]),
      getGitRootPath: vi.fn(async () => "file:///ws"),
    };
    const term = {
      getIdeInfo: vi.fn(async () => ({
        ideType: "vscode" as const,
        name: "knox",
        version: "1",
        remoteName: "local",
        extensionVersion: "1",
      })),
      runCommand: vi.fn(async () => {}),
    };
    const editor = {
      openFile: vi.fn(async () => {}),
      getCurrentFile: vi.fn(async () => ({
        isUntitled: false,
        path: "file:///ws/a.ts",
        contents: "x",
      })),
    };
    const e = extras({ fs, proc, search, git, term, editor });
    expect(await toolFilesystem(e).readFile("file:///ws/a.ts")).toBe("from-fs");
    expect(await toolSubprocess(e).subprocess("git status")).toEqual(["out", ""]);
    expect(await toolSearch(e).getSearchResults("q")).toBe("hit.ts:1:match");
    expect(await toolGit(e).getDiff(true)).toEqual(["diff --git a/x"]);
    expect((await toolTerminal(e).getIdeInfo()).remoteName).toBe("local");
    expect((await toolEditor(e).getCurrentFile?.())?.path).toBe("file:///ws/a.ts");
    expect(e.ide.readFile).not.toHaveBeenCalled();
    expect(e.ide.subprocess).not.toHaveBeenCalled();
    expect(e.ide.getSearchResults).not.toHaveBeenCalled();
    expect(e.ide.getDiff).not.toHaveBeenCalled();
    expect(e.ide.getIdeInfo).not.toHaveBeenCalled();
    expect(e.ide.openFile).not.toHaveBeenCalled();
  });

  it("withIdePorts copies every port from the same host", () => {
    const ide = extras().ide;
    const ports = withIdePorts(ide);
    expect(ports.ide).toBe(ide);
    expect(ports.fs).toBe(ide);
    expect(ports.proc).toBe(ide);
    expect(ports.search).toBe(ide);
    expect(ports.git).toBe(ide);
    expect(ports.term).toBe(ide);
    expect(ports.editor).toBe(ide);
  });
});
