import { describe, expect, it } from "vitest";

import { scoreMessages } from "../compaction/contextPruner";
import type { ChatMessage } from "..";
import { resolveJevRuntime } from "./config";
import { rescoreMessagesWithJev } from "./compactionScore";
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

function messages(): ChatMessage[] {
  return [
    { role: "system", content: "You are a coding assistant." },
    { role: "user", content: "Fix add() so cargo test passes" },
    { role: "assistant", content: "I will look at weather in Paris for some reason." },
    { role: "user", content: "Stay on the add() bug" },
  ];
}

describe("rescoreMessagesWithJev", () => {
  it("leaves heuristic scores alone when Jev is off", async () => {
    const scored = scoreMessages(messages(), "gpt-4o", 2);
    const rescored = await rescoreMessagesWithJev(scored, {
      runtime: resolveJevRuntime({ enabled: false }),
    });
    expect(rescored).toEqual(scored);
  });

  it("blends Jev scores onto the unprotected shortlist", async () => {
    const scored = scoreMessages(messages(), "gpt-4o", 1);
    const unprotected = scored.filter((item) => !item.isProtected);
    expect(unprotected.length).toBeGreaterThan(0);

    const answers: JevSystemOneResult["answers"] = {};
    for (let i = 0; i < unprotected.slice(0, 8).length; i++) {
      answers[`relevance_${i}`] = { type: "score", score: 0, confidence: 0.9 };
    }

    const rescored = await rescoreMessagesWithJev(scored, {
      query: "Fix add() so cargo test passes",
      runtime: runtime(),
      client: fakeClient({ model: "jev-1.13.0", answers }),
    });
    const dropped = rescored.find(
      (item) =>
        !item.isProtected &&
        typeof item.message.content === "string" &&
        item.message.content.includes("Paris"),
    );
    expect(dropped).toBeDefined();
    expect(dropped!.relevanceScore).toBeLessThan(
      scored.find((item) => item.index === dropped!.index)!.relevanceScore + 0.01,
    );
  });

  it("fails open to heuristic scores", async () => {
    const scored = scoreMessages(messages(), "gpt-4o", 1);
    const rescored = await rescoreMessagesWithJev(scored, {
      runtime: { ...runtime(), failOpen: true },
      client: fakeClient(new Error("down")),
    });
    expect(rescored).toEqual(scored);
  });
});
