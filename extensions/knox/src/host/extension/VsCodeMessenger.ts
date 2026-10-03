import { ConfigHandler } from "core/config/ConfigHandler";
import { myersDiff } from "core/diff/myers";
import { getKnoxChatModels } from "core/llm/knoxChatModels";
import { getOpenRouterModels } from "core/llm/openrouterModels";
import {
  FromCoreProtocol,
  FromWebviewProtocol,
  ToCoreProtocol,
} from "core/protocol";
import { ToWebviewFromCoreProtocol } from "core/protocol/coreWebview";
import { ToIdeFromWebviewOrCoreProtocol } from "core/protocol/ide";
import { ToIdeFromCoreProtocol } from "core/protocol/ideCore";
import { InProcessMessenger, Message } from "core/protocol/messenger";
import {
  CORE_TO_WEBVIEW_PASS_THROUGH,
  WEBVIEW_TO_CORE_PASS_THROUGH,
} from "core/protocol/passThrough";
import { stripImages } from "core/util/messageContent";
import { getUriPathBasename } from "core/util/uri";
import * as crypto from "crypto";
import * as vscode from "vscode";

import { AgentModeManager } from "../agent/AgentModeManager";
import { ShadowWorkspaceManager } from "../agent/ShadowWorkspaceManager";
import { runApplyToFile } from "../diff/applyToFile";
import { createVsCodeApplyToFileHost } from "../diff/applyToFileHost";
import { BatchDiffManager } from "../diff/batchDiff/BatchDiffManager";
import { BATCH_DIFF_PROTOCOL } from "../diff/batchDiff/batchDiff";
import { t } from "../i18n";
import { setGuiLanguage } from "../i18n/guiLanguage";

import { CheckpointChatIntegration } from "../checkpoints/commands";
import { isWorkspaceMismatchError } from "../checkpoints/CheckpointManager";
import {
  getActiveChatSessionId,
  notifyCheckpointHistoryChanged,
  setActiveChatSessionId,
} from "../checkpoints/historyEvents";
import { setCheckpointRestoreListener } from "../checkpoints/notifyRestore";
import { SmartCheckpointManager, AICheckpointIntegration } from "../checkpoints/SmartCheckpointManager";
import { VerticalDiffManager } from "../diff/vertical/manager";
import { isMemoryWriteMessage } from "../memory/memoryEvents";
import { MemoryView } from "../memory/MemoryView";
import EditDecorationManager from "../quickEdit/EditDecorationManager";
import { getExtensionUri } from "../util/vscode";
import { VsCodeIde } from "../VsCodeIde";
import { VsCodeWebviewProtocol } from "../webviewProtocol";
import { KnoxOAuthController } from "../oauth/KnoxOAuthController";
import { OpenRouterOAuthController } from "../oauth/OpenRouterOAuthController";
import { openRouterKeySettingsUrl } from "core/protocol/openrouterOAuth";
import {
  buildNativeAgentRequest,
  checkNativeDoomLoop,
  evaluateNativeToolPolicy,
  hydrateNativeAssistant,
  resolveNativeDoomLoopThreshold,
} from "./nativeAgentRequest";
import { getWorkspaceHookRunner } from "core/hooks/workspaceHooks";
import {
  cancelSharedChatTurn,
  runSharedChatTurn,
  type SharedChatTurnDeps,
} from "./sharedChatTurn";
import { finishNativeTurn, runMemoryPostTurn, startNativeTurn } from "./nativeTurn";


/**
 * A shared messenger class between Core and Webview
 * so we don't have to rewrite some of the handlers
 */
type TODO = any;
type ToIdeOrWebviewFromCoreProtocol = ToIdeFromCoreProtocol &
  ToWebviewFromCoreProtocol;

export class VsCodeMessenger {
  onWebview<T extends keyof FromWebviewProtocol>(
    messageType: T,
    handler: (
      message: Message<FromWebviewProtocol[T][0]>,
    ) => Promise<FromWebviewProtocol[T][1]> | FromWebviewProtocol[T][1],
  ): void {
    void this.webviewProtocol.on(messageType, handler);
  }

  onCore<T extends keyof ToIdeOrWebviewFromCoreProtocol>(
    messageType: T,
    handler: (
      message: Message<ToIdeOrWebviewFromCoreProtocol[T][0]>,
    ) =>
      | Promise<ToIdeOrWebviewFromCoreProtocol[T][1]>
      | ToIdeOrWebviewFromCoreProtocol[T][1],
  ): void {
    this.inProcessMessenger.externalOn(messageType, handler);
  }

  onWebviewOrCore<T extends keyof ToIdeFromWebviewOrCoreProtocol>(
    messageType: T,
    handler: (
      message: Message<ToIdeFromWebviewOrCoreProtocol[T][0]>,
    ) =>
      | Promise<ToIdeFromWebviewOrCoreProtocol[T][1]>
      | ToIdeFromWebviewOrCoreProtocol[T][1],
  ): void {
    this.onWebview(messageType, handler);
    this.onCore(messageType, handler);
  }

  constructor(
    private readonly inProcessMessenger: InProcessMessenger<
      ToCoreProtocol,
      FromCoreProtocol
    >,
    private readonly webviewProtocol: VsCodeWebviewProtocol,
    private readonly ide: VsCodeIde,
    private readonly verticalDiffManagerPromise: Promise<VerticalDiffManager>,
    private readonly configHandlerPromise: Promise<ConfigHandler>,
    private readonly editDecorationManager: EditDecorationManager,
    private readonly checkpointIntegration?: CheckpointChatIntegration,
    private readonly aiCheckpointIntegration?: AICheckpointIntegration,
  ) {
    // Shadow Accept → same vertical-diff apply path as chat Apply.
    void this.verticalDiffManagerPromise.then((verticalDiffManager) => {
      ShadowWorkspaceManager.getInstance().setApplyHandler(
        async (filePath, proposedContent, streamId) => {
          await this.ide.openFile(filePath);
          const editor = vscode.window.activeTextEditor;
          if (!editor) {
            throw new Error(t("diff.noActiveEditorApply"));
          }
          const oldContent = editor.document.getText();
          const lines = myersDiff(oldContent, proposedContent);
          async function* diffStream() {
            for (const line of lines) {
              yield line;
            }
          }
          await verticalDiffManager.streamDiffLines(
            diffStream(),
            true,
            streamId ?? crypto.randomUUID(),
            editor.document.uri.toString(),
          );
        },
      );
    });

    setCheckpointRestoreListener((payload) => {
      this.webviewProtocol.send("checkpointRestored", payload);
    });

    /** WEBVIEW ONLY LISTENERS **/
    const agentModeManager = AgentModeManager.getInstance();
    agentModeManager.onActiveChanged((active) => {
      this.webviewProtocol.send("agentModeChanged", { active });
    });
    this.onWebview("setAgentMode", async (msg) => {
      await agentModeManager.setActive(msg.data.active, {
        silent: true,
        sessionId: msg.data.sessionId,
      });
      const active = agentModeManager.isActive();
      return { success: true, active };
    });

    this.onWebview("showFile", (msg) => {
      this.ide.openFile(msg.data.filepath);
    });

    this.onWebview("vscode/openMoveRightMarkdown", (msg) => {
      vscode.commands.executeCommand(
        "markdown.showPreview",
        vscode.Uri.joinPath(
          getExtensionUri(),
          "media",
          "move-chat-panel-right.md",
        ),
      );
    });

    this.onWebview("toggleDevTools", (msg) => {
      vscode.commands.executeCommand("knoxchat.viewLogs");
    });
    this.onWebview("reloadWindow", (msg) => {
      vscode.commands.executeCommand("workbench.action.reloadWindow");
    });
    this.onWebview("focusEditor", (msg) => {
      vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
    });

    // KN-371: native GUI tools support reads this same KN-253 /v1/models cache.
    this.onWebview("knoxchat/listModels", async () => {
      return getKnoxChatModels();
    });
    this.onWebview("openrouter/listModels", async () => {
      return getOpenRouterModels();
    });

    const knoxOAuth = new KnoxOAuthController(
      this.ide,
      this.webviewProtocol,
      this.configHandlerPromise,
    );
    // KN-360: native GUI oauth quartet. Tokens stay in SecretStorage; browser open is host.
    this.onWebview("knoxchat/oauth/status", () => knoxOAuth.status());
    this.onWebview("knoxchat/oauth/start", async () => {
      void knoxOAuth.startLogin();
    });
    this.onWebview("knoxchat/oauth/cancel", () => {
      knoxOAuth.cancel();
    });
    this.onWebview("knoxchat/oauth/signOut", async () => {
      await knoxOAuth.signOut();
    });

    const openrouterOAuth = new OpenRouterOAuthController({
      secrets: this.ide.secretStorage,
      accounts: this.ide.extensionContext.globalState,
      sendUpdate: (status) => {
        this.webviewProtocol.send("openrouter/oauth/update", status);
      },
      openBrowser: async (url) => {
        await vscode.env.openExternal(vscode.Uri.parse(url));
      },
      callbackPage: () => ({
        lang: vscode.env.language.startsWith("zh") ? "zh-Hans" : "en",
        title: t("oauth.openrouterCallbackTitle"),
        body: t("oauth.openrouterCallbackClose"),
      }),
      reloadConfig: async () => {
        const configHandler = await this.configHandlerPromise;
        await configHandler.reloadConfig();
      },
      warnSignOut: (account) => {
        const manage = t("oauth.manageKey");
        void vscode.window
          .showWarningMessage(
            t("oauth.openrouterSignedOutLocal"),
            ...(account?.keyHash ? [manage] : []),
          )
          .then((choice) => {
            if (choice === manage && account?.keyHash) {
              void vscode.env.openExternal(
                vscode.Uri.parse(openRouterKeySettingsUrl(account.keyHash)),
              );
            }
          });
      },
    });
    this.ide.extensionContext.subscriptions.push(openrouterOAuth);
    this.onWebview("openrouter/oauth/status", () => openrouterOAuth.status());
    this.onWebview("openrouter/oauth/start", async () => {
      void openrouterOAuth.startLogin();
    });
    this.onWebview("openrouter/oauth/cancel", () => {
      openrouterOAuth.cancel();
    });
    this.onWebview("openrouter/oauth/signOut", async () => {
      await openrouterOAuth.signOut();
    });

    this.onWebview("acceptDiff", async ({ data: { filepath, streamId } }) => {
      await vscode.commands.executeCommand(
        "knoxchat.acceptDiff",
        filepath,
        streamId,
      );
    });

    this.onWebview("rejectDiff", async ({ data: { filepath, streamId } }) => {
      await vscode.commands.executeCommand(
        "knoxchat.rejectDiff",
        filepath,
        streamId,
      );
    });

    // ── Batch Diff Handlers (KN-344 native /batch-diff) ──
    this.onWebview(BATCH_DIFF_PROTOCOL.getPendingFiles, async () => {
      return (await this.batchDiffManager()).pendingFilesPayload();
    });

    this.onWebview(BATCH_DIFF_PROTOCOL.acceptAll, async () => {
      return (await this.batchDiffManager()).applyKind("acceptAll");
    });

    this.onWebview(BATCH_DIFF_PROTOCOL.rejectAll, async () => {
      return (await this.batchDiffManager()).applyKind("rejectAll");
    });

    this.onWebview(BATCH_DIFF_PROTOCOL.acceptSelected, async ({ data: { fileUris } }) => {
      return (await this.batchDiffManager()).applyKind("acceptSelected", fileUris);
    });

    this.onWebview(BATCH_DIFF_PROTOCOL.rejectSelected, async ({ data: { fileUris } }) => {
      return (await this.batchDiffManager()).applyKind("rejectSelected", fileUris);
    });

    this.onWebview("applyToFile", async ({ data }) => {
      await runApplyToFile(
        createVsCodeApplyToFileHost({
          ide: this.ide,
          webviewProtocol,
          verticalDiffManagerPromise: this.verticalDiffManagerPromise,
          configHandlerPromise: this.configHandlerPromise,
        }),
        data,
      );
    });

    this.onWebview(
      "overwriteFile",
      async ({ data: { prevFileContent, filepath } }) => {
        // null means the file did not exist before the edit — undo = delete.
        if (prevFileContent === null) {
          const uri =
            filepath.includes("://")
              ? vscode.Uri.parse(filepath)
              : vscode.Uri.file(filepath);

          try {
            // Close open tabs first so a dirty buffer cannot recreate the file.
            for (const group of vscode.window.tabGroups.all) {
              for (const tab of group.tabs) {
                const input = tab.input as { uri?: vscode.Uri } | undefined;
                const tabUri = input?.uri;
                if (
                  tabUri &&
                  (tabUri.toString() === uri.toString() ||
                    tabUri.fsPath === uri.fsPath)
                ) {
                  await vscode.window.tabGroups.close(tab, true);
                }
              }
            }

            await vscode.workspace.fs.delete(uri, { useTrash: false });
          } catch (error) {
            const code =
              error && typeof error === "object" && "code" in error
                ? String((error as { code?: string }).code)
                : "";
            const message =
              error instanceof Error ? error.message : String(error);
            if (
              code === "FileNotFound" ||
              message.includes("ENOENT") ||
              message.toLowerCase().includes("not found")
            ) {
              return;
            }
            console.error(
              `[overwriteFile] Failed to delete "${filepath}":`,
              message,
            );
            vscode.window.showErrorMessage(
              t("diff.deleteFileFailed", {
                filepath: getUriPathBasename(filepath),
              }),
            );
          }
          return;
        }

        await this.ide.openFile(filepath);

        // Get active text editor
        const editor = vscode.window.activeTextEditor;

        if (!editor) {
          vscode.window.showErrorMessage(t("diff.noActiveEditorApply"));
          return;
        }

        editor.edit((builder) =>
          builder.replace(
            new vscode.Range(
              editor.document.positionAt(0),
              editor.document.positionAt(editor.document.getText().length),
            ),
            prevFileContent,
          ),
        );
      },
    );

    this.onWebview("insertAtCursor", async (msg) => {
      const editor = vscode.window.activeTextEditor;
      if (editor === undefined || !editor.selection) {
        return;
      }

      editor.edit((editBuilder) => {
        editBuilder.replace(
          new vscode.Range(editor.selection.start, editor.selection.end),
          msg.data.text,
        );
      });
    });

    this.onWebview("setGuiLanguage", (msg) => {
      setGuiLanguage(msg.data.language);
    });

    this.onWebview("setActiveChatSession", (msg) => {
      setActiveChatSessionId(msg.data.sessionId);
    });

    this.onWebview("getActiveChatSession", () => ({
      sessionId: getActiveChatSessionId(),
    }));

    // Checkpoint message handlers
    this.onWebview("getCheckpointForMessage", async (msg) => {
      const { messageId } = msg.data;
      const checkpointId = this.checkpointIntegration?.getCheckpointForMessage(messageId);
      
      return { success: true, checkpointId: checkpointId || null };
    });

    this.onWebview("restoreCheckpoint", async (msg) => {
      const { checkpointId, rewindMemory } = msg.data;
      
      if (!this.checkpointIntegration) {
        console.error('Checkpoint integration not available');
        return { success: false };
      }

      try {
        // Use direct restore (no confirmation dialog) for seamless GUI experience
        const result = await this.checkpointIntegration.restoreCheckpointDirect(
          checkpointId,
          { rewindMemory },
        );
        if (result.success) {
          notifyCheckpointHistoryChanged();
        }
        return result;
      } catch (error) {
        console.error('Failed to restore checkpoint:', error);
        const errorMsg = error instanceof Error ? error.message : String(error);
        return { success: false, message: errorMsg };
      }
    });

    this.onWebview("createCheckpointForMessage", async (msg) => {
      const { messageId, description, stableId, conversationContext } = msg.data;
      
      if (this.checkpointIntegration) {
        const checkpointId = await this.checkpointIntegration.afterAgentResponse(messageId, description, stableId, conversationContext);
        return { checkpointId: checkpointId || null };
      }
      
      return { checkpointId: null };
    });

    this.onWebview("getCheckpointForStableId", async (msg) => {
      const { stableId } = msg.data;
      
      if (this.checkpointIntegration) {
        const checkpointId = this.checkpointIntegration.getCheckpointForStableId(stableId);
        return { checkpointId: checkpointId || null };
      }
      
      return { checkpointId: null };
    });

    // AI Context handlers removed - AI Context functionality has been removed

    this.onWebview("getContextualAssistance" as any, async (msg) => {
      const data = msg.data as any;
      const { cursorPosition, selectedText } = data;
      
      if (this.aiCheckpointIntegration) {
        try {
          const context = await (this.aiCheckpointIntegration as any).provideContextualAssistance(cursorPosition, selectedText);
          return { success: true, context };
        } catch (error) {
          console.error('Failed to get contextual assistance:', error);
          const errorMessage = error instanceof Error ? error.message : String(error);
          return { success: false, error: errorMessage };
        }
      }
      
      return { success: false, error: "AI context system not initialized" };
    });

    this.onWebview("getDebuggingContext" as any, async (msg) => {
      const data = msg.data as any;
      const { errorMessage, stackTrace } = data;
      
      if (this.aiCheckpointIntegration) {
        try {
          const context = await (this.aiCheckpointIntegration as any).provideDebuggingContext(errorMessage, stackTrace);
          return { success: true, context };
        } catch (error) {
          console.error('Failed to get debugging context:', error);
          const errorMessage = error instanceof Error ? error.message : String(error);
          return { success: false, error: errorMessage };
        }
      }
      
      return { success: false, error: "AI context system not initialized" };
    });

    this.onWebview("getRefactoringContext" as any, async (msg) => {
      const data = msg.data as any;
      const { refactoringType, targetElement } = data;
      
      if (this.aiCheckpointIntegration) {
        try {
          const context = await (this.aiCheckpointIntegration as any).provideRefactoringContext(refactoringType, targetElement);
          return { success: true, context };
        } catch (error) {
          console.error('Failed to get refactoring context:', error);
          const errorMessage = error instanceof Error ? error.message : String(error);
          return { success: false, error: errorMessage };
        }
      }
      
      return { success: false, error: "AI context system not initialized" };
    });

    this.onWebview("getSemanticAnalysis" as any, async (msg) => {
      const data = msg.data as any;
      const { filePath } = data;
      
      if (this.aiCheckpointIntegration) {
        try {
          const analysis = await (this.aiCheckpointIntegration as any).getSemanticAnalysisForFile(filePath);
          return { success: true, analysis };
        } catch (error) {
          console.error('Failed to get semantic analysis:', error);
          const errorMessage = error instanceof Error ? error.message : String(error);
          return { success: false, error: errorMessage };
        }
      }
      
      return { success: false, error: "AI context system not initialized" };
    });

    // AI Checkpoint Integration handlers
    (this.onWebview as any)("startAISession", async (msg: any) => {
      const { sessionId, filesToWork } = msg.data as { sessionId: string; filesToWork?: string[] };
      
      if (this.aiCheckpointIntegration) {
        await this.aiCheckpointIntegration.onAgentStart(sessionId, filesToWork || []);
      }
      
      return { success: true };
    });

    (this.onWebview as any)("stopAISession", async (msg: any) => {
      const { description } = msg.data as { description?: string };
      
      if (this.aiCheckpointIntegration) {
        const checkpointId = await this.aiCheckpointIntegration.onAgentComplete(description);
        return { success: true, checkpointId };
      }
      
      return { success: false };
    });

    (this.onWebview as any)("trackAIFiles", async (msg: any) => {
      const { filePaths } = msg.data as { filePaths: string[] };
      
      if (this.aiCheckpointIntegration) {
        await this.aiCheckpointIntegration.onFilesAboutToChange(filePaths);
      }
      
      return { success: true };
    });

    (this.onWebview as any)("createAICheckpoint", async (msg: any) => {
      const { description } = msg.data as { description?: string };
      
      if (this.aiCheckpointIntegration) {
        const checkpointId = await this.aiCheckpointIntegration.onFilesChanged(description);
        return { success: true, checkpointId };
      }
      
      return { success: false };
    });

    (this.onWebview as any)("enterChatMode", async (msg: any) => {
      if (this.aiCheckpointIntegration) {
        await this.aiCheckpointIntegration.enterChatMode();
      }
      
      return { success: true };
    });

    this.onWebview("listCheckpoints", async (msg) => {
      if (this.checkpointIntegration) {
        const listed = await this.checkpointIntegration.listCheckpoints(msg.data);
        return {
          checkpoints: listed.checkpoints || [],
          total: listed.total ?? listed.checkpoints?.length ?? 0,
          offset: listed.offset ?? 0,
          limit: listed.limit ?? listed.checkpoints?.length ?? 0,
          hasMore: listed.hasMore === true,
          compareCatalog: listed.compareCatalog || [],
          activeWorkspacePath: listed.activeWorkspacePath,
          workspaceFolders: listed.workspaceFolders || [],
        };
      }
      
      return {
        checkpoints: [],
        total: 0,
        offset: 0,
        limit: 0,
        hasMore: false,
        compareCatalog: [],
        workspaceFolders: [],
      };
    });

    this.onWebview("setActiveCheckpointWorkspace", async (msg) => {
      const { workspacePath } = msg.data;
      if (this.checkpointIntegration) {
        const success = await this.checkpointIntegration.setActiveWorkspace(workspacePath);
        if (success) {
          notifyCheckpointHistoryChanged();
        }
        return { success };
      }
      return { success: false };
    });

    this.onWebview("getCheckpointDetails", async (msg) => {
      const { checkpointId } = msg.data;
      
      if (this.checkpointIntegration) {
        const details = await this.checkpointIntegration.getCheckpointDetails(checkpointId);
        return { success: !!details, details };
      }
      
      return { success: false, details: null };
    });

    this.onWebview("getPreviousCheckpoint", async (msg) => {
      const { checkpointId } = msg.data;
      
      if (this.checkpointIntegration) {
        const details = await this.checkpointIntegration.getPreviousCheckpoint(checkpointId);
        return { success: !!details, details };
      }
      
      return { success: false, details: null };
    });

    this.onWebview("computeCheckpointDiff", async (msg) => {
      const { checkpointId, compareToCheckpointId, compareToWorkspace } = msg.data;

      if (this.checkpointIntegration) {
        const diff = await this.checkpointIntegration.computeCheckpointDiff(
          checkpointId,
          compareToCheckpointId,
          compareToWorkspace,
        );
        return { success: !!diff, diff };
      }
      
      return { success: false, diff: null };
    });

    this.onWebview("previewRestore", async (msg) => {
      const { checkpointId } = msg.data;

      if (!this.checkpointIntegration) {
        return { success: false, preview: null, message: "Checkpoint integration not available" };
      }

      try {
        const preview = await this.checkpointIntegration.previewRestore(checkpointId);
        return { success: !!preview, preview };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return { success: false, preview: null, message: errorMsg };
      }
    });

    this.onWebview("restoreCheckpointFiles", async (msg) => {
      const { checkpointId, relativePaths } = msg.data;

      if (this.checkpointIntegration) {
        const result = await this.checkpointIntegration.restoreCheckpointFiles(
          checkpointId,
          relativePaths,
        );
        if (result.success) {
          notifyCheckpointHistoryChanged();
        }
        return result;
      }

      return {
        success: false,
        restoredFiles: [],
        failedFiles: relativePaths.map((path: string) => ({
          path,
          error: "Checkpoint integration not available",
        })),
      };
    });

    this.onWebview("deleteCheckpoints", async (msg) => {
      const { checkpointIds } = msg.data;
      const checkpointIntegration = this.checkpointIntegration;
      
      if (checkpointIntegration) {
        const results = await Promise.all(
          checkpointIds.map(async (id: string) => ({
            checkpointId: id,
            success: await checkpointIntegration.deleteCheckpoint(id),
          }))
        );
        if (results.some((result) => result.success)) {
          notifyCheckpointHistoryChanged();
        }
        return { success: results.every((result) => result.success), results };
      }
      
      return { success: false };
    });

    this.onWebview("pinCheckpoint", async (msg) => {
      const { checkpointId, pinned } = msg.data;
      if (this.checkpointIntegration) {
        const success = await this.checkpointIntegration.pinCheckpoint(checkpointId, pinned);
        if (success) {
          notifyCheckpointHistoryChanged();
        }
        return { success };
      }
      return { success: false };
    });

    this.onWebview("getPerformanceDashboard", async (msg) => {
      if (!this.checkpointIntegration) {
        return { success: false, data: null };
      }
      try {
        const data = await this.checkpointIntegration.getPerformanceDashboard(
          msg.data?.historyDays,
        );
        return { success: true, data };
      } catch (error) {
        console.error("Failed to load checkpoint performance dashboard:", error);
        return { success: false, data: null };
      }
    });

    this.onWebview("getSharedCheckpointBundles", async (msg) => {
      if (!this.checkpointIntegration) {
        return { success: false, bundles: [], auditRecords: [] };
      }
      try {
        const panel = await this.checkpointIntegration.getSharedCheckpointPanel(
          msg.data?.limit,
        );
        return { success: true, bundles: panel.bundles, auditRecords: panel.auditRecords };
      } catch (error) {
        console.error("Failed to load shared checkpoint bundles:", error);
        return { success: false, bundles: [], auditRecords: [] };
      }
    });

    this.onWebview("shareCheckpoints", async (msg) => {
      if (!this.checkpointIntegration) {
        return { success: false, bundle: null, message: "Checkpoint integration not available" };
      }
      try {
        const bundle = await this.checkpointIntegration.shareCheckpoints(msg.data);
        if (!bundle) {
          return { success: false, cancelled: true, bundle: null };
        }
        notifyCheckpointHistoryChanged();
        return { success: true, bundle };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("Failed to share checkpoints:", error);
        return { success: false, bundle: null, message };
      }
    });

    this.onWebview("importSharedBundle", async (msg) => {
      if (!this.checkpointIntegration) {
        return { success: false, message: "Checkpoint integration not available" };
      }
      try {
        const importedCount = await this.checkpointIntegration.importSharedBundle(
          msg.data.filePath,
          { merge: msg.data.merge !== false, remapIds: msg.data.remapIds === true },
        );
        notifyCheckpointHistoryChanged();
        return { success: true, importedCount };
      } catch (error) {
        if (isWorkspaceMismatchError(error)) {
          return { success: false, cancelled: true, message: error.message };
        }
        const message = error instanceof Error ? error.message : String(error);
        console.error("Failed to import shared checkpoint bundle:", error);
        return { success: false, message };
      }
    });

    this.onWebview("getCheckpointTimeline", async (msg) => {
      if (!this.checkpointIntegration) {
        return { success: false, checkpoints: [], branches: [] };
      }
      try {
        const timeline = await this.checkpointIntegration.getCheckpointTimeline(msg.data?.limit);
        return { success: true, ...timeline };
      } catch (error) {
        console.error("Failed to load checkpoint timeline:", error);
        return { success: false, checkpoints: [], branches: [] };
      }
    });

    this.onWebview("createCheckpointBranch", async (msg) => {
      if (!this.checkpointIntegration) {
        return { success: false, branch: null, message: "Checkpoint integration not available" };
      }
      try {
        const result = await this.checkpointIntegration.createCheckpointBranch(
          msg.data.name,
          msg.data.baseCheckpointId,
          msg.data.description,
        );
        if (result.success) {
          notifyCheckpointHistoryChanged();
        }
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("Failed to create checkpoint branch:", error);
        return { success: false, branch: null, message };
      }
    });

    this.onWebview("switchCheckpointBranch", async (msg) => {
      if (!this.checkpointIntegration) {
        return { success: false, message: "Checkpoint integration not available" };
      }
      try {
        const result = await this.checkpointIntegration.switchCheckpointBranch(msg.data.branchId);
        if (result.success) {
          notifyCheckpointHistoryChanged();
        }
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("Failed to switch checkpoint branch:", error);
        return { success: false, message };
      }
    });

    this.onWebview("analyzeCheckpoint", async (msg) => {
      if (!this.checkpointIntegration) {
        return { success: false, analysis: null, message: "Checkpoint integration not available" };
      }
      try {
        return await this.checkpointIntegration.analyzeCheckpoint(msg.data.checkpointId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("Failed to analyze checkpoint:", error);
        return { success: false, analysis: null, message };
      }
    });

    this.onWebview("suggestCheckpointGroups", async (msg) => {
      if (!this.checkpointIntegration) {
        return { success: false, groups: [] };
      }
      try {
        return await this.checkpointIntegration.suggestCheckpointGroups(msg.data?.limit);
      } catch (error) {
        console.error("Failed to suggest checkpoint groups:", error);
        return { success: false, groups: [] };
      }
    });

    this.onWebview("revealSharedBundle", async (msg) => {
      if (!this.checkpointIntegration) {
        return { success: false, message: "Checkpoint integration not available" };
      }
      const success = await this.checkpointIntegration.revealSharedBundle(msg.data.filePath);
      return { success };
    });

    this.onWebview("getCheckpointConfig", async (msg) => {
      if (this.checkpointIntegration) {
        const config = await this.checkpointIntegration.getConfiguration();
        return { status: "success", config };
      }
      
      return { status: "error", config: null };
    });

    this.onWebview("saveCheckpointConfig", async (msg) => {
      if (this.checkpointIntegration) {
        const { config } = msg.data;
        const success = await this.checkpointIntegration.saveConfiguration(config);
        return { status: success ? "success" : "error" };
      }
      
      return { status: "error" };
    });
    this.onWebview("edit/sendPrompt", async (msg) => {
      const prompt = msg.data.prompt;
      const { start, end } = msg.data.range.range;
      const verticalDiffManager = await verticalDiffManagerPromise;

      const fileAfterEdit = await verticalDiffManager.streamEdit(
        stripImages(prompt),
        msg.data.selectedModelTitle,
        "edit",
        undefined,
        undefined,
        new vscode.Range(
          new vscode.Position(start.line, start.character),
          new vscode.Position(end.line, end.character),
        ),
      );

      void this.webviewProtocol.request("setEditStatus", {
        status: "accepting",
        fileAfterEdit,
      });
    });
    this.onWebview("edit/exit", async (msg) => {
      if (msg.data.shouldFocusEditor) {
        const activeEditor = vscode.window.activeTextEditor;

        if (activeEditor) {
          vscode.window.showTextDocument(activeEditor.document);
        }
      }

      editDecorationManager.clear();
    });

    this.onWebview("knox/buildAgentRequest", async (msg) => {
      const { config } = await (await this.configHandlerPromise).loadConfig();
      return buildNativeAgentRequest(msg.data, {
        ide: this.ide,
        configTools: config?.tools,
        experimental: config?.experimental,
      });
    });
    this.onWebview("knox/checkDoomLoop", async (msg) => {
      const { config } = await (await this.configHandlerPromise).loadConfig();
      return checkNativeDoomLoop(msg.data, config?.experimental);
    });
    this.onWebview("knox/evaluateToolPolicy", async (msg) => {
      const { config } = await (await this.configHandlerPromise).loadConfig();
      const dirs = await this.ide.getWorkspaceDirs().catch(() => []);
      return evaluateNativeToolPolicy(msg.data, config?.experimental, dirs);
    });
    this.onWebview("knox/hydrateAssistant", async (msg) => hydrateNativeAssistant(msg.data));

    // Shared loop (K-010): tools run through the existing core `tools/call` path.
    const sharedTurnDeps: SharedChatTurnDeps = {
      buildRequest: async (input) => {
        const { config } = await (await this.configHandlerPromise).loadConfig();
        return buildNativeAgentRequest(input, {
          ide: this.ide,
          configTools: config?.tools,
          experimental: config?.experimental,
        });
      },
      resolveLlm: async (title) =>
        (await this.configHandlerPromise).llmFromTitle(title),
      getDeferTools: () =>
        vscode.workspace.getConfiguration("knoxchat").get<boolean>("deferTools", true),
      getHooks: () => getWorkspaceHookRunner(this.ide),
      resolveFallbackLlm: async () => {
        const title = vscode.workspace
          .getConfiguration("knoxchat")
          .get<string>("fallbackModel", "")
          .trim();
        return title
          ? (await this.configHandlerPromise).llmFromTitle(title)
          : null;
      },
      callTool: (request) =>
        this.inProcessMessenger.externalRequest("tools/call", request),
      cancelTools: () => {
        void this.inProcessMessenger.externalRequest("tools/cancel", undefined);
      },
      emit: (sessionId, event) =>
        this.webviewProtocol.send("knox/chatTurnEvent", { sessionId, event }),
      getPolicy: async () => {
        const { config } = await (await this.configHandlerPromise).loadConfig();
        const experimental = config?.experimental;
        return {
          policy: experimental?.agentPolicy ?? null,
          policyFromRules: experimental?.agentPolicyFromRules ?? null,
          workspaceDirs: await this.ide.getWorkspaceDirs().catch(() => []),
          doomLoopThreshold: resolveNativeDoomLoopThreshold(experimental),
        };
      },
      ensureCheckpoint: async (sessionId, turnId) => {
        await this.ide.ensureTurnCheckpoint?.({
          sessionId,
          turnId,
          toolName: "chat_turn",
        });
      },
    };
    this.onWebview("knox/runChatTurn", (msg) =>
      runSharedChatTurn(msg.data, sharedTurnDeps),
    );
    this.onWebview("knox/cancelChatTurn", async (msg) => ({
      cancelled: await cancelSharedChatTurn(msg.data.sessionId, sharedTurnDeps),
    }));
    this.onWebview("knox/startTurn", async (msg) => {
      const dirs = await this.ide.getWorkspaceDirs().catch(() => []);
      return startNativeTurn(msg.data, dirs[0] ?? "");
    });
    this.onWebview("knox/finishTurn", async (msg) => {
      const dirs = await this.ide.getWorkspaceDirs().catch(() => []);
      await finishNativeTurn(msg.data, dirs[0] ?? "", () =>
        MemoryView.notifyMemoryChanged(),
      );
    });

    // ── Memory Brain integration ──
    this.onWebview("memory/buildContext", async (msg) => {
      try {
        const { MemoryPipeline } = await import("core/context/memory/brain/MemoryPipeline");
        const { BrainStore } = await import("core/context/memory/brain/BrainStore");
        await BrainStore.get();
        const config = BrainStore.getConfig();
        const result = await MemoryPipeline.runPreTurn({
          message: msg.data.message,
          session_id: msg.data.sessionId,
          max_tokens: msg.data.maxTokens ?? config.context_max_tokens,
          goal: msg.data.goal,
        });
        return {
          context: result.context?.context ?? null,
          items: result.context?.items ?? [],
          tokensSaved: result.context?.memory_tokens_saved ?? 0,
        };
      } catch (error) {
        console.warn("[Memory] Failed to build context:", error);
        return { context: null, items: [] };
      }
    });
    this.onWebview("memory/postTurn", async (msg) =>
      runMemoryPostTurn(msg.data, () => MemoryView.notifyMemoryChanged()),
    );
    this.onWebview("memory/autoStore", async (msg) => {
      try {
        const { autoStoreTask } = await import("core/context/soul/recordSoulEvent");
        await autoStoreTask({
          taskDescription: msg.data.taskDescription,
          filesModified: msg.data.filesModified,
          sessionSummary: msg.data.sessionSummary,
        });
        MemoryView.notifyMemoryChanged();
        return { success: true };
      } catch (error) {
        console.warn("[Memory] Failed to auto-store:", error);
        return { success: false };
      }
    });

    // M₁ sensory buffer: stream editor changes into active session (IMP-03, optional)
    let sensoryDebounce: ReturnType<typeof setTimeout> | null = null;
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.scheme !== "file") return;
      const changeText = event.contentChanges
        .map((c) => c.text)
        .join("")
        .trim();
      if (changeText.length < 8) return;

      if (sensoryDebounce) clearTimeout(sensoryDebounce);
      sensoryDebounce = setTimeout(() => {
        void (async () => {
          try {
            const { BrainManager } = await import("core/context/memory/brain/BrainManager");
            const { BrainStore } = await import("core/context/memory/brain/BrainStore");
            await BrainStore.get();
            const fileLabel = getUriPathBasename(event.document.uri.toString());
            BrainManager.ingestSensoryInput(
              `[${fileLabel}] ${changeText.slice(0, 500)}`,
            );
          } catch {
            // Best-effort sensory capture
          }
        })();
      }, 300);
    });

    /** PASS THROUGH FROM WEBVIEW TO CORE AND BACK **/
    WEBVIEW_TO_CORE_PASS_THROUGH.forEach((messageType) => {
      this.onWebview(messageType, async (msg) => {
        try {
          return await this.inProcessMessenger.externalRequest(
            messageType,
            msg.data,
            msg.messageId,
          );
        } finally {
          if (isMemoryWriteMessage(messageType, msg.data)) {
            MemoryView.notifyMemoryChanged();
          }
        }
      });
    });

    /** PASS THROUGH FROM CORE TO WEBVIEW AND BACK **/
    this.onCore("agent/jobUpdate", async (msg) => {
      const { recordAgentJobForTerminalMonitor } = await import(
        "../agent/TerminalMonitor"
      );
      recordAgentJobForTerminalMonitor(msg.data);
      return this.webviewProtocol.request("agent/jobUpdate", msg.data);
    });
    CORE_TO_WEBVIEW_PASS_THROUGH.forEach((messageType) => {
      if (messageType === "agent/jobUpdate") {
        return;
      }
      this.onCore(messageType, async (msg) => {
        return this.webviewProtocol.request(messageType, msg.data);
      });
    });

    /** CORE ONLY LISTENERS **/
    // None right now

    /** BOTH CORE AND WEBVIEW **/
    this.onWebviewOrCore("readRangeInFile", async (msg) => {
      return await vscode.workspace
        .openTextDocument(msg.data.filepath)
        .then((document) => {
          const start = new vscode.Position(0, 0);
          const end = new vscode.Position(5, 0);
          const range = new vscode.Range(start, end);

          const contents = document.getText(range);
          return contents;
        });
    });

    this.onWebviewOrCore("getIdeSettings", async (msg) => {
      return ide.getIdeSettings();
    });
    this.onWebviewOrCore("getDiff", async (msg) => {
      return ide.getDiff(msg.data.includeUnstaged);
    });
    this.onWebviewOrCore("getGitChangedFiles", async () => {
      return ide.getGitChangedFiles();
    });
    this.onWebviewOrCore("getTerminalContents", async (msg) => {
      return ide.getTerminalContents();
    });
    this.onWebviewOrCore("getDebugLocals", async (msg) => {
      return ide.getDebugLocals(Number(msg.data.threadIndex));
    });
    this.onWebviewOrCore("getAvailableThreads", async (msg) => {
      return ide.getAvailableThreads();
    });
    this.onWebviewOrCore("debugControl", async (msg) => {
      return ide.debugControl(msg.data);
    });
    this.onWebviewOrCore("getTopLevelCallStackSources", async (msg) => {
      return ide.getTopLevelCallStackSources(
        msg.data.threadIndex,
        msg.data.stackDepth,
      );
    });
    this.onWebviewOrCore("getWorkspaceDirs", async (msg) => {
      return ide.getWorkspaceDirs();
    });
    this.onWebviewOrCore("writeFile", async (msg) => {
      return ide.writeFile(msg.data.path, msg.data.contents);
    });
    this.onWebviewOrCore("showVirtualFile", async (msg) => {
      return ide.showVirtualFile(msg.data.name, msg.data.content);
    });
    this.onWebviewOrCore("openFile", async (msg) => {
      return ide.openFile(msg.data.path);
    });
    this.onWebviewOrCore("showStagedDiff", async (msg) => {
      return ide.showStagedDiff(
        msg.data.fileUri,
        msg.data.before,
        msg.data.after,
      );
    });
    this.onWebviewOrCore("openGitChange", async (msg) => {
      return ide.openGitChange(msg.data.uri);
    });
    this.onWebviewOrCore("runCommand", async (msg) => {
      await ide.runCommand(msg.data.command);
    });
    this.onWebviewOrCore("getSearchResults", async (msg) => {
      return ide.getSearchResults(msg.data.query, msg.data.options);
    });
    this.onWebviewOrCore("subprocess", async (msg) => {
      return ide.subprocess(msg.data.command, msg.data.cwd);
    });
    this.onWebviewOrCore("getProblems", async (msg) => {
      return ide.getProblems(msg.data.filepath);
    });
    this.onWebviewOrCore("getBranch", async (msg) => {
      const { dir } = msg.data;
      return ide.getBranch(dir);
    });
    this.onWebviewOrCore("getOpenFiles", async (msg) => {
      return ide.getOpenFiles();
    });
    this.onWebviewOrCore("getCurrentFile", async () => {
      return ide.getCurrentFile();
    });
    this.onWebviewOrCore("getPinnedFiles", async (msg) => {
      return ide.getPinnedFiles();
    });
    this.onWebviewOrCore("showLines", async (msg) => {
      const { filepath, startLine, endLine } = msg.data;
      return ide.showLines(filepath, startLine, endLine);
    });
    this.onWebviewOrCore("showToast", (msg) => {
      this.ide.showToast(...msg.data);
    });
    this.onWebviewOrCore("saveFile", async (msg) => {
      return await ide.saveFile(msg.data.filepath);
    });
    this.onWebviewOrCore("readFile", async (msg) => {
      return await ide.readFile(msg.data.filepath);
    });
    this.onWebviewOrCore("openUrl", (msg) => {
      vscode.env.openExternal(vscode.Uri.parse(msg.data));
    });

    this.onWebviewOrCore("fileExists", async (msg) => {
      return await ide.fileExists(msg.data.filepath);
    });

    this.onWebviewOrCore("gotoDefinition", async (msg) => {
      return await ide.gotoDefinition(msg.data.location);
    });

    this.onWebviewOrCore("findReferences", async (msg) => {
      return await ide.findReferences(msg.data.location);
    });

    this.onWebviewOrCore("getHover", async (msg) => {
      return await ide.getHover(msg.data.location);
    });

    this.onWebviewOrCore("getDocumentSymbols", async (msg) => {
      return await ide.getDocumentSymbols(msg.data.filepath);
    });

    this.onWebviewOrCore("getWorkspaceSymbols", async (msg) => {
      return await ide.getWorkspaceSymbols(msg.data.query);
    });

    this.onWebviewOrCore("gotoImplementation", async (msg) => {
      return await ide.gotoImplementation(msg.data.location);
    });

    this.onWebviewOrCore("prepareCallHierarchy", async (msg) => {
      return await ide.prepareCallHierarchy(msg.data.location);
    });

    this.onWebviewOrCore("getIncomingCalls", async (msg) => {
      return await ide.getIncomingCalls(msg.data.location);
    });

    this.onWebviewOrCore("getOutgoingCalls", async (msg) => {
      return await ide.getOutgoingCalls(msg.data.location);
    });

    this.onWebviewOrCore("getFileStats", async (msg) => {
      return await ide.getFileStats(msg.data.files);
    });

    this.onWebviewOrCore("getGitRootPath", async (msg) => {
      return await ide.getGitRootPath(msg.data.dir);
    });

    this.onWebviewOrCore("listDir", async (msg) => {
      return await ide.listDir(msg.data.dir);
    });

    this.onWebviewOrCore("getRepoName", async (msg) => {
      return await ide.getRepoName(msg.data.dir);
    });

    this.onWebviewOrCore("getTags", async (msg) => {
      return await ide.getTags(msg.data);
    });

    this.onWebviewOrCore("getIdeInfo", async (msg) => {
      return await ide.getIdeInfo();
    });

    this.onWebviewOrCore("getUniqueId", async (msg) => {
      return await ide.getUniqueId();
    });
  }

  private async batchDiffManager(): Promise<BatchDiffManager> {
    const batchManager = BatchDiffManager.getInstance();
    const verticalDiffManager = await this.verticalDiffManagerPromise;
    batchManager.setVerticalDiffManager(verticalDiffManager);
    return batchManager;
  }
}
