import * as path from "node:path";

import { inferResolvedUriFromRelativePath } from "../../util/ideUtils";
import { getUriPathBasename } from "../../util/uri";
import { t } from "../../i18n/index.js";

import { ToolImpl } from ".";

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:[\w+-]+)?\n([\s\S]*?)\n```$/);
  if (fenced) {
    return fenced[1];
  }
  return trimmed.replace(/^```(?:[\w+-]+)?\n/, "").replace(/\n```$/, "");
}

function countTestCases(content: string): number {
  const patterns = [
    /\b(?:it|test|specify)\s*\(/g,
    /\bdef\s+test_/g,
    /\bfunc\s+Test[A-Z]/g,
    /#\[test\]/g,
  ];
  let count = 0;
  for (const pattern of patterns) {
    const matches = content.match(pattern);
    if (matches) {
      count += matches.length;
    }
  }
  return count;
}

/** Unit tests stay in the same `.rs` file (`#[cfg(test)]`). Never `src/foo_test.rs`. */
export function defaultTestPath(sourcePath: string): string {
  const ext = path.extname(sourcePath);
  const base = sourcePath.slice(0, sourcePath.length - ext.length);
  if (ext === ".py") {
    const dir = path.dirname(sourcePath);
    const name = path.basename(sourcePath, ext);
    return path.join(dir, `test_${name}.py`);
  }
  if (ext === ".go") {
    return `${base}_test.go`;
  }
  if (ext === ".rs") {
    const posix = sourcePath.replace(/\\/g, "/");
    if (posix.startsWith("tests/") || posix.includes("/tests/")) {
      return sourcePath;
    }
    return sourcePath;
  }
  return `${base}.test${ext || ".ts"}`;
}

/**
 * Generate tests for a source file using the active LLM and write them to disk.
 */
export const generateTestsImpl: ToolImpl = async (args, extras) => {
  if (!args.filepath || typeof args.filepath !== "string") {
    throw new Error(t("missingRequiredParam", { param: "filepath" }));
  }

  const filepath = args.filepath.trim();
  const resolvedSourceUri = await inferResolvedUriFromRelativePath(
    filepath,
    extras.ide,
  );

  const exists = await extras.ide.fileExists(resolvedSourceUri);
  if (!exists) {
    throw new Error(t("fileDoesNotExist", { filepath }));
  }

  const sourceCode = await extras.ide.readFile(resolvedSourceUri);
  const outputPathArg =
    typeof args.outputPath === "string" && args.outputPath.trim()
      ? args.outputPath.trim()
      : typeof args.output_path === "string" && args.output_path.trim()
        ? args.output_path.trim()
        : defaultTestPath(filepath);

  const resolvedOutputUri = await inferResolvedUriFromRelativePath(
    outputPathArg,
    extras.ide,
  );

  let existingTestCode = "";
  if (await extras.ide.fileExists(resolvedOutputUri)) {
    existingTestCode = await extras.ide.readFile(resolvedOutputUri);
  }

  const framework =
    typeof args.testFramework === "string" && args.testFramework !== "auto"
      ? args.testFramework
      : "auto-detect from project";
  const coverage =
    typeof args.coverage === "string" ? args.coverage : "basic";
  const includeMocks = args.includeMocks !== false;
  const functions: string[] = Array.isArray(args.functions)
    ? args.functions.filter((f: unknown) => typeof f === "string")
    : [];

  const rustIdioms =
    filepath.replace(/\\/g, "/").endsWith(".rs")
      ? [
          "- Rust layout: prefer `#[cfg(test)] mod tests` in the same file for unit tests.",
          "- Integration tests go in `tests/<name>.rs`. Never write `src/foo_test.rs`.",
          "- Libs: `Result` + `thiserror`. No `unwrap()` in helpers without `expect(\"...\")`.",
          "- After writing, the rust profile oracle is `cargo test`, not LSP.",
        ].join("\n")
      : "";

  const prompt = `You are an expert software engineer writing automated tests.
Generate ${coverage} tests for the source file below.

Requirements:
- Framework preference: ${framework}
- ${includeMocks ? "Include mocks/stubs for external dependencies where useful." : "Avoid mocks unless necessary."}
- ${functions.length > 0 ? `Focus on these functions: ${functions.join(", ")}` : "Cover the main exported/public behavior."}
${rustIdioms}
- Return ONLY the full test file contents — no markdown fences, no explanation.
${existingTestCode ? "- Merge with or improve the existing test file rather than ignoring it.\n" : ""}

Source path: ${filepath}
Output path: ${outputPathArg}

Source:
\`\`\`
${sourceCode}
\`\`\`
${
  existingTestCode
    ? `\nExisting tests:\n\`\`\`\n${existingTestCode}\n\`\`\`\n`
    : ""
}`;

  const raw = await extras.llm.complete(
    prompt,
    new AbortController().signal,
  );
  const testContent = stripCodeFences(raw);
  if (!testContent.trim()) {
    throw new Error(t("emptyTestGeneration"));
  }

  await extras.ide.writeFile(resolvedOutputUri, testContent);

  const testCount = countTestCases(testContent);
  const basename = getUriPathBasename(resolvedOutputUri);

  return [
    {
      name: basename,
      description: `Generated tests written to ${outputPathArg}`,
      content: JSON.stringify({
        success: true,
        test_file_path: outputPathArg,
        test_file_content: testContent,
        test_count: testCount,
        // Coverage is unknown without running tests — never fabricate percentages.
        coverage: null,
        functions_with_tests: functions,
      }),
    },
  ];
};
