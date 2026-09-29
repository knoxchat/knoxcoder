import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const pkgRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: pkgRoot,
  test: {
    include: ["**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
