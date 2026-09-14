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
import { CheckpointManager } from "../checkpoints/CheckpointManager";
import { CheckpointChatIntegration, registerCheckpointCommands } from "../checkpoints/commands";
import { CheckpointEnterpriseMonitor } from "../checkpoints/EnterpriseMonitor";
import { CheckpointSessionManager } from "../checkpoints/SessionManager";
import { SmartCheckpointManager, AICheckpointIntegration } from "../checkpoints/SmartCheckpointManager";
import { registerAllCommands } from "../commands";
import { registerDebugTracker } from "../debug/debug";
import { VerticalDiffManager } from "../diff/vertical/manager";
import { KnoxGUIWebviewViewProvider } from "../KnoxGUIWebviewViewProvider";
import { registerAllCodeLensProviders } from "../lang-server/codeLens";
import { registerAllPromptFilesCompletionProviders } from "../lang-server/promptFileCompletions";
import EditDecorationManager from "../quickEdit/EditDecorationManager";
import { QuickEdit } from "../quickEdit/QuickEditQuickPick";
import { FileSearch } from "../util/FileSearch";
import { VsCodeIde } from "../VsCodeIde";
import { ensureAgentServices } from "../agent";
import { knoxStartupMark } from "../activation/startupMetrics";

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
  private deferredStartupStarted = false;
  private checkpointInitPromise: Promise<void> | undefined;

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

    // Native pane talks to Core through this protocol's native sink (T13.2).
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
    this.verticalDiffManager = new VerticalDiffManager(
      this.configHandler,
      this.sidebar.webviewProtocol,
      this.editDecorationManager,
    );
    resolveVerticalDiffManager?.(this.verticalDiffManager);

    // Local config only (no remote org/profile sync).

    // Register sendToWebview command so agent services can forward events to GUI
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
        const resolvedResult = await Promise.resolve(result);
        return resolvedResult.contextItems;
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

    this.configHandler.loadConfig().then(({ config }) => {
      const { verticalDiffCodeLens } = registerAllCodeLensProviders(
        context,
        this.verticalDiffManager.fileUriToCodeLens,
        config,
      );

      this.verticalDiffManager.refreshCodeLens =
        verticalDiffCodeLens.refresh.bind(verticalDiffCodeLens);
    });
    
    // T7.3: checkpoint disk load / session restore wait until sidebar or a
    // checkpoint command (registerCanonicalCommand wraps initialize).
    registerCheckpointCommands(context);
    
    // AI Context commands removed - AI Context functionality has been removed
    
    // Notify webview when checkpoints change (only if checkpoint system is ready)
    try {
      this.checkpointManager.onCheckpointCreated(() => {
        // Notify webview to refresh checkpoint list
        if (this.sidebar?.webviewProtocol) {
          this.sidebar.webviewProtocol.send("checkpointListUpdated", undefined);
        }
      });
      this.checkpointManager.onActiveWorkspaceChanged(() => {
        if (this.sidebar?.webviewProtocol) {
          this.sidebar.webviewProtocol.send("checkpointListUpdated", undefined);
        }
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
          await this.ensureCheckpointSystem();
          const sessionManager = CheckpointSessionManager.getInstance();
          await sessionManager.onWorkspaceChanged(event);
        } catch (error) {
          console.warn('⚠️ Error handling workspace change for checkpoint sessions:', error);
        }
      })
    );

    this.configHandler.onConfigUpdate(
      async ({ config: newConfig, configLoadInterrupted }) => {
        if (!configLoadInterrupted && newConfig) {
          registerAllCodeLensProviders(
            context,
            this.verticalDiffManager.fileUriToCodeLens,
            newConfig,
          );
        }
      },
    );

    // FileSearch — construct only; findFiles waits until sidebar/command (T7.3)
    this.fileSearch = new FileSearch(this.ide);
    registerAllPromptFilesCompletionProviders(
      context,
      this.fileSearch,
      this.ide,
    );

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

    // Track paused debug threads for @debugger (debounced submenu refresh)
    context.subscriptions.push(
      registerDebugTracker(this.sidebar.webviewProtocol, this.ide),
    );

    // Listen for file saving - use global file watcher so that changes
    // from outside the window are also caught
    fs.watchFile(
      getConfigYamlPath("vscode"),
      { interval: 1000 },
      async (stats) => {
        if (stats.size === 0) {
          return;
        }
        await this.configHandler.reloadConfig();
      },
    );

    vscode.workspace.onDidSaveTextDocument(async (event) => {
      this.ide.updateLastFileSaveTimestamp();
      this.core.invoke("files/changed", {
        uris: [event.uri.toString()],
      });
    });

    vscode.workspace.onDidDeleteFiles(async (event) => {
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
      this.core.invoke("files/created", {
        uris: event.files.map((uri) => uri.toString()),
      });
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
      { language: "yaml" },
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

    // Warm agent / checkpoints / file index off the activate path (T7.3).
    this.sidebar.onDidResolve(() => this.scheduleDeferredStartup());
    if (this.sidebar.isReady) {
      this.scheduleDeferredStartup();
    }
  }

  static knoxVirtualDocumentScheme = EXTENSION_NAME;

   
  private PREVIOUS_BRANCH_FOR_WORKSPACE_DIR: { [dir: string]: string } = {};

  private scheduleDeferredStartup(): void {
    if (this.deferredStartupStarted) {
      return;
    }
    this.deferredStartupStarted = true;
    knoxStartupMark("deferredStartup");
    void this.fileSearch.ensureIndexed();
    void this.ensureCheckpointSystem();
    ensureAgentServices();
    this.initializeAgentModeStreaming();
  }

  private ensureCheckpointSystem(): Promise<void> {
    if (!this.checkpointInitPromise) {
      this.checkpointInitPromise = (async () => {
        await this.initializeCheckpointSystem(this.extensionContext);
        await this.initializeEnterpriseMonitoring(this.extensionContext);
      })();
    }
    return this.checkpointInitPromise;
  }

  /**
   * Initialize Agent Mode streaming and connect to webview
   */
  private initializeAgentModeStreaming(): void {
    try {
      const { AgentModeManager } = require('../agent/AgentModeManager');
      const { ChatFlowCoordinator } = require('../agent/ChatFlowCoordinator');
      
      const agentModeManager = AgentModeManager.getInstance();
      const chatFlowCoordinator = ChatFlowCoordinator.getInstance();
      
      // Listen for streaming updates from ChatFlowCoordinator and forward to webview
      chatFlowCoordinator.onStreamingUpdate(({ content, isComplete }: { content: string; isComplete: boolean }) => {
        this.sidebar.webviewProtocol.send('agentStreamingUpdate', {
          content,
          isComplete
        });
      });
      
      console.log('✅ Agent Mode streaming initialized');
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
      try {
        const { AutoCheckpointSystem } = await import("../checkpoints/AutoCheckpointSystem");
        await AutoCheckpointSystem.getInstance().initialize(context);
      } catch (autoError) {
        console.warn('⚠️ Auto-checkpoint system failed to initialize:', autoError);
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

  registerCustomContextProvider(contextProvider: IContextProvider) {
    this.configHandler.registerCustomContextProvider(contextProvider);
  }
}
