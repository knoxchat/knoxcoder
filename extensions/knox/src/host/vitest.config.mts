import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const hostRoot = path.dirname(fileURLToPath(import.meta.url));
const coreRoot = path.resolve(hostRoot, "../core");
const pkgRoot = path.resolve(hostRoot, "../pkg");

/**
 * Host unit tests that need no running editor: persistence/store logic with a
 * stubbed `vscode`. Files are `*.vitest.ts` so the Electron mocha runner
 * (`**\/*.test.js`) never picks them up.
 */
export default defineConfig({
  root: hostRoot,
  resolve: {
    alias: [
      { find: /^vscode$/, replacement: path.join(hostRoot, "test/vitest/vscodeStub.ts") },
      { find: /^core\/(.*)$/, replacement: path.join(coreRoot, "$1") },
      { find: "knoxdev-package/config-yaml", replacement: path.join(pkgRoot, "config-yaml/index.ts") },
      { find: "knoxdev-package/fetch", replacement: path.join(pkgRoot, "fetch/index.ts") },
    ],
  },
  test: {
    include: ["**/*.vitest.ts"],
    exclude: ["**/node_modules/**"],
    testTimeout: 30000,
  },
});
