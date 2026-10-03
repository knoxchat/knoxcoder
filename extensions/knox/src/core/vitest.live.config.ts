import { defineConfig } from "vitest/config";

import base from "./vitest.config";

// Opt-in live-model eval (needs KNOX_EVAL_API_KEY). See eval/live.eval.ts.
export default defineConfig({
  root: base.root,
  resolve: base.resolve,
  test: {
    include: ["eval/live.eval.ts"],
    testTimeout: 30 * 60_000,
  },
});
