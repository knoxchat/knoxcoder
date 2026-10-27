import { defineConfig } from "vitest/config";

import base from "./vitest.config";

// Opt-in live-model eval for recipe-shaped tasks. Knox OAuth, no KNOX_API_KEY.
//   cd extensions/knox && npm run test:live:recipes
export default defineConfig({
  root: base.root,
  resolve: base.resolve,
  test: {
    include: ["eval/recipeLive.eval.ts"],
    testTimeout: 20 * 60_000,
  },
});
