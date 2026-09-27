import * as assert from "node:assert";

import {
  buildFimPrompt,
  ENABLE_INLINE_COMPLETIONS_DEFAULT,
  ENABLE_INLINE_COMPLETIONS_SETTING,
  INLINE_COMPLETION_COMPLETE_OPTIONS,
  INLINE_COMPLETION_EXCLUDED_SCHEMES,
  INLINE_COMPLETION_MAX_CHARS,
  INLINE_COMPLETION_MAX_FILE_CHARS,
  INLINE_COMPLETION_PREFIX_LINES,
  INLINE_COMPLETION_SUFFIX_LINES,
  INLINE_COMPLETION_TRIGGER_AUTOMATIC,
  INLINE_COMPLETION_TRIGGER_EXPLICIT,
  isInlineCompletionsEnabled,
  pickInlineCompletionModel,
  sanitizeCompletion,
  shouldProvideInlineCompletion,
  slicePrefixSuffix,
  stripPrefixOverlap,
} from "./knoxInlineCompletion";

suite("KN-363 optional inline completions", () => {
  test("setting is off by default and keeps the knoxchat id", () => {
    assert.strictEqual(
      ENABLE_INLINE_COMPLETIONS_SETTING,
      "knoxchat.enableInlineCompletions",
    );
    assert.strictEqual(ENABLE_INLINE_COMPLETIONS_DEFAULT, false);
    assert.strictEqual(isInlineCompletionsEnabled(undefined), false);
    assert.strictEqual(isInlineCompletionsEnabled(false), false);
    assert.strictEqual(isInlineCompletionsEnabled("true"), false);
    assert.strictEqual(isInlineCompletionsEnabled(true), true);
    assert.strictEqual(INLINE_COMPLETION_PREFIX_LINES, 40);
    assert.strictEqual(INLINE_COMPLETION_SUFFIX_LINES, 12);
    assert.strictEqual(INLINE_COMPLETION_MAX_CHARS, 800);
    assert.strictEqual(INLINE_COMPLETION_COMPLETE_OPTIONS.maxTokens, 128);
    assert.strictEqual(INLINE_COMPLETION_COMPLETE_OPTIONS.temperature, 0.1);
    assert.deepStrictEqual([...INLINE_COMPLETION_EXCLUDED_SCHEMES], [
      "output",
      "comment",
      "git",
      "knox",
      "debug",
      "vscode",
    ]);
  });

  test("shouldProvideInlineCompletion requires the setting and skips output/git/huge files", () => {
    const file = {
      enabled: true,
      scheme: "file",
      documentChars: 100,
      triggerKind: INLINE_COMPLETION_TRIGGER_EXPLICIT,
      atWord: false,
      atLineStart: false,
    };
    assert.strictEqual(shouldProvideInlineCompletion(file), true);
    assert.strictEqual(
      shouldProvideInlineCompletion({ ...file, enabled: false }),
      false,
    );
    assert.strictEqual(
      shouldProvideInlineCompletion({ ...file, scheme: "output" }),
      false,
    );
    assert.strictEqual(
      shouldProvideInlineCompletion({ ...file, scheme: "git" }),
      false,
    );
    assert.strictEqual(
      shouldProvideInlineCompletion({
        ...file,
        documentChars: INLINE_COMPLETION_MAX_FILE_CHARS + 1,
      }),
      false,
    );
  });

  test("automatic trigger skips empty line starts unless a word is present", () => {
    const auto = {
      enabled: true,
      scheme: "file",
      documentChars: 20,
      triggerKind: INLINE_COMPLETION_TRIGGER_AUTOMATIC,
      atWord: false,
      atLineStart: true,
    };
    assert.strictEqual(shouldProvideInlineCompletion(auto), false);
    assert.strictEqual(
      shouldProvideInlineCompletion({ ...auto, atWord: true }),
      true,
    );
    assert.strictEqual(
      shouldProvideInlineCompletion({ ...auto, atLineStart: false }),
      true,
    );
    assert.strictEqual(
      shouldProvideInlineCompletion({
        ...auto,
        triggerKind: INLINE_COMPLETION_TRIGGER_EXPLICIT,
      }),
      true,
    );
  });

  test("slicePrefixSuffix keeps cursor-relative prefix and suffix windows", () => {
    const lines = ["a", "bbXcc", "d", "e"];
    const sliced = slicePrefixSuffix({
      lines,
      line: 1,
      character: 2,
      prefixLineCount: 1,
      suffixLineCount: 1,
    });
    assert.strictEqual(sliced.prefix, "a\nbb");
    assert.strictEqual(sliced.suffix, "Xcc\nd");
  });

  test("buildFimPrompt asks for completion text only", () => {
    const prompt = buildFimPrompt("typescript", "const x =", "\n}");
    assert.ok(prompt.includes("Language: typescript"));
    assert.ok(prompt.includes("<<<PREFIX>>>\nconst x ="));
    assert.ok(prompt.includes("<<<SUFFIX>>>\n\n}"));
    assert.ok(prompt.endsWith("<<<COMPLETION>>>"));
    assert.ok(!prompt.includes("```"));
  });

  test("sanitizeCompletion strips fences, prefix overlap, and long tails", () => {
    assert.strictEqual(
      sanitizeCompletion("```ts\nfoo();\n```", ""),
      "foo();",
    );
    assert.strictEqual(
      stripPrefixOverlap("const x = 1;", "const x"),
      " = 1;",
    );
    assert.strictEqual(
      sanitizeCompletion("const x = 1;", "const x"),
      " = 1;",
    );
    const long = "a".repeat(INLINE_COMPLETION_MAX_CHARS + 50);
    assert.strictEqual(
      sanitizeCompletion(long, "").length,
      INLINE_COMPLETION_MAX_CHARS,
    );
    assert.strictEqual(sanitizeCompletion("   \n", ""), "");
  });

  test("pickInlineCompletionModel prefers edit, then chat, then first model", () => {
    assert.strictEqual(
      pickInlineCompletionModel({
        edit: "edit",
        chat: "chat",
        models: ["first"],
      }),
      "edit",
    );
    assert.strictEqual(
      pickInlineCompletionModel({ chat: "chat", models: ["first"] }),
      "chat",
    );
    assert.strictEqual(
      pickInlineCompletionModel({ models: ["first"] }),
      "first",
    );
    assert.strictEqual(pickInlineCompletionModel({}), undefined);
  });
});
