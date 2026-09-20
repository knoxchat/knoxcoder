import { describe, expect, it } from "vitest";

import { evaluateAgentTurn } from "./turn";
import { resolveJevRuntime } from "./config";
import { escalateReasoningEffort } from "./questions";
import type { JevClient, JevSystemOneResult } from "./types";
import type { SkillInfo } from "../skills/types";

function skill(name: string, description: string): SkillInfo {
  return {
    name,
    description,
    location: `/tmp/${name}/SKILL.md`,
    content: "# body",
  };
}

function runtime(overrides?: { failOpen?: boolean }) {
  return {
    ...resolveJevRuntime({ enabled: true, failOpen: overrides?.failOpen }),
    apiKey: "test-key",
  };
}

function fakeClient(result: JevSystemOneResult | Error): JevClient {
  return {
    async systemOne() {
      if (result instanceof Error) {
        throw result;
      }
      return result;
    },
  };
}

const qemu = skill("qemu", "Boot and debug QEMU guests");
const rust = skill("rust", "Cargo check, clippy, and borrowck repair");

describe("evaluateAgentTurn", () => {
  it("uses regex heuristics when Jev is disabled", async () => {
    const judgment = await evaluateAgentTurn({
      userMessage: "What does copy_to_user do in mm/?",
      skills: [qemu, rust],
      hasViewRead: true,
      hasContext: true,
      runtime: resolveJevRuntime({ enabled: false }),
    });
    expect(judgment.source).toBe("heuristic");
    expect(judgment.shouldUseViewRead).toBe(true);
  });

  it("uses heuristics when enabled but jev.apiKey is missing", async () => {
    const judgment = await evaluateAgentTurn({
      userMessage: "What does copy_to_user do?",
      hasViewRead: true,
      hasContext: true,
      runtime: {
        ...resolveJevRuntime({ enabled: true }),
        apiKey: "",
      },
    });
    expect(judgment.source).toBe("heuristic");
  });

  it("keeps implementation requests on chat in the heuristic fallback", async () => {
    const judgment = await evaluateAgentTurn({
      userMessage: "Fix the E0425 in src/lib.rs",
      skills: [qemu, rust],
      hasViewRead: true,
      runtime: resolveJevRuntime({ enabled: false }),
    });
    expect(judgment.shouldUseViewRead).toBe(false);
    expect(judgment.route).toBe("chat");
  });

  it("routes a confident view_read answer to the View/Read model", async () => {
    const judgment = await evaluateAgentTurn({
      userMessage: "Explain builtin_plan",
      skills: [qemu],
      hasViewRead: true,
      runtime: runtime(),
      client: fakeClient({
        model: "jev-1.13.0",
        answers: {
          route: {
            type: "choice",
            choice: "view_read",
            confidence: 0.92,
          },
          needs_mutation: { type: "noul", noul: 0.05 },
          difficulty: { type: "score", score: 0.2, confidence: 0.8 },
          need_skill: { type: "noul", noul: 0.1 },
          skill: { type: "choice", choice: "none", confidence: 0.9 },
        },
      }),
    });
    expect(judgment.source).toBe("jev");
    expect(judgment.shouldUseViewRead).toBe(true);
    expect(judgment.skillHint).toBe("");
  });

  it("overrides view_read when the turn needs a mutation", async () => {
    const judgment = await evaluateAgentTurn({
      userMessage: "What is copy_to_user, then patch it",
      hasViewRead: true,
      runtime: runtime(),
      client: fakeClient({
        model: "jev-1.13.0",
        answers: {
          route: {
            type: "choice",
            choice: "view_read",
            confidence: 0.8,
          },
          needs_mutation: { type: "noul", noul: 0.88 },
          difficulty: { type: "score", score: 1.0, confidence: 0.7 },
          need_skill: { type: "noul", noul: 0.2 },
          skill: { type: "choice", choice: "none", confidence: 0.7 },
        },
      }),
    });
    expect(judgment.shouldUseViewRead).toBe(false);
    expect(judgment.reason).toMatch(/needs_mutation/);
  });

  it("stays on chat when route confidence is low", async () => {
    const judgment = await evaluateAgentTurn({
      userMessage: "hmm",
      hasViewRead: true,
      runtime: runtime(),
      client: fakeClient({
        model: "jev-1.13.0",
        answers: {
          route: { type: "choice", choice: "view_read", confidence: 0.2 },
          needs_mutation: { type: "noul", noul: 0.1 },
          difficulty: { type: "score", score: 0.1, confidence: 0.2 },
          need_skill: { type: "noul", noul: 0.1 },
          skill: { type: "choice", choice: "none", confidence: 0.2 },
        },
      }),
    });
    expect(judgment.shouldUseViewRead).toBe(false);
    expect(judgment.reason).toMatch(/confidence/);
  });

  it("uses heuristics for CJK-heavy turns with low Jev confidence", async () => {
    const judgment = await evaluateAgentTurn({
      userMessage: "这个函数 copy_to_user 在内核里是做什么的，请详细解释一下实现",
      hasViewRead: true,
      hasContext: true,
      runtime: runtime(),
      client: fakeClient({
        model: "jev-1.13.0",
        answers: {
          route: { type: "choice", choice: "chat", confidence: 0.3 },
          needs_mutation: { type: "noul", noul: 0.1 },
          difficulty: { type: "score", score: 0.2, confidence: 0.3 },
          need_skill: { type: "noul", noul: 0.1 },
          skill: { type: "choice", choice: "none", confidence: 0.3 },
        },
      }),
    });
    expect(judgment.source).toBe("heuristic");
  });

  it("injects at most one skill when Jev picks a roster entry", async () => {
    const judgment = await evaluateAgentTurn({
      userMessage: "QEMU guest panics after boot",
      skills: [qemu, rust],
      hasViewRead: true,
      runtime: runtime(),
      client: fakeClient({
        model: "jev-1.13.0",
        answers: {
          route: { type: "choice", choice: "chat", confidence: 0.85 },
          needs_mutation: { type: "noul", noul: 0.4 },
          difficulty: { type: "score", score: 1.8, confidence: 0.8 },
          need_skill: { type: "noul", noul: 0.9 },
          skill: { type: "choice", choice: "qemu", confidence: 0.88 },
        },
      }),
    });
    expect(judgment.skillName).toBe("qemu");
    expect(judgment.skillHint).toContain("<skill_relevance>");
    expect(judgment.skillHint).not.toContain("rust");
  });

  it("keeps a clarify route and hint instead of silently implementing", async () => {
    const judgment = await evaluateAgentTurn({
      userMessage: "do the thing with the file",
      hasViewRead: true,
      runtime: runtime(),
      client: fakeClient({
        model: "jev-1.13.0",
        answers: {
          route: { type: "choice", choice: "clarify", confidence: 0.8 },
          needs_mutation: { type: "noul", noul: 0.2 },
          difficulty: { type: "score", score: 0.3, confidence: 0.7 },
          need_skill: { type: "noul", noul: 0.05 },
          skill: { type: "choice", choice: "none", confidence: 0.9 },
        },
      }),
    });
    expect(judgment.route).toBe("clarify");
    expect(judgment.shouldUseViewRead).toBe(false);
    expect(judgment.clarifyHint).toContain("<clarify_first>");
  });

  it("preserves chat_high for systems work", async () => {
    const judgment = await evaluateAgentTurn({
      userMessage: "port this kbuild change across qemu and rust-for-linux",
      hasViewRead: true,
      runtime: runtime(),
      client: fakeClient({
        model: "jev-1.13.0",
        answers: {
          route: { type: "choice", choice: "chat_high", confidence: 0.9 },
          needs_mutation: { type: "noul", noul: 0.9 },
          difficulty: { type: "score", score: 1.8, confidence: 0.85 },
          need_skill: { type: "noul", noul: 0.4 },
          skill: { type: "choice", choice: "none", confidence: 0.7 },
        },
      }),
    });
    expect(judgment.route).toBe("chat_high");
    expect(judgment.shouldUseViewRead).toBe(false);
  });

  it("confirms rust for auto when kernel and Cargo.toml hints disagree", async () => {
    const judgment = await evaluateAgentTurn({
      userMessage: "Fix the E0502 in rust/kernel/sync.rs",
      hasViewRead: true,
      agentProfileSetting: "auto",
      workspaceHints: { systems: true, cargo: true },
      runtime: runtime(),
      client: fakeClient({
        model: "jev-1.13.0",
        answers: {
          route: { type: "choice", choice: "chat", confidence: 0.9 },
          needs_mutation: { type: "noul", noul: 0.95 },
          difficulty: { type: "score", score: 1.9, confidence: 0.85 },
          need_skill: { type: "noul", noul: 0.2 },
          skill: { type: "choice", choice: "none", confidence: 0.8 },
          profile: { type: "choice", choice: "rust", confidence: 0.9 },
        },
      }),
    });
    expect(judgment.profile).toBe("rust");
  });

  it("fails open to heuristics when the client throws", async () => {
    const judgment = await evaluateAgentTurn({
      userMessage: "What does copy_to_user do?",
      hasViewRead: true,
      hasContext: true,
      runtime: runtime({ failOpen: true }),
      client: fakeClient(new Error("timeout")),
    });
    expect(judgment.source).toBe("heuristic");
    expect(judgment.shouldUseViewRead).toBe(true);
  });

  it("rethrows when failOpen is false", async () => {
    await expect(
      evaluateAgentTurn({
        userMessage: "hello",
        hasViewRead: false,
        runtime: runtime({ failOpen: false }),
        client: fakeClient(new Error("down")),
      }),
    ).rejects.toThrow("down");
  });
});

describe("escalateReasoningEffort", () => {
  it("bumps none/low/medium up to high", () => {
    expect(escalateReasoningEffort(undefined)).toBe("high");
    expect(escalateReasoningEffort("low")).toBe("high");
    expect(escalateReasoningEffort("medium")).toBe("high");
  });

  it("does not lower xhigh or max", () => {
    expect(escalateReasoningEffort("xhigh")).toBe("xhigh");
    expect(escalateReasoningEffort("max")).toBe("max");
  });
});
