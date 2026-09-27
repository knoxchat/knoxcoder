import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const coreRoot = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(coreRoot, "../pkg");

export default defineConfig({
  root: coreRoot,
  resolve: {
    alias: {
      "knoxdev-package/config-yaml": path.join(pkgRoot, "config-yaml/index.ts"),
      "knoxdev-package/fetch": path.join(pkgRoot, "fetch/index.ts"),
      "knoxdev-package/openai-adapters/apis/base": path.join(
        pkgRoot,
        "openai-adapters/apis/base.ts",
      ),
      "knoxdev-package/openai-adapters": path.join(
        pkgRoot,
        "openai-adapters/index.ts",
      ),
    },
  },
  test: {
    // Only vitest-style suites. Legacy script-style runners
    // (context/memory/brain/test-*.ts) are executed manually with tsx.
    include: [
      "agent/**/*.test.ts",
      "context/memory/**/*.test.ts",
      "context/soul/**/*.test.ts",
      "context/*.test.ts",
      "tools/**/*.test.ts",
      "eval/**/*.test.ts",
      "config/**/*.test.ts",
      "llm/**/*.test.ts",
      "compaction/**/*.test.ts",
      "util/**/*.test.ts",
      "skills/**/*.test.ts",
      "jev/**/*.test.ts",
      "context/providers/**/*.test.ts",
      "edit/**/*.test.ts",
      "diff/**/*.test.ts",
      "i18n/**/*.test.ts",
      "promptFiles/**/*.test.ts",
      "protocol/**/*.test.ts",
      "auth/**/*.test.ts",
      "commands/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/test-*.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
