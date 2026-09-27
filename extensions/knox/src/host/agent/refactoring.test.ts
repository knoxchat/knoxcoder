import * as assert from "node:assert";
import * as path from "node:path";

import { LLM_COMPLETE_COMMAND } from "./diagnostics";
import {
  buildExtractInterfacePrompt,
  buildExtractMethodPrompt,
  DEFAULT_EXTRACT_ACCESSIBILITY,
  defaultExtractInterfacePath,
  editorSelectionFallback,
  EXTRACT_INTERFACE_COMMAND,
  EXTRACT_METHOD_COMMAND,
  llmCompletionText,
  MOVE_FILE_COMMAND,
  movedImportRewrite,
  parseExtractInterfaceResult,
  parseJsonObject,
  RENAME_SYMBOL_COMMAND,
  resolveExtractInterfaceArgs,
  resolveExtractMethodArgs,
  resolveMoveFileArgs,
  resolveRenameArgs,
  rewriteImportsAfterMove,
  stripCodeFences,
} from "./refactoring";

suite("KN-355 refactoring", () => {
  test("command ids stay contributed", () => {
    assert.strictEqual(RENAME_SYMBOL_COMMAND, "knox.renameSymbol");
    assert.strictEqual(EXTRACT_METHOD_COMMAND, "knox.extractMethod");
    assert.strictEqual(MOVE_FILE_COMMAND, "knox.moveFile");
    assert.strictEqual(EXTRACT_INTERFACE_COMMAND, "knox.extractInterface");
    assert.strictEqual(LLM_COMPLETE_COMMAND, "knox.llmComplete");
    assert.strictEqual(DEFAULT_EXTRACT_ACCESSIBILITY, "private");
  });

  test("stripCodeFences and parseJsonObject accept fenced LLM output", () => {
    assert.strictEqual(stripCodeFences("```ts\nconst x = 1;\n```"), "const x = 1;");
    assert.deepStrictEqual(
      parseJsonObject('```json\n{"updated_source":"a","interface_file":"b"}\n```'),
      { updated_source: "a", interface_file: "b" },
    );
    assert.deepStrictEqual(
      parseJsonObject('prefix {"updated_source":"c"} suffix'),
      { updated_source: "c" },
    );
  });

  test("parseExtractInterfaceResult requires updated_source", () => {
    assert.strictEqual(parseExtractInterfaceResult("{}"), undefined);
    assert.deepStrictEqual(
      parseExtractInterfaceResult('{"updated_source":"class X {}","interface_file":"export interface I {}"}'),
      { updatedSource: "class X {}", interfaceFile: "export interface I {}" },
    );
  });

  test("extract prompts name the LSP/LLM contract", () => {
    const method = buildExtractMethodPrompt({
      languageId: "typescript",
      accessibility: "private",
      methodName: "run",
      startLine: 2,
      endLine: 4,
      selectedText: "doWork();",
      fileText: "class A { doWork(); }",
    });
    assert.ok(method.includes("extract-method"));
    assert.ok(method.includes('named "run"'));
    assert.ok(method.includes("doWork();"));

    const iface = buildExtractInterfacePrompt({
      languageId: "typescript",
      className: "Foo",
      interfaceName: "IFoo",
      interfacePath: "/tmp/IFoo.ts",
      fileText: "class Foo {}",
    });
    assert.ok(iface.includes("updated_source"));
    assert.ok(iface.includes("IFoo"));
    assert.strictEqual(
      defaultExtractInterfacePath("/tmp/src/Foo.ts", "IFoo"),
      path.join("/tmp/src", "IFoo.ts"),
    );
  });

  test("rewriteImportsAfterMove only rewrites from-specifiers", () => {
    const rewrite = movedImportRewrite("/tmp/ws", "/tmp/ws/src/old.ts", "/tmp/ws/lib/new.ts");
    assert.ok(rewrite);
    const next = rewriteImportsAfterMove(
      `import { x } from "./old";\nconst old = 1;\nimport y from "src/old";`,
      rewrite!,
    );
    assert.strictEqual(
      next,
      `import { x } from "lib/new";\nconst old = 1;\nimport y from "lib/new";`,
    );
    assert.strictEqual(
      movedImportRewrite("/tmp/ws", "/tmp/ws/a.ts", "/tmp/ws/a.ts"),
      undefined,
    );
  });

  test("arg resolvers require names and accept editor fallbacks", () => {
    assert.strictEqual(resolveRenameArgs({ oldName: "a" }), undefined);
    assert.deepStrictEqual(resolveRenameArgs({ oldName: "a", newName: "b", filePaths: ["x.ts"] }), {
      oldName: "a",
      newName: "b",
      filePaths: ["x.ts"],
    });

    assert.strictEqual(resolveExtractMethodArgs({ methodName: "run" }), undefined);
    assert.deepStrictEqual(
      resolveExtractMethodArgs(
        { methodName: "run" },
        { filePath: "/tmp/a.ts", startLine: 2, endLine: 5 },
      ),
      {
        filePath: "/tmp/a.ts",
        startLine: 2,
        endLine: 5,
        methodName: "run",
        accessibility: "private",
      },
    );

    assert.deepStrictEqual(
      resolveMoveFileArgs({ sourcePath: "/a.ts", targetPath: "/b.ts" }),
      { sourcePath: "/a.ts", targetPath: "/b.ts", updateImports: true },
    );
    assert.strictEqual(resolveExtractInterfaceArgs({ className: "Foo" }), undefined);
    assert.deepStrictEqual(
      resolveExtractInterfaceArgs({ className: "Foo", interfaceName: "IFoo" }, "/tmp/Foo.ts"),
      { filePath: "/tmp/Foo.ts", className: "Foo", interfaceName: "IFoo", targetPath: undefined },
    );

    const sel = editorSelectionFallback({
      document: { uri: { fsPath: "/tmp/a.ts" } },
      selection: { start: { line: 1 }, end: { line: 4, character: 0 } },
    });
    assert.deepStrictEqual(sel, { filePath: "/tmp/a.ts", startLine: 2, endLine: 4 });
    assert.strictEqual(llmCompletionText("  ok  "), "  ok  ");
    assert.strictEqual(llmCompletionText("   "), undefined);
  });
});
