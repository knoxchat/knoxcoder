import { describe, expect, it } from "vitest";

import {
  composeAutoProfile,
  confirmAutoProfile,
  shouldConfirmAutoProfile,
} from "./profileConfirm";
import { resolveJevRuntime, getJevConfirmedProfile } from "./config";
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

describe("shouldConfirmAutoProfile", () => {
  it("asks Jev when kernel and Cargo.toml both match", () => {
    expect(
      shouldConfirmAutoProfile("auto", { systems: true, cargo: true }),
    ).toBe(true);
  });

  it("asks Jev when auto has no workspace hint", () => {
    expect(shouldConfirmAutoProfile("auto", false)).toBe(true);
  });

  it("does not ask when the profile is explicit", () => {
    expect(
      shouldConfirmAutoProfile("systems", { systems: true, cargo: true }),
    ).toBe(false);
  });

  it("does not ask when auto already resolved unambiguously", () => {
    expect(shouldConfirmAutoProfile("auto", { cargo: true })).toBe(false);
    expect(shouldConfirmAutoProfile("auto", { systems: true })).toBe(false);
  });
});

describe("composeAutoProfile", () => {
  it("lets Jev pick rust when workspace hints disagree", () => {
    expect(
      composeAutoProfile({
        heuristic: "systems",
        hintsDisagree: true,
        choice: "rust",
        confidence: 0.88,
        difficulty: 1.8,
      }),
    ).toBe("rust");
  });

  it("stays on the heuristic when confidence is low", () => {
    expect(
      composeAutoProfile({
        heuristic: "systems",
        hintsDisagree: true,
        choice: "rust",
        confidence: 0.2,
      }),
    ).toBe("systems");
  });

  it("escalates default auto when difficulty is high", () => {
    expect(
      composeAutoProfile({
        heuristic: "default",
        hintsDisagree: false,
        choice: "systems",
        confidence: 0.8,
        difficulty: 1.7,
      }),
    ).toBe("systems");
  });
});

describe("confirmAutoProfile", () => {
  it("returns explicit profiles without calling Jev", async () => {
    const profile = await confirmAutoProfile({
      setting: "rust",
      workspaceHints: { systems: true, cargo: true },
      userMessage: "fix copy_to_user",
      runtime: runtime(),
      client: fakeClient(new Error("should not be called")),
    });
    expect(profile).toBe("rust");
    expect(getJevConfirmedProfile()).toBeUndefined();
  });

  it("stores a rust confirm for mixed kernel+Cargo trees", async () => {
    const profile = await confirmAutoProfile({
      setting: "auto",
      workspaceHints: { systems: true, cargo: true },
      userMessage: "Fix the E0502 in rust/kernel/sync.rs",
      runtime: runtime(),
      client: fakeClient({
        model: "jev-1.13.0",
        answers: {
          profile: { type: "choice", choice: "rust", confidence: 0.91 },
          difficulty: { type: "score", score: 1.8, confidence: 0.85 },
        },
      }),
    });
    expect(profile).toBe("rust");
    expect(getJevConfirmedProfile()).toBe("rust");
  });

  it("fails open to the kernel-wins heuristic", async () => {
    const profile = await confirmAutoProfile({
      setting: "auto",
      workspaceHints: { systems: true, cargo: true },
      userMessage: "fix it",
      runtime: { ...runtime(), failOpen: true },
      client: fakeClient(new Error("timeout")),
    });
    expect(profile).toBe("systems");
  });
});
