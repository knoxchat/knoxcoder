import { describe, expect, it } from "vitest";

import { BuiltInToolNames } from "../tools/builtIn";
import type { DoomLoopCall } from "../agent/doomLoop";
import { resolveJevRuntime } from "./config";
import {
  assessSemanticDoom,
  detectDoomLoopWithJev,
  shouldAssessSemanticDoom,
} from "./doomSemantic";
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

function search(query: string, ok = true): DoomLoopCall {
  return {
    name: BuiltInToolNames.ExactSearch,
    args: { query },
    output: ok ? `hits for ${query}` : `no matches for ${query}`,
    ok,
  };
}

describe("shouldAssessSemanticDoom", () => {
  it("skips short traces and healthy mixed-tool progress", () => {
    expect(shouldAssessSemanticDoom([search("a"), search("b")])).toBe(false);
    expect(
      shouldAssessSemanticDoom([
        { name: BuiltInToolNames.ReadFile, args: { filepath: "a.ts" }, ok: true },
        { name: BuiltInToolNames.EditFile, args: { filepath: "a.ts" }, ok: true },
        { name: BuiltInToolNames.Build, args: { command: "make" }, ok: true },
      ]),
    ).toBe(false);
  });

  it("runs when the same tool name repeats or failures pile up", () => {
    expect(
      shouldAssessSemanticDoom([
        search("copy_to_user"),
        search("copy to user"),
        search("copy_from_user"),
      ]),
    ).toBe(true);
  });
});

describe("detectDoomLoopWithJev", () => {
  it("returns the fingerprint hit without calling Jev", async () => {
    let called = 0;
    const client: JevClient = {
      async systemOne() {
        called += 1;
        throw new Error("should not run");
      },
    };
    const same = search("copy_to_user");
    const hit = await detectDoomLoopWithJev([same, same, same], {
      runtime: runtime(),
      client,
    });
    expect(hit?.kind).toBe("repeat");
    expect(called).toBe(0);
  });

  it("flags paraphrased searches as the same failed strategy", async () => {
    const hit = await detectDoomLoopWithJev(
      [
        search("copy_to_user"),
        search("copy to user"),
        search("copy_from_user"),
      ],
      {
        userMessage: "find copy_to_user",
        runtime: runtime(),
        client: fakeClient({
          model: "jev-1.13.0",
          answers: {
            repeating_failed_strategy: { type: "noul", noul: 0.91 },
            progress_made: { type: "noul", noul: 0.12 },
          },
        }),
      },
    );
    expect(hit?.kind).toBe("same_strategy");
    expect(hit?.toolName).toBe(BuiltInToolNames.ExactSearch);
  });

  it("does not stop when Jev sees progress", async () => {
    const hit = await assessSemanticDoom({
      calls: [
        search("copy_to_user"),
        search("copy to user"),
        search("copy_from_user"),
      ],
      runtime: runtime(),
      client: fakeClient({
        model: "jev-1.13.0",
        answers: {
          repeating_failed_strategy: { type: "noul", noul: 0.8 },
          progress_made: { type: "noul", noul: 0.7 },
        },
      }),
    });
    expect(hit).toBeNull();
  });

  it("skips Jev when doom-loop is disabled", async () => {
    let called = 0;
    const hit = await detectDoomLoopWithJev(
      [search("a"), search("b"), search("c")],
      {
        threshold: null,
        runtime: runtime(),
        client: {
          async systemOne() {
            called += 1;
            throw new Error("nope");
          },
        },
      },
    );
    expect(hit).toBeNull();
    expect(called).toBe(0);
  });

  it("fails open to no-hit when the client throws", async () => {
    const hit = await assessSemanticDoom({
      calls: [search("a"), search("b"), search("c")],
      runtime: { ...runtime(), failOpen: true },
      client: fakeClient(new Error("timeout")),
    });
    expect(hit).toBeNull();
  });
});
