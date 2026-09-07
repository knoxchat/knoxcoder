/**
 * GUI product Agent chat → shared `runAgentLoop` (HL-01).
 *
 * Token chunks still go through Redux `streamUpdate`. Tools, doom-loop,
 * compaction, consecutive readonly batching, and Ask/Accept wait on the
 * same runtime as `/autonomous`, subagents, and eval.
 */

import { ThunkDispatch, UnknownAction, unwrapResult } from "@reduxjs/toolkit";
import {
  AssistantChatMessage,
  ChatMessage,
  ContextItem,
  ModelDescription,
  PromptLog,
  Tool,
  ToolCallState,
  ToolExtras,
} from "core";
import {
  createAgentLoopCompactor,
  runAgentLoop,
  type AgentLoopToolCall,
} from "core/agent/loop";
import {
  isHardPolicyDeny,
  isToolAutoApproved,
} from "core/agent/permissions";
import { analyzeForViewReadModel } from "core/tools/modelRouting";
import { ToCoreProtocol } from "core/protocol";
import { BuiltInToolNames, resolveBuiltInToolName } from "core/tools/builtIn";
import { selectAgentTools } from "core/tools/catalog";
import { ToolCallError, ToolCallErrorCode } from "core/tools/errors";

import { modelSupportsWebSearch } from "../../util/webSearch";
import { resolveReasoningEffort } from "../../util/reasoningEffort";
import {
  collectTurnToolCalls,
  resolveDoomLoopThreshold,
} from "../util/doomLoop";
import { resolveAgentMaxSteps } from "../util/agentMaxSteps";
import {
  enterGuiAgentLoop,
  leaveGuiAgentLoop,
  rejectGuiLoopWaiters,
  waitForGuiAskUser,
  waitForGuiToolApproval,
} from "../util/guiToolApproval";
import {
  DEFAULT_PERMISSION_MODE,
} from "../util/permissionMode";
import { findToolCallStateById, getHistoryToolStates } from "../util";
import { selectDefaultModel } from "../slices/configSlice";
import {
  acceptToolCall,
  addPromptCompletionPair,
  addSessionToolAllowlist,
  hydrateLastAssistant,
  incrementToolLoopSteps,
  setCalling,
  setToolCallOutput,
  setToolGenerated,
  streamUpdate,
} from "../slices/sessionSlice";
import { RootState, ThunkApiType } from "../store";

import { callTool } from "./callTool";
import { streamResponseAfterToolCall } from "./streamResponseAfterToolCall";

type GuiThunkDispatch = ThunkDispatch<
  RootState,
  ThunkApiType["extra"],
  UnknownAction
>;

const DENIED_TOOL_OUTPUT: ContextItem[] = [
  {
    name: "Agent",
    description: "permission-denied",
    content:
      "Blocked: this tool was not approved. The call was not executed. Continue with a different approach or wait for the user.",
  },
];

function cancelledToolError(toolName: string): ToolCallError {
  return new ToolCallError({
    code: ToolCallErrorCode.CANCELLED,
    message: "cancelled",
    toolName,
    retryable: false,
  });
}

function messageText(message: ChatMessage | undefined): string {
  if (!message) {
    return "";
  }
  if (typeof message.content === "string") {
    return message.content;
  }
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => ("text" in part ? part.text : ""))
      .join(" ");
  }
  return "";
}

function resolveCallId(
  call: AgentLoopToolCall,
  history: RootState["session"]["history"],
): string {
  if (call.id) {
    return call.id;
  }
  for (let i = history.length - 1; i >= 0; i--) {
    const match = getHistoryToolStates(history[i]).find(
      (state: ToolCallState) =>
        (state.status === "generated" || state.status === "generating") &&
        (resolveBuiltInToolName(state.toolCall.function.name) ||
          state.toolCall.function.name) === call.name,
    );
    if (match?.toolCallId) {
      return match.toolCallId;
    }
  }
  return call.name;
}

async function writeDeniedToolCard(
  dispatch: GuiThunkDispatch,
  callId: string,
  output: ContextItem[],
): Promise<void> {
  dispatch(setCalling(callId));
  dispatch(setToolCallOutput({ toolCallId: callId, output }));
  dispatch(acceptToolCall(callId));
  unwrapResult(
    await dispatch(
      streamResponseAfterToolCall({
        toolCallId: callId,
        toolOutput: output,
        skipLlmContinue: true,
      }),
    ),
  );
}

export async function runGuiAgentLoop(params: {
  messages: ChatMessage[];
  legacySlashCommandData?: ToCoreProtocol["llm/streamChat"][0]["legacySlashCommandData"];
  dispatch: GuiThunkDispatch;
  extra: ThunkApiType["extra"];
  getState: () => RootState;
}): Promise<void> {
  const { dispatch, extra, getState, legacySlashCommandData } = params;
  const messages = [...params.messages];
  const state = getState();
  const defaultModel = selectDefaultModel(state);
  if (!defaultModel) {
    throw new Error("Default model not defined");
  }

  const abortSignal = state.session.streamAborter.signal;
  const agentMaxSteps = resolveAgentMaxSteps(
    state.config.config.experimental?.agentMaxSteps,
    state.config.config.experimental?.agentProfile,
  );
  const remainingSteps =
    agentMaxSteps === null
      ? null
      : Math.max(0, agentMaxSteps - state.session.toolLoopSteps);
  const doomThreshold = resolveDoomLoopThreshold(
    state.config.config.experimental?.agentDoomLoopThreshold,
    state.config.config.experimental?.agentProfile,
  );
  const systems = state.config.config.experimental?.agentProfile === "systems";
  let debugSessionActive = false;
  try {
    const status = await extra.ideMessenger.request("debugControl", {
      op: "status",
    });
    debugSessionActive =
      status.status === "success" && Boolean(status.content?.sessionActive);
  } catch {
    debugSessionActive = false;
  }
  const tools = selectAgentTools(state.config.config.tools, {
    systems,
    debugSessionActive,
  }).filter((tool) => {
    const toolEnabled =
      state.ui.toolSettings[tool.function.name] !== "disabled" &&
      state.ui.toolGroupSettings[tool.group] !== "exclude";
    return toolEnabled;
  });

  const pickModelTitle = (requestMessages: ChatMessage[]): string => {
    const live = getState();
    const chatModel = selectDefaultModel(live) ?? defaultModel;
    const viewReadModel = live.config.config.selectedModelByRole.viewRead;
    if (!viewReadModel || requestMessages.length === 0) {
      return chatModel.title;
    }
    const lastMessage = requestMessages[requestMessages.length - 1];
    let messageContent = "";
    if (lastMessage.role === "user") {
      messageContent = messageText(lastMessage);
    } else if (lastMessage.role === "tool") {
      messageContent = `${messageText(
        [...requestMessages].reverse().find((msg) => msg.role === "user"),
      )} ${messageText(lastMessage).slice(0, 200)}`;
    } else {
      return chatModel.title;
    }
    if (!messageContent.trim()) {
      return chatModel.title;
    }
    const analysis = analyzeForViewReadModel(
      messageContent,
      requestMessages.length > 1 || live.session.mode === "agent",
    );
    return analysis.shouldUseViewRead ? viewReadModel.title : chatModel.title;
  };

  const adapter = {
    model: defaultModel.model,
    title: defaultModel.title,
    contextLength: defaultModel.contextLength ?? 32_000,
    completionOptions: {
      maxTokens: defaultModel.completionOptions?.maxTokens ?? 2048,
    },
    streamChat: async function* (
      requestMessages: ChatMessage[],
      signal: AbortSignal,
      options?: { tools?: Tool[] },
    ) {
      const live = getState();
      if (!live.session.isStreaming) {
        return;
      }
      const title = pickModelTitle(requestMessages);
      const model: ModelDescription =
        live.config.config.models.find(
          (item: ModelDescription) => item.title === title,
        ) ??
        selectDefaultModel(live) ??
        defaultModel;
      const reasoningEffort = resolveReasoningEffort(
        model,
        live.ui.reasoningEffortByModel ?? {},
        live.ui.reasoningEffort,
      );
      const webSearchSupported = modelSupportsWebSearch(model);
      const useNativeWebSearch = webSearchSupported && live.ui.webSearchEnabled;
      const realTimeSearchModel =
        live.config.config.selectedModelByRole.realTimeSearch;
      const catalog = (options?.tools ?? []).filter((tool) => {
        if (tool.function.name !== BuiltInToolNames.SearchWeb) {
          return true;
        }
        return !useNativeWebSearch && !!realTimeSearchModel;
      });

      const gen = extra.ideMessenger.llmStreamChat(
        {
          completionOptions: {
            ...(catalog.length ? { tools: catalog } : {}),
            ...(reasoningEffort ? { reasoningEffort } : {}),
            ...(webSearchSupported
              ? { webSearch: live.ui.webSearchEnabled }
              : {}),
          },
          title: model.title,
          messages: requestMessages,
          legacySlashCommandData,
        },
        signal,
      );

      try {
        let next = await gen.next();
        while (!next.done) {
          if (!getState().session.isStreaming || signal.aborted) {
            break;
          }
          const batch = next.value;
          dispatch(streamUpdate(batch));
          for (const chunk of batch) {
            yield chunk;
          }
          next = await gen.next();
        }
        if (next.done && next.value) {
          return next.value;
        }
      } finally {
        try {
          await gen.return?.(undefined);
        } catch {
          // Best-effort close so the stream abort listener is dropped.
        }
      }
    },
  } as unknown as ToolExtras["llm"];

  enterGuiAgentLoop();
  try {
    await runAgentLoop({
      extras: {
        llm: adapter,
        abortSignal,
      },
      messages,
      tools,
      maxSteps: remainingSteps,
      doomLoopThreshold: doomThreshold,
      holdCompletionWhileOracleRed: true,
      compact: createAgentLoopCompactor(adapter),
      initialDoomCalls: collectTurnToolCalls(state.session.history).map(
        (item) => ({
          name: item.toolCall.function.name,
          args: item.parsedArgs ?? item.toolCall.function.arguments,
          output: (item.output ?? []).map((out) => out.content ?? "").join("\n"),
          items: item.output,
          ok: item.status === "done",
        }),
      ),
      onPromptLog: (log: PromptLog) => {
        dispatch(addPromptCompletionPair([log]));
        try {
          if (getState().session.mode === "chat") {
            extra.ideMessenger.post("devdata/log", {
              name: "chatInteraction",
              data: {
                prompt: log.prompt,
                completion: log.completion,
                modelProvider: defaultModel.provider,
                modelTitle: defaultModel.title,
                sessionId: getState().session.id,
              },
            });
          }
        } catch (e) {
          console.error("Failed to send development data interaction log", e);
        }
      },
      onAssistant: (assistant: AssistantChatMessage) => {
        dispatch(hydrateLastAssistant(assistant));
        dispatch(setToolGenerated());
      },
      onStep: () => {
        dispatch(incrementToolLoopSteps());
      },
      approveTool: async (tool, args, call) => {
        if (abortSignal.aborted) {
          throw cancelledToolError(tool.function.name);
        }
        const live = getState();
        const callId = resolveCallId(call, live.session.history);
        if (
          isHardPolicyDeny({
            toolName: tool.function.name,
            args,
            policy: live.config.config.experimental?.agentPolicy,
            policyFromRules:
              live.config.config.experimental?.agentPolicyFromRules,
            workspaceDirs: window.workspacePaths,
          })
        ) {
          await writeDeniedToolCard(dispatch, callId, DENIED_TOOL_OUTPUT);
          return "deny";
        }
        if (tool.function.name === BuiltInToolNames.AskUser) {
          return "allow";
        }
        if (
          isToolAutoApproved({
            toolName: tool.function.name,
            toolSettings: live.ui.toolSettings,
            permissionMode: live.ui.permissionMode ?? DEFAULT_PERMISSION_MODE,
            sessionAllowlist: live.session.sessionToolAllowlist,
            args,
            policy: live.config.config.experimental?.agentPolicy,
            policyFromRules:
              live.config.config.experimental?.agentPolicyFromRules,
            workspaceDirs: window.workspacePaths,
          })
        ) {
          return "allow";
        }
        const decision = await waitForGuiToolApproval({
          callId,
          abortSignal,
        });
        if (abortSignal.aborted) {
          throw cancelledToolError(tool.function.name);
        }
        if (decision.always) {
          dispatch(addSessionToolAllowlist(tool.function.name));
        }
        if (!decision.allow) {
          await writeDeniedToolCard(dispatch, callId, DENIED_TOOL_OUTPUT);
          return "deny";
        }
        return "allow";
      },
      executeTool: async (tool, _args, call) => {
        if (abortSignal.aborted) {
          throw cancelledToolError(tool.function.name);
        }
        const callId = resolveCallId(call, getState().session.history);
        if (tool.function.name === BuiltInToolNames.AskUser) {
          const output = await waitForGuiAskUser({
            callId,
            abortSignal,
          });
          if (abortSignal.aborted || !output) {
            throw cancelledToolError(tool.function.name);
          }
          return output;
        }
        unwrapResult(
          await dispatch(
            callTool({
              toolCallId: callId,
              skipContinue: true,
            }),
          ),
        );
        const settled = findToolCallStateById(
          getState().session.history,
          callId,
        );
        // Only a real user Stop should abort the agent loop. A failed
        // edit/write used to be marked canceled, which stopped the LLM
        // before it could retry. Missing/unfinished → error result, continue.
        if (settled?.status === "canceled") {
          throw cancelledToolError(tool.function.name);
        }
        if (!settled || settled.status !== "done") {
          return [
            {
              name: "Tool Call Error",
              description: "failed",
              content: `Tool call "${tool.function.name}" did not finish (status=${settled?.status ?? "missing"}).`,
            },
          ];
        }
        return settled.output ?? [];
      },
    });
  } finally {
    rejectGuiLoopWaiters();
    leaveGuiAgentLoop();
  }
}
