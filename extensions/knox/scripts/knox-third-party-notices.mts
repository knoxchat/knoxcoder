/**
 * Knox production-dependency notices (P0-4).
 *
 * Direct `dependencies` / `optionalDependencies` from extensions/knox/package.json.
 * Transitive `node-forge` (via mac-ca / win-ca) is called out; we take the
 * BSD-3-Clause side of its dual license. Root `ThirdPartyNotices.txt` remains
 * the VS Code editor inventory.
 *
 *   node ./scripts/knox-third-party-notices.mts
 *   node ./scripts/knox-third-party-notices.mts --check
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const knoxRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outFile = path.join(knoxRoot, "docs", "third-party-notices.md");

/** SPDX for each direct production dependency. Dual-license: the option we take. */
const LICENSES: Record<string, string> = {
  "@electron/rebuild": "MIT",
  "@mozilla/readability": "Apache-2.0",
  "@octokit/rest": "MIT",
  "@vscode/ripgrep": "MIT",
  dbinfoz: "MIT",
  diff: "BSD-3-Clause",
  dotenv: "BSD-2-Clause",
  esbuild: "MIT",
  "fastest-levenshtein": "MIT",
  "follow-redirects": "MIT",
  handlebars: "MIT",
  "http-proxy-agent": "MIT",
  "https-proxy-agent": "MIT",
  i18next: "MIT",
  ignore: "MIT",
  jsdom: "MIT",
  "mac-ca": "BSD-2-Clause",
  minisearch: "MIT",
  "monaco-vscode-textmate-theme-converter": "MIT",
  ncp: "MIT",
  "node-fetch": "MIT",
  "node-html-markdown": "MIT",
  "node-machine-id": "MIT",
  "node-pty": "MIT",
  openai: "Apache-2.0",
  "partial-json": "MIT",
  sqlite: "MIT",
  sqlite3: "BSD-3-Clause",
  "strip-ansi": "MIT",
  "svg-builder": "MIT",
  "system-ca": "MIT",
  systeminformation: "MIT",
  "tree-sitter-wasms": "MIT",
  uuid: "MIT",
  "vscode-languageclient": "MIT",
  "web-tree-sitter": "MIT",
  "win-ca": "BSD-2-Clause",
  yaml: "ISC",
  zod: "MIT",
};

function productionDeps(): string[] {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(knoxRoot, "package.json"), "utf8"),
  ) as {
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };
  return [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
  ].sort();
}

export function renderNotices(names = productionDeps()): string {
  const missing = names.filter((name) => !LICENSES[name]);
  if (missing.length) {
    throw new Error(
      `knox-third-party-notices: add SPDX for ${missing.join(", ")}`,
    );
  }
  const rows = names
    .map((name) => `| \`${name}\` | ${LICENSES[name]} |`)
    .join("\n");
  return `# Knox bundled third-party notices

Direct production dependencies of the Knox system extension
(\`extensions/knox/package.json\`). This is **not** a replacement for the
editor-wide [\`ThirdPartyNotices.txt\`](../../../ThirdPartyNotices.txt).

Transitive: \`node-forge\` (via \`mac-ca\` / \`win-ca\`) is \`BSD-3-Clause OR GPL-2.0\`;
Knox uses only system root-certificate reading, and we take **BSD-3-Clause**.

Regenerate: \`node ./scripts/knox-third-party-notices.mts\`.

| Package | License |
|---|---|
${rows}
`;
}

const markdown = renderNotices();
const check = process.argv.includes("--check");
if (check) {
  const current = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8") : "";
  if (current !== markdown) {
    console.error(
      "knox-third-party-notices: docs/third-party-notices.md is stale. Run the script without --check.",
    );
    process.exit(1);
  }
  process.stdout.write("knox-third-party-notices: up to date\n");
} else {
  fs.writeFileSync(outFile, markdown);
  process.stdout.write(`wrote ${path.relative(knoxRoot, outFile)}\n`);
}
