/**
 * KN-355: vscode-free refactoring helpers.
 *
 * RefactoringService is the vscode adapter (LSP rename, workspace.fs,
 * `knox.llmComplete`). Distinct from the unimplemented `builtin_refactor`
 * tool stub. ReasoningEngine stays quarantined as the product planner
 * (`builtin_plan`); it is not dropped here.
 */

import * as path from "path";

import { LLM_COMPLETE_COMMAND } from "./diagnostics";

export { LLM_COMPLETE_COMMAND };

export const RENAME_SYMBOL_COMMAND = "knox.renameSymbol";
export const EXTRACT_METHOD_COMMAND = "knox.extractMethod";
export const MOVE_FILE_COMMAND = "knox.moveFile";
export const EXTRACT_INTERFACE_COMMAND = "knox.extractInterface";

export const DEFAULT_EXTRACT_ACCESSIBILITY = "private";

export interface RenameSymbolArgs {
  oldName: string;
  newName: string;
  filePaths: string[];
}

export interface ExtractMethodArgs {
  filePath: string;
  startLine: number;
  endLine: number;
  methodName: string;
  accessibility: string;
}

export interface MoveFileArgs {
  sourcePath: string;
  targetPath: string;
  updateImports: boolean;
}

export interface ExtractInterfaceArgs {
  filePath: string;
  className: string;
  interfaceName: string;
  targetPath?: string;
}

export interface ExtractInterfaceLlmResult {
  updatedSource: string;
  interfaceFile: string;
}

export interface MovedImportRewrite {
  oldRel: string;
  newRel: string;
  oldBase: string;
  patterns: string[];
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:[\w+-]+)?\n([\s\S]*?)\n```$/);
  if (fenced) {
    return fenced[1];
  }
  return trimmed.replace(/^```(?:[\w+-]+)?\n/, "").replace(/\n```$/, "");
}

export function parseJsonObject(text: string): Record<string, unknown> | null {
  const stripped = stripCodeFences(text);
  try {
    const parsed = JSON.parse(stripped);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(stripped.slice(start, end + 1));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function llmCompletionText(result: unknown): string | undefined {
  return typeof result === "string" && result.trim() ? result : undefined;
}

export function defaultExtractInterfacePath(
  sourcePath: string,
  interfaceName: string,
): string {
  return path.join(path.dirname(sourcePath), `${interfaceName}.ts`);
}

export function buildExtractMethodPrompt(input: {
  languageId: string;
  accessibility: string;
  methodName: string;
  startLine: number;
  endLine: number;
  selectedText: string;
  fileText: string;
}): string {
  return `You are performing an extract-method refactor on a ${input.languageId} file.
Extract the selected lines into a new ${input.accessibility} method/function named "${input.methodName}".
Return ONLY the full updated file contents — no markdown fences, no explanation.

Selected lines (${input.startLine}-${input.endLine}):
\`\`\`
${input.selectedText}
\`\`\`

Full file:
\`\`\`
${input.fileText}
\`\`\`
`;
}

export function buildExtractInterfacePrompt(input: {
  languageId: string;
  className: string;
  interfaceName: string;
  interfacePath: string;
  fileText: string;
}): string {
  return `You are extracting an interface from a class in a ${input.languageId} file.
Class name: ${input.className}
New interface name: ${input.interfaceName}
Interface file path: ${input.interfacePath}

Return ONLY valid JSON (no markdown) with this shape:
{
  "updated_source": "<full updated source file contents>",
  "interface_file": "<full contents for the interface file, or empty string if interface stays in source>"
}

Rules:
- Prefer a separate interface file when target path differs from source.
- Update the class to implement the new interface.
- Keep the rest of the source behavior unchanged.

Source file:
\`\`\`
${input.fileText}
\`\`\`
`;
}

export function parseExtractInterfaceResult(
  raw: string,
): ExtractInterfaceLlmResult | undefined {
  const parsed = parseJsonObject(raw);
  const updatedSource =
    typeof parsed?.updated_source === "string" ? parsed.updated_source : "";
  const interfaceFile =
    typeof parsed?.interface_file === "string" ? parsed.interface_file : "";
  if (!updatedSource.trim()) {
    return undefined;
  }
  return { updatedSource, interfaceFile };
}

export function movedImportRewrite(
  workspaceRoot: string,
  sourcePath: string,
  targetPath: string,
): MovedImportRewrite | undefined {
  const oldBase = path.basename(sourcePath, path.extname(sourcePath));
  const oldRel = path
    .relative(workspaceRoot, sourcePath)
    .replace(/\\/g, "/")
    .replace(/\.(ts|tsx|js|jsx)$/, "");
  const newRel = path
    .relative(workspaceRoot, targetPath)
    .replace(/\\/g, "/")
    .replace(/\.(ts|tsx|js|jsx)$/, "");
  if (!oldRel || oldRel === newRel) {
    return undefined;
  }
  return {
    oldRel,
    newRel,
    oldBase,
    patterns: [oldRel, `./${oldBase}`, `../${oldBase}`, oldBase],
  };
}

export function rewriteFromImportSpecifiers(
  text: string,
  oldPattern: string,
  newRel: string,
): string {
  if (!oldPattern || !text.includes(oldPattern)) {
    return text;
  }
  return text.replace(
    new RegExp(`(from\\s+['"])([^'"]*${escapeRegExp(oldPattern)})(['"])`, "g"),
    (_m, a: string, spec: string, c: string) =>
      `${a}${spec.replace(oldPattern, newRel)}${c}`,
  );
}

export function rewriteImportsAfterMove(
  text: string,
  rewrite: MovedImportRewrite,
): string {
  let updated = text;
  for (const pattern of rewrite.patterns) {
    updated = rewriteFromImportSpecifiers(updated, pattern, rewrite.newRel);
  }
  return updated;
}

export function resolveRenameArgs(arg: unknown): RenameSymbolArgs | undefined {
  const rec = asRecord(arg);
  const oldName = asNonEmptyString(rec?.oldName);
  const newName = asNonEmptyString(rec?.newName);
  if (!oldName || !newName) {
    return undefined;
  }
  return {
    oldName,
    newName,
    filePaths: asStringArray(rec?.filePaths),
  };
}

export function resolveExtractMethodArgs(
  arg: unknown,
  fallback?: { filePath?: string; startLine?: number; endLine?: number },
): ExtractMethodArgs | undefined {
  const rec = asRecord(arg);
  const filePath =
    asNonEmptyString(rec?.filePath) ?? asNonEmptyString(fallback?.filePath);
  const startLine = asFiniteNumber(rec?.startLine) ?? fallback?.startLine;
  const endLine = asFiniteNumber(rec?.endLine) ?? fallback?.endLine;
  const methodName = asNonEmptyString(rec?.methodName);
  if (!filePath || startLine === undefined || endLine === undefined || !methodName) {
    return undefined;
  }
  return {
    filePath,
    startLine,
    endLine,
    methodName,
    accessibility:
      asNonEmptyString(rec?.accessibility) ?? DEFAULT_EXTRACT_ACCESSIBILITY,
  };
}

export function resolveMoveFileArgs(arg: unknown): MoveFileArgs | undefined {
  const rec = asRecord(arg);
  const sourcePath = asNonEmptyString(rec?.sourcePath);
  const targetPath = asNonEmptyString(rec?.targetPath);
  if (!sourcePath || !targetPath) {
    return undefined;
  }
  return {
    sourcePath,
    targetPath,
    updateImports: rec?.updateImports !== false,
  };
}

export function resolveExtractInterfaceArgs(
  arg: unknown,
  fallbackFilePath?: string,
): ExtractInterfaceArgs | undefined {
  const rec = asRecord(arg);
  const filePath =
    asNonEmptyString(rec?.filePath) ?? asNonEmptyString(fallbackFilePath);
  const className = asNonEmptyString(rec?.className);
  const interfaceName = asNonEmptyString(rec?.interfaceName);
  if (!filePath || !className || !interfaceName) {
    return undefined;
  }
  return {
    filePath,
    className,
    interfaceName,
    targetPath: asNonEmptyString(rec?.targetPath),
  };
}

export function editorSelectionFallback(editor?: {
  document?: { uri?: { fsPath?: string } };
  selection?: {
    start: { line: number };
    end: { line: number; character: number };
  };
}): { filePath?: string; startLine?: number; endLine?: number } {
  const filePath = editor?.document?.uri?.fsPath;
  const selection = editor?.selection;
  if (!filePath || !selection) {
    return { filePath };
  }
  const startLine = selection.start.line + 1;
  const endLine =
    selection.end.character === 0 && selection.end.line > selection.start.line
      ? selection.end.line
      : selection.end.line + 1;
  return { filePath, startLine, endLine };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}
