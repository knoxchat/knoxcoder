import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  KNOX_GULP_COMPILE_TASKS,
  assertNoKnoxMarketplaceBuiltins,
  gulpCompilationsExcludesKnoxTsconfig,
  gulpFileHasKnoxPackagingTasks,
  nativeExtensionsSourceIncludesKnox,
  vscodeIgnoreAllowsPackagedNatives,
} from "../../../scripts/packaging.mts";
import { allTools } from "../tools";

function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 12; i++) {
    if (
      existsSync(join(dir, "product.json")) &&
      existsSync(join(dir, "extensions", "knox", "package.json"))
    ) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  throw new Error(`KN-384: repo root not found from ${start}`);
}

const repoRoot = findRepoRoot(dirname(fileURLToPath(import.meta.url)));

describe("KnoxCoder product identity (KN-124, KN-152)", () => {
  it("does not recommend marketplace knoxchat.knoxchat", () => {
    const product = readFileSync(join(repoRoot, "product.json"), "utf8");
    expect(product).not.toMatch(/knoxchat\.knoxchat/);
    const parsed = JSON.parse(product) as {
      builtInExtensions?: Array<{ name?: string }>;
      extensionTips?: unknown;
      extensionRecommendations?: unknown;
      keymapExtensionTips?: unknown;
    };
    expect(
      (parsed.builtInExtensions ?? []).some((ext) => ext.name?.includes("knox")),
    ).toBe(false);
    expect(parsed.extensionTips ?? {}).not.toHaveProperty("knoxchat.knoxchat");
    expect(parsed.extensionRecommendations ?? {}).not.toHaveProperty(
      "knoxchat.knoxchat",
    );
  });

  it("in-tree Knox is node-only (no browser field)", () => {
    const manifest = JSON.parse(
      readFileSync(join(repoRoot, "extensions/knox/package.json"), "utf8"),
    ) as { main?: string; browser?: string };
    expect(manifest.main).toMatch(/extension/);
    expect(manifest.browser).toBeUndefined();
  });

  it("Remote-SSH: extensionKind ui + workspace (KN-365)", () => {
    const manifest = JSON.parse(
      readFileSync(join(repoRoot, "extensions/knox/package.json"), "utf8"),
    ) as { extensionKind?: string[]; browser?: string };
    expect(manifest.extensionKind).toEqual(["ui", "workspace"]);
    expect(manifest.browser).toBeUndefined();
  });

  it("in-tree Knox contributes LM tools and assist provider (KN-362)", () => {
    const manifest = JSON.parse(
      readFileSync(join(repoRoot, "extensions/knox/package.json"), "utf8"),
    ) as {
      contributes?: {
        textModelApiTools?: Array<{ name: string }>;
        textModelApiAssistProviders?: Array<{ vendor: string }>;
        configuration?: { properties?: Record<string, unknown> };
      };
    };
    const tools = manifest.contributes?.textModelApiTools ?? [];
    const names = new Set(tools.map((tool) => tool.name));
    expect(names.has("builtin_read_file")).toBe(true);
    for (const tool of allTools) {
      expect(names.has(tool.function.name)).toBe(true);
    }
    expect(
      (manifest.contributes?.textModelApiAssistProviders ?? []).some(
        (provider) => provider.vendor === "knox",
      ),
    ).toBe(true);
    expect(manifest.contributes?.configuration?.properties).toMatchObject({
      "knoxchat.enableInlineCompletions": { default: false, type: "boolean" },
    });
  });

  it("in-tree Knox is packaged as nativeExtensions, not a marketplace builtin (KN-384)", () => {
    const product = JSON.parse(
      readFileSync(join(repoRoot, "product.json"), "utf8"),
    ) as {
      builtInExtensions?: Array<{ name?: string }>;
      webBuiltInExtensions?: Array<{ name?: string }>;
    };
    assertNoKnoxMarketplaceBuiltins(product);

    const gulp = readFileSync(
      join(repoRoot, "build/gulpfile.extensions.ts"),
      "utf8",
    );
    const buildExt = readFileSync(
      join(repoRoot, "build/lib/extensions.ts"),
      "utf8",
    );
    const ignore = readFileSync(
      join(repoRoot, "extensions/knox/.vscodeignore"),
      "utf8",
    );
    const knoxPkg = JSON.parse(
      readFileSync(join(repoRoot, "extensions/knox/package.json"), "utf8"),
    ) as { scripts?: { compile?: string; "compile-native"?: string } };

    expect(nativeExtensionsSourceIncludesKnox(buildExt)).toBe(true);
    expect(gulpFileHasKnoxPackagingTasks(gulp)).toBe(true);
    expect(gulpCompilationsExcludesKnoxTsconfig(gulp)).toBe(true);
    expect(vscodeIgnoreAllowsPackagedNatives(ignore)).toBe(true);
    expect(knoxPkg.scripts?.compile).toContain(KNOX_GULP_COMPILE_TASKS[0]);
    expect(knoxPkg.scripts?.["compile-native"]).toContain(
      KNOX_GULP_COMPILE_TASKS[1],
    );
  });
});
