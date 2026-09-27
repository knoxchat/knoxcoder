import { describe, expect, it } from "vitest";

import { resolveJevRuntime } from "./config";
import { skillGateAnswers } from "./fixtures/labeledTurns";
import {
  firstPassSkillHint,
  pickRerankWinner,
  rankSkillShortlist,
  skillGateScore,
  suggestSkill,
} from "./skillSuggest";
import type { JevClient, JevSystemOneResult } from "./types";
import type { SkillInfo } from "../skills/types";

function skill(name: string, description: string, content = "# body"): SkillInfo {
  return {
    name,
    description,
    location: `/tmp/${name}/SKILL.md`,
    content,
  };
}

const qemu = skill("qemu", "Boot and debug QEMU guests", "Boot a guest and attach GDB.");
const rust = skill("rust", "Cargo check, clippy, and borrowck repair");
const kbuild = skill("linux-kernel", "Kernel, kbuild, and mm/ paths");

function runtime() {
  return {
    ...resolveJevRuntime({ enabled: true }),
    apiKey: "test-key",
  };
}

describe("rankSkillShortlist", () => {
  it("stays quiet when the three-noul gate mean is below the threshold", () => {
    expect(
      rankSkillShortlist(
        {
          ...skillGateAnswers(0.2),
          skill: { type: "choice", choice: "qemu", confidence: 0.9 },
        },
        [qemu, rust],
      ),
    ).toEqual([]);
  });

  it("inverts prose_suffices before averaging", () => {
    expect(skillGateAnswers(0).prose_suffices.noul).toBe(1);
    expect(skillGateScore(skillGateAnswers(0))).toBeCloseTo(0);
    expect(skillGateScore(skillGateAnswers(1))).toBeCloseTo(1);
  });

  it("ranks by Choice probabilities, not only argmax", () => {
    const shortlist = rankSkillShortlist(
      {
        ...skillGateAnswers(0.8),
        skill: {
          type: "choice",
          choice: "linux-kernel",
          confidence: 0.6,
          probabilities: {
            "linux-kernel": 0.45,
            qemu: 0.4,
            rust: 0.15,
          },
        },
      },
      [qemu, rust, kbuild],
    );
    expect(shortlist.map((item) => item.name)).toEqual([
      "linux-kernel",
      "qemu",
      "rust",
    ]);
  });
});

describe("pickRerankWinner", () => {
  it("drops the shortlist when every fits noul is below the threshold", () => {
    expect(
      pickRerankWinner(
        {
          which: { type: "choice", choice: "qemu", confidence: 0.7 },
          "fits::qemu": { type: "noul", noul: 0.1 },
          "fits::rust": { type: "noul", noul: 0.12 },
        },
        [qemu, rust],
      ),
    ).toBeUndefined();
  });

  it("uses the Choice winner when a skill actually fits", () => {
    expect(
      pickRerankWinner(
        {
          which: { type: "choice", choice: "qemu", confidence: 0.8 },
          "fits::qemu": { type: "noul", noul: 0.7 },
          "fits::rust": { type: "noul", noul: 0.8 },
        },
        [qemu, rust],
      )?.name,
    ).toBe("qemu");
  });
});

describe("suggestSkill", () => {
  it("re-reads the top skills and can flip the first-pass winner", async () => {
    const calls: string[] = [];
    const client: JevClient = {
      async systemOne(request) {
        calls.push(Object.keys(request.questions).sort().join(","));
        return {
          model: "jev-1.13.0",
          answers: {
            which: { type: "choice", choice: "qemu", confidence: 0.84 },
            "fits::qemu": { type: "noul", noul: 0.72 },
            "fits::rust": { type: "noul", noul: 0.2 },
          },
        };
      },
    };
    const suggested = await suggestSkill({
      answers: {
        ...skillGateAnswers(0.9),
        skill: {
          type: "choice",
          choice: "rust",
          confidence: 0.55,
          probabilities: { rust: 0.52, qemu: 0.48 },
        },
      },
      skills: [qemu, rust],
      userMessage: "QEMU guest panics after boot",
      client,
      runtime: runtime(),
    });
    expect(suggested.skillName).toBe("qemu");
    expect(suggested.skillHint).toContain("<skill_relevance>");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("fits::qemu");
  });

  it("suggests nothing when the second pass rejects every candidate", async () => {
    const client: JevClient = {
      async systemOne(): Promise<JevSystemOneResult> {
        return {
          model: "jev-1.13.0",
          answers: {
            which: { type: "choice", choice: "rust", confidence: 0.4 },
            "fits::rust": { type: "noul", noul: 0.1 },
          },
        };
      },
    };
    const suggested = await suggestSkill({
      answers: {
        ...skillGateAnswers(0.8),
        skill: { type: "choice", choice: "rust", confidence: 0.7 },
      },
      skills: [rust],
      userMessage: "rename foo to bar",
      client,
      runtime: runtime(),
    });
    expect(suggested.skillHint).toContain(
      "No skill in the roster appears relevant",
    );
    expect(suggested.skillName).toBeUndefined();
  });

  it("falls back to the first-pass winner when rerank errors fail-open", async () => {
    const client: JevClient = {
      async systemOne() {
        throw new Error("timeout");
      },
    };
    const suggested = await suggestSkill({
      answers: {
        ...skillGateAnswers(0.9),
        skill: { type: "choice", choice: "qemu", confidence: 0.9 },
      },
      skills: [qemu],
      userMessage: "debug qemu",
      client,
      runtime: { ...runtime(), failOpen: true },
    });
    expect(suggested.skillName).toBe("qemu");
    expect(firstPassSkillHint(
      {
        ...skillGateAnswers(0.9),
        skill: { type: "choice", choice: "qemu", confidence: 0.9 },
      },
      [qemu],
    ).skillName).toBe("qemu");
  });

  it("skips the rerank round-trip when the first-pass timeout is already spent", async () => {
    let calls = 0;
    const client: JevClient = {
      async systemOne() {
        calls += 1;
        throw new Error("should not rerank");
      },
    };
    const suggested = await suggestSkill({
      answers: {
        ...skillGateAnswers(0.9),
        skill: { type: "choice", choice: "qemu", confidence: 0.9 },
      },
      skills: [qemu],
      userMessage: "debug qemu",
      client,
      runtime: runtime(),
      timeoutMs: 100,
    });
    expect(calls).toBe(0);
    expect(suggested.skillName).toBe("qemu");
  });
});
