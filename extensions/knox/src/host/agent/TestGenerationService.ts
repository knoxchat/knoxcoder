import * as path from "path";

import { ToolCall, ContextItem } from "core";
import * as vscode from "vscode";

import { t } from "../i18n";

/**
 * Options for test generation
 */
export interface TestGenerationOptions {
  testFramework?: string;
  coverage?: "basic" | "full";
  includeEdgeCases?: boolean;
  includeDocComments?: boolean;
  targetPath?: string;
}

/**
 * Results of test generation
 */
export interface TestGenerationResult {
  success: boolean;
  testFilePath: string;
  /** null when coverage was not measured (never fabricate percentages) */
  coverage: {
    functions: number;
    branches: number;
    lines: number;
  } | null;
  functionsWithTests: string[];
  testCount: number;
}

/**
 * TestGenerationService generates tests via Core `builtin_generate_tests`
 * (LLM + file write). It does not invent non-existent tool names.
 */
export class TestGenerationService implements vscode.Disposable {
  private static instance: TestGenerationService;
  private disposables: vscode.Disposable[] = [];

  private testFrameworkPatterns: Record<string, RegExp[]> = {
    vitest: [
      /vitest\.config\.(js|ts|mjs|mts|cjs|cts)/,
      /"vitest":/,
      /\bvitest\b/,
    ],
    mocha: [/mocha\.opts/, /"mocha":/],
    jasmine: [/jasmine\.json/, /"jasmine":/],
    pytest: [/pytest\.ini/, /conftest\.py/],
    unittest: [/unittest/],
    phpunit: [/phpunit\.xml/],
    junit: [/junit/],
    testng: [/testng\.xml/],
    golang: [/go test/],
    rspec: [/spec_helper\.rb/],
    ava: [/"ava":/],
  };

  private testFilePatterns: Record<string, string> = {
    typescript: "{name}.test.ts",
    javascript: "{name}.test.js",
    typescriptreact: "{name}.test.tsx",
    javascriptreact: "{name}.test.jsx",
    python: "test_{name}.py",
    java: "{Name}Test.java",
    csharp: "{Name}Tests.cs",
    go: "{name}_test.go",
    rust: "{name}_test.rs",
    ruby: "{name}_spec.rb",
    php: "{Name}Test.php",
  };

  private _onTestGenerated = new vscode.EventEmitter<TestGenerationResult>();
  public readonly onTestGenerated = this._onTestGenerated.event;

  public static getInstance(): TestGenerationService {
    if (!TestGenerationService.instance) {
      TestGenerationService.instance = new TestGenerationService();
    }
    return TestGenerationService.instance;
  }

  private constructor() {
    this.registerCommands();
  }

  private registerCommands(): void {
    this.disposables.push(
      vscode.commands.registerCommand(
        "knox.generateTests",
        async (filePath: string, options?: TestGenerationOptions) => {
          return await this.generateTests(filePath, options);
        },
      ),
    );

    this.disposables.push(
      vscode.commands.registerCommand(
        "knox.generateTestsForCurrentFile",
        async (options?: TestGenerationOptions) => {
          const activeEditor = vscode.window.activeTextEditor;
          if (!activeEditor) {
            vscode.window.showErrorMessage(t("test.noActiveFile"));
            return null;
          }

          return await this.generateTests(
            activeEditor.document.uri.fsPath,
            options,
          );
        },
      ),
    );
  }

  public async generateTests(
    filePath: string,
    options: TestGenerationOptions = {},
  ): Promise<TestGenerationResult | null> {
    try {
      const sourceUri = vscode.Uri.file(filePath);
      const sourceDocument = await vscode.workspace.openTextDocument(sourceUri);
      const language = sourceDocument.languageId;

      const testFramework =
        options.testFramework ||
        (await this.detectTestFramework(filePath, language));

      const testFilePath =
        options.targetPath || (await this.getTestFilePath(filePath, language));

      const coverageArg =
        options.coverage === "full"
          ? "comprehensive"
          : options.includeEdgeCases
            ? "edge_cases"
            : "basic";

      const toolCall: ToolCall = {
        id: `generate-tests-${Date.now()}`,
        type: "function",
        function: {
          name: "builtin_generate_tests",
          arguments: JSON.stringify({
            filepath: filePath,
            testFramework,
            coverage: coverageArg,
            includeMocks: true,
            outputPath: testFilePath,
          }),
        },
      };

      let generationResult: TestGenerationResult | null = null;

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: t("test.generatingTests", { file: path.basename(filePath) }),
          cancellable: false,
        },
        async (progress) => {
          progress.report({
            increment: 0,
            message: t("test.analyzingSource"),
          });

          const result = await vscode.commands.executeCommand<ContextItem[]>(
            "knox.executeToolCall",
            { toolCall, selectedModelTitle: "default" },
          );

          progress.report({ increment: 50, message: t("test.processing") });

          if (!result || result.length === 0) {
            throw new Error(t("test.emptyResult"));
          }

          const content =
            typeof result[0].content === "string"
              ? result[0].content
              : JSON.stringify(result[0].content);

          const parsed = parseToolResult(content);
          const writtenPath =
            (typeof parsed?.test_file_path === "string" &&
              parsed.test_file_path) ||
            testFilePath;

          await this.formatFile(writtenPath);

          generationResult = {
            success: true,
            testFilePath: writtenPath,
            coverage: null,
            functionsWithTests: Array.isArray(parsed?.functions_with_tests)
              ? (parsed.functions_with_tests as string[])
              : [],
            testCount:
              typeof parsed?.test_count === "number" ? parsed.test_count : 0,
          };

          this._onTestGenerated.fire(generationResult);

          const testFileUri = vscode.Uri.file(writtenPath);
          await vscode.window.showTextDocument(testFileUri);

          progress.report({ increment: 100, message: t("test.success") });
        },
      );

      return generationResult;
    } catch (error) {
      console.error("Error generating tests:", error);
      vscode.window.showErrorMessage(
        t("test.errorGenerating", { message: (error as Error).message }),
      );
      return null;
    }
  }

  private async detectTestFramework(
    filePath: string,
    language: string,
  ): Promise<string> {
    try {
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(
        vscode.Uri.file(filePath),
      )?.uri.fsPath;
      if (!workspaceFolder) {
        return this.getDefaultTestFramework(language);
      }

      const packageJsonPath = path.join(workspaceFolder, "package.json");
      if (await this.fileExists(packageJsonPath)) {
        const packageJsonUri = vscode.Uri.file(packageJsonPath);
        const packageJsonDoc =
          await vscode.workspace.openTextDocument(packageJsonUri);
        const packageJson = packageJsonDoc.getText();

        for (const [framework, patterns] of Object.entries(
          this.testFrameworkPatterns,
        )) {
          for (const pattern of patterns) {
            if (pattern.test(packageJson)) {
              return framework;
            }
          }
        }
      }

      const configFiles = await vscode.workspace.findFiles(
        "**/{vitest.config.js,vitest.config.ts,vitest.config.mjs,vitest.config.mts,vitest.config.cjs,vitest.config.cts,mocha.opts,jasmine.json,pytest.ini,phpunit.xml}",
        "**/node_modules/**",
      );

      for (const configFile of configFiles) {
        const fileName = path.basename(configFile.fsPath);
        if (fileName.includes("vitest")) {
          return "vitest";
        }
        if (fileName.includes("mocha")) {
          return "mocha";
        }
        if (fileName.includes("jasmine")) {
          return "jasmine";
        }
        if (fileName.includes("pytest")) {
          return "pytest";
        }
        if (fileName.includes("phpunit")) {
          return "phpunit";
        }
      }

      return this.getDefaultTestFramework(language);
    } catch (error) {
      console.error("Error detecting test framework:", error);
      return this.getDefaultTestFramework(language);
    }
  }

  private getDefaultTestFramework(language: string): string {
    switch (language) {
      case "typescript":
      case "javascript":
      case "typescriptreact":
      case "javascriptreact":
        return "vitest";
      case "python":
        return "pytest";
      case "java":
        return "junit";
      case "csharp":
        return "nunit";
      case "go":
        return "golang";
      case "rust":
        return "rust";
      case "ruby":
        return "rspec";
      case "php":
        return "phpunit";
      default:
        return "vitest";
    }
  }

  private async getTestFilePath(
    filePath: string,
    language: string,
  ): Promise<string> {
    const dirName = path.dirname(filePath);
    const fileName = path.basename(filePath, path.extname(filePath));
    const pattern = this.testFilePatterns[language] || "{name}.test.js";
    const testFileName = pattern
      .replace("{name}", fileName)
      .replace(
        "{Name}",
        fileName.charAt(0).toUpperCase() + fileName.slice(1),
      );

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(
      vscode.Uri.file(filePath),
    )?.uri.fsPath;
    if (!workspaceFolder) {
      return path.join(dirName, testFileName);
    }

    const testDirPatterns = [
      path.join(dirName, "__tests__"),
      path.join(dirName, "tests"),
      path.join(dirName, "test"),
      path.join(dirName, "spec"),
      path.join(path.dirname(dirName), "tests", path.basename(dirName)),
      path.join(path.dirname(dirName), "test", path.basename(dirName)),
      path.join(path.dirname(dirName), "__tests__", path.basename(dirName)),
      path.join(
        workspaceFolder,
        "tests",
        path.relative(workspaceFolder, dirName),
      ),
      path.join(
        workspaceFolder,
        "test",
        path.relative(workspaceFolder, dirName),
      ),
    ];

    for (const testDir of testDirPatterns) {
      if (await this.directoryExists(testDir)) {
        return path.join(testDir, testFileName);
      }
    }

    return path.join(dirName, testFileName);
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
      return true;
    } catch {
      return false;
    }
  }

  private async directoryExists(dirPath: string): Promise<boolean> {
    try {
      const stat = await vscode.workspace.fs.stat(vscode.Uri.file(dirPath));
      return (stat.type & vscode.FileType.Directory) !== 0;
    } catch {
      return false;
    }
  }

  private async formatFile(filePath: string): Promise<void> {
    try {
      const uri = vscode.Uri.file(filePath);
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document);
      await vscode.commands.executeCommand("editor.action.formatDocument");
    } catch (error) {
      console.error("Error formatting file:", error);
    }
  }

  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
    this._onTestGenerated.dispose();
  }
}

function parseToolResult(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Non-JSON content — treat as raw test file; count still unknown
    return {
      test_file_content: content,
      test_count: 0,
      coverage: null,
    };
  }
  return null;
}
