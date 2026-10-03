import * as assert from "node:assert";

import { pickInlineCompletionModel } from "./knoxInlineCompletion";
import { InlineCompletionStats } from "./inlineCompletionStats";

suite("K-051 inline completion stats and model route", () => {
  test("acceptance rate and latency percentiles", () => {
    const s = new InlineCompletionStats();
    assert.strictEqual(s.snapshot().acceptanceRate, 0);
    for (const ms of [100, 200, 300, 400, 1000]) {
      s.recordRequest();
      s.recordLatency(ms);
      s.recordShown();
    }
    s.recordAccepted();
    s.recordAccepted();
    const snap = s.snapshot();
    assert.strictEqual(snap.requests, 5);
    assert.strictEqual(snap.acceptanceRate, 0.4);
    assert.strictEqual(snap.latencyP50Ms, 300);
    assert.strictEqual(snap.latencyP95Ms, 1000);
    assert.ok(s.format().includes("40.0%"));
  });

  test("a configured completion model wins, else edit, chat, first", () => {
    type M = { title: string };
    const small = { title: "small" };
    const edit = { title: "edit" };
    const chat = { title: "chat" };
    const models: M[] = [chat, small];
    assert.strictEqual(
      pickInlineCompletionModel<M>({ edit, chat, models, preferredTitle: "small" }),
      small,
    );
    assert.strictEqual(
      pickInlineCompletionModel<M>({ edit, chat, models, preferredTitle: "gone" }),
      edit,
    );
    assert.strictEqual(pickInlineCompletionModel<M>({ chat, models }), chat);
  });
});
