import * as assert from "node:assert";

import {
  buildFixPrompt,
  CHECK_DIAGNOSTICS_COMMAND,
  computeFixedIssues,
  DiagnosticCache,
  DIAGNOSTIC_CACHE_TTL_MS,
  DiagnosticSeverity,
  FIX_DIAGNOSTICS_COMMAND,
  FixAttemptTracker,
  formatDiagnosticsForDisplay,
  isDiagnosticFixSuccess,
  issuesNeedFixing,
  languageFromFilePath,
  LLM_COMPLETE_COMMAND,
  mapSeverity,
  MAX_FIX_ATTEMPTS,
  resolveDiagnosticUri,
  resolveFixDiagnosticsArgs,
  sanitizeLlmFixOutput,
  summarizeDiagnostics,
  toDiagnosticIssue,
  toFixPromptIssues,
  VSCODE_DIAGNOSTIC_SEVERITY,
} from "./diagnostics";

function issue(
  partial: Partial<{
    filePath: string;
    message: string;
    line: number;
    character: number;
    severity: DiagnosticSeverity;
    source: string;
  }> = {},
) {
  return {
    filePath: "file:///src/a.ts",
    message: "Cannot find name 'x'",
    line: 2,
    character: 0,
    severity: DiagnosticSeverity.ERROR,
    ...partial,
  };
}

suite("KN-352 diagnostics", () => {
  test("command ids stay contributed", () => {
    assert.strictEqual(CHECK_DIAGNOSTICS_COMMAND, "knox.checkDiagnostics");
    assert.strictEqual(FIX_DIAGNOSTICS_COMMAND, "knox.fixDiagnostics");
    assert.strictEqual(LLM_COMPLETE_COMMAND, "knox.llmComplete");
    assert.strictEqual(MAX_FIX_ATTEMPTS, 3);
    assert.strictEqual(DIAGNOSTIC_CACHE_TTL_MS, 3000);
  });

  test("mapSeverity follows vscode DiagnosticSeverity numbers", () => {
    assert.strictEqual(
      mapSeverity(VSCODE_DIAGNOSTIC_SEVERITY.Error),
      DiagnosticSeverity.ERROR,
    );
    assert.strictEqual(
      mapSeverity(VSCODE_DIAGNOSTIC_SEVERITY.Warning),
      DiagnosticSeverity.WARNING,
    );
    assert.strictEqual(
      mapSeverity(VSCODE_DIAGNOSTIC_SEVERITY.Information),
      DiagnosticSeverity.INFO,
    );
    assert.strictEqual(
      mapSeverity(VSCODE_DIAGNOSTIC_SEVERITY.Hint),
      DiagnosticSeverity.HINT,
    );
    assert.strictEqual(mapSeverity(99), DiagnosticSeverity.INFO);
  });

  test("toDiagnosticIssue copies range, code object, and source", () => {
    const mapped = toDiagnosticIssue("file:///src/a.ts", {
      message: "unused",
      range: {
        start: { line: 4, character: 1 },
        end: { line: 4, character: 8 },
      },
      severity: VSCODE_DIAGNOSTIC_SEVERITY.Warning,
      code: { value: 6133 },
      source: "ts",
    });
    assert.strictEqual(mapped.line, 4);
    assert.strictEqual(mapped.character, 1);
    assert.strictEqual(mapped.endLine, 4);
    assert.strictEqual(mapped.endCharacter, 8);
    assert.strictEqual(mapped.severity, DiagnosticSeverity.WARNING);
    assert.strictEqual(mapped.code, "6133");
    assert.strictEqual(mapped.source, "ts");
  });

  test("format / summarize / needsFixing match DiagnosticChecker", () => {
    assert.strictEqual(formatDiagnosticsForDisplay([]), "No issues found.");
    assert.strictEqual(
      formatDiagnosticsForDisplay([issue()]),
      "🔴 Cannot find name 'x' (Line 3)",
    );
    const mixed = [
      issue(),
      issue({
        message: "deprecated",
        line: 0,
        severity: DiagnosticSeverity.WARNING,
      }),
    ];
    assert.deepStrictEqual(summarizeDiagnostics(mixed), {
      hasErrors: true,
      hasWarnings: true,
    });
    assert.strictEqual(
      issuesNeedFixing(mixed, DiagnosticSeverity.ERROR),
      true,
    );
    assert.strictEqual(
      issuesNeedFixing(
        [issue({ severity: DiagnosticSeverity.WARNING })],
        DiagnosticSeverity.ERROR,
      ),
      false,
    );
    assert.strictEqual(
      issuesNeedFixing(
        [issue({ severity: DiagnosticSeverity.WARNING })],
        DiagnosticSeverity.WARNING,
      ),
      true,
    );
    assert.strictEqual(
      issuesNeedFixing(
        [issue({ severity: DiagnosticSeverity.HINT })],
        DiagnosticSeverity.HINT,
      ),
      true,
    );
  });

  test("DiagnosticCache TTL expires on read", () => {
    let now = 1000;
    const cache = new DiagnosticCache(100, () => now);
    const issues = [issue()];
    cache.set("a", issues);
    assert.strictEqual(cache.get("a"), issues);
    now = 1099;
    assert.strictEqual(cache.get("a"), issues);
    now = 1100;
    assert.strictEqual(cache.get("a"), undefined);
  });

  test("FixAttemptTracker blocks reentry and caps at 3", () => {
    const tracker = new FixAttemptTracker();
    assert.strictEqual(tracker.begin("f"), true);
    assert.strictEqual(tracker.begin("f"), false);
    tracker.end("f");
    assert.strictEqual(tracker.begin("f"), true);
    tracker.end("f");

    assert.strictEqual(tracker.hasReachedMax("f"), false);
    tracker.increment("f");
    tracker.increment("f");
    tracker.increment("f");
    assert.strictEqual(tracker.getCount("f"), 3);
    assert.strictEqual(tracker.hasReachedMax("f"), true);
    tracker.reset("f");
    assert.strictEqual(tracker.getCount("f"), 0);
    assert.strictEqual(tracker.hasReachedMax("f"), false);
  });

  test("buildFixPrompt uses 1-indexed lines and language from extension", () => {
    assert.strictEqual(languageFromFilePath("src/a.ts"), "TypeScript");
    assert.strictEqual(languageFromFilePath("/tmp/main.rs"), "Rust");
    const prompt = buildFixPrompt({
      filePath: "src/a.ts",
      content: "const x = 1;",
      issues: toFixPromptIssues([issue({ source: "ts" })]),
    });
    assert.ok(prompt.includes("Fix the following TypeScript code diagnostics"));
    assert.ok(prompt.includes("File: src/a.ts"));
    assert.ok(prompt.includes("Line 3 [error]: Cannot find name 'x' (ts)"));
    assert.ok(prompt.includes("const x = 1;"));
    assert.ok(!prompt.includes("```"));
  });

  test("sanitizeLlmFixOutput strips fences and rejects too-short output", () => {
    const original = "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10";
    const fenced = sanitizeLlmFixOutput(
      "```ts\n" + original + "\n```",
      original,
    );
    assert.strictEqual(fenced.skipped, false);
    assert.strictEqual(fenced.fixedContent, original);

    const empty = sanitizeLlmFixOutput("", original);
    assert.strictEqual(empty.skipped, true);
    assert.strictEqual(empty.fixedContent, original);

    const short = sanitizeLlmFixOutput("nope", original);
    assert.strictEqual(short.skipped, true);
    assert.strictEqual(short.fixedContent, original);
  });

  test("computeFixedIssues and success treat remaining errors as failure", () => {
    const initial = [
      issue({ line: 1, message: "a" }),
      issue({ line: 2, message: "b" }),
    ];
    const remaining = [issue({ line: 2, message: "b" })];
    assert.deepStrictEqual(computeFixedIssues(initial, remaining), [
      issue({ line: 1, message: "a" }),
    ]);
    assert.strictEqual(isDiagnosticFixSuccess(remaining), false);
    assert.strictEqual(isDiagnosticFixSuccess([]), true);
    assert.strictEqual(
      isDiagnosticFixSuccess([
        issue({ severity: DiagnosticSeverity.WARNING, message: "w" }),
      ]),
      true,
    );
  });

  test("resolveDiagnosticUri accepts Uri-like, { uri }, or active editor", () => {
    assert.strictEqual(
      resolveDiagnosticUri(undefined, "file:///active.ts"),
      "file:///active.ts",
    );
    assert.strictEqual(
      resolveDiagnosticUri("file:///arg.ts", "file:///active.ts"),
      "file:///arg.ts",
    );
    assert.strictEqual(
      resolveDiagnosticUri(
        {
          fsPath: "/src/a.ts",
          toString() {
            return "file:///src/a.ts";
          },
        },
        "file:///active.ts",
      ),
      "file:///src/a.ts",
    );
    const params = resolveFixDiagnosticsArgs(
      {
        uri: {
          fsPath: "/src/a.ts",
          toString() {
            return "file:///src/a.ts";
          },
        },
        selectedModelTitle: "Claude",
      },
      { selectedModelTitle: "default" },
    );
    assert.strictEqual(params.uri, "file:///src/a.ts");
    assert.strictEqual(params.selectedModelTitle, "Claude");
    assert.strictEqual(
      resolveFixDiagnosticsArgs(undefined, {}).selectedModelTitle,
      "default",
    );
  });
});
