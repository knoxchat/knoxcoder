import { describe, expect, it, vi } from "vitest";

import type { IDE, KnoxConfig } from "../..";
import FileFolderContextProvider, {
  formatFolderListing,
  isDirectoryUri,
  selectMentionWalkUris,
} from "./FileFolderContextProvider";

const FILE = 1;
const DIR = 2;

function mockIde(
  tree: Record<string, [string, number][]>,
  files: Record<string, string> = {},
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
    [".git", DIR],
    ["dist", DIR],
  ],
  core: [
    ["core.ts", FILE],
    ["index.ts", FILE],
  ],
  gui: [["src", DIR]],
  "gui/src": [["App.tsx", FILE]],
  node_modules: [["pkg", DIR]],
  "node_modules/pkg": [["index.js", FILE]],
  ".git": [["HEAD", FILE]],
  dist: [["bundle.js", FILE]],
};

describe("selectMentionWalkUris", () => {
  it("keeps shallower paths when truncated", () => {
    const files = [
      "file:///tmp/ws/deep/nested/a.ts",
      "file:///tmp/ws/package.json",
    ];
    const folders = ["file:///tmp/ws/core", "file:///tmp/ws/deep/nested"];
    expect(selectMentionWalkUris(files, folders, 2)).toEqual([
      "file:///tmp/ws/core",
      "file:///tmp/ws/package.json",
    ]);
  });
});

describe("FileFolderContextProvider.loadSubmenuItems (MN-01)", () => {
  it("returns files and folders from the workspace walk", async () => {
    const provider = new FileFolderContextProvider({});
    const items = await provider.loadSubmenuItems(
      loadArgs(mockIde(fixtureTree)),
    );

    expect(items.length).toBeGreaterThan(0);

    const byId = Object.fromEntries(items.map((item) => [item.id, item]));
    expect(byId["file:///tmp/ws/package.json"]).toMatchObject({
      title: "package.json",
      icon: "file",
    });
    expect(byId["file:///tmp/ws/core/core.ts"]).toMatchObject({
      title: "core.ts",
      icon: "file",
    });
    expect(byId["file:///tmp/ws/core"]).toMatchObject({
      title: "core",
      icon: "folder",
    });
    expect(byId["file:///tmp/ws/gui"]).toMatchObject({
      title: "gui",
      icon: "folder",
    });
    expect(byId["file:///tmp/ws/gui/src"]).toMatchObject({
      icon: "folder",
    });
  });

  it("skips ignored dirs (node_modules, .git, dist)", async () => {
    const provider = new FileFolderContextProvider({});
    const items = await provider.loadSubmenuItems(
      loadArgs(mockIde(fixtureTree)),
    );
    const joined = items.map((item) => item.id).join("\n");
    expect(joined).not.toContain("node_modules");
    expect(joined).not.toContain(".git");
    expect(joined).not.toContain("/dist");
  });

  it("does not mark a small workspace as truncated", async () => {
    const provider = new FileFolderContextProvider({});
    const items = await provider.loadSubmenuItems(
      loadArgs(mockIde(fixtureTree)),
    );
    expect(items.every((item) => item.metadata?.truncated !== true)).toBe(true);
  });

  it("returns an empty list when there is no workspace", async () => {
    const ide = mockIde(fixtureTree);
    ide.getWorkspaceDirs = vi.fn(async () => []);
    const provider = new FileFolderContextProvider({});
    await expect(provider.loadSubmenuItems(loadArgs(ide))).resolves.toEqual([]);
  });
});

describe("FileFolderContextProvider.getContextItems (MN-12)", () => {
  function extras(ide: IDE) {
    return {
      ide,
      config: {} as KnoxConfig,
      llm: {} as any,
      fullInput: "",
      selectedCode: [],
      fetch: vi.fn() as unknown as typeof fetch,
    };
  }

  it("attaches file contents for a file mention", async () => {
    const ide = mockIde(fixtureTree, {
      "core/core.ts": "export const core = 1;\n",
    });
    const provider = new FileFolderContextProvider({});
    const items = await provider.getContextItems(
      "file:///tmp/ws/core/core.ts",
      extras(ide),
    );

    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("core.ts");
    expect(items[0].uri?.value).toBe("file:///tmp/ws/core/core.ts");
    expect(items[0].content).toContain("export const core = 1;");
    expect(items[0].content).toContain("core/core.ts");
  });

  it("attaches a directory listing for a folder mention", async () => {
    const ide = mockIde(fixtureTree, { "gui/src/App.tsx": "export default {}" });
    const provider = new FileFolderContextProvider({});
    const items = await provider.getContextItems(
      "file:///tmp/ws/gui",
      extras(ide),
    );

    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("gui");
    expect(items[0].content).toContain("Folder listing of gui/");
    expect(items[0].content).toContain("src");
    expect(items[0].content).toContain("src/App.tsx");
  });

  it("does not treat a file as a directory just because listDir is callable", async () => {
    const ide = mockIde(fixtureTree, { "package.json": "{}" });
    await expect(
      isDirectoryUri("file:///tmp/ws/package.json", ide),
    ).resolves.toBe(false);
    await expect(isDirectoryUri("file:///tmp/ws/gui", ide)).resolves.toBe(true);
  });
});

describe("formatFolderListing", () => {
  it("lists paths relative to the folder", () => {
    expect(
      formatFolderListing("file:///tmp/ws/gui", [
        "file:///tmp/ws/gui/src",
        "file:///tmp/ws/gui/src/App.tsx",
      ]),
    ).toBe("src\nsrc/App.tsx");
  });
});
