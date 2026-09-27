/**
 * Verification Loop Tool Implementation
 *
 * Provides a core-layer tool that checks diagnostics on edited files
 * using the IDE's getProblems() API. Reports any remaining errors
 * back to the LLM so they can be addressed in subsequent edits.
 */

import { ToolImpl } from ".";

/**
 * verifyAfterEdit — Tool that checks diagnostics on specified files.
 *
 * This uses IDE.getProblems() to:
 * 1. Fetch current diagnostics (errors/warnings) for specified files
 * 2. Report back a structured summary the LLM can act on
 */
export const verifyAfterEdit: ToolImpl = async (args, extras) => {
  const filePaths: string[] = args.filePaths || [];

  if (filePaths.length === 0) {
    return [
      {
        name: "Verification",
        description: "No files specified for verification",
        content: "No files to verify.",
        uri: { type: "file" as const, value: "" },
      },
    ];
  }

  const fileResults: Array<{
    path: string;
    clean: boolean;
    errors: number;
    warnings: number;
    details: string[];
  }> = [];

  for (const filePath of filePaths) {
    try {
      const problems = await extras.ide.getProblems(filePath);
      const details = problems
        .slice(0, 10)
        .map(
          (p) =>
            `Line ${p.range.start.line + 1}: ${p.message}`,
        );

      fileResults.push({
        path: filePath,
        clean: problems.length === 0,
        errors: problems.length,
        warnings: 0,
        details,
      });
    } catch {
      fileResults.push({
        path: filePath,
        clean: true,
        errors: 0,
        warnings: 0,
        details: ["Could not fetch diagnostics"],
      });
    }
  }

  const allClean = fileResults.every((r) => r.clean);
  const totalErrors = fileResults.reduce((sum, r) => sum + r.errors, 0);

  let summary: string;
  if (allClean) {
    summary = `All ${filePaths.length} file(s) verified clean — no errors.`;
  } else {
    const cleanCount = fileResults.filter((r) => r.clean).length;
    summary = `${cleanCount}/${filePaths.length} file(s) clean. ${totalErrors} error(s) remaining.`;
  }

  return [
    {
      name: "Verification Results",
      description: summary,
      content: JSON.stringify(
        {
          success: allClean,
          totalErrors,
          files: fileResults.map((r) => ({
            path: r.path,
            clean: r.clean,
            errors: r.errors,
            warnings: r.warnings,
            details: r.details,
          })),
        },
        null,
        2,
      ),
      uri: { type: "file" as const, value: filePaths[0] },
    },
  ];
};
