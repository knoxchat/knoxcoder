# Host IDE adapters (not a second agent)

The product Agent loop is GUI / CLI / eval → `runChatTurn` / `runAgentLoop` → Core `tools/call`. This folder is VS Code glue only.

## Keep

- `AgentModeManager` — Ask / Edits / Auto switch and `knox.executeToolCall` → `knox.callToolDirect`
- `CommandHistoryService` — snapshot undo/redo (`knox.undoLastOperation`)
- `ShadowWorkspaceManager` — optional Accept/Reject preview
- `DiagnosticChecker` / `DiagnosticFixManager` — thin `IDE.runPostEditVerification` adapter (Core owns compile-oracle vs LSP)
- DAP helpers (`DebugIntegrationService`) for `@debugger` — not `builtin_debug`

Planning is **`builtin_plan`**. There is no host-side planner. Do not add a `ReasoningEngine` or route GUI chat through leftover classes.

## Leftover (do not extend)

`AgentService`, `ChatFlowCoordinator`, and `CodeIntelligenceService` are not the harness. `getAgentService()` throws. Project-structure helper commands are gone. File mutations must go through Core snapshots, not a second undo stack.

## Commands (IDE)

- `knox.toggleAgentMode`, `knox.undoLastOperation` / `knox.enhancedUndo`
- `knox.checkDiagnostics` / `knox.fixDiagnostics`
- Shadow preview accept/reject
- DAP helpers: `knox.analyzeDebugSession`, `knox.suggestFixForError`, `knox.addIntelligentBreakpoint`
