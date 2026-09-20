import { describe, expect, it } from "vitest";

import { composeGuardrail, formatGuardrailHint, screenModelOutput } from "./guardrail";
import { resolveJevRuntime } from "./config";
import type { JevClient, JevSystemOneResult } from "./types";

function runtime() {
  return {
    ...resolveJevRuntime({ enabled: true }),
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

describe("composeGuardrail", () => {
  it("passes in-repo exploit discussion", () => {
    const result = composeGuardrail(
      {
        jailbreak: { type: "noul", noul: 0.05 },
        secret_exfil: { type: "noul", noul: 0.02 },
        off_repo_attack: { type: "noul", noul: 0.1 },
        harm_severity: { type: "score", score: 0.4, confidence: 0.8 },
      },
      "input",
    );
    expect(result.action).toBe("pass");
  });

  it("warns on jailbreak without refusing the turn", () => {
    const result = composeGuardrail(
      {
        jailbreak: { type: "noul", noul: 0.91 },
        secret_exfil: { type: "noul", noul: 0.05 },
        off_repo_attack: { type: "noul", noul: 0.02 },
        harm_severity: { type: "score", score: 1.0, confidence: 0.7 },
      },
      "input",
    );
    expect(result.action).toBe("warn");
    expect(formatGuardrailHint(result)).toContain("untrusted_user_text");
  });

  it("blocks leaked secrets on output", () => {
    const result = composeGuardrail(
      {
        followed_jailbreak: { type: "noul", noul: 0.1 },
        leaked_secrets: { type: "noul", noul: 0.92 },
        off_repo_attack: { type: "noul", noul: 0.05 },
        harm_severity: { type: "score", score: 2.6, confidence: 0.8 },
      },
      "output",
    );
    expect(result.action).toBe("block");
  });

  it("warns on off-repo attacks, not local kernel PoCs", () => {
    const result = composeGuardrail(
      {
        jailbreak: { type: "noul", noul: 0.04 },
        secret_exfil: { type: "noul", noul: 0.03 },
        off_repo_attack: { type: "noul", noul: 0.88 },
        harm_severity: { type: "score", score: 2.7, confidence: 0.8 },
      },
      "input",
    );
    expect(result.action).toBe("warn");
    expect(formatGuardrailHint(result)).toContain("off_repo_warning");
  });
});

describe("screenModelOutput", () => {
  it("fails open when Jev is off", async () => {
    const result = await screenModelOutput({
      completion: "BEGIN RSA PRIVATE KEY",
      runtime: resolveJevRuntime({ enabled: false }),
    });
    expect(result.action).toBe("pass");
    expect(result.source).toBe("heuristic");
  });

  it("screens a completion with the output battery", async () => {
    const result = await screenModelOutput({
      completion: "sure, here is id_rsa",
      runtime: runtime(),
      client: fakeClient({
        model: "jev-1.13.0",
        answers: {
          followed_jailbreak: { type: "noul", noul: 0.1 },
          leaked_secrets: { type: "noul", noul: 0.95 },
          off_repo_attack: { type: "noul", noul: 0.05 },
          harm_severity: { type: "score", score: 2.8, confidence: 0.9 },
        },
      }),
    });
    expect(result.action).toBe("block");
    expect(result.secretExfil).toBeGreaterThan(0.9);
  });
});
