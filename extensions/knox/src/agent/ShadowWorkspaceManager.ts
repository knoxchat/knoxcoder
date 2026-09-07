import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import * as vscode from "vscode";

import { t } from "../i18n";

import {
  normalizeFsPath,
  PendingShadowEdit,
  resolveShadowRelativePath,
  ShadowDecision,
} from "./shadowWorkspace";

/**
 * Apply proposed content through the chat vertical-diff path
 * (open file → stream DiffLines). Wired by VsCodeMessenger.
 */
export type ShadowApplyHandler = (
  filePath: string,
  proposedContent: string,
  streamId?: string,
) => Promise<void>;

/**
 * Shadow workspace: stage AI-proposed file content in a temp tree, show
 * side-by-side `vscode.diff`, then Accept (chat apply path) or Reject.
 */
export class ShadowWorkspaceManager implements vscode.Disposable {
  private static instance: ShadowWorkspaceManager;
  private disposables: vscode.Disposable[] = [];
  private shadowWorkspacePath: string;
  private pending = new Map<string, PendingShadowEdit>();
  private resolvers = new Map<
    string,
    (decision: ShadowDecision) => void
  >();
  private diffEditors = new Map<string, vscode.TextEditor>();
  private applyHandler?: ShadowApplyHandler;

  private _onDiffCreated = new vscode.EventEmitter<{
    originalPath: string;
    shadowPath: string;
  }>();
  public readonly onDiffCreated = this._onDiffCreated.event;

  private _onDiffClosed = new vscode.EventEmitter<{ originalPath: string }>();
  public readonly onDiffClosed = this._onDiffClosed.event;

  public static getInstance(): ShadowWorkspaceManager {
    if (!ShadowWorkspaceManager.instance) {
      ShadowWorkspaceManager.instance = new ShadowWorkspaceManager();
    }
    return ShadowWorkspaceManager.instance;
  }

  private constructor() {
    const shadowDir = path.join(
      os.tmpdir(),
      `knox-shadow-${crypto.randomBytes(8).toString("hex")}`,
    );
    this.shadowWorkspacePath = shadowDir;

    this.registerCommands();
    this.registerEventHandlers();
    void this.initShadowWorkspace();
  }

  public setApplyHandler(handler: ShadowApplyHandler): void {
    this.applyHandler = handler;
  }

  /**
   * Apply proposed content through the chat vertical-diff path.
   * Used by callers that awaited Accept via previewAndAwaitDecision.
   */
  public async applyViaChatPath(
    filePath: string,
    proposedContent: string,
    streamId?: string,
  ): Promise<void> {
    const key = normalizeFsPath(filePath);
    if (this.applyHandler) {
      await this.applyHandler(key, proposedContent, streamId);
      return;
    }
    await fs.writeFile(key, proposedContent, "utf-8");
  }

  public getPendingPaths(): string[] {
    return [...this.pending.keys()];
  }

  public getPending(filePath: string): PendingShadowEdit | undefined {
    return this.pending.get(normalizeFsPath(filePath));
  }

  private registerCommands(): void {
    this.disposables.push(
      vscode.commands.registerCommand(
        "knox.showDiff",
        async (filePath?: string) => this.showDiff(filePath),
      ),
      vscode.commands.registerCommand(
        "knox.showDiffView",
        async (filePath?: string) => this.showDiff(filePath),
      ),
      vscode.commands.registerCommand(
        "knox.acceptShadowChanges",
        async (filePath?: string) => this.acceptChanges(filePath),
      ),
      vscode.commands.registerCommand(
        "knox.rejectShadowChanges",
        async (filePath?: string) => this.rejectChanges(filePath),
      ),
      vscode.commands.registerCommand(
        "knox.applyShadowChanges",
        async (filePath?: string) => {
          if (filePath) {
            return this.acceptChanges(filePath);
          }
          if (this.pending.size > 1) {
            return this.acceptAllPending();
          }
          return this.acceptChanges();
        },
      ),
      vscode.commands.registerCommand(
        "knox.closeDiffView",
        async (filePath?: string) => {
          const target = filePath ?? (await this.resolveTargetPath());
          if (target) {
            await this.closeDiffView(target);
          }
        },
      ),
    );
  }

  private registerEventHandlers(): void {
    vscode.window.onDidChangeVisibleTextEditors(
      (editors) => {
        for (const [origPath, editor] of this.diffEditors.entries()) {
          if (!editors.includes(editor)) {
            this.diffEditors.delete(origPath);
            this._onDiffClosed.fire({ originalPath: origPath });
          }
        }
      },
      null,
      this.disposables,
    );
  }

  private async initShadowWorkspace(): Promise<void> {
    try {
      await fs.mkdir(this.shadowWorkspacePath, { recursive: true });
    } catch (error) {
      console.error("Failed to initialize shadow workspace:", error);
      vscode.window.showErrorMessage(
        t("agent.shadow.failedInit", {
          message: (error as Error).message,
        }),
      );
    }
  }

  private workspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  private getShadowPath(originalPath: string): string {
    const key = normalizeFsPath(originalPath);
    const existing = this.pending.get(key);
    if (existing) {
      return existing.shadowPath;
    }
    const relative = resolveShadowRelativePath(key, this.workspaceRoot());
    return path.join(this.shadowWorkspacePath, relative);
  }

  /**
   * Stage proposed content in the shadow tree (does not touch the original).
   */
  public async updateShadowFile(
    originalPath: string,
    newContent: string,
    streamId?: string,
  ): Promise<string> {
    const key = normalizeFsPath(originalPath);
    const shadowPath = this.getShadowPath(key);

    await fs.mkdir(path.dirname(shadowPath), { recursive: true });
    await fs.writeFile(shadowPath, newContent, "utf-8");

    const prev = this.pending.get(key);
    this.pending.set(key, {
      originalPath: key,
      shadowPath,
      proposedContent: newContent,
      streamId: streamId ?? prev?.streamId,
    });
    await this.refreshShadowContext();
    return shadowPath;
  }

  /**
   * Show side-by-side diff for a pending (or currently active) shadow edit.
   */
  public async showDiff(filePath?: string): Promise<void> {
    try {
      const target = filePath
        ? normalizeFsPath(filePath)
        : await this.resolveTargetPath();
      if (!target) {
        vscode.window.showWarningMessage(t("agent.shadow.noPendingAny"));
        return;
      }

      const pending = this.pending.get(target);
      if (!pending) {
        vscode.window.showWarningMessage(
          t("agent.shadow.noPendingChanges", {
            file: path.basename(target),
          }),
        );
        return;
      }

      // Ensure shadow file matches proposed content (never overwrite with original).
      await fs.mkdir(path.dirname(pending.shadowPath), { recursive: true });
      await fs.writeFile(
        pending.shadowPath,
        pending.proposedContent,
        "utf-8",
      );

      const originalUri = vscode.Uri.file(pending.originalPath);
      const shadowUri = vscode.Uri.file(pending.shadowPath);

      await vscode.commands.executeCommand(
        "vscode.diff",
        originalUri,
        shadowUri,
        t("agent.shadow.diffTitle", { file: path.basename(target) }),
      );

      const activeEditor = vscode.window.activeTextEditor;
      if (activeEditor) {
        this.diffEditors.set(target, activeEditor);
      }

      await vscode.commands.executeCommand(
        "setContext",
        "knox.shadowDiffVisible",
        true,
      );
      this._onDiffCreated.fire({
        originalPath: target,
        shadowPath: pending.shadowPath,
      });
    } catch (error) {
      console.error("Error showing shadow diff:", error);
      vscode.window.showErrorMessage(
        t("agent.shadow.errorDiffView", {
          message: (error as Error).message,
        }),
      );
    }
  }

  /**
   * Stage proposed content, open diff, and wait for Accept/Reject.
   * When the user Accepts, the caller (e.g. applyToFile) continues the chat apply path.
   */
  public async previewAndAwaitDecision(
    originalPath: string,
    proposedContent: string,
    options?: { streamId?: string; promptUser?: boolean },
  ): Promise<ShadowDecision> {
    const key = normalizeFsPath(originalPath);
    await this.updateShadowFile(key, proposedContent, options?.streamId);
    await this.showDiff(key);

    return new Promise<ShadowDecision>((resolve) => {
      this.resolvers.set(key, resolve);
      if (options?.promptUser !== false) {
        void this.promptAcceptReject(key);
      }
    });
  }

  private async promptAcceptReject(filePath: string): Promise<void> {
    const file = path.basename(filePath);
    const choice = await vscode.window.showInformationMessage(
      t("agent.shadow.previewPrompt", { file }),
      { modal: true },
      t("agent.shadow.accept"),
      t("agent.shadow.reject"),
    );

    // User may have already decided via command/title button.
    if (!this.resolvers.has(normalizeFsPath(filePath))) {
      return;
    }

    if (choice === t("agent.shadow.accept")) {
      await this.acceptChanges(filePath);
    } else {
      // Reject button or dismiss/cancel — never leave applyToFile hanging.
      await this.rejectChanges(filePath);
    }
  }

  /**
   * Accept: resolve waiters (caller applies) OR run applyHandler for standalone Accept.
   * Never raw-writes the original when an apply handler / waiter is available.
   */
  public async acceptChanges(filePath?: string): Promise<boolean> {
    try {
      const target = filePath
        ? normalizeFsPath(filePath)
        : await this.resolveTargetPath();
      if (!target) {
        vscode.window.showWarningMessage(t("agent.shadow.noPendingAny"));
        return false;
      }

      const pending = this.pending.get(target);
      if (!pending) {
        vscode.window.showWarningMessage(
          t("agent.shadow.noPendingChanges", {
            file: path.basename(target),
          }),
        );
        return false;
      }

      const { proposedContent, streamId } = pending;
      const resolver = this.resolvers.get(target);

      // Close UI first so apply opens the real editor cleanly.
      await this.closeDiffView(target);
      this.resolvers.delete(target);

      if (resolver) {
        // Caller (applyToFile / previewEdit) continues the chat apply path.
        resolver("accept");
      } else if (this.applyHandler) {
        await this.applyHandler(target, proposedContent, streamId);
        vscode.window.showInformationMessage(
          t("agent.shadow.changesApplied", {
            file: path.basename(target),
          }),
        );
      } else {
        // Last resort: write directly (should be rare — handler is wired at activate).
        await fs.writeFile(target, proposedContent, "utf-8");
        vscode.window.showInformationMessage(
          t("agent.shadow.changesApplied", {
            file: path.basename(target),
          }),
        );
      }

      await this.clearPending(target);

      return true;
    } catch (error) {
      console.error("Error accepting shadow changes:", error);
      vscode.window.showErrorMessage(
        t("agent.shadow.errorAccepting", {
          message: (error as Error).message,
        }),
      );
      return false;
    }
  }

  public async rejectChanges(filePath?: string): Promise<boolean> {
    try {
      const target = filePath
        ? normalizeFsPath(filePath)
        : await this.resolveTargetPath();
      if (!target) {
        vscode.window.showWarningMessage(t("agent.shadow.noPendingAny"));
        return false;
      }

      const pending = this.pending.get(target);
      if (!pending) {
        vscode.window.showWarningMessage(
          t("agent.shadow.noPendingChanges", {
            file: path.basename(target),
          }),
        );
        return false;
      }

      const resolver = this.resolvers.get(target);
      await this.closeDiffView(target);
      this.resolvers.delete(target);
      await this.clearPending(target);

      if (resolver) {
        resolver("reject");
      }

      vscode.window.showInformationMessage(
        t("agent.shadow.changesRejected", {
          file: path.basename(target),
        }),
      );
      return true;
    } catch (error) {
      console.error("Error rejecting shadow changes:", error);
      vscode.window.showErrorMessage(
        t("agent.shadow.errorRejecting", {
          message: (error as Error).message,
        }),
      );
      return false;
    }
  }

  /**
   * Accept every pending shadow edit (standalone apply path).
   */
  public async acceptAllPending(): Promise<number> {
    const paths = [...this.pending.keys()];
    let count = 0;
    for (const p of paths) {
      if (await this.acceptChanges(p)) {
        count++;
      }
    }
    return count;
  }

  public async closeDiffView(filePath: string): Promise<void> {
    const key = normalizeFsPath(filePath);
    try {
      const editor = this.diffEditors.get(key);
      if (editor) {
        await vscode.window.showTextDocument(editor.document, {
          preview: true,
          preserveFocus: false,
        });
        await vscode.commands.executeCommand(
          "workbench.action.closeActiveEditor",
        );
        this.diffEditors.delete(key);
        this._onDiffClosed.fire({ originalPath: key });
      }
    } catch (error) {
      console.error(`Error closing diff view for ${filePath}:`, error);
    }
    await this.refreshShadowContext();
  }

  private async clearPending(filePath: string): Promise<void> {
    const key = normalizeFsPath(filePath);
    const pending = this.pending.get(key);
    this.pending.delete(key);
    if (pending) {
      try {
        await fs.rm(pending.shadowPath, { force: true });
      } catch {
        // ignore missing shadow file
      }
    }
    await this.refreshShadowContext();
  }

  private async refreshShadowContext(): Promise<void> {
    await vscode.commands.executeCommand(
      "setContext",
      "knox.shadowDiffVisible",
      this.pending.size > 0,
    );
  }

  private async resolveTargetPath(): Promise<string | undefined> {
    const active = vscode.window.activeTextEditor?.document.uri.fsPath;
    if (active) {
      const normalized = normalizeFsPath(active);
      if (this.pending.has(normalized)) {
        return normalized;
      }
      // Diff right-hand side is the shadow path — map back.
      for (const [orig, pending] of this.pending) {
        if (normalizeFsPath(pending.shadowPath) === normalized) {
          return orig;
        }
      }
    }
    if (this.pending.size === 1) {
      return this.pending.keys().next().value;
    }
    if (this.pending.size > 1) {
      const pick = await vscode.window.showQuickPick(
        [...this.pending.keys()].map((p) => ({
          label: path.basename(p),
          description: p,
          path: p,
        })),
        { placeHolder: t("agent.shadow.pickPending") },
      );
      return pick?.path;
    }
    return undefined;
  }

  public dispose(): void {
    for (const resolve of this.resolvers.values()) {
      resolve("reject");
    }
    this.resolvers.clear();
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
    this.diffEditors.clear();
    this.pending.clear();
    void this.cleanupShadowWorkspace();
    this._onDiffCreated.dispose();
    this._onDiffClosed.dispose();
    void vscode.commands.executeCommand(
      "setContext",
      "knox.shadowDiffVisible",
      false,
    );
  }

  private async cleanupShadowWorkspace(): Promise<void> {
    try {
      await fs.rm(this.shadowWorkspacePath, { recursive: true, force: true });
    } catch (error) {
      console.error("Failed to clean up shadow workspace:", error);
    }
  }
}
