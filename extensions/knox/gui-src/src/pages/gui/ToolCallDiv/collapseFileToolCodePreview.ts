import { BuiltInToolNames, resolveBuiltInToolName } from "core/tools/builtIn";

const COLLAPSED_FILE_PREVIEW_TOOLS = new Set<string>([
  BuiltInToolNames.ReadFile,
  BuiltInToolNames.ReadCurrentlyOpenFile,
]);

/** Read-file cards have no generated code to show — keep the fence collapsed. */
export function collapseFileToolCodePreview(toolName?: string): boolean {
  return COLLAPSED_FILE_PREVIEW_TOOLS.has(resolveBuiltInToolName(toolName));
}
