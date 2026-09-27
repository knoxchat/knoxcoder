import { createNewFileTool } from "./definitions/createNewFile";
import { editFileTool } from "./definitions/editFile";
import { writeFileTool } from "./definitions/writeFile";
import { applyPatchTool } from "./definitions/applyPatch";
import { exactSearchTool } from "./definitions/exactSearch";
import { readCurrentlyOpenFileTool } from "./definitions/readCurrentlyOpenFile";
import { readFileTool } from "./definitions/readFile";
import { runTerminalCommandTool } from "./definitions/runTerminalCommand";
import { buildTool } from "./definitions/build";
import { awaitShellTool } from "./definitions/awaitShell";
import {
  ptyReadTool,
  ptySendTool,
  ptyStartTool,
} from "./definitions/pty";
import { searchWebTool } from "./definitions/searchWeb";
import { viewDiffTool } from "./definitions/viewDiff";
import { viewRepoMapTool } from "./definitions/viewRepoMap";
import { viewSubdirectoryTool } from "./definitions/viewSubdirectory";
import { globTool } from "./definitions/glob";
import { taskTool } from "./definitions/task";
import { askUserTool } from "./definitions/askUser";
import {
  gitBlameTool,
  gitBisectTool,
  gitCommitTool,
  gitDiffTool,
  gitLogTool,
  gitStatusTool,
} from "./definitions/git";
import { qemuTool } from "./definitions/qemu";
import { debugTool } from "./definitions/debug";
import { kconfigTool } from "./definitions/kconfig";
import { maintainersTool } from "./definitions/maintainers";
import { workspaceCheckpointTool } from "./definitions/workspaceCheckpoint";
import { planTool } from "./definitions/plan";
import { skillTool } from "./definitions/skill";
import { lspTool } from "./definitions/lsp";
import { memoryTool } from "./definitions/memory";
import { memoryGraphTool } from "./definitions/memoryGraph";
import { memorySessionsTool } from "./definitions/memorySessions";
import { memoryManageTool } from "./definitions/memoryManage";
import { memoryLearnTool } from "./definitions/memoryLearn";

// Advanced tools (opt-in — not on default chat list except generate_tests)
import { advancedTools, testGeneratorTool } from "./definitions/advanced";
import { compositeTools } from "./definitions/composite";

// Orchestration library (no SmartToolRouter — see orchestration/index.ts)
export * from "./orchestration";
export {
  hasToolImplementation,
  listImplementedToolNames,
} from "./callTool";
export {
  resolveProductAgentTools,
  selectAgentTools,
  shouldIncludeDebugTool,
} from "./catalog";

// Post-edit verification helpers (IDE hook gated from Core tools/call)
export {
  POST_EDIT_VERIFY_TOOL_NAMES,
  SOUL_TURN_CHECKPOINT_TOOLS,
  shouldCheckpointTool,
  shouldVerifyTool,
  shouldSkipLspVerify,
  isLspWeakLanguagePath,
  lspVerifySkippedItem,
  extractVerifiedFilePath,
  parseToolArgs,
} from "./postEditVerification";
export type { PostEditVerificationParams } from "./postEditVerification";

// Error types and middleware exports
export * from "./errors";
export {
  executeToolWithMiddleware,
  getToolMetrics,
  resetToolMetrics,
  resetCircuitBreaker,
  resetAllCircuitBreakers,
  repairJsonArgs,
  resolveToolTimeoutMs,
} from "./middleware";
export type { ToolCallMiddlewareOptions, RetryOptions } from "./middleware";

// Basic built-in tools
export const allTools = [
  readFileTool,
  createNewFileTool,
  editFileTool,
  writeFileTool,
  applyPatchTool,
  runTerminalCommandTool,
  buildTool,
  awaitShellTool,
  ptyStartTool,
  ptySendTool,
  ptyReadTool,
  viewSubdirectoryTool,
  globTool,
  viewRepoMapTool,
  exactSearchTool,
  searchWebTool,
  viewDiffTool,
  readCurrentlyOpenFileTool,
  skillTool,
  lspTool,
  memoryTool,
  memoryGraphTool,
  memorySessionsTool,
  memoryManageTool,
  memoryLearnTool,
  taskTool,
  askUserTool,
  gitStatusTool,
  gitDiffTool,
  gitLogTool,
  gitBlameTool,
  gitCommitTool,
  gitBisectTool,
  qemuTool,
  kconfigTool,
  maintainersTool,
  workspaceCheckpointTool,
  planTool,
  // Implemented advanced tool — also kept in advancedTools for grouping
  testGeneratorTool,
];

/**
 * Opt-in catalog: every entry MUST have a `callTool` implementation
 * (`hasToolImplementation`). Unimplemented advanced defs live in
 * `unimplementedAdvancedTools` and are intentionally excluded.
 */
export const allAvailableTools = [
  ...allTools,
  // Gated onto the model catalog (systems profile or active DAP session).
  debugTool,
  ...advancedTools,
  ...compositeTools,
];

// Grouped tools for easy access
export const toolGroups = {
  basic: allTools,
  advanced: advancedTools,
  composite: compositeTools,
  readOnly: allAvailableTools.filter((t) => t.readonly),
  write: allAvailableTools.filter((t) => !t.readonly),
};

// Re-export individual tools for convenience
// Skill system singleton management
export { setSkillManager, getSkillManager } from "./implementations/skillSingleton";
export { getSkillToolDescription } from "./implementations/skill";

export {
  readFileTool,
  createNewFileTool,
  editFileTool,
  writeFileTool,
  applyPatchTool,
  runTerminalCommandTool,
  buildTool,
  awaitShellTool,
  ptyStartTool,
  ptySendTool,
  ptyReadTool,
  viewSubdirectoryTool,
  globTool,
  viewRepoMapTool,
  exactSearchTool,
  searchWebTool,
  viewDiffTool,
  readCurrentlyOpenFileTool,
  skillTool,
  lspTool,
  memoryTool,
  memoryGraphTool,
  memorySessionsTool,
  memoryManageTool,
  memoryLearnTool,
  taskTool,
  askUserTool,
  gitStatusTool,
  gitDiffTool,
  gitLogTool,
  gitBlameTool,
  gitCommitTool,
  gitBisectTool,
  qemuTool,
  debugTool,
  kconfigTool,
  maintainersTool,
  workspaceCheckpointTool,
  planTool,
  advancedTools,
  compositeTools,
};
