import * as vscode from "vscode";

import {
  BATCH_DIFF_NAVIGATE_COMMAND,
  BATCH_DIFF_ROUTE,
} from "./batchDiff";

/**
 * KN-344: leftover tree-view constructor is gone.
 * createOrShow opens the native `/batch-diff` GUI route.
 */
export class BatchDiffView {
  static createOrShow(): void {
    void vscode.commands.executeCommand(
      BATCH_DIFF_NAVIGATE_COMMAND,
      BATCH_DIFF_ROUTE,
    );
  }
}
