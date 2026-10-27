/**
 * P7.6 live eval of recipe-shaped work (manual). Sign in with Knox OAuth, then:
 *   cd extensions/knox && npm run test:live:recipes
 *
 * No `KNOX_API_KEY` / `.env`. Skipped when not signed in. Writes
 * eval/results/recipe-live-<model>.json with match / replay / wrong-reuse
 * placeholders — the engine golden + soak cover those numbers without a model.
 * This file scores whether a live model can still do the work recipes reuse.
 *
 * Manual recipe loop (in the editor, recipes on, autoReplay=ask):
 *   1. Add a lint script, wait for the check, Accept.
 *   2. Fix a failing test the same way.
 *   3. Create a Button component, then a Card component.
 * Record whether the second request reused / previewed / missed, and any revert.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { apiBase } from "../auth/knoxOAuth";
import { resolveSession } from "../cli/credentials";
import { buildSystemPrompt } from "../llm/systemPrompt";
import { LIVE_EVAL_CATALOG, runAgentEval } from "./harness";
import { createLiveLlm } from "./liveLlm";
import { noShell, type LiveTask } from "./liveTasks";

const apiKey = resolveSession()?.apiKey;
const model = process.env.KNOX_LIVE_MODEL || "openai/gpt-6-luna";

const RECIPE_LIVE_TASKS: LiveTask[] = [
  {
    id: "recipe-lint-script",
    prompt: 'Add an npm script named "lint" to package.json that runs "eslint .". Do not change anything else.',
    workspace: {
      "package.json": `{ "name": "app", "scripts": { "test": "vitest" } }\n`,
    },
    check: (r) => {
      const pkg = r.files["package.json"] ?? "";
      const pass = /"lint"\s*:\s*"eslint\s+\."/.test(pkg) && /"test"\s*:\s*"vitest"/.test(pkg);
      return { pass, reason: pass ? undefined : "lint script missing or test script changed" };
    },
  },
  {
    id: "recipe-fix-failing-test",
    prompt: "`npm test` fails. Fix add() so the test passes. Do not change the test file.",
    workspace: {
      "src/add.ts": "export function add(a: number, b: number): number {\n  return a - b;\n}\n",
      "src/add.test.ts":
        'import { add } from "./add";\ntest("adds", () => expect(add(2, 2)).toBe(4));\n',
    },
    evaluateCommand: async (_args, files) => {
      const src = files["src/add.ts"] ?? "";
      const pass = /return a \+ b/.test(src) && !/return a - b/.test(src);
      return [
        {
          name: "Terminal",
          description: pass ? "exit 0" : "exit 1",
          content: pass
            ? "Exit: 0\nDuration: 1ms\n\nPASS src/add.test.ts (1 test)"
            : "Exit: 1\nDuration: 1ms\n\nFAIL src/add.test.ts\n  add(2, 2): expected 4, received 0",
        },
      ];
    },
    check: (r) => {
      const fixed = /return a \+ b/.test(r.files["src/add.ts"] ?? "");
      const testUntouched = /toBe\(4\)/.test(r.files["src/add.test.ts"] ?? "");
      const pass = fixed && testUntouched;
      return { pass, reason: pass ? undefined : `fixed=${fixed} testUntouched=${testUntouched}` };
    },
  },
  {
    id: "recipe-create-component",
    prompt: "Create a React function component named Button in src/components/Button.tsx that renders the text Button.",
    workspace: { "src/components/.gitkeep": "" },
    check: (r) => {
      const src = r.files["src/components/Button.tsx"] ?? "";
      const pass = /function\s+Button/.test(src) && /Button/.test(src);
      return { pass, reason: pass ? undefined : "Button.tsx missing or has no Button component" };
    },
  },
];

describe.skipIf(!apiKey)("live eval: recipe-shaped tasks (P7.6)", () => {
  it(
    `runs ${model} on lint / test-fix / component`,
    async () => {
      const results: Array<{
        taskId: string;
        pass: boolean;
        reason?: string;
        steps: number;
        ms: number;
      }> = [];
      for (const task of RECIPE_LIVE_TASKS) {
        const live = createLiveLlm({
          apiKey: apiKey!,
          model,
          baseUrl: `${apiBase()}/v1`,
        });
        const started = Date.now();
        const r = await runAgentEval({
          prompt: task.prompt,
          workspace: task.workspace,
          llm: live.llm,
          viaChatTurn: true,
          holdCompletionWhileOracleRed: true,
          catalog: LIVE_EVAL_CATALOG,
          evaluateCommand: task.evaluateCommand ?? noShell,
          maxSteps: task.maxSteps ?? 15,
          systemPrompt: buildSystemPrompt({ systems: false }),
        });
        const verdict = task.check(r);
        results.push({
          taskId: task.id,
          pass: verdict.pass,
          reason: verdict.reason,
          steps: r.steps,
          ms: Date.now() - started,
        });
      }
      const metrics = { match: 0, replay: 0, wrongReuse: 0 };
      const dir = path.join(__dirname, "results");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, `recipe-live-${model.replace(/[^\w.-]+/g, "_")}.json`),
        JSON.stringify({ model, results, metrics }, null, 2),
      );
      console.log("[recipe-live]", JSON.stringify({ results, metrics }));
      expect(results.every((r) => r.pass)).toBe(true);
    },
    20 * 60_000,
  );
});
