import { describe, expect, it, vi } from "vitest";

import type { IDE, KnoxConfig } from "../..";
import RepoMapContextProvider from "./RepoMapContextProvider";

const FILE = 1;
const DIR = 2;

function mockIde(
  tree: Record<string, [string, number][]>,
  workspaceDir = "file:///tmp/ws",
): IDE {
  const fileAt = (uri: string): string => {
    const prefix = `${workspaceDir}/`;
    if (uri === workspaceDir || uri === `${workspaceDir}/`) {
      return "";
    }
    return uri.startsWith(prefix) ? uri.slice(prefix.length) : uri;
  };
  return {
    getWorkspaceDirs: vi.fn(async () => [workspaceDir]),
    listDir: vi.fn(async (uri: string) => tree[fileAt(uri)] ?? []),
    fileExists: vi.fn(async (uri: string) => {
      const rel = fileAt(uri);
      return rel in tree;
    }),
    readFile: vi.fn(async () => ""),
  } as unknown as IDE;
}

function loadArgs(ide: IDE) {
  return {
    ide,
    config: {} as KnoxConfig,
    fetch: vi.fn() as unknown as typeof fetch,
  };
}

const fixtureTree: Record<string, [string, number][]> = {
  "": [
    ["package.json", FILE],
    ["core", DIR],
    ["gui", DIR],
    ["node_modules", DIR],
  ],
  core: [["core.ts", FILE]],
  gui: [["src", DIR]],
  "gui/src": [["App.tsx", FILE]],
  node_modules: [["pkg", DIR]],
};

describe("RepoMapContextProvider.loadSubmenuItems (MN-13)", () => {
  it("lists workspace folders plus Entire codebase", async () => {
    const provider = new RepoMapContextProvider({});
    const items = await provider.loadSubmenuItems(
      loadArgs(mockIde(fixtureTree)),
    );

    expect(items[0]?.id).toBe("entire-codebase");
    const ids = items.map((item) => item.id);
    expect(ids).toContain("file:///tmp/ws/core");
    expect(ids).toContain("file:///tmp/ws/gui");
    expect(ids).toContain("file:///tmp/ws/gui/src");
    expect(ids.some((id) => id.endsWith("package.json"))).toBe(false);
    expect(ids.join("\n")).not.toContain("node_modules");
  });

  it("still returns Entire codebase when there is no workspace", async () => {
    const ide = mockIde(fixtureTree);
    ide.getWorkspaceDirs = vi.fn(async () => []);
    const provider = new RepoMapContextProvider({});
    const items = await provider.loadSubmenuItems(loadArgs(ide));
    expect(items).toEqual([
      expect.objectContaining({ id: "entire-codebase" }),
    ]);
  });
});
