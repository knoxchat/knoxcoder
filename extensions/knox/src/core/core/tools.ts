import { fetchwithRequestOptions } from "knoxdev-package/fetch";

import { resolveAgentLoopSettings } from "../config/agentProfile";
import { BrainManager } from "../context/memory/brain/BrainManager";
import { getJevConfirmedProfile } from "../jev/config";
import { t } from "../i18n/index.js";
import { callTool } from "../tools/callTool";
import { parseToolArgs } from "../tools/postEditVerification";
import {
  formatUnknownToolError,
  resolveBuiltInToolCall,
  resolveViewSubdirectoryMaxFiles,
} from "../tools/builtIn";
import { executeToolWithSoulHooks } from "../tools/mutatingToolHooks";
import { resolveConfigAgentPolicy } from "../tools/toolPolicy";
import { runTerminalCommandTool } from "../tools/definitions/runTerminalCommand";
import { resolveVerifyMaxIterations } from "../tools/build/verifyCommand";
import { wrapIdeForWorktree } from "../tools/worktree";

import type { CoreRuntime } from "./runtime";

export function registerToolHandlers(core: CoreRuntime): void {
  const on = core.messenger.on.bind(core.messenger);

  on("tools/call", async (msg) => {
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
    const parsedArgs = parseToolArgs(toolCall.function.arguments) ?? {};
    const toolName =
      resolveBuiltInToolCall(requestedName, parsedArgs) || requestedName;
    if (toolName !== requestedName) {
      toolCall.function.name = toolName;
      console.log(
        `[Tools/Call] Canonicalized tool name '${requestedName}' → '${toolName}'`,
      );
    }
    console.log(
      `[Tools/Call] Executing ${toolName} with Chat: ${selectedModelTitle}, ViewRead: ${viewReadModelTitle || "null"}, RealTimeSearch: ${realTimeSearchModelTitle || "null"}, Preferred: ${preferredModel || "auto"}`,
    );

    if (core.abortedMessageIds.has(msg.messageId)) {
      core.abortedMessageIds.delete(msg.messageId);
      throw new Error(`Tool "${toolName}" cancelled`);
    }

    const toolAbort = new AbortController();
    core.activeToolAborts.set(msg.messageId, toolAbort);

    try {
    const { config } = await core.configHandler.loadConfig();
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
    } = await import("../tools/modelRouting");

    // Get the chat model
    const chatModel =
      await core.configHandler.llmFromTitle(selectedModelTitle);

    // Get the view/read model if specified
    let viewReadModel = null;
    if (viewReadModelTitle) {
      try {
        viewReadModel =
          await core.configHandler.llmFromTitle(viewReadModelTitle);
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
        realTimeSearchModel = await core.configHandler.llmFromTitle(
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
    const toolIde = core.agentWorktree
      ? wrapIdeForWorktree(core.ide, core.agentWorktree)
      : core.ide;
    const loopSettings = resolveAgentLoopSettings(
      config.experimental,
      undefined,
      getJevConfirmedProfile(),
    );
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
            core.abortedMessageIds.has(msg.messageId)
          ) {
            core.abortedMessageIds.delete(msg.messageId);
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
                core.send("tools/partialOutput", {
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
          if (core.abortedMessageIds.has(msg.messageId)) {
            core.abortedMessageIds.delete(msg.messageId);
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
      core.activeToolAborts.delete(msg.messageId);
    }
  });
}
