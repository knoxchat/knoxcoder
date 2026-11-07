/**
 * MEM-79: LongMemEval / LoCoMo adapters plus a synthetic accuracy run.
 */
import { describe, expect, it } from "vitest";

import { gateAccuracy } from "../gate";
import {
  anonymizeHeldOutText,
  loadAccuracyCases,
  normalizeLoCoMo,
  normalizeLongMemEval,
  SYNTHETIC_ACCURACY_CASES,
} from "./adapters";
import { lexicalGrade } from "./grader";
import { loadAccuracyBaseline, runAccuracyBench } from "./runAccuracyBench";

describe("MEM-79 accuracy adapters", () => {
  it("normalizes LongMemEval and LoCoMo shapes without vendoring datasets", () => {
    const lme = normalizeLongMemEval([
      {
        question_id: "q1",
        question: "what is the token policy",
        answer: "JWT refresh",
        haystack_sessions: [[{ role: "user", content: "we use JWT refresh tokens" }]],
      },
    ]);
    expect(lme).toHaveLength(1);
    expect(lme[0].suite).toBe("longmemeval");
    expect(lme[0].memories[0].content).toContain("JWT");

    const locomo = normalizeLoCoMo({
      conversation: { turns: [{ speaker: "A", text: "Postgres is primary" }] },
      qa: [{ question: "which database", answer: "Postgres" }],
    });
    expect(locomo).toHaveLength(1);
    expect(locomo[0].suite).toBe("locomo");
  });

  it("anonymizes held-out sessions before they enter a number", () => {
    expect(anonymizeHeldOutText("mail a@b.com at /Users/knox/secret")).toBe(
      "mail [email] at [home]/secret",
    );
  });

  it("skips missing dataset paths and still has the synthetic fixture", () => {
    const loaded = loadAccuracyCases({});
    expect(loaded.cases.some((c) => c.suite === "synthetic")).toBe(true);
    expect(loaded.skipped.some((s) => s.includes("longmemeval"))).toBe(true);
  });

  it("grades retrieved context lexically (no neural judge)", () => {
    const hit = lexicalGrade(
      "Login issues a JWT refresh token in an httpOnly cookie",
      "JWT refresh token httpOnly cookie",
    );
    expect(hit.score).toBeGreaterThan(0.8);
    expect(lexicalGrade("unrelated", "JWT refresh").score).toBeLessThan(0.3);
  });

  it(
    "synthetic accuracy does not regress vs the previous release",
    async () => {
      const report = await runAccuracyBench(SYNTHETIC_ACCURACY_CASES);
      console.log("[accuracy-bench]", JSON.stringify({
        overall: report.overall,
        skipped: report.skipped,
        cases: report.cases.map((c) => ({ id: c.id, score: c.score })),
      }));
      expect(report.overall).toBeGreaterThan(0);
      const previous = loadAccuracyBaseline();
      const gate = gateAccuracy(report, previous);
      expect(gate.ok, gate.failures.join("; ")).toBe(true);
    },
    60_000,
  );
});
