/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Shared esbuild plugins for the Knox host bundle and the installable CLI.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { Plugin } from "esbuild";

export function knoxNodeModuleDirs(extensionDir: string): string[] {
  return [path.join(extensionDir, "node_modules")].filter((dir) =>
    fs.existsSync(dir),
  );
}

export function findKnoxNodeFile(
  extensionDir: string,
  relPath: string,
): string | undefined {
  for (const dir of knoxNodeModuleDirs(extensionDir)) {
    const candidate = path.join(dir, relPath);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export function copyXhrSyncWorker(
  extensionDir: string,
  destDir: string,
): void {
  const sourcePath = findKnoxNodeFile(
    extensionDir,
    path.join("jsdom", "lib", "jsdom", "living", "xhr", "xhr-sync-worker.js"),
  );
  if (!sourcePath) {
    return;
  }
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(sourcePath, path.join(destDir, "xhr-sync-worker.js"));
}

export function knoxResolvePlugin(opts: {
  knoxCoreDir: string;
  knoxPkgDir: string;
  coreShim: string;
}): Plugin {
  const { knoxCoreDir, knoxPkgDir, coreShim } = opts;
  return {
    name: "knox-core-knoxdev-alias",
    setup(build) {
      build.onResolve({ filter: /^core$/ }, () => ({ path: coreShim }));
      build.onResolve({ filter: /^core\// }, async (args) => {
        const subpath = args.path.slice("core/".length);
        return build.resolve("./" + subpath, {
          kind: args.kind,
          resolveDir: knoxCoreDir,
        });
      });
      build.onResolve({ filter: /^knoxdev-package(\/|$)/ }, (args) => {
        const exportMap: Record<string, string> = {
          "knoxdev-package/config-yaml": path.join(
            knoxPkgDir,
            "config-yaml",
            "index.ts",
          ),
          "knoxdev-package/fetch": path.join(knoxPkgDir, "fetch", "index.ts"),
          "knoxdev-package/openai-adapters": path.join(
            knoxPkgDir,
            "openai-adapters",
            "index.ts",
          ),
          "knoxdev-package/openai-adapters/apis/base": path.join(
            knoxPkgDir,
            "openai-adapters",
            "apis",
            "base.ts",
          ),
        };
        const mapped = exportMap[args.path];
        if (mapped && fs.existsSync(mapped)) {
          return { path: mapped };
        }
        const subpath = args.path.replace(/^knoxdev-package\/?/, "");
        const tsFallback = path.join(
          knoxPkgDir,
          subpath.endsWith(".ts") ? subpath : `${subpath}.ts`,
        );
        if (fs.existsSync(tsFallback)) {
          return { path: tsFallback };
        }
        return { path: path.join(knoxPkgDir, subpath) };
      });
    },
  };
}

export const jsdomInlineDefaultStylesheet: Plugin = {
  name: "jsdom-inline-default-stylesheet",
  setup(build) {
    build.onLoad(
      {
        filter:
          /jsdom[/\\]lib[/\\]jsdom[/\\]living[/\\]css[/\\]helpers[/\\]computed-style\.js$/,
      },
      async (args) => {
        let contents = await fs.promises.readFile(args.path, "utf8");
        const cssPath = path.resolve(
          path.dirname(args.path),
          "../../../browser/default-stylesheet.css",
        );
        if (fs.existsSync(cssPath)) {
          const cssContent = await fs.promises.readFile(cssPath, "utf8");
          contents = contents.replace(
            /const defaultStyleSheet = fs\.readFileSync\(\s*path\.resolve\(__dirname,\s*"\.\.\/\.\.\/\.\.\/browser\/default-stylesheet\.css"\)\s*,\s*\{\s*encoding:\s*"utf-8"\s*\}\s*\);/,
            `const defaultStyleSheet = ${JSON.stringify(cssContent)};`,
          );
        }
        return { contents, loader: "js" };
      },
    );
  },
};

export const cssTreeInlineJson: Plugin = {
  name: "css-tree-inline-json",
  setup(build) {
    build.onLoad(
      { filter: /css-tree[/\\]lib[/\\]data-patch\.js$/ },
      async (args) => {
        const contents = `import patch from '../data/patch.json';\nexport default patch;`;
        return {
          contents,
          loader: "js",
          resolveDir: path.dirname(args.path),
        };
      },
    );
    build.onLoad(
      { filter: /css-tree[/\\]lib[/\\]data\.js$/ },
      async (args) => {
        let contents = await fs.promises.readFile(args.path, "utf8");
        const imports = [
          `import mdnAtrules from 'mdn-data/css/at-rules.json';`,
          `import mdnProperties from 'mdn-data/css/properties.json';`,
          `import mdnSyntaxes from 'mdn-data/css/syntaxes.json';`,
        ].join("\n");
        contents = contents.replace(
          /import\s*\{\s*createRequire\s*\}\s*from\s*['"]module['"];/,
          "",
        );
        contents = contents.replace(
          /const\s+require\s*=\s*createRequire\(import\.meta\.url\);/,
          "",
        );
        contents = contents.replace(
          /const\s+mdnAtrules\s*=\s*require\(['"]mdn-data\/css\/at-rules\.json['"]\);/,
          "",
        );
        contents = contents.replace(
          /const\s+mdnProperties\s*=\s*require\(['"]mdn-data\/css\/properties\.json['"]\);/,
          "",
        );
        contents = contents.replace(
          /const\s+mdnSyntaxes\s*=\s*require\(['"]mdn-data\/css\/syntaxes\.json['"]\);/,
          "",
        );
        return {
          contents: imports + "\n" + contents,
          loader: "js",
          resolveDir: path.dirname(args.path),
        };
      },
    );
  },
};

export function knoxBundlePlugins(opts: {
  knoxCoreDir: string;
  knoxPkgDir: string;
  coreShim: string;
}): Plugin[] {
  return [
    knoxResolvePlugin(opts),
    jsdomInlineDefaultStylesheet,
    cssTreeInlineJson,
  ];
}
