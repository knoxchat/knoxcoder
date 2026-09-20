import { describe, expect, it } from "vitest";

import { LABELED_TURNS } from "./fixtures/labeledTurns";
import { resolveJevRuntime } from "./config";
import { evaluateAgentTurn } from "./turn";
import type { JevClient } from "./types";
import type { SkillInfo } from "../skills/types";

function skill(name: string, description: string): SkillInfo {
  return {
    name,
    description,
    location: `/tmp/${name}/SKILL.md`,
    content: "# body",
  };
}

const roster: SkillInfo[] = [
  skill("qemu", "Boot and debug QEMU guests"),
  skill("rust", "Cargo check, clippy, and borrowck repair"),
  skill("linux-kernel", "Kernel, kbuild, and mm/ paths"),
];

describe("labeled turns (question regression, no network)", () => {
  for (const labeled of LABELED_TURNS) {
    it(labeled.id, async () => {
      const client: JevClient = {
        async systemOne() {
          return { model: "jev-1.13.0", answers: labeled.answers };
        },
      };
      const judgment = await evaluateAgentTurn({
        userMessage: labeled.userMessage,
        skills: roster,
        hasViewRead: labeled.hasViewRead ?? true,
        runtime: {
          ...resolveJevRuntime({ enabled: true }),
          apiKey: "test-key",
        },
        client,
      });
      if (labeled.expect.shouldUseViewRead !== undefined) {
        expect(judgment.shouldUseViewRead).toBe(labeled.expect.shouldUseViewRead);
      }
      if (labeled.expect.skillName !== undefined) {
        expect(judgment.skillName ?? null).toBe(labeled.expect.skillName);
      }
      if (labeled.expect.guardrailAction) {
        expect(judgment.guardrail?.action).toBe(labeled.expect.guardrailAction);
      }
      if (labeled.expect.source) {
        expect(judgment.source).toBe(labeled.expect.source);
      }
      if (labeled.expect.route) {
        expect(judgment.route).toBe(labeled.expect.route);
      }
    });
  }
});
