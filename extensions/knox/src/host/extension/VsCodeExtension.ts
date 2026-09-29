import fs from "fs";

import { IContextProvider } from "core";
import { ConfigHandler } from "core/config/ConfigHandler";
import { EXTENSION_NAME } from "core/config/extensionName";
import { Core } from "core/core";
import { FromCoreProtocol, ToCoreProtocol } from "core/protocol";
import { InProcessMessenger } from "core/protocol/messenger";
import {
  getConfigYamlPath,
} from "core/util/paths";
import { v4 as uuidv4 } from "uuid";
import * as vscode from "vscode";

// AI Context imports removed - AI Context functionality has been removed
import { CheckpointGraphView } from "../checkpoints/CheckpointGraphView";
import { registerCheckpointGraphMessages } from "../checkpoints/graphMessages";
import {
  notifyCheckpointHistoryChanged,
  onCheckpointHistoryChanged,
} from "../checkpoints/historyEvents";
import { CheckpointManager } from "../checkpoints/CheckpointManager";
import { CheckpointChatIntegration, registerCheckpointCommands } from "../checkpoints/commands";
import { CheckpointEnterpriseMonitor } from "../checkpoints/EnterpriseMonitor";
import { CheckpointSessionManager } from "../checkpoints/SessionManager";
import { SmartCheckpointManager, AICheckpointIntegration } from "../checkpoints/SmartCheckpointManager";
import { registerAllCommands } from "../commands";
import { registerDebugTracker } from "../debug/debug";
import { BatchDiffManager } from "../diff/batchDiff/BatchDiffManager";
import { VerticalDiffManager } from "../diff/vertical/manager";
import { KnoxGUIWebviewViewProvider } from "../KnoxGUIWebviewViewProvider";
import { isMemoryWriteMessage } from "../memory/memoryEvents";
import { MemoryView } from "../memory/MemoryView";
import { registerMemoryStatusBar } from "../memory/statusBar";
import { registerAllCodeLensProviders } from "../lang-server/codeLens";
import { registerAllPromptFilesCompletionProviders } from "../lang-server/promptFileCompletions";
import EditDecorationManager from "../quickEdit/EditDecorationManager";
import { QuickEdit } from "../quickEdit/QuickEditQuickPick";
import { FileSearch } from "../util/FileSearch";
import { VsCodeIde } from "../VsCodeIde";
import { ChatFlowCoordinator } from "../agent/ChatFlowCoordinator";
import { registerLanguageModelFeatures } from "../lm/registerLanguageModelFeatures";

import {
  CONFIG_YAML_LANGUAGE,
  pathsReferToSameFile,
  watchConfigYamlFile,
} from "./configYaml";
import { ConfigYamlDocumentLinkProvider } from "./ConfigYamlDocumentLinkProvider";
import { VsCodeMessenger } from "./VsCodeMessenger";

import type { VsCodeWebviewProtocol } from "../webviewProtocol";

export class VsCodeExtension {
  // Currently some of these are public so they can be used in testing (test/test-suites)

  private configHandler: ConfigHandler;
  private extensionContext: vscode.ExtensionContext;
  private ide: VsCodeIde;
  private sidebar: KnoxGUIWebviewViewProvider;
  private windowId: string;
  private editDecorationManager: EditDecorationManager;
  private verticalDiffManager: VerticalDiffManager;
  private checkpointManager: CheckpointManager;
  private checkpointIntegration: CheckpointChatIntegration;
  private smartCheckpointManager: SmartCheckpointManager;
  private aiCheckpointIntegration: AICheckpointIntegration;
  // AI Context providers removed - AI Context functionality has been removed
  webviewProtocolPromise: Promise<VsCodeWebviewProtocol>;
  private core: Core;
  private fileSearch: FileSearch;

  constructor(context: vscode.ExtensionContext) {
    // Register auth provider

    this.editDecorationManager = new EditDecorationManager(context);

    let resolveWebviewProtocol: any = undefined;
    this.webviewProtocolPromise = new Promise<VsCodeWebviewProtocol>(
      (resolve) => {
        resolveWebviewProtocol = resolve;
      },
    );
    this.ide = new VsCodeIde(this.webviewProtocolPromise, context);
    this.extensionContext = context;
    this.windowId = uuidv4();
    
    // Initialize checkpoint system
    this.checkpointManager = CheckpointManager.getInstance();
    this.smartCheckpointManager = SmartCheckpointManager.getInstance();
    this.aiCheckpointIntegration = new AICheckpointIntegration();
    
    // AI Context initialization removed - AI Context functionality has been removed
    
    try {
      this.checkpointIntegration = CheckpointChatIntegration.getInstance();
      console.log('✅ Checkpoint chat integration initialized successfully');
    } catch (error) {
      console.warn('⚠️ Failed to initialize checkpoint chat integration:', error);
      // Create a dummy integration to prevent crashes
      this.checkpointIntegration = null as any;
    }

    // Dependencies of core
    let resolveVerticalDiffManager: any = undefined;
    const verticalDiffManagerPromise = new Promise<VerticalDiffManager>(
      (resolve) => {
        resolveVerticalDiffManager = resolve;
      },
    );
    let resolveConfigHandler: any = undefined;
    const configHandlerPromise = new Promise<ConfigHandler>((resolve) => {
      resolveConfigHandler = resolve;
    });
    this.sidebar = new KnoxGUIWebviewViewProvider(
      configHandlerPromise,
      this.windowId,
      this.extensionContext,
    );
    this.sidebar.webviewProtocol.attachNativeClient();
    CheckpointGraphView.setNotifier(() => {
      this.sidebar.webviewProtocol.send("checkpointGraphUpdated", undefined);
    });
    MemoryView.setNotifier(() => {
      this.sidebar.webviewProtocol.send("memoryViewUpdated", undefined);
    });

    resolveWebviewProtocol(this.sidebar.webviewProtocol);

    // Config Handler with output channel
    const outputChannel = vscode.window.createOutputChannel(
      "Knox - LLM Prompt/Completion",
    );
    const inProcessMessenger = new InProcessMessenger<
      ToCoreProtocol,
      FromCoreProtocol
    >();

    new VsCodeMessenger(
      inProcessMessenger,
      this.sidebar.webviewProtocol,
      this.ide,
      verticalDiffManagerPromise,
      configHandlerPromise,
      this.editDecorationManager,
      this.checkpointIntegration || null,
      this.aiCheckpointIntegration,
    );

    registerCheckpointGraphMessages(
      this.sidebar.webviewProtocol,
      context,
      () => CheckpointGraphView.notifyHistoryChanged(),
    );
    this.sidebar.webviewProtocol.on("getCheckpointGraphShell", async () => {
      const manager = CheckpointManager.getInstance();
      const folderCount = vscode.workspace.workspaceFolders?.length ?? 0;
      const hasWorkspace = folderCount > 0 || !!manager.getCurrentWorkspacePath();
      const { resolveCheckpointGraphShell } = await import("../checkpoints/manager/graphShell");
      const { isListableCheckpoint } = await import("../checkpoints/manager/listQuery");
      const listableCount = hasWorkspace && manager.initialized
        ? manager.getCheckpointHistoryForWorkspace().filter((checkpoint) => isListableCheckpoint(checkpoint)).length
        : 0;
      const shell = resolveCheckpointGraphShell({
        hasWorkspace,
        initialized: manager.initialized,
        listableCount,
      });
      return {
        ...shell,
        workspaceFolders: (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
          path: folder.uri.fsPath,
          name: folder.name,
        })),
        activeWorkspacePath: manager.getCurrentWorkspacePath(),
      };
    });
    this.sidebar.webviewProtocol.on("checkpointGraph", async (msg) => {
      const manager = CheckpointManager.getInstance();
      const { buildCheckpointGraph } = await import("../checkpoints/manager/graphPayload");
      if (!manager.initialized) {
        return buildCheckpointGraph({ history: [], branches: [] });
      }
      const history = manager.getCheckpointHistoryForWorkspace();
      const branches = await manager.listBranches();
      const branchIds = msg.data?.activeBranchOnly
        ? (manager.activeBranchId ? [manager.activeBranchId] : [])
        : msg.data?.branchIds;
      return buildCheckpointGraph({
        history,
        branches,
        activeBranchId: manager.activeBranchId,
        limit: msg.data?.limit,
        branchIds,
      });
    });
    this.sidebar.webviewProtocol.on("runCheckpointGraphAction", async (msg) => {
      const action = msg.data.action;
      if (action === "openFolder") {
        await vscode.commands.executeCommand("workbench.action.files.openFolder");
        return { ok: true };
      }
      if (action === "createCheckpoint") {
        await vscode.commands.executeCommand("knox.checkpoints.create");
        return { ok: true };
      }
      if (action === "showConfiguration") {
        await vscode.commands.executeCommand("knox.checkpoints.showConfiguration");
        return { ok: true };
      }
      try {
        await CheckpointManager.getInstance().initialize(context);
        return { ok: CheckpointManager.getInstance().initialized };
      } catch {
        return { ok: false };
      }
    });
    this.sidebar.webviewProtocol.on("getMemoryViewUiState", () => {
      return context.workspaceState.get("memoryView") ?? null;
    });
    this.sidebar.webviewProtocol.on("saveMemoryViewUiState", async (msg) => {
      await context.workspaceState.update("memoryView", msg.data);
    });

    this.core = new Core(inProcessMessenger, this.ide, async (log: string) => {
      outputChannel.appendLine(
        "==========================================================================",
      );
      outputChannel.appendLine(
        "==========================================================================",
      );
      outputChannel.append(log);
    });
    this.configHandler = this.core.configHandler;
    resolveConfigHandler?.(this.configHandler);

    // Warm Core-process KnoxChat /v1/models cache (disk last-good + network)
    // before/alongside first config load so sync capability lookups succeed.
    void Promise.all([
      import("core/llm/knoxChatModels"),
      import("core/llm/knoxChatModelsDisk"),
    ]).then(
      ([
        { preloadKnoxChatModels, registerKnoxChatModelsDiskAdapter },
        { nodeKnoxChatModelsDiskAdapter },
      ]) => {
        registerKnoxChatModelsDiskAdapter(nodeKnoxChatModelsDiskAdapter);
        return preloadKnoxChatModels().catch((err) => {
          console.warn("[KnoxChat] models prefetch failed:", err);
        });
      },
    );

    this.configHandler.loadConfig();
    registerLanguageModelFeatures(context, this.configHandler);
    this.verticalDiffManager = new VerticalDiffManager(
      this.configHandler,
      this.sidebar.webviewProtocol,
      this.editDecorationManager,
    );
    resolveVerticalDiffManager?.(this.verticalDiffManager);
    BatchDiffManager.getInstance().setVerticalDiffManager(
      this.verticalDiffManager,
    );

    // Local config only (no remote org/profile sync).

    // Initialize Agent Mode Manager and connect streaming
    this.initializeAgentModeStreaming();

    // Register sendToWebview command so agent services can forward events to GUI
    // (KN-354 screenshot → addImageAttachment, and other host→native inbound).
    context.subscriptions.push(
      vscode.commands.registerCommand('knox.sendToWebview', (payload: { messageType: string; data: any }) => {
        this.sidebar.webviewProtocol.send(payload.messageType as any, payload.data);
      })
    );

    // Register direct tool call command for agent mode
    context.subscriptions.push(
      vscode.commands.registerCommand('knox.callToolDirect', async (params: { toolCall: any, selectedModelTitle: string, viewReadModelTitle?: string | null, realTimeSearchModelTitle?: string | null, preferredModel?: 'chat' | 'viewRead' | 'realTimeSearch' }) => {
        // Use the messenger to invoke the tools/call handler on Core
        const result = inProcessMessenger.invoke('tools/call', {
          toolCall: params.toolCall,
          selectedModelTitle: params.selectedModelTitle,
          viewReadModelTitle: params.viewReadModelTitle,
          realTimeSearchModelTitle: params.realTimeSearchModelTitle,
          preferredModel: params.preferredModel
        });
        
        // Handle both sync and async results from invoke
        try {
          const resolvedResult = await Promise.resolve(result);
          return resolvedResult.contextItems;
        } finally {
          if (isMemoryWriteMessage('tools/call', params)) {
            MemoryView.notifyMemoryChanged();
          }
        }
      })
    );

    // Register command for LLM completions (used by ReasoningEngine, etc.)
    context.subscriptions.push(
      vscode.commands.registerCommand('knox.llmComplete', async (params: { prompt: string; title?: string; completionOptions?: Record<string, unknown> }) => {
        const result = inProcessMessenger.invoke('llm/complete', {
          prompt: params.prompt,
          title: params.title ?? 'default',
          completionOptions: params.completionOptions ?? {},
        });
        return await Promise.resolve(result);
      })
    );

    // Register command to get current View/Read model for agent mode
    context.subscriptions.push(
      vscode.commands.registerCommand('knox.getCurrentViewReadModel', async () => {
        const { config } = await this.configHandler.loadConfig();
        if (!config) {
          console.log('[getCurrentViewReadModel] Config not loaded');
          return null;
        }
        const viewReadModelTitle = config.selectedModelByRole?.viewRead?.title || null;
        console.log(`[getCurrentViewReadModel] Returning View/Read model: ${viewReadModelTitle || 'null'}`);
        console.log(`[getCurrentViewReadModel] Full selectedModelByRole:`, config.selectedModelByRole);
        return viewReadModelTitle;
      })
    );

    // Register command to get current RealTimeSearch model for agent mode
    context.subscriptions.push(
      vscode.commands.registerCommand('knox.getCurrentRealTimeSearchModel', async () => {
        const { config } = await this.configHandler.loadConfig();
        if (!config) {
          console.log('[getCurrentRealTimeSearchModel] Config not loaded');
          return null;
        }
        const realTimeSearchModelTitle = config.selectedModelByRole?.realTimeSearch?.title || null;
        console.log(`[getCurrentRealTimeSearchModel] Returning RealTimeSearch model: ${realTimeSearchModelTitle || 'null'}`);
        console.log(`[getCurrentRealTimeSearchModel] Full selectedModelByRole:`, config.selectedModelByRole);
        return realTimeSearchModelTitle;
      })
    );

    const bindCodeLensRefresh = (config: Parameters<typeof registerAllCodeLensProviders>[2]) => {
      const { verticalDiffCodeLens } = registerAllCodeLensProviders(
        context,
        this.verticalDiffManager.fileUriToCodeLens,
        config,
      );
      this.verticalDiffManager.refreshCodeLens =
        verticalDiffCodeLens.refresh.bind(verticalDiffCodeLens);
    };

    this.configHandler.loadConfig().then(({ config }) => {
      try {
        bindCodeLensRefresh(config);
      } catch (error) {
        console.warn("Knox code lens registration failed:", error);
      }
    });
    
    // Initialize checkpoint system with proper error handling
    this.initializeCheckpointSystem(context);

    // Initialize enterprise monitoring with proper error handling
    this.initializeEnterpriseMonitoring(context);
    
    // Register enterprise checkpoint commands
    registerCheckpointCommands(context);

    registerMemoryStatusBar(context);
    
    // AI Context commands removed - AI Context functionality has been removed
    
    // Notify webview when checkpoints change (only if checkpoint system is ready)
    context.subscriptions.push(
      onCheckpointHistoryChanged(() => {
        this.sidebar?.webviewProtocol?.send("checkpointListUpdated", undefined);
        CheckpointGraphView.notifyHistoryChanged();
      }),
    );
    try {
      this.checkpointManager.onCheckpointCreated(() => {
        notifyCheckpointHistoryChanged();
      });
      this.checkpointManager.onActiveWorkspaceChanged(() => {
        notifyCheckpointHistoryChanged();
      });
    } catch (error) {
      console.warn('⚠️ Could not set up checkpoint event listener:', error);
    }

    context.subscriptions.push(
      this.ide.ideUtils.watchGitChanges(() => {
        this.sidebar?.webviewProtocol?.send("gitStateChanged", undefined);
      }),
    );

    // Set up workspace change handling for session management
    context.subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders(async (event) => {
        try {
          const sessionManager = CheckpointSessionManager.getInstance();
          await sessionManager.onWorkspaceChanged(event);
        } catch (error) {
          console.warn('⚠️ Error handling workspace change for checkpoint sessions:', error);
        }
        try {
          this.sidebar?.webviewProtocol?.send("refreshSubmenuItems", {
            providers: ["file", "repo-map"],
          });
          void this.fileSearch?.refresh();
        } catch (error) {
          console.warn("Failed to refresh mention file index after workspace change:", error);
        }
      })
    );

    this.configHandler.onConfigUpdate(
      async ({ config: newConfig, configLoadInterrupted }) => {
        if (!configLoadInterrupted && newConfig) {
          try {
            bindCodeLensRefresh(newConfig);
          } catch (error) {
            console.warn("Knox code lens registration failed:", error);
          }
        }
      },
    );

    // FileSearch for prompt-file / QuickEdit `@` (KN-356)
    this.fileSearch = new FileSearch(this.ide);
    try {
      registerAllPromptFilesCompletionProviders(
        context,
        this.fileSearch,
        this.ide,
      );
    } catch (error) {
      console.warn("Knox prompt-file providers failed to register:", error);
    }

    const quickEdit = new QuickEdit(
      this.verticalDiffManager,
      this.configHandler,
      this.sidebar.webviewProtocol,
      this.ide,
      context,
      this.fileSearch,
    );

    // Commands
    registerAllCommands(
      context,
      this.ide,
      context,
      this.sidebar,
      this.configHandler,
      this.verticalDiffManager,
      quickEdit,
      this.core,
      this.editDecorationManager,
    );

    // Track paused debug threads for @debugger (KN-353; debounced submenu refresh)
    try {
      context.subscriptions.push(
        registerDebugTracker(this.sidebar.webviewProtocol, this.ide),
      );
    } catch (error) {
      console.warn("Knox debug tracker failed to register:", error);
    }

    // Listen for file saving - use global file watcher so that changes
    // from outside the window are also caught (`~/.knoxcoder/config.yaml`).
    const configYamlPath = getConfigYamlPath("vscode");
    context.subscriptions.push(
      watchConfigYamlFile(
        configYamlPath,
        (filename, options, listener) => {
          fs.watchFile(filename, options, listener);
        },
        (filename) => {
          fs.unwatchFile(filename);
        },
        async () => {
          await this.configHandler.reloadConfig();
        },
      ),
    );

    vscode.workspace.onDidSaveTextDocument(async (event) => {
      this.ide.updateLastFileSaveTimestamp();
      this.core.invoke("files/changed", {
        uris: [event.uri.toString()],
      });
      if (pathsReferToSameFile(event.uri.fsPath, configYamlPath)) {
        await this.configHandler.reloadConfig();
      }
    });

    vscode.workspace.onDidDeleteFiles(async (event) => {
      this.fileSearch.removeUris(event.files);
      this.core.invoke("files/deleted", {
        uris: event.files.map((uri) => uri.toString()),
      });
    });

    vscode.workspace.onDidCloseTextDocument(async (event) => {
      this.core.invoke("files/closed", {
        uris: [event.uri.toString()],
      });
    });

    vscode.workspace.onDidCreateFiles(async (event) => {
      this.fileSearch.addUris(event.files);
      this.core.invoke("files/created", {
        uris: event.files.map((uri) => uri.toString()),
      });
    });

    vscode.workspace.onDidRenameFiles(async (event) => {
      this.fileSearch.renameUris(event.files);
    });


    // Register a content provider for the readonly virtual documents
    const documentContentProvider = new (class
      implements vscode.TextDocumentContentProvider
    {
      // emitter and its event
      onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
      onDidChange = this.onDidChangeEmitter.event;

      provideTextDocumentContent(uri: vscode.Uri): string {
        return uri.query;
      }
    })();
    context.subscriptions.push(
      vscode.workspace.registerTextDocumentContentProvider(
        VsCodeExtension.knoxVirtualDocumentScheme,
        documentContentProvider,
      ),
    );

    const linkProvider = vscode.languages.registerDocumentLinkProvider(
      { language: CONFIG_YAML_LANGUAGE },
      new ConfigYamlDocumentLinkProvider(),
    );
    context.subscriptions.push(linkProvider);

    this.ide.onDidChangeActiveTextEditor((filepath) => {
      void this.core.invoke("didChangeActiveTextEditor", { filepath });
    });

    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (event.affectsConfiguration(EXTENSION_NAME)) {
        const settings = await this.ide.getIdeSettings();
        const webviewProtocol = await this.webviewProtocolPromise;
        void webviewProtocol.request("didChangeIdeSettings", {
          settings,
        });
      }
    });
  }

  static knoxVirtualDocumentScheme = EXTENSION_NAME;

   
  private PREVIOUS_BRANCH_FOR_WORKSPACE_DIR: { [dir: string]: string } = {};

  /**
   * Initialize Agent Mode streaming and connect to webview
   */
  private initializeAgentModeStreaming(): void {
    try {
      const chatFlowCoordinator = ChatFlowCoordinator.getInstance();
      
      // Listen for streaming updates from ChatFlowCoordinator and forward to webview
      chatFlowCoordinator.onStreamingUpdate(({ content, isComplete }: { content: string; isComplete: boolean }) => {
        // Forward the streaming update to the main webview
        this.sidebar.webviewProtocol.send('agentStreamingUpdate', {
          content,
          isComplete
        });
      });

      // Do not listen for agentStreamingUpdateFromRedux. That path posted the
      // full accumulated assistant string on every token (CSLD-03). Agent-mode
      // code blocks already update from Redux in the GUI. 
      console.log('✅ Agent Mode streaming initialized and connected to webview');
    } catch (error) {
      console.warn('⚠️ Failed to initialize Agent Mode streaming:', error);
      // Don't throw - allow extension to continue without agent mode streaming
    }
  }

  /**
   * Initialize checkpoint system with proper error handling
   */
  private async initializeCheckpointSystem(context: vscode.ExtensionContext): Promise<void> {
    try {
      await this.checkpointManager.initialize(context);
      try {
        await CheckpointSessionManager.getInstance().initialize();
      } catch (sessionError) {
        console.warn('⚠️ Checkpoint session restore failed:', sessionError);
      }
      try {
        await this.smartCheckpointManager.initialize(context);
        console.log('✅ Smart checkpoint manager initialized successfully');
      } catch (smartError) {
        console.warn('⚠️ Smart checkpoint manager failed to initialize; using base checkpoints:', smartError);
      }
      console.log('✅ Checkpoint system initialized successfully');
    } catch (error) {
      console.warn('⚠️ Checkpoint system initialization failed, continuing without checkpoints:', error);
    }
  }

  /**
   * Initialize enterprise monitoring with proper error handling
   */
  private async initializeEnterpriseMonitoring(context: vscode.ExtensionContext): Promise<void> {
    try {
      const enterpriseMonitor = CheckpointEnterpriseMonitor.getInstance();
      await enterpriseMonitor.initialize(context);
      console.log('✅ Checkpoint monitoring initialized successfully');
    } catch (error) {
      console.warn('⚠️ Checkpoint monitoring initialization failed, continuing without monitoring:', error);
      // Don't throw - allow extension to continue without monitoring
    }
  }

  async receiveNativeGuiMessage(message: {
    messageType: string;
    messageId: string;
    data: unknown;
  }): Promise<void> {
    await this.sidebar.webviewProtocol.receiveFromNative(message);
  }

  get onDidSendGuiMessage() {
    return this.sidebar.webviewProtocol.onDidSend;
  }

  registerCustomContextProvider(contextProvider: IContextProvider) {
    this.configHandler.registerCustomContextProvider(contextProvider);
  }
}
