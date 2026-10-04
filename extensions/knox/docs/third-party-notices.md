# Knox bundled third-party notices

Direct production dependencies of the Knox system extension
(`extensions/knox/package.json`). This is **not** a replacement for the
editor-wide [`ThirdPartyNotices.txt`](../../../ThirdPartyNotices.txt).

Transitive: `node-forge` (via `mac-ca` / `win-ca`) is `BSD-3-Clause OR GPL-2.0`;
Knox uses only system root-certificate reading, and we take **BSD-3-Clause**.

Regenerate: `node ./scripts/knox-third-party-notices.mts`.

| Package | License |
|---|---|
| `@electron/rebuild` | MIT |
| `@mozilla/readability` | Apache-2.0 |
| `@octokit/rest` | MIT |
| `@vscode/ripgrep` | MIT |
| `dbinfoz` | MIT |
| `diff` | BSD-3-Clause |
| `dotenv` | BSD-2-Clause |
| `esbuild` | MIT |
| `fastest-levenshtein` | MIT |
| `follow-redirects` | MIT |
| `handlebars` | MIT |
| `http-proxy-agent` | MIT |
| `https-proxy-agent` | MIT |
| `i18next` | MIT |
| `ignore` | MIT |
| `jsdom` | MIT |
| `mac-ca` | BSD-2-Clause |
| `minisearch` | MIT |
| `monaco-vscode-textmate-theme-converter` | MIT |
| `ncp` | MIT |
| `node-fetch` | MIT |
| `node-html-markdown` | MIT |
| `node-machine-id` | MIT |
| `node-pty` | MIT |
| `openai` | Apache-2.0 |
| `partial-json` | MIT |
| `sqlite` | MIT |
| `sqlite3` | BSD-3-Clause |
| `strip-ansi` | MIT |
| `svg-builder` | MIT |
| `system-ca` | MIT |
| `systeminformation` | MIT |
| `tree-sitter-wasms` | MIT |
| `uuid` | MIT |
| `vscode-languageclient` | MIT |
| `web-tree-sitter` | MIT |
| `win-ca` | BSD-2-Clause |
| `yaml` | ISC |
| `zod` | MIT |
