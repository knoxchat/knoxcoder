import * as assert from "node:assert";

import {
  collectPromptFileAtMentions,
  PROMPT_BUILTIN_MENTIONS,
} from "./promptFileAtMentions";

suite("collectPromptFileAtMentions", () => {
  test("skips builtin context ids", () => {
    const mentions = collectPromptFileAtMentions(
      "Use @file and @problems then @src/app.ts",
    );
    assert.deepStrictEqual(
      mentions.map((m) => m.token),
      ["src/app.ts"],
    );
    assert.ok(PROMPT_BUILTIN_MENTIONS.has("problems"));
  });

  test("records offsets for workspace-relative paths", () => {
    const text = "See @lib/util.ts please";
    const mentions = collectPromptFileAtMentions(text);
    assert.strictEqual(mentions.length, 1);
    assert.strictEqual(mentions[0].token, "lib/util.ts");
    assert.strictEqual(
      text.slice(mentions[0].start, mentions[0].end),
      "@lib/util.ts",
    );
  });

  test("skips URL mentions", () => {
    const mentions = collectPromptFileAtMentions(
      "Docs at @https://knox.chat/x",
    );
    assert.strictEqual(mentions.length, 0);
  });
});
