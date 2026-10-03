/**
 * Live-model comparison of `runAgentLoop` vs `runChatTurn` (K-010).
 *
 *   knox login            (OAuth, once; see cli/main.ts)
 *   npm run test:live
 *
 * Uses the signed-in KnoxChat session from `~/.knoxcoder/auth.json`. No API
 * keys or env vars. Skipped when not signed in. Writes eval/results/live-<model>.json.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { calculateCost } from "../llm/tokenTracking";
import { apiBase } from "../auth/knoxOAuth";
import { loadSession } from "../cli/credentials";
import { buildSystemPrompt } from "../llm/systemPrompt";
import type { Tool } from "..";
import { allTools } from "../tools";
import { LIVE_EVAL_CATALOG, runAgentEval } from "./harness";
import { createLiveLlm } from "./liveLlm";
import {
  checkTrend,
  compareParity,
  parseHistory,
  renderReport,
  toHistoryEntry,
  type LivePath,
  type LiveRun,
} from "./liveReport";
import { LIVE_TASKS, noShell } from "./liveTasks";

const apiKey = loadSession()?.apiKey;
// KNOX_LIVE_MODEL / KNOX_LIVE_RUNS pick the model and repeats. With
// KNOX_LIVE_DEFER=1 the chat-turn column runs with deferred tool loading (K-021)
// against the full product catalog (both paths see it), so the report compares full vs deferred schemas.
const model = process.env.KNOX_LIVE_MODEL || "openai/gpt-5.4-mini";
const runsPerTask = Number(process.env.KNOX_LIVE_RUNS) || 3;
const defer = process.env.KNOX_LIVE_DEFER === "1";
const allowedDrop = 1;

describe.skipIf(!apiKey)("live eval: loop vs chat turn", () => {
  it(
    `compares ${model} on both paths`,
    async () => {
      const results: LiveRun[] = [];
      for (const task of LIVE_TASKS) {
        for (let i = 0; i < runsPerTask; i++) {
          for (const p of ["loop", "chatTurn"] as LivePath[]) {
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
              viaChatTurn: p === "chatTurn",
              ...(defer
                ? {
                    catalog: allTools as Tool[],
                    deferTools: p === "chatTurn",
                  }
                : { catalog: LIVE_EVAL_CATALOG }),
              evaluateCommand: task.evaluateCommand ?? noShell,
              maxSteps: task.maxSteps ?? 15,
              systemPrompt: buildSystemPrompt({ systems: false }),
            });
            const verdict = task.check(r);
            results.push({
              taskId: task.id,
              path: p,
              pass: verdict.pass,
              reason: verdict.reason,
              stoppedReason: r.stoppedReason,
              steps: r.steps,
              promptTokens: live.usage.promptTokens,
              completionTokens: live.usage.completionTokens,
              ms: Date.now() - started,
            });
          }
        }
      }
      const verdict = compareParity(results, allowedDrop);
      const dir = path.join(__dirname, "results");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, `live-${model.replace(/[^\w.-]/g, "_")}${defer ? "-defer" : ""}.json`),
        JSON.stringify({ model, runsPerTask, results, verdict }, null, 2),
      );
      console.log("\n" + renderReport(results, verdict));

      // K-053: append to the per-model history and flag regressions against the last entry.
      const chat = results.filter((r) => r.path === "chatTurn");
      const cost = calculateCost(
        model,
        chat.reduce((a, r) => a + r.promptTokens, 0),
        chat.reduce((a, r) => a + r.completionTokens, 0),
      ).totalCost;
      const entry = toHistoryEntry(chat, {
        date: new Date().toISOString(),
        model,
        variant: defer ? "defer" : "full",
        costUsd: cost,
      });
      const historyFile = path.join(dir, "history.jsonl");
      const history = fs.existsSync(historyFile)
        ? parseHistory(fs.readFileSync(historyFile, "utf8"))
        : [];
      const trend = checkTrend(history, entry);
      fs.appendFileSync(historyFile, `${JSON.stringify(entry)}\n`);
      console.log(
        `trend: ${trend.ok ? "OK" : "REGRESSED"} ${JSON.stringify(trend)}`,
      );
      expect(verdict.ok).toBe(true);
      expect(trend.ok).toBe(true);
    },
    30 * 60_000,
  );
});
