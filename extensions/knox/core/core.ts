import { ConfigYaml } from "knoxdev-package/config-yaml";
import { fetchwithRequestOptions } from "knoxdev-package/fetch";
import * as URI from "./util/uriApi.js";
import { v4 as uuidv4 } from "uuid";

import { ConfigHandler } from "./config/ConfigHandler";
import {
  detectWorkspaceKindFromIde,
  resolveAgentLoopSettings,
  workspaceKindHints,
} from "./config/agentProfile";
import { SYSTEM_PROMPT_DOT_FILE } from "./config/getSystemPromptDotFile";
import { isLocalAssistantFile } from "./config/loadLocalAssistants";
import { addModel, deleteModel, addPrompt } from "./config/util";
import CurrentFileContextProvider from "./context/providers/CurrentFileContextProvider";
import { gatherAutoContext } from "./context/autoContext";
import { MemoryManager } from "./context/memory/MemoryManager";
import type { MemoryCreateInput, MemoryQuery } from "./context/memory/types";
import { BrainManager } from "./context/memory/brain/BrainManager";
import { enrichWithCost } from "./llm/tokenTracking";
import { DevDataSqliteDb } from "./data/devdataSqlite";
import { DataLogger } from "./data/log";
import { streamDiffLines } from "./edit/streamDiffLines";
import { llmStreamChat } from "./llm/streamChat";
import { createNewPromptFileV2 } from "./promptFiles/v2/createNewPromptFile";
import { t } from "./i18n/index.js";
import { callTool } from "./tools/callTool";
import {
  formatUnknownToolError,
  resolveBuiltInToolName,
  resolveViewSubdirectoryMaxFiles,
} from "./tools/builtIn";
import { executeToolWithSoulHooks } from "./tools/mutatingToolHooks";
import { resolveConfigAgentPolicy } from "./tools/toolPolicy";
import { resolveAutonomousToolApproval } from "./agent/autonomousApproval";
import { DEFAULT_PERMISSION_MODE } from "./agent/permissions";
import { runTerminalCommandTool } from "./tools/definitions/runTerminalCommand";
import {
  resolveVerifyMaxIterations,
} from "./tools/build/verifyCommand";
import {
  autoStoreTask,
  getLastSoulEvent,
  recordSoulEvent,
} from "./context/soul/recordSoulEvent.js";
import {
  handleAgentJobsRequest,
  listAgentBackgroundJobs,
  cancelAllBackgroundJobs,
  toAgentBackgroundJob,
} from "./tools/agentJobs";
import { subscribeShellJobs } from "./tools/shellJobs";
import {
  applyAgentWorktree,
  discardAgentWorktree,
  enterAgentWorktree,
  wrapIdeForWorktree,
  worktreeActionResult,
  type AgentWorktreeState,
} from "./tools/worktree";
import { setSkillManager } from "./tools/implementations/skillSingleton";
import { SkillManager } from "./skills";
import { ChatDescriber } from "./util/chatDescriber";
import { clipboardCache } from "./util/clipboardCache";
import { GlobalContext } from "./util/GlobalContext";
import historyManager from "./util/history";
import { editConfigFile, migrate, migrateProjectKnoxToGlobal, migrateV1DevDataFiles } from "./util/paths";
import { localPathOrUriToPath } from "./util/pathToUri";
import { getSymbolsForManyFiles } from "./util/treeSitter";

import { DiffLine, type ContextItemId, type IDE, type ToolExtras } from ".";

import type { FromCoreProtocol, ToCoreProtocol } from "./protocol";
import type { IMessenger, Message } from "./protocol/messenger";

export class Core {
  configHandler: ConfigHandler;
  private globalContext = new GlobalContext();

  private abortedMessageIds: Set<string> = new Set();
  /** In-flight tools/call abort controllers, keyed by messenger messageId. */
  private activeToolAborts = new Map<string, AbortController>();
  /** Optional git worktree that isolates agent file/shell writes from the main tree. */
  private agentWorktree: AgentWorktreeState | null = null;

  private abortActiveTools(messageId?: string): void {
    if (messageId) {
      const controller = this.activeToolAborts.get(messageId);
      controller?.abort();
      return;
    }
    for (const controller of this.activeToolAborts.values()) {
      controller.abort();
    }
  }

  invoke<T extends keyof ToCoreProtocol>(
    messageType: T,
    data: ToCoreProtocol[T][0],
  ): ToCoreProtocol[T][1] {
    return this.messenger.invoke(messageType, data);
  }

  send<T extends keyof FromCoreProtocol>(
    messageType: T,
    data: FromCoreProtocol[T][0],
    messageId?: string,
  ): string {
    return this.messenger.send(messageType, data, messageId);
  }

  // TODO: It shouldn't actually need an IDE type, because this can happen
  // through the messenger (it does in the case of any non-VS Code IDEs already)
  constructor(
    private readonly messenger: IMessenger<ToCoreProtocol, FromCoreProtocol>,
    private readonly ide: IDE,
    private readonly onWrite: (text: string) => Promise<void> = async () => {},
  ) {
    // Ensure global ~/.knox directory is created and migrate legacy project .knox data
    migrateV1DevDataFiles();
    void (async () => {
      try {
        const workspaceDirs = await this.ide.getWorkspaceDirs();
        await migrate("v2-project-knox-to-global", () => {
          migrateProjectKnoxToGlobal(
            workspaceDirs.map((dir) => localPathOrUriToPath(dir)),
          );
        });
      } catch (err) {
        console.warn("[Knox] Failed to migrate project .knox data:", err);
      }
    })();

    // T7.2: do not open sqlite / Memory Brain during Core construct.
    // BrainStore.get() (first chat or Memory view) starts consolidation.
    // Event forwarding is cheap and does not open the DB.
    BrainManager.onEvent((event) => {
      this.messenger.send("brain/memoryEvent", {
        type: event.type,
        timestamp: event.timestamp,
        data: event.data,
      });
    });

    const ideInfoPromise = messenger.request("getIdeInfo", undefined);
    const ideSettingsPromise = messenger.request("getIdeSettings", undefined);

    this.configHandler = new ConfigHandler(
      this.ide,
      ideSettingsPromise,
      this.onWrite,
    );

    this.configHandler.onConfigUpdate(async (result) => {
      const serializedResult = await this.configHandler.getSerializedConfig();
      this.messenger.send("configUpdate", {
        result: serializedResult,
        profileId:
          this.configHandler.currentProfile?.profileDescription.id ?? null,
      });

      // update additional submenu context providers registered via VSCode API
      const additionalProviders =
        this.configHandler.getAdditionalSubmenuContextProviders();
      if (additionalProviders.length > 0) {
        this.messenger.send("refreshSubmenuItems", {
          providers: additionalProviders,
        });
      }

      // Give the Memory Brain an LLM so its enhanced features (entity
      // extraction, session summarization, importance scoring) run outside
      // of memory-tool calls too.
      try {
        const chatLlm = result.config?.selectedModelByRole?.chat;
        if (chatLlm) {
          BrainManager.setLlm(chatLlm);
        }
      } catch {
        // LLM wiring is best-effort — heuristic fallbacks cover its absence
      }

      // Reload skills when config changes (paths/urls/disableExternalSkills may have changed)
      try {
        const { config } = result;
        const skillsConfig = config?.skills;
        const workspaceDirs = await this.ide.getWorkspaceDirs();
        const skillManager = new SkillManager({
          workspaceDirs,
          additionalPaths: skillsConfig?.paths,
          urls: skillsConfig?.urls,
          pins: skillsConfig?.pins,
          disableExternalSkills: skillsConfig?.disableExternalSkills,
        });
        setSkillManager(skillManager);
        await skillManager.load();
        console.log(
          `[Skills] Reloaded ${skillManager.all().length} skill(s) after config change`,
        );
      } catch (err) {
        console.error(
          "[Skills] Failed to reload skills on config change:",
          err,
        );
      }
    });

    this.configHandler.onDidChangeAvailableProfiles(
      (profiles, selectedProfileId) =>
        this.messenger.send("didChangeAvailableProfiles", {
          profiles,
          selectedProfileId,
        }),
    );

    // Dev Data Logger
    const dataLogger = DataLogger.getInstance();
    dataLogger.core = this;
    dataLogger.ideInfoPromise = ideInfoPromise;
    dataLogger.ideSettingsPromise = ideSettingsPromise;

    // ── Skills System ──────────────────────────────────────────────────
    // Initialize the skill manager asynchronously. It will be available
    // for the skill tool by the time any LLM tool call arrives.
    // Reads skills config (paths, urls, disableExternalSkills) from user config.
    const configHandlerRef = this.configHandler;
    void (async () => {
      try {
        const workspaceDirs = await this.ide.getWorkspaceDirs();
        const { config } = await configHandlerRef.loadConfig();
        const skillsConfig = config?.skills;

        const skillManager = new SkillManager({
          workspaceDirs,
          additionalPaths: skillsConfig?.paths,
          urls: skillsConfig?.urls,
          pins: skillsConfig?.pins,
          disableExternalSkills: skillsConfig?.disableExternalSkills,
        });
        setSkillManager(skillManager);
        await skillManager.load();

        const loadedSkills = skillManager.all();
        const loadedDirs = skillManager.dirs();
        console.log(
          `[Skills] Loaded ${loadedSkills.length} skill(s) from ${loadedDirs.length} dir(s)`,
        );
        if (loadedSkills.length > 0) {
          console.log(
            `[Skills] Available: ${loadedSkills.map((s) => s.name).join(", ")}`,
          );
        }
      } catch (err) {
        console.error("[Skills] Failed to initialize skill system:", err);
      }
    })();

    const on = this.messenger.on.bind(this.messenger);

    // Special
    on("abort", (msg) => {
      this.abortedMessageIds.add(msg.messageId);
      // If this abort targets an in-flight tools/call, stop it (e.g. terminal).
      this.abortActiveTools(msg.messageId);
    });

    on("tools/cancel", () => {
      this.abortActiveTools();
      // Background shells (block_until_ms: 0) and builtin_task children are
      // not in activeToolAborts once they detach. Stop them on user Stop.
      const jobs = cancelAllBackgroundJobs();
      this.send("agent/jobUpdate", {
        event: "updated",
        job: jobs[0] ?? {
          id: "cancel",
          kind: "shell",
          title: "",
          status: "killed",
        },
        jobs,
      });
    });

    subscribeShellJobs((event, snapshot) => {
      this.send("agent/jobUpdate", {
        event,
        job: toAgentBackgroundJob(snapshot),
        jobs: listAgentBackgroundJobs(),
      });
      if (event !== "completed") {
        return;
      }
      const soulSession = BrainManager.getActiveSessionId();
      if (!soulSession) {
        return;
      }
      const killed = snapshot.status === "killed";
      const failed =
        !killed && snapshot.exitCode !== null && snapshot.exitCode !== 0;
      void recordSoulEvent({
        sessionId: soulSession,
        kind: failed || killed ? "tool_error" : "tool_success",
        toolName: "builtin_run_terminal_command",
        files: [],
        ok: !failed && !killed,
        summary: killed
          ? `Background job ${snapshot.id} killed: ${snapshot.command}`
          : `Background job ${snapshot.id} exited ${snapshot.exitCode ?? "?"}: ${snapshot.command}`,
        metadata: {
          jobId: snapshot.id,
          exitCode: snapshot.exitCode,
          status: snapshot.status,
        },
      }).catch(() => {});
    });

    on("agent/jobs", (msg) => {
      return handleAgentJobsRequest(msg.data);
    });

    on("agent/worktree", async (msg) => {
      const action = msg.data.action;
      const sessionId = msg.data.sessionId || "default";
      try {
        if (action === "enter") {
          this.agentWorktree = await enterAgentWorktree(
            this.ide,
            sessionId,
            this.agentWorktree,
          );
          return await worktreeActionResult(this.ide, this.agentWorktree);
        }
        if (action === "status") {
          return await worktreeActionResult(this.ide, this.agentWorktree);
        }
        if (!this.agentWorktree) {
          return { ok: false, error: t("worktreeNotActive"), state: { enabled: false, files: [] } };
        }
        if (action === "apply") {
          const soulSession =
            sessionId !== "default"
              ? sessionId
              : BrainManager.getActiveSessionId() || sessionId;
          let checkpointId: string | undefined;
          if (typeof this.ide.ensureTurnCheckpoint === "function") {
            try {
              checkpointId = await this.ide.ensureTurnCheckpoint({
                sessionId: soulSession,
                turnId: `worktree-apply-${soulSession}`,
                toolName: "agent_worktree_apply",
              });
            } catch {
              // Apply still proceeds if the safety CP fails.
            }
          }
          const files = await applyAgentWorktree(this.ide, this.agentWorktree);
          void recordSoulEvent({
            sessionId: soulSession,
            kind: "tool_success",
            toolName: "agent_worktree_apply",
            files,
            workspaceCheckpointId: checkpointId,
            ok: true,
            summary: `Applied ${files.length} file${
              files.length === 1 ? "" : "s"
            } from worktree ${this.agentWorktree.branch}`,
          }).catch(() => {});
          const result = await worktreeActionResult(this.ide, this.agentWorktree);
          if (result.state) {
            result.state.files = files;
          }
          return result;
        }
        const discardSession =
          sessionId !== "default"
            ? sessionId
            : BrainManager.getActiveSessionId() || sessionId;
        const discardedBranch = this.agentWorktree.branch;
        await discardAgentWorktree(this.ide, this.agentWorktree);
        this.agentWorktree = null;
        void recordSoulEvent({
          sessionId: discardSession,
          kind: "tool_success",
          toolName: "agent_worktree_discard",
          files: [],
          ok: true,
          summary: `Discarded isolated worktree ${discardedBranch} without applying files`,
        }).catch(() => {});
        return { ok: true, state: { enabled: false, files: [] } };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          error: message,
          state: this.agentWorktree
            ? {
                enabled: true,
                branch: this.agentWorktree.branch,
                path: this.agentWorktree.worktreePath,
                files: [],
              }
            : { enabled: false, files: [] },
        };
      }
    });

    on("ping", (msg) => {
      if (msg.data !== "ping") {
        throw new Error(t("pingIncorrect"));
      }
      return "pong";
    });

    // History
    on("history/list", (msg) => {
      return historyManager.list(msg.data);
    });

    on("history/delete", (msg) => {
      historyManager.delete(msg.data.id);
    });

    on("history/load", (msg) => {
      return historyManager.load(msg.data.id);
    });

    on("history/save", (msg) => {
      historyManager.save(msg.data);
    });

    // Dev data
    on("devdata/log", async (msg) => {
      void DataLogger.getInstance().logDevData(msg.data);
    });

    // Edit config
    on("config/addModel", (msg) => {
      const model = msg.data.model;
      addModel(model, msg.data.role);
      void this.configHandler.reloadConfig();
    });

    on("config/deleteModel", (msg) => {
      deleteModel(msg.data.title);
      void this.configHandler.reloadConfig();
    });

    on("config/addPrompt", (msg) => {
      addPrompt(msg.data);
      void this.configHandler.reloadConfig();
    });

    on("config/newPromptFile", async (msg) => {
      const { config } = await this.configHandler.loadConfig();
      await createNewPromptFileV2(this.ide, config?.experimental?.promptPath);
      await this.configHandler.reloadConfig();
    });

    on("config/openProfile", async (msg) => {
      await this.configHandler.openConfigProfile(msg.data.profileId);
    });

    on("config/reload", async (msg) => {
      void this.configHandler.reloadConfig();
      return await this.configHandler.getSerializedConfig();
    });

    on("config/ideSettingsUpdate", (msg) => {
      this.configHandler.updateIdeSettings(msg.data);
    });

    on("config/listProfiles", async (msg) => {
      const profiles = this.configHandler.listProfiles();
      const selectedProfileId =
        this.configHandler.currentProfile?.profileDescription.id ?? null;
      return { profiles, selectedProfileId };
    });

    on("config/refreshProfiles", async (_msg) => {
      await this.configHandler.reloadLocalProfiles();
    });

    on("config/updateSharedConfig", async (msg) => {
      const newSharedConfig = this.globalContext.updateSharedConfig(msg.data);
      await this.configHandler.reloadConfig();
      return newSharedConfig;
    });

    on("config/updateSelectedModel", async (msg) => {
      const newSelectedModels = this.globalContext.updateSelectedModel(
        msg.data.profileId,
        msg.data.role,
        msg.data.title,
      );
      await this.configHandler.reloadConfig();
      return newSelectedModels;
    });

    on("ui/getReasoningEffortPrefs", async () => {
      return this.globalContext.getReasoningEffortPrefs();
    });

    on("ui/updateReasoningEffortPrefs", async (msg) => {
      return this.globalContext.updateReasoningEffortPrefs(msg.data ?? {});
    });

    // Context providers

    on("context/loadSubmenuItems", async (msg) => {
      const { config } = await this.configHandler.loadConfig();
      if (!config) {
        return [];
      }

      const items = await config.contextProviders
        ?.find((provider) => provider.description.title === msg.data.title)
        ?.loadSubmenuItems({
          config,
          ide: this.ide,
          fetch: (url, init) =>
            fetchwithRequestOptions(url, init, config.requestOptions),
        });
      return items || [];
    });

    on("context/getContextItems", async (msg) => {
      const { config } = await this.configHandler.loadConfig();
      if (!config) {
        return [];
      }

      const { name, query, fullInput, selectedCode, selectedModelTitle } =
        msg.data;

      const llm = await this.configHandler.llmFromTitle(selectedModelTitle);
      const provider =
        config.contextProviders?.find(
          (provider) => provider.description.title === name,
        ) ??
        [
          // user doesn't need these in their config.json for the shortcuts to work
          // option+enter
          new CurrentFileContextProvider({}),
          // cmd+enter
        ].find((provider) => provider.description.title === name);
      if (!provider) {
        return [];
      }

      try {
        const id: ContextItemId = {
          providerTitle: provider.description.title,
          itemId: uuidv4(),
        };

        const items = await provider.getContextItems(query, {
          config,
          llm,
          fullInput,
          ide,
          selectedCode,
          fetch: (url, init) =>
            fetchwithRequestOptions(url, init, config.requestOptions),
        });

        return items.map((item) => ({
          ...item,
          id,
        }));
      } catch (e) {
        let knownError = false;

        if (e instanceof Error) {
        }
        if (!knownError) {
          void this.ide.showToast(
            "error",
            t("errorGettingContextItem", { name, error: String(e) }),
          );
        }
        return [];
      }
    });

    on("context/getSymbolsForFiles", async (msg) => {
      const { uris } = msg.data;
      return await getSymbolsForManyFiles(uris, this.ide);
    });

    on("context/getAutoContext", async (msg) => {
      const { message, existingContextPaths, modelName } = msg.data;
      const pathSet = new Set<string>(existingContextPaths || []);
      try {
        return await gatherAutoContext(
          message,
          ide,
          pathSet,
          modelName || "gpt-4",
        );
      } catch (e) {
        console.error("[AutoContext] Failed to gather auto-context:", e);
        return [];
      }
    });

    // ── Memory Management Handlers ──
    on("memory/create", async (msg) => {
      const id = await MemoryManager.remember(msg.data as MemoryCreateInput);
      return { id };
    });

    on("memory/search", async (msg) => {
      const items = await MemoryManager.recall(msg.data as MemoryQuery);
      return { items };
    });

    on("memory/delete", async (msg) => {
      const success = await MemoryManager.forget(msg.data.id);
      return { success };
    });

    on("memory/list", async () => {
      const items = await MemoryManager.listAll();
      return { items };
    });

    on("memory/cleanup", async () => {
      const removed = await MemoryManager.cleanup();
      return { removed };
    });

    // ── Memory Brain Handlers (Knox-MS-style persistent brain memory) ──
    on("brain/dispatch", async (msg) => {
      const result = await BrainManager.dispatch(msg.data.action, msg.data);
      return { result };
    });

    on("brain/trackSession", async (msg) => {
      await BrainManager.trackSession(
        msg.data.sessionId,
        msg.data.title,
        msg.data.workspaceDir,
      );
    });

    on("brain/recordMessage", async (msg) => {
      const id = await BrainManager.recordMessage(
        msg.data.sessionId,
        msg.data.role,
        msg.data.content,
        {
          type: msg.data.type as any,
          tokenCount: msg.data.tokenCount,
          importance: msg.data.importance,
          metadata: msg.data.metadata,
        },
      );
      return { id };
    });

    on("brain/recordSoulEvent", async (msg) => {
      const id = await recordSoulEvent({
        sessionId: msg.data.sessionId,
        kind: msg.data.kind,
        toolName: msg.data.toolName,
        files: msg.data.files ?? [],
        workspaceCheckpointId: msg.data.workspaceCheckpointId,
        memoryCheckpointId: msg.data.memoryCheckpointId,
        ok: msg.data.ok,
        policy: msg.data.policy,
        summary: msg.data.summary,
      });
      return { id };
    });

    on("brain/getLastSoulEvent", async (msg) => {
      const event = getLastSoulEvent(msg.data.sessionId) ?? null;
      return { event };
    });

    on("brain/autoStore", async (msg) => {
      try {
        await autoStoreTask({
          taskDescription: msg.data.taskDescription,
          filesModified: msg.data.filesModified,
          sessionSummary: msg.data.sessionSummary,
          sessionId: msg.data.sessionId,
        });
        return { success: true };
      } catch {
        return { success: false };
      }
    });

    on("brain/buildContext", async (msg) => {
      const result = await BrainManager.buildContextDetailed(
        msg.data.message,
        msg.data.sessionId,
        msg.data.maxTokens,
        {
          goal: msg.data.goal,
          memory_mode: msg.data.memoryMode,
        },
      );
      return { context: result.context, items: result.items };
    });

    on("brain/runPipeline", async (msg) => {
      const result = await BrainManager.runPipeline({
        mode: msg.data.mode as any,
        message: msg.data.message,
        session_id: msg.data.sessionId,
        role: msg.data.role,
        goal: msg.data.goal,
        max_tokens: msg.data.maxTokens,
        turn_content: msg.data.turnContent,
      });
      return {
        phases: result.phases ?? [],
        context: result.context?.context,
        items: result.context?.items,
        extracted: (result as any).extracted,
      };
    });

    on("brain/getEffectiveContext", async () => {
      return await BrainManager.getEffectiveContext();
    });

    on("brain/getPhaseStatus", async () => {
      return BrainManager.getPhaseStatus();
    });

    on("brain/getReviewDue", async (msg) => {
      const items = await BrainManager.getReviewDue(msg.data?.limit ?? 10);
      return { items, count: items.length };
    });

    on("brain/getEbbinghausStats", async () => {
      return await BrainManager.getEbbinghausStats();
    });

    on("brain/routeTask", async (msg) => {
      return BrainManager.routeTask({
        message: msg.data.message,
        toolCount: msg.data.toolCount,
        codeBlockCount: msg.data.codeBlockCount,
      });
    });

    on("brain/runAutonomousLoop", async (msg) => {
      const { config } = await this.configHandler.loadConfig();
      let chatLlm = config?.selectedModelByRole?.chat ?? null;
      if (msg.data.modelTitle) {
        try {
          chatLlm =
            (await this.configHandler.llmFromTitle(msg.data.modelTitle)) ??
            chatLlm;
        } catch {
          // keep config chat model
        }
      }
      if (chatLlm) {
        BrainManager.setLlm(chatLlm);
      }

      const { allTools } = await import("./tools");
      const { loadCodebaseCard, setCodebaseCardInject } = await import(
        "./context/codebaseCard"
      );
      const { loadSerialContextFromJobs, setSerialContextInject } = await import(
        "./context/serialContext"
      );
      const { listShellJobs } = await import("./tools/shellJobs");
      const catalog =
        config?.tools?.filter((tool) => tool.function?.name) ?? allTools;
      const toolIde = this.agentWorktree
        ? wrapIdeForWorktree(this.ide, this.agentWorktree)
        : this.ide;
      try {
        const card = await loadCodebaseCard(toolIde);
        setCodebaseCardInject(card);
        const { rustPolicyShouldEnable, setRustPolicyEnabled, setRustUserTask } =
          await import("./context/rustPolicy");
        setRustPolicyEnabled(rustPolicyShouldEnable({ card }));
        setRustUserTask(
          typeof msg.data?.goal === "string" ? msg.data.goal : "",
        );
      } catch {
        setCodebaseCardInject("");
      }
      try {
        setSerialContextInject(loadSerialContextFromJobs(listShellJobs()));
      } catch {
        setSerialContextInject("");
      }
      const sessionId = msg.data.sessionId;
      const loopLlm = chatLlm;
      const extras = loopLlm
        ? {
            ide: toolIde,
            llm: loopLlm,
            fetch: ((url: string, init?: RequestInit) =>
              fetchwithRequestOptions(
                url,
                init,
                config?.requestOptions,
              )) as ToolExtras["fetch"],
            abortSignal: undefined as AbortSignal | undefined,
          }
        : undefined;

      let workspaceHints = workspaceKindHints(null);
      try {
        workspaceHints = workspaceKindHints(
          await detectWorkspaceKindFromIde(toolIde),
        );
      } catch {
        workspaceHints = workspaceKindHints(null);
      }
      const loopSettings = resolveAgentLoopSettings(
        config?.experimental,
        workspaceHints,
      );

      let workspaceDirs: string[] = [];
      try {
        workspaceDirs = await toolIde.getWorkspaceDirs();
      } catch {
        workspaceDirs = [];
      }

      const result = await BrainManager.runAutonomousLoop({
        session_id: sessionId,
        goal: msg.data.goal,
        max_iterations: msg.data.maxIterations,
        ensureWorkspaceCheckpoint: async (iteration) => {
          if (typeof this.ide.ensureTurnCheckpoint !== "function") {
            return undefined;
          }
          return this.ide.ensureTurnCheckpoint({
            sessionId,
            turnId: `autonomous-${sessionId}-${iteration}`,
            toolName: "autonomous_loop",
          });
        },
        resolveModel: async (modelId: string) => {
          try {
            return (await this.configHandler.llmFromTitle(modelId)) ?? null;
          } catch {
            return null;
          }
        },
        toolRuntime:
          loopLlm && extras && catalog.length
            ? {
                catalog,
                extras,
                sessionId,
                onEvent: (type, data) => BrainManager.publishEvent(type, data),
                executeTool: async (tool, args) => {
                  const workspaceDirs = await toolIde.getWorkspaceDirs();
                  return executeToolWithSoulHooks({
                    tool,
                    toolName: tool.function.name,
                    rawArgs: args,
                    ide: toolIde,
                    selectedModelTitle: loopLlm.title ?? loopLlm.model,
                    sessionId,
                    execute: () =>
                      callTool(
                        tool,
                        args,
                        {
                          ide: toolIde,
                          llm: loopLlm,
                          fetch: extras.fetch,
                          tool,
                          abortSignal: extras.abortSignal,
                        },
                        {
                          agentPolicy: resolveConfigAgentPolicy(
                            config?.experimental,
                          ),
                          workspaceDirs,
                        },
                      ),
                  });
                },
                maxStepsPerIteration: loopSettings.maxSteps,
                doomLoopThreshold: loopSettings.doomLoopThreshold,
                permission: {
                  mode: msg.data.permissionMode ?? DEFAULT_PERMISSION_MODE,
                  toolSettings: msg.data.toolSettings ?? {},
                  sessionAllowlist: [...(msg.data.sessionAllowlist ?? [])],
                  policy: config?.experimental?.agentPolicy ?? null,
                  policyFromRules:
                    config?.experimental?.agentPolicyFromRules ?? null,
                  workspaceDirs,
                },
              }
            : undefined,
      });
      return result;
    });

    on("brain/resolveAutonomousTool", async (msg) => {
      const ok = resolveAutonomousToolApproval({
        sessionId: msg.data.sessionId,
        callId: msg.data.callId,
        allow: msg.data.allow,
        always: msg.data.always,
      });
      return { ok };
    });

    on("brain/cancelAutonomousLoop", async (msg) => {
      const cancelled = BrainManager.cancelAutonomousLoop(msg.data.sessionId);
      return { cancelled };
    });

    on("brain/getAutonomousLoopStatus", async (msg) => {
      return BrainManager.getAutonomousLoopStatus(msg.data.sessionId);
    });

    on("brain/getSessionHistory", async (msg) => {
      return BrainManager.getSessionHistoryFull(msg.data.sessionId, {
        episodicLimit: msg.data.episodicLimit,
        semanticLimit: msg.data.semanticLimit,
      });
    });

    on("brain/pinMemory", async (msg) => {
      const success = await BrainManager.pinMemory(msg.data.id);
      return { success };
    });

    on("brain/unpinMemory", async (msg) => {
      const success = await BrainManager.unpinMemory(msg.data.id);
      return { success };
    });

    on("brain/mismatchMemory", async (msg) => {
      const success = await BrainManager.recordMismatch(
        msg.data.id,
        msg.data.sessionId,
      );
      return { success };
    });

    on("brain/getAuditLog", async (msg) => {
      const { BrainStore } =
        await import("./context/memory/brain/BrainStore.js");
      const entries = await BrainStore.getAuditLog({
        action: msg.data?.action,
        limit: msg.data?.limit ?? 50,
        since: msg.data?.since,
      });
      return {
        entries: entries.map((e) => {
          let details: unknown = e.details;
          if (typeof e.details === "string") {
            try {
              details = JSON.parse(e.details);
            } catch {
              details = e.details;
            }
          }
          return { ...e, details };
        }),
      };
    });

    on("brain/pinMemories", async (msg) => {
      return BrainManager.pinMemories(msg.data.ids ?? []);
    });

    on("brain/unpinMemories", async (msg) => {
      return BrainManager.unpinMemories(msg.data.ids ?? []);
    });

    on("brain/deleteMemories", async (msg) => {
      const result = await BrainManager.forgetMany(msg.data.ids ?? []);
      return {
        deleted: result.deleted,
        failed: result.failed,
        errors: result.errors,
      };
    });

    on("brain/store", async (msg) => {
      const id = await BrainManager.store(msg.data);
      return { id };
    });

    on("brain/recall", async (msg) => {
      const result = await BrainManager.recall(msg.data);
      return { result };
    });

    on("brain/stats", async () => {
      const stats = await BrainManager.getStats();
      return { stats };
    });

    on("brain/dashboard", async () => {
      try {
        const [
          stats,
          health,
          graphCap,
          sessionsData,
          healthScore,
          consolidation,
        ] = await Promise.all([
          BrainManager.getStats(),
          BrainManager.getHealth().catch(() => null),
          BrainManager.getGraphCapStatus().catch(() => null),
          BrainManager.listSessions(10).catch(() => []),
          BrainManager.getHealthScore().catch(() => null),
          Promise.resolve().then(() => {
            try {
              return BrainManager.getConsolidationStats();
            } catch {
              return null;
            }
          }),
        ]);
        // Best-effort metrics snapshot for trend dashboard (IMP-16).
        void BrainManager.storeMetricsSnapshot().catch(() => {});
        return {
          stats,
          health,
          graphStats: graphCap
            ? {
                total_entities: graphCap.entity_count,
                total_edges: graphCap.edges,
                entity_types: graphCap.entity_types,
                max_entities: graphCap.max_entities,
                cap_utilization: graphCap.cap_utilization,
                at_cap: graphCap.at_cap,
                max_depth: graphCap.max_depth,
                depth_decay_gamma: graphCap.depth_decay_gamma,
              }
            : null,
          sessions: sessionsData,
          healthScore,
          consolidation,
        };
      } catch (e) {
        return {
          stats: null,
          health: null,
          graphStats: null,
          sessions: [],
          healthScore: null,
          consolidation: null,
        };
      }
    });

    on("brain/getMetricsTrend", async (msg) => {
      return BrainManager.getMetricsTrend(msg.data?.hours ?? 24);
    });

    on("brain/graphStats", async () => {
      const [raw, cap] = await Promise.all([
        BrainManager.getGraphStats(),
        BrainManager.getGraphCapStatus(),
      ]);
      return {
        total_entities: raw?.entities ?? 0,
        total_edges: raw?.edges ?? 0,
        entity_types: raw?.entityTypes ?? {},
        max_entities: cap.max_entities,
        cap_utilization: cap.cap_utilization,
        at_cap: cap.at_cap,
        max_depth: cap.max_depth,
        depth_decay_gamma: cap.depth_decay_gamma,
      };
    });

    on("brain/searchEntities", async (msg) => {
      const entities = await BrainManager.searchEntities(
        msg.data.query,
        msg.data.entity_type,
        msg.data.limit,
      );
      return { entities: entities ?? [] };
    });

    on("brain/exploreGraph", async (msg) => {
      const config = BrainManager.getConfig();
      const result = await BrainManager.exploreGraph({
        entity_id: msg.data.entity_id,
        depth: msg.data.depth ?? config.graph_max_depth,
      });
      return { result };
    });

    on("brain/getConfig", async () => {
      const config = BrainManager.getConfig();
      return { config };
    });

    on("brain/updateConfig", async (msg) => {
      await BrainManager.updateConfig({
        key: msg.data.key,
        value: msg.data.value,
      } as any);
      // The scheduler captures the interval at start time — restart it so a
      // changed interval takes effect immediately.
      if (msg.data.key === "consolidation_interval_hours") {
        BrainManager.stopAutoConsolidation();
        BrainManager.startAutoConsolidation();
      }
      return { success: true };
    });

    on("brain/optimize", async () => {
      const result = await BrainManager.optimize();
      return { message: result };
    });

    on("brain/heal", async (msg) => {
      if (msg.data?.action) {
        const result = await BrainManager.runHealingAction(
          msg.data.action as any,
        );
        return { results: [result] };
      }
      const results = await BrainManager.autoHeal();
      return { results };
    });

    on("brain/export", async (msg) => {
      // Export writes a file to disk and returns the data as JSON string.
      // Optional password wraps the backup in AES-256-GCM (local only).
      const { BrainStore } =
        await import("./context/memory/brain/BrainStore.js");
      const exportData = await BrainStore.exportAll();
      const plaintext = JSON.stringify(exportData, null, 2);
      const password = msg.data?.password?.trim();
      let payload = plaintext;
      let encrypted = false;
      if (password) {
        const { encryptBrainExport } =
          await import("./context/memory/brain/exportCrypto.js");
        payload = JSON.stringify(encryptBrainExport(plaintext, password), null, 2);
        encrypted = true;
      }
      const { getMemoryBrainPath } = await import("./util/paths.js");
      const path = await import("path");
      const fs = await import("fs");
      const exportPath = path.join(
        getMemoryBrainPath(),
        `brain-export-${Date.now()}${encrypted ? ".enc" : ""}.json`,
      );
      fs.writeFileSync(exportPath, payload);
      return { data: payload, filePath: exportPath, encrypted };
    });

    on("brain/import", async (msg) => {
      // Webviews can't provide disk paths, so accept raw export JSON too.
      if (msg.data.data) {
        let parsed = JSON.parse(msg.data.data);
        const { isEncryptedBrainExport, decryptBrainExport } =
          await import("./context/memory/brain/exportCrypto.js");
        if (isEncryptedBrainExport(parsed)) {
          const decrypted = decryptBrainExport(parsed, msg.data.password ?? "");
          parsed = JSON.parse(decrypted);
        }
        if (!parsed.version) {
          throw new Error("Invalid export file: missing version field");
        }
        const { BrainStore } =
          await import("./context/memory/brain/BrainStore.js");
        const importResult = await BrainStore.importData(parsed);
        const summary = Object.entries(importResult.imported)
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ");
        return { result: `Import complete: ${summary}` };
      }
      if (!msg.data.filePath) {
        throw new Error("brain/import requires filePath or data");
      }
      // File-path import: support encrypted envelopes when password provided
      const fs = await import("fs");
      const raw = fs.readFileSync(msg.data.filePath, "utf-8");
      let parsed = JSON.parse(raw);
      const { isEncryptedBrainExport, decryptBrainExport } =
        await import("./context/memory/brain/exportCrypto.js");
      if (isEncryptedBrainExport(parsed)) {
        const decrypted = decryptBrainExport(parsed, msg.data.password ?? "");
        parsed = JSON.parse(decrypted);
        const { BrainStore } =
          await import("./context/memory/brain/BrainStore.js");
        const importResult = await BrainStore.importData(parsed);
        const summary = Object.entries(importResult.imported)
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ");
        return { result: `Import complete: ${summary}` };
      }
      const result = await BrainManager.importMemories(msg.data.filePath);
      return { result };
    });

    on("brain/deleteMemory", async (msg) => {
      const result = await BrainManager.forget(msg.data.id);
      return { success: result };
    });

    on("brain/searchMemories", async (msg) => {
      try {
        const { BrainStore } =
          await import("./context/memory/brain/BrainStore.js");
        const annotatePinned = async (memories: any[]) => {
          if (!memories.length) return memories;
          const ids = memories.map((m) => m.id).filter((id) => typeof id === "number");
          if (!ids.length) return memories;
          const db = await BrainStore.get();
          const placeholders = ids.map(() => "?").join(",");
          const pinnedRows = await db.all(
            `SELECT memory_id FROM brain_tags
             WHERE memory_type = 'semantic' AND tag = 'pinned'
             AND memory_id IN (${placeholders})`,
            ids,
          );
          const pinned = new Set(pinnedRows.map((r: any) => r.memory_id));
          return memories.map((m) => ({ ...m, pinned: pinned.has(m.id) }));
        };

        if (msg.data.query && msg.data.query !== "*") {
          const result = await BrainManager.recall({
            query: msg.data.query,
            category: msg.data.category as any,
            limit: msg.data.limit,
          });
          let memories = await annotatePinned(result?.semantic ?? []);
          if (msg.data.tier) {
            memories = memories.filter((m: any) => m.tier === msg.data.tier);
          }
          if (msg.data.pinned === true) {
            memories = memories.filter((m: any) => m.pinned);
          } else if (msg.data.pinned === false) {
            memories = memories.filter((m: any) => !m.pinned);
          }
          return { memories };
        }
        // Browse all — use BrainStore directly
        const db = await BrainStore.get();
        const conditions: string[] = [];
        const sqlParams: any[] = [];
        if (msg.data.category) {
          conditions.push("category = ?");
          sqlParams.push(msg.data.category);
        }
        if (msg.data.tier) {
          conditions.push("tier = ?");
          sqlParams.push(msg.data.tier);
        }
        if (msg.data.pinned === true) {
          conditions.push(
            `id IN (SELECT memory_id FROM brain_tags WHERE memory_type = 'semantic' AND tag = 'pinned')`,
          );
        } else if (msg.data.pinned === false) {
          conditions.push(
            `id NOT IN (SELECT memory_id FROM brain_tags WHERE memory_type = 'semantic' AND tag = 'pinned')`,
          );
        }
        const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
        sqlParams.push(msg.data.limit ?? 100, msg.data.offset ?? 0);
        const rows = await db.all(
          `SELECT * FROM brain_semantic ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
          sqlParams,
        );
        return { memories: await annotatePinned(rows ?? []) };
      } catch {
        return { memories: [] };
      }
    });

    on("brain/consolidate", async () => {
      const result = await BrainManager.consolidate();
      return { result };
    });

    on("brain/listSessions", async (msg) => {
      const sessions = await BrainManager.listSessions(
        msg.data?.limit,
        msg.data?.workspace_directory,
      );
      return { sessions };
    });

    on("brain/summarizeSession", async (msg) => {
      const summary = await BrainManager.summarizeSession(msg.data);
      return { summary };
    });

    on("brain/searchBacklogs", async (msg) => {
      const result = await BrainManager.searchBacklogs(msg.data);
      return { result };
    });

    on("brain/llmExtractEntities", async (msg) => {
      const result = await BrainManager.llmExtractEntities(
        msg.data.text,
        msg.data.session_id,
      );
      return { result };
    });

    on("brain/llmSummarizeSession", async (msg) => {
      const result = await BrainManager.llmSummarizeSession(
        msg.data.session_id,
        msg.data.detail_level as any,
      );
      return { summary: result.summary, llm_used: result.llm_used };
    });

    on("brain/llmEvaluateImportance", async (msg) => {
      const result = await BrainManager.llmEvaluateImportance(
        msg.data.content,
        msg.data.role,
        msg.data.context,
      );
      return result;
    });

    on("brain/llmPostActionMemory", async (msg) => {
      const result = await BrainManager.llmPostActionMemory(
        msg.data.action_description,
        msg.data.action_result,
        msg.data.session_id,
      );
      return { result };
    });

    on("brain/createCheckpoint", async (msg) => {
      const checkpoint = await BrainManager.createCheckpoint(msg.data.label);
      return { checkpoint };
    });

    on("brain/listCheckpoints", async (msg) => {
      const checkpoints = await BrainManager.listCheckpoints(msg.data?.limit);
      return { checkpoints };
    });

    on("brain/rollbackCheckpoint", async (msg) => {
      const result = await BrainManager.rollbackCheckpoint(
        msg.data.checkpoint_id,
      );
      return { result };
    });

    on("brain/deleteCheckpoint", async (msg) => {
      const success = await BrainManager.deleteCheckpoint(
        msg.data.checkpoint_id,
      );
      return { success };
    });

    on("config/getSerializedProfileInfo", async (msg) => {
      return {
        result: await this.configHandler.getSerializedConfig(),
        profileId:
          this.configHandler.currentProfile?.profileDescription.id ?? null,
      };
    });

    on("clipboardCache/add", (msg) => {
      const added = clipboardCache.add(uuidv4(), msg.data.content);
      if (added) {
        this.messenger.send("refreshSubmenuItems", {
          providers: ["clipboard"],
        });
      }
    });

    on("llm/streamChat", (msg) =>
      llmStreamChat(
        this.configHandler,
        this.abortedMessageIds,
        msg,
        ide,
        this.messenger,
      ),
    );

    on("llm/complete", async (msg) => {
      const model = await this.configHandler.llmFromTitle(msg.data.title);
      const completion = await model.complete(
        msg.data.prompt,
        new AbortController().signal,
        msg.data.completionOptions,
      );
      return completion;
    });
    on("llm/listModels", async (msg) => {
      const { config } = await this.configHandler.loadConfig();
      if (!config) {
        return [];
      }

      const model =
        config.models.find((model) => model.title === msg.data.title) ??
        config.models.find((model) => model.title?.startsWith(msg.data.title));
      try {
        if (model) {
          return await model.listModels();
        } else {
          return undefined;
        }
      } catch (e) {
        console.debug(`Error listing models: ${e}`);
        return undefined;
      }
    });

    // Provide messenger to utils so they can interact with GUI + state
    ChatDescriber.messenger = this.messenger;

    on("chatDescriber/describe", async (msg) => {
      const currentModel = await this.configHandler.llmFromTitle(
        msg.data.selectedModelTitle,
      );
      return await ChatDescriber.describe(currentModel, {}, msg.data.text);
    });

    async function* streamDiffLinesGenerator(
      configHandler: ConfigHandler,
      abortedMessageIds: Set<string>,
      msg: Message<ToCoreProtocol["streamDiffLines"][0]>,
    ): AsyncGenerator<DiffLine> {
      const data = msg.data;
      const llm = await configHandler.llmFromTitle(msg.data.modelTitle);
      for await (const diffLine of streamDiffLines(
        data.prefix,
        data.highlighted,
        data.suffix,
        llm,
        data.input,
        data.language,
        false,
        undefined,
      )) {
        if (abortedMessageIds.has(msg.messageId)) {
          abortedMessageIds.delete(msg.messageId);
          break;
        }
        yield diffLine;
      }
    }

    on("streamDiffLines", (msg) =>
      streamDiffLinesGenerator(this.configHandler, this.abortedMessageIds, msg),
    );

    on("stats/getTokensPerDay", async (msg) => {
      const rows = await DevDataSqliteDb.getTokensPerDay();
      return rows;
    });
    on("stats/getTokensPerModel", async (msg) => {
      const rows = await DevDataSqliteDb.getTokensPerModel();
      return rows;
    });
    on("stats/getTokensPerModelWithCost", async (msg) => {
      const rows = await DevDataSqliteDb.getTokensPerModel();
      return enrichWithCost(rows);
    });

    // ── Terminal Suggestion Handlers ──
    on("terminal/getSuggestions", async () => {
      try {
        const contents = await ide.getTerminalContents();
        if (!contents || contents.trim().length === 0) {
          return { suggestions: [] };
        }

        const errorPatterns: { pattern: RegExp; category: string }[] = [
          { pattern: /error TS\d+:/i, category: "build" },
          { pattern: /SyntaxError:/i, category: "build" },
          {
            pattern: /Cannot find module ['"][^'"]+['"]/i,
            category: "dependency",
          },
          { pattern: /Module not found/i, category: "dependency" },
          { pattern: /npm ERR!/i, category: "dependency" },
          { pattern: /FAIL\s+/i, category: "test" },
          { pattern: /AssertionError/i, category: "test" },
          { pattern: /error\[E\d+\]/i, category: "build" },
          {
            pattern: /Traceback \(most recent call last\)/i,
            category: "runtime",
          },
          { pattern: /ModuleNotFoundError:/i, category: "dependency" },
          { pattern: /FATAL ERROR/i, category: "runtime" },
        ];

        const lines = contents.split("\n");
        const suggestions: Array<{
          command: string;
          errorPattern: string;
          suggestedFix: string;
          confidence: number;
          timestamp: number;
        }> = [];

        for (const line of lines.slice(-100)) {
          for (const { pattern, category } of errorPatterns) {
            const match = line.match(pattern);
            if (match) {
              suggestions.push({
                command: line.trim().substring(0, 200),
                errorPattern: match[0],
                suggestedFix:
                  category === "dependency"
                    ? "Install missing dependencies"
                    : category === "build"
                      ? "Fix the compilation error"
                      : category === "test"
                        ? "Fix the failing test"
                        : "Investigate the runtime error",
                confidence: category === "dependency" ? 0.9 : 0.7,
                timestamp: Date.now(),
              });
              break;
            }
          }
        }

        // Deduplicate by errorPattern
        const seen = new Set<string>();
        const unique = suggestions.filter((s) => {
          if (seen.has(s.errorPattern)) return false;
          seen.add(s.errorPattern);
          return true;
        });

        return { suggestions: unique.slice(0, 5) };
      } catch (e) {
        console.error("[Terminal] Failed to get suggestions:", e);
        return { suggestions: [] };
      }
    });

    on("terminal/applySuggestion", async (msg) => {
      const { command, suggestedFix } = msg.data;
      try {
        await ide.runCommand(suggestedFix);
        return { success: true };
      } catch {
        return { success: false };
      }
    });

    // File changes
    // TODO - remove remaining logic for these from IDEs where possible
    on("files/changed", async ({ data }) => {
      if (data?.uris?.length) {
        // File watching logic has been simplified
        for (const uri of data.uris) {
          const currentProfileUri =
            this.configHandler.currentProfile?.profileDescription.uri ?? "";

          if (URI.equal(uri, currentProfileUri)) {
            // Trigger a toast notification to provide UI feedback that config has been updated
            const showToast =
              this.globalContext.get("showConfigUpdateToast") ?? true;
            if (showToast) {
              const selection = await this.ide.showToast(
                "info",
                t("configUpdated"),
                t("dontShowAgain"),
              );
              if (selection === t("dontShowAgain")) {
                this.globalContext.update("showConfigUpdateToast", false);
              }
            }
            await this.configHandler.reloadConfig();
            continue;
          }

          if (
            uri.endsWith(".prompt") ||
            uri.endsWith(SYSTEM_PROMPT_DOT_FILE)
          ) {
            await this.configHandler.reloadConfig();
          } else if (
            uri.endsWith(".knoxignore") ||
            uri.endsWith(".gitignore")
          ) {
          } else {
            // File change handling has been simplified
          }
        }
      }
    });

    const refreshIfNotIgnored = async (uris: string[]) => {};

    on("files/created", async ({ data }) => {
      if (data?.uris?.length) {
        // File cache has been removed
        void refreshIfNotIgnored(data.uris);

        for (const uri of data.uris) {
          if (isLocalAssistantFile(uri)) {
            await this.configHandler.reloadLocalProfiles();
          }
        }
      }
    });

    on("files/deleted", async ({ data }) => {
      if (data?.uris?.length) {
        // File cache has been removed
        void refreshIfNotIgnored(data.uris);
      }
    });

    on("files/closed", async ({ data }) => {
      if (data.uris) {
        this.messenger.send("didCloseFiles", {
          uris: data.uris,
        });
      }
    });

    on("files/opened", async ({ data }) => {
      if (data?.uris?.length) {
        // Do something on files opened
      }
    });

    on("didChangeSelectedProfile", async (msg) => {
      await this.configHandler.setSelectedProfile(msg.data.id);
      await this.configHandler.reloadConfig();
    });

    on("didChangeActiveTextEditor", async ({ data: { filepath } }) => {
      try {
        // File tracking has been removed
      } catch (e) {
        console.error(
          `didChangeActiveTextEditor: failed to update recentlyEditedFiles cache for ${filepath}`,
        );
      }
    });

    on(
      "tools/call",
      async (msg) => {
        const {
          toolCall,
          selectedModelTitle,
          viewReadModelTitle,
          realTimeSearchModelTitle,
          preferredModel,
          sessionId: requestSessionId,
          turnId,
        } = msg.data;
        const requestedName = toolCall.function.name;
        const toolName = resolveBuiltInToolName(requestedName) || requestedName;
        if (toolName !== requestedName) {
          toolCall.function.name = toolName;
          console.log(
            `[Tools/Call] Canonicalized tool name '${requestedName}' → '${toolName}'`,
          );
        }
        console.log(
          `[Tools/Call] Executing ${toolName} with Chat: ${selectedModelTitle}, ViewRead: ${viewReadModelTitle || "null"}, RealTimeSearch: ${realTimeSearchModelTitle || "null"}, Preferred: ${preferredModel || "auto"}`,
        );

        if (this.abortedMessageIds.has(msg.messageId)) {
          this.abortedMessageIds.delete(msg.messageId);
          throw new Error(`Tool "${toolName}" cancelled`);
        }

        const toolAbort = new AbortController();
        this.activeToolAborts.set(msg.messageId, toolAbort);

        try {
        const { config } = await this.configHandler.loadConfig();
        if (!config) {
          throw new Error(t("configNotLoaded"));
        }

        const tool = config.tools.find((t) => t.function.name === toolName);

        if (!tool) {
          throw new Error(formatUnknownToolError(toolName));
        }

        // Import model routing utility
        const {
          selectModelForTool,
          createModelSwitchingContext,
          isRealTimeSearchTool,
        } = await import("./tools/modelRouting");

        // Get the chat model
        const chatModel =
          await this.configHandler.llmFromTitle(selectedModelTitle);

        // Get the view/read model if specified
        let viewReadModel = null;
        if (viewReadModelTitle) {
          try {
            viewReadModel =
              await this.configHandler.llmFromTitle(viewReadModelTitle);
          } catch (error) {
            console.warn(
              `[Tools/Call] Failed to load view/read model '${viewReadModelTitle}', falling back to chat model:`,
              error,
            );
          }
        }

        // Get the real-time search model if specified
        let realTimeSearchModel = null;
        if (realTimeSearchModelTitle) {
          try {
            realTimeSearchModel = await this.configHandler.llmFromTitle(
              realTimeSearchModelTitle,
            );
          } catch (error) {
            console.warn(
              `[Tools/Call] Failed to load real-time search model '${realTimeSearchModelTitle}', falling back to chat model:`,
              error,
            );
          }
        }

        if (isRealTimeSearchTool(toolName) && !realTimeSearchModel) {
          throw new Error(
            "RealTime Search model is not configured; web search is unavailable.",
          );
        }

        // Create model switching context for dynamic switching
        const modelContext = createModelSwitchingContext(
          chatModel,
          viewReadModel,
          realTimeSearchModel,
        );

        // Select the appropriate model for this tool with preferred model support
        const llm = selectModelForTool(
          toolName,
          chatModel,
          viewReadModel,
          realTimeSearchModel,
          preferredModel as "chat" | "viewRead" | "realTimeSearch" | undefined,
        );

        // Log model selection for debugging
        if (realTimeSearchModel && llm === realTimeSearchModel) {
          console.log(
            `[Model Routing] Using RealTimeSearch model '${realTimeSearchModelTitle}' for tool: ${toolName}`,
          );
        } else if (viewReadModel && llm === viewReadModel) {
          console.log(
            `[Model Routing] Using View/Read model '${viewReadModelTitle}' for tool: ${toolName}`,
          );
        } else if (llm === chatModel) {
          const reason =
            realTimeSearchModel || viewReadModel
              ? "specialized model available but not selected"
              : "no specialized model available";
          console.log(
            `[Model Routing] Using Chat model '${selectedModelTitle}' for tool: ${toolName} (${reason})`,
          );
        }

        // ── Argument handling is now delegated to the middleware layer ──
        // The middleware in callTool handles:
        // - String → object parsing
        // - Malformed JSON repair (trailing commas, single quotes, etc.)
        // - Missing required parameter validation
        // We pass raw arguments through — the middleware deals with it.
        const rawArgs = toolCall.function.arguments;
        const sessionId =
          requestSessionId || BrainManager.getActiveSessionId() || undefined;
        const toolIde = this.agentWorktree
          ? wrapIdeForWorktree(this.ide, this.agentWorktree)
          : this.ide;
        const loopSettings = resolveAgentLoopSettings(config.experimental);
        const verifyCommand = loopSettings.verifyCommand;
        const verifyMode = loopSettings.verifyMode;

        try {
          const contextItems = await executeToolWithSoulHooks({
            tool,
            toolName,
            rawArgs,
            ide: toolIde,
            selectedModelTitle,
            sessionId,
            turnId,
            buildVerify:
              verifyMode === "command" && verifyCommand
                ? {
                    command: verifyCommand,
                    maxIterations: resolveVerifyMaxIterations(
                      config.experimental?.agentVerifyMaxIterations,
                    ),
                    run: async (command) =>
                      callTool(
                        runTerminalCommandTool,
                        { command },
                        {
                          ide: toolIde,
                          llm,
                          fetch: (url, init) =>
                            fetchwithRequestOptions(
                              url,
                              init,
                              config.requestOptions,
                            ),
                          tool: runTerminalCommandTool,
                          abortSignal: toolAbort.signal,
                        },
                        {
                          retry: false,
                          timeout: false,
                          circuitBreaker: false,
                          logging: false,
                          agentPolicy: resolveConfigAgentPolicy(
                            config.experimental,
                          ),
                          workspaceDirs: await toolIde.getWorkspaceDirs(),
                        },
                      ),
                  }
                : undefined,
            execute: async () => {
              if (
                toolAbort.signal.aborted ||
                this.abortedMessageIds.has(msg.messageId)
              ) {
                this.abortedMessageIds.delete(msg.messageId);
                throw new Error(`Tool "${toolName}" cancelled`);
              }

              const items = await callTool(
                tool,
                rawArgs,
                {
                  ide: toolIde,
                  llm,
                  fetch: (url, init) =>
                    fetchwithRequestOptions(url, init, config.requestOptions),
                  tool,
                  abortSignal: toolAbort.signal,
                  toolCallId: toolCall.id,
                  soul: { sessionId, turnId },
                  onPartialOutput: (items) => {
                    if (!toolCall.id) {
                      return;
                    }
                    this.send("tools/partialOutput", {
                      toolCallId: toolCall.id,
                      contextItems: items,
                    });
                  },
                },
                {
                  agentPolicy: resolveConfigAgentPolicy(config.experimental),
                  workspaceDirs: await toolIde.getWorkspaceDirs(),
                  defaultMaxFiles: resolveViewSubdirectoryMaxFiles(
                    config.experimental?.agentViewSubdirectoryMaxFiles,
                  ),
                },
              );

              // If the write already succeeded, return it. Throwing
              // "cancelled" here marked a finished builtin_edit_file as a
              // user Stop and aborted the agent. Pre-execute abort still
              // throws above.
              if (this.abortedMessageIds.has(msg.messageId)) {
                this.abortedMessageIds.delete(msg.messageId);
              }

              if (tool.faviconUrl) {
                items.forEach((item) => {
                  item.icon = tool.faviconUrl;
                });
              }
              return items;
            },
          });

          return { contextItems };
        } catch (error) {
          const errorInfo =
            error instanceof Error
              ? {
                  message: error.message,
                  name: error.name,
                  stack: error.stack?.split("\n").slice(0, 5).join("\n"),
                }
              : { message: String(error) };

          console.error(`[Tools/Call] Tool "${toolName}" failed:`, errorInfo);
          throw error;
        }
        } finally {
          this.activeToolAborts.delete(msg.messageId);
        }
      },
    );
  }
}
