# Agent Mode Extension for VSCode

This extension adds VS Code host features around Knox Agent (checkpoints, shadow preview, diagnostics, DAP). **The product Agent loop is GUI chat** (`streamNormalInput` → Core `tools/call`). Classes below (`ReasoningEngine`, `CodeIntelligenceService`, …) are optional extension helpers — they are not the harness that runs `builtin_*` tools.

## Key Features

### 1. Task plan (product path)

The Agent loop plans with **`builtin_plan`** (create/add/update/complete). That plan is injected every turn and survives compaction. Do not call `ReasoningEngine.performTaskAnalysis` from GUI chat — that class is **legacy** (extension-only, not the harness).

```typescript
// Product path: the model calls builtin_plan. Optional leftover:
import { ReasoningEngine } from './agent';
// ReasoningEngine is quarantined. Prefer builtin_plan in Agent chat.
```

### 2. File Navigation Intelligence

The extension can automatically discover connections between files, helping you navigate your codebase more efficiently.

Example usage:
```typescript
// In your code:
import { CodeIntelligenceService } from './agent';

const codeIntelligence = CodeIntelligenceService.getInstance();
const relatedFiles = await codeIntelligence.findRelatedFiles('/path/to/component.tsx');

// Returns files that import this component, test files, etc.
console.log(relatedFiles);
```

### 3. Refactoring Tools

Refactoring uses real VS Code APIs — not invented Core tool names:

- **Rename** → `vscode.executeDocumentRenameProvider` (LSP)
- **Move file** → `workspace.fs.rename` (+ optional import path rewrite)
- **Extract method / interface** → LLM rewrite via `knox.llmComplete`, written to disk with undo snapshots

Example usage:
```typescript
import { RefactoringService } from './agent';

const refactoring = RefactoringService.getInstance();

await refactoring.renameSymbol('oldName', 'newName', ['/path/to/file1.ts']);
await refactoring.extractMethod('/path/to/file.ts', 10, 20, 'extractedMethod');
await refactoring.extractInterface('/path/to/class.ts', 'MyClass', 'IMyInterface');
```

### 4. Debug Integration

`builtin_debug` is the Agent DAP tool (launch/attach/breakpoint/continue/step/backtrace/locals/evaluate). It is on the model catalog for systems profile or an active debug session. `knox.analyzeDebugSession` and `@debugger` remain opt-in helpers around paused threads.

Example usage:
```typescript
import { DebugIntegrationService } from './agent';

const debugIntegration = DebugIntegrationService.getInstance();
const analysis = await debugIntegration.analyzeDebugSession();
```

Prefer `builtin_debug` from Agent chat.

### 5. Test Generation

Test generation calls Core `builtin_generate_tests` (LLM + file write). Coverage percentages are not fabricated — only a parsed test-case count is reported.

Example usage:
```typescript
import { TestGenerationService } from './agent';

const testGeneration = TestGenerationService.getInstance();
const result = await testGeneration.generateTests('/path/to/source.ts');
// result.testFilePath, result.testCount, result.coverage === null until tests are run
```

### 6. Shadow preview (optional Accept/Reject gate)

When `knoxchat.enableShadowPreview` is enabled, chat **Apply** to an existing non-empty file first stages the proposal in a temp shadow workspace and opens a side-by-side `vscode.diff`. Files over 4000 lines skip shadow unless `knoxchat.shadowPreviewLargeFiles` is true.

- **Accept** continues the normal chat apply path (`applyCodeBlock` → vertical diffs / `knoxchat.acceptDiff`).
- **Reject** discards the proposal; the original file is untouched.
- Standalone Accept (commands / agent `previewEdit`) applies via the same vertical-diff stream (`myersDiff` → `VerticalDiffManager.streamDiffLines`).

```typescript
import { AgentModeManager } from './agent';

const agent = AgentModeManager.getInstance();
// Stage + wait for Accept/Reject; Accept uses the chat apply path
await agent.previewEdit('/path/to/file.ts', proposedContents);
```

### 6b. Tool execution path

GUI chat and agent both execute tools through Core `tools/call` (`knox.callToolDirect` / protocol).

### 6c. Post-edit verification (shared with chat)

Mutating tools that go through Core `tools/call` (GUI chat and agent) run the same post-edit verification hook:

1. Core decides the tool is mutating (`shouldVerifyTool`)
2. If `verifyCommand` / systems profile is set, Core runs the compile oracle and skips LSP
3. C/asm/Kconfig edits skip LSP even without a command (clangd is not the kernel oracle) and tell the model to use `builtin_build`
4. Otherwise VS Code `IDE.runPostEditVerification` runs diagnostics + LLM auto-fix
5. Results are appended as context items for the model

Toggle: VS Code setting `knoxchat.enablePostEditVerification` (default on). Profile: `knoxchat.agentProfile` (`default` | `systems` | `auto`).

### 7. Command History

Mutating tool calls (`builtin_create_new_file`, `builtin_edit_file`, `builtin_write_file`, `builtin_apply_patch`, `composite_smart_edit`, `builtin_generate_tests`, etc.) snapshot file bytes on the shared Core `tools/call` path (GUI chat + agent) via `IDE.captureMutatingToolBefore` / `recordMutatingToolAfter`. Undo restores the before snapshot; redo restores the after snapshot (captured after post-edit verification). Multi-file patches snapshot every path in the patch.

Example usage:
```typescript
// In your code:
import { CommandHistoryService } from './agent';

const commandHistory = CommandHistoryService.getInstance();

// View operation history
await vscode.commands.executeCommand('knox.showOperationHistory');

// Undo/redo with the enhanced system (also bound to knox.undoLastOperation)
await vscode.commands.executeCommand('knox.enhancedUndo');
await vscode.commands.executeCommand('knox.enhancedRedo');
```

### 8. Project Structure Understanding

The extension can analyze and understand your project structure to better navigate and reason about your codebase.

Example usage:
```typescript
// In your code:
import { CodeIntelligenceService } from './agent';

const codeIntelligence = CodeIntelligenceService.getInstance();
const projectStructure = await codeIntelligence.analyzeProjectStructure();

console.log(projectStructure.mainModules); // Main modules in the project
console.log(projectStructure.entryPoints); // Entry points
console.log(projectStructure.dependencies); // Dependencies between modules
```

## Usage

Agent mode is **one switch**: the Chat / Agent tab in the sidebar (`session.mode === "agent"`) and the VS Code `AgentModeManager` stay in sync.

1. Switch to **Agent** in the chat toolbar, or toggle with `Ctrl+Shift+Alt+A` (or `Cmd+Shift+Alt+A` on Mac) — either one activates both GUI tools and extension features (checkpoints, undo, shadow preview, verification).
2. Use the agent to assist with coding tasks. Prefer `builtin_edit_file` / `builtin_write_file` / `builtin_apply_patch` over rewriting files in the terminal. Cycle Ask / Edits / Auto on the Agent tab (Shift+Tab). Long tests/servers: `background: true` or wait ~30s, then `builtin_await_shell`.
3. (Optional) Enable `knoxchat.enableShadowPreview` to review Apply edits in a side-by-side shadow diff before the vertical-diff apply path runs
4. Accept with `Ctrl+Shift+Alt+S` / Reject with `Ctrl+Shift+Alt+Backspace` while a shadow preview is open

## Worktree isolation

The Agent tab **Worktree** chip creates a `git worktree` (`knox/agent-*` under the system temp dir). While it is on, tool edits and the agent shell run in that tree. **Apply** copies changed files onto the current workspace (never `vmlinux` / `*.ko` / `qemu-system-*`). **Discard** (or toggling the chip off) removes the worktree without merging. Huge repos can pass `sparsePaths` (`arch/x86`, `kernel`, `mm`, …) and warn above 20k tracked files.

## Commands

- `knox.toggleAgentMode` - Toggle agent mode on/off (keybinding: `Ctrl+Shift+Alt+A` / `Cmd+Shift+Alt+A`). Syncs the GUI Chat/Agent tab.
  - Legacy aliases (same behavior): `knox.toggleAgentModeCommand`, `knoxchat.toggleAgentMode`, `knoxchat.activateAgentMode`
- `knox.isAgentModeActive` - Returns whether extension agent mode is **actually active** (not merely whether the manager was constructed)
  - Legacy alias: `knoxchat.isAgentModeActive`
- `knox.applyShadowChanges` / `knox.acceptShadowChanges` - Accept pending shadow preview (then chat apply path)
- `knox.rejectShadowChanges` - Reject pending shadow preview (discard)
- `knox.showDiffView` - Re-open the side-by-side shadow diff for a pending file
- `knox.undoLastOperation` - Undo last assistant file mutation (restores snapshot)
- `knox.redoLastOperation` - Redo last undone assistant file mutation
- `knox.enhancedUndo` / `knox.enhancedRedo` - Same snapshot undo/redo
- `knox.showOperationHistory` - Show the operation history
- `knox.clearOperationHistory` - Clear undo/redo stacks

## Keyboard Shortcuts

- Toggle Agent Mode: `Ctrl+Shift+Alt+A` (Mac: `Cmd+Shift+Alt+A`)
- Accept Shadow Preview: `Ctrl+Shift+Alt+S` (Mac: `Cmd+Shift+Alt+S`) when `knox.shadowDiffVisible`
- Reject Shadow Preview: `Ctrl+Shift+Alt+Backspace` (Mac: `Cmd+Shift+Alt+Backspace`) when `knox.shadowDiffVisible`
- Undo Last Operation: `Ctrl+Shift+Alt+Z` (Mac: `Cmd+Shift+Alt+Z`) when agent mode is active and undo is available
- Redo Last Operation: `Ctrl+Shift+Alt+Y` (Mac: `Cmd+Shift+Alt+Y`) when agent mode is active and redo is available