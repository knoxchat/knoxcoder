import { describe, expect, it, vi } from "vitest";

import type { IDE } from "..";
import {
  mentionUriMatchesQuery,
  rankLiveMentionHits,
  searchWorkspaceMentions,
} from "./searchWorkspaceMentions";

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
    fileExists: vi.fn(async () => true),
    readFile: vi.fn(async () => ""),
  } as unknown as IDE;
}

describe("searchWorkspaceMentions (MN-04)", () => {
  it("matches basename and relative path", () => {
    expect(mentionUriMatchesQuery("core.ts", "core/core.ts", "core.ts")).toBe(
      true,
    );
    expect(mentionUriMatchesQuery("App.tsx", "gui/src/App.tsx", "gui/src")).toBe(
      true,
    );
    expect(mentionUriMatchesQuery("core.ts", "core/core.ts", "zzz")).toBe(false);
  });

  it("ranks exact basename above a longer path hit", () => {
    const ranked = rankLiveMentionHits(
      [
        { title: "score.ts", description: "lib/score.ts" },
        { title: "core.ts", description: "core/core.ts" },
      ],
      "core.ts",
    );
    expect(ranked[0]?.title).toBe("core.ts");
  });

  it("finds a newly walked file by name", async () => {
    const ide = mockIde({
      "": [
        ["brand-new-xyz.ts", FILE],
        ["core", DIR],
      ],
      core: [["core.ts", FILE]],
    });
    const items = await searchWorkspaceMentions(ide, "brand-new-xyz", 200);
    expect(items.some((item) => item.title === "brand-new-xyz.ts")).toBe(true);
    expect(items[0]?.icon).toBe("file");
  });

  it("returns [] for short queries", async () => {
    const ide = mockIde({ "": [["ab.ts", FILE]] });
    await expect(searchWorkspaceMentions(ide, "a")).resolves.toEqual([]);
  });
});
