import * as assert from "node:assert";

import { LLM_COMPLETE_COMMAND } from "./diagnostics";
import {
  ADD_INTELLIGENT_BREAKPOINT_COMMAND,
  ANALYZE_DEBUG_SESSION_COMMAND,
  buildAnalyzeSessionPrompt,
  buildBreakpointSuggestionPrompt,
  buildDebugSnapshot,
  buildErrorAnalysisPrompt,
  coerceDebugError,
  fallbackAnalysis,
  parseAnalysisResult,
  parseBreakpointSuggestions,
  parseJsonObject,
  resolveAnalyzeDebugArgs,
  resolveIntelligentBreakpointPath,
  stringifyVariableValues,
  SUGGEST_FIX_FOR_ERROR_COMMAND,
} from "./debugIntegration";

suite("KN-353 debug integration", () => {
  test("command ids stay contributed", () => {
    assert.strictEqual(ANALYZE_DEBUG_SESSION_COMMAND, "knox.analyzeDebugSession");
    assert.strictEqual(SUGGEST_FIX_FOR_ERROR_COMMAND, "knox.suggestFixForError");
    assert.strictEqual(
      ADD_INTELLIGENT_BREAKPOINT_COMMAND,
      "knox.addIntelligentBreakpoint",
    );
    assert.strictEqual(LLM_COMPLETE_COMMAND, "knox.llmComplete");
  });

  test("stringifyVariableValues reads DAP value objects", () => {
    assert.deepStrictEqual(
      stringifyVariableValues({
        count: { value: "3", type: "number" },
        label: "ok",
        empty: null,
      }),
      { count: "3", label: "ok", empty: "" },
    );
  });

  test("buildDebugSnapshot strips frame ids and copies source path", () => {
    const snapshot = buildDebugSnapshot({
      callStack: [
        {
          id: 9,
          name: "main",
          line: 12,
          column: 4,
          source: { name: "app.ts", path: "/tmp/app.ts" },
        },
      ],
      variables: { x: { value: "1", type: "number" } },
      breakpoints: [
        {
          enabled: true,
          location: {
            uri: "file:///tmp/app.ts",
            range: {
              start: { line: 11, character: 0 },
              end: { line: 11, character: 0 },
            },
          },
        },
      ],
      error: { message: "boom" },
    });
    assert.strictEqual(snapshot.callStack[0].id, undefined);
    assert.strictEqual(snapshot.callStack[0].source?.path, "/tmp/app.ts");
    assert.strictEqual(snapshot.error?.message, "boom");
  });

  test("parseJsonObject accepts fenced JSON and embedded objects", () => {
    assert.deepStrictEqual(parseJsonObject('```json\n{"insights":"a"}\n```'), {
      insights: "a",
    });
    assert.deepStrictEqual(
      parseJsonObject('prefix {"insights":"b","suggestedFixes":[]} suffix'),
      { insights: "b", suggestedFixes: [] },
    );
    assert.strictEqual(parseJsonObject("not json"), undefined);
  });

  test("parseAnalysisResult hydrates JSON and falls back to insights text", () => {
    const parsed = parseAnalysisResult(
      JSON.stringify({
        insights: "null deref",
        suggestedFixes: [{ filePath: "/tmp/a.ts", change: "check ptr" }],
        variableValues: { p: "0x0" },
        errorAnalysis: {
          errorType: "TypeError",
          errorMessage: "null",
          probableCause: "unchecked",
          suggestedSolution: "guard",
        },
      }),
      { p: { value: "stale" } },
    );
    assert.strictEqual(parsed.insights, "null deref");
    assert.deepStrictEqual(parsed.suggestedFixes, [
      { filePath: "/tmp/a.ts", change: "check ptr" },
    ]);
    assert.strictEqual(parsed.variableValues.p, "0x0");
    assert.strictEqual(parsed.errorAnalysis?.suggestedSolution, "guard");

    const fallback = parseAnalysisResult("plain text", { x: { value: "1" } });
    assert.strictEqual(fallback.insights, "plain text");
    assert.strictEqual(fallback.variableValues.x, "1");
    assert.deepStrictEqual(fallback.suggestedFixes, []);
  });

  test("parseBreakpointSuggestions keeps 1-based integer lines", () => {
    const parsed = parseBreakpointSuggestions({
      suggestedLines: [1, 4.2, 0, "8", -1],
      condition: "i > 0",
    });
    assert.deepStrictEqual(parsed?.suggestedLines, [1, 8]);
    assert.strictEqual(parsed?.condition, "i > 0");
    assert.strictEqual(parseBreakpointSuggestions("[]"), undefined);
  });

  test("prompts mention JSON-only and include snapshot fields", () => {
    const analyze = buildAnalyzeSessionPrompt(
      buildDebugSnapshot({
        callStack: [{ name: "fn", line: 2, column: 1 }],
        variables: {},
        breakpoints: [],
      }),
    );
    assert.ok(analyze.includes("Respond with JSON only"));
    assert.ok(analyze.includes('"fn"'));

    const error = buildErrorAnalysisPrompt({
      error: { name: "Error", message: "boom" },
      callStack: [],
      variables: {},
    });
    assert.ok(error.includes("error_message"));
    assert.ok(error.includes("boom"));

    const bp = buildBreakpointSuggestionPrompt({
      filePath: "/tmp/a.ts",
      fileContent: "x()",
      language: "typescript",
      existingLines: [3],
    });
    assert.ok(bp.includes("suggestedLines"));
    assert.ok(bp.includes("/tmp/a.ts"));
  });

  test("resolveIntelligentBreakpointPath accepts string, { filePath }, and fallback", () => {
    assert.strictEqual(
      resolveIntelligentBreakpointPath("/tmp/a.ts"),
      "/tmp/a.ts",
    );
    assert.strictEqual(
      resolveIntelligentBreakpointPath({ filePath: "/tmp/b.ts" }),
      "/tmp/b.ts",
    );
    assert.strictEqual(
      resolveIntelligentBreakpointPath(undefined, "/tmp/active.ts"),
      "/tmp/active.ts",
    );
    assert.strictEqual(resolveIntelligentBreakpointPath(undefined), undefined);
  });

  test("coerceDebugError and resolveAnalyzeDebugArgs", () => {
    const fromError = coerceDebugError(new Error("fail"));
    assert.strictEqual(fromError.message, "fail");
    assert.strictEqual(coerceDebugError("plain").message, "plain");
    assert.strictEqual(
      coerceDebugError({ message: "obj" }).message,
      "obj",
    );
    assert.strictEqual(coerceDebugError(undefined).message, "Unknown error");
    assert.strictEqual(
      resolveAnalyzeDebugArgs({ selectedModelTitle: "gpt" }).selectedModelTitle,
      "gpt",
    );
    assert.strictEqual(
      resolveAnalyzeDebugArgs(undefined).selectedModelTitle,
      "default",
    );
  });

  test("fallbackAnalysis fills errorAnalysis when an error is present", () => {
    const result = fallbackAnalysis({
      insights: "could not",
      variables: { a: { value: "1" } },
      error: { name: "TypeError", message: "x" },
    });
    assert.strictEqual(result.errorAnalysis?.errorType, "TypeError");
    assert.strictEqual(result.variableValues.a, "1");
  });
});
