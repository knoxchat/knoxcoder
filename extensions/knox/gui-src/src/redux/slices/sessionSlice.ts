import {
  ActionReducerMapBuilder,
  AsyncThunk,
  PayloadAction,
  createSelector,
  createSlice,
} from "@reduxjs/toolkit";
import { JSONContent } from "@tiptap/react";
import {
  ApplyState,
  ChatHistoryItem,
  ChatMessage,
  CodeToEdit,
  ContextItem,
  ContextItemWithId,
  FileSymbolMap,
  MessageModes,
  PromptLog,
  Session,
  SessionMetadata,
} from "core";
import { extractTextToolCalls, looksLikeTextToolCall } from "core/llm/parseTextToolCalls";
import { NEW_SESSION_TITLE } from "core/util/constants";
import { renderChatMessage } from "core/util/messageContent";
import { findUriInDirs, getUriPathBasename } from "core/util/uri";
import { v4 as uuidv4 } from "uuid";

import { RootState } from "../store";
import { streamResponseThunk } from "../thunks/streamResponse";
import { findCurrentToolCall, findToolCallStateById } from "../util";
import {
  mergeToolCallDeltas,
  primaryToolCallState,
  syncToolCallStatesFromDeltas,
} from "../util/mergeToolCallDeltas";

// We need this to handle reorderings (e.g. a mid-array deletion) of the messages array.
// The proper fix is adding a UUID to all chat messages, but this is the temp workaround.
type ChatHistoryItemWithMessageId = ChatHistoryItem & {
  message: ChatMessage & { id: string; createdAt?: string };
};

function findLastHistoryIndex(
  history: ChatHistoryItemWithMessageId[],
  predicate: (item: ChatHistoryItemWithMessageId) => boolean,
): number {
  for (let i = history.length - 1; i >= 0; i--) {
    if (predicate(history[i])) {
      return i;
    }
  }
  return -1;
}

function getMessageToolCalls(message: ChatMessage) {
  if (message.role === "assistant" || message.role === "thinking") {
    return message.toolCalls;
  }
  return undefined;
}

function messageHasVisibleContent(content: ChatMessage["content"]): boolean {
  if (typeof content === "string") {
    return content.length > 0;
  }
  if (Array.isArray(content)) {
    return content.some((part) =>
      part.type === "text" ? !!part.text?.length : true,
    );
  }
  return false;
}

/** Mark every in-flight tool canceled, including ones already followed by a sibling tool result. */
function cancelUnsettledToolCalls(
  history: ChatHistoryItemWithMessageId[],
): void {
  for (const item of history) {
    const toolStates =
      item.toolCallStates ??
      (item.toolCallState ? [item.toolCallState] : []);
    if (!toolStates.length) {
      continue;
    }
    let changed = false;
    for (const toolCallState of toolStates) {
      if (
        toolCallState.status !== "done" &&
        toolCallState.status !== "canceled"
      ) {
        toolCallState.status = "canceled";
        changed = true;
      }
    }
    if (changed) {
      item.toolCallStates = toolStates;
      item.toolCallState = primaryToolCallState(toolStates);
    }
  }
}

function assistantContentString(content: ChatMessage["content"]): string {
  if (typeof content === "string") {
    return content;
  }
  return renderChatMessage({ role: "assistant", content });
}

/**
 * Merge a streamed assistant chunk into already-buffered text.
 * Treats identical/snapshot chunks as replacements, not concatenations,
 * so the same sentence is not stored twice under the thinking block.
 */
export function mergeAssistantText(existing: string, incoming: string): string {
  if (!incoming) {
    return existing;
  }
  if (!existing) {
    return incoming;
  }
  if (incoming === existing || existing.startsWith(incoming)) {
    return existing;
  }
  if (incoming.startsWith(existing)) {
    return incoming;
  }
  return existing + incoming;
}

function writeAssistantContent(message: ChatMessage, incoming: string) {
  message.content = mergeAssistantText(
    assistantContentString(message.content),
    incoming,
  );
}

export type InjectedMemoryItemState = {
  id: number | null;
  kind: string;
  title: string;
  reason: string;
  category?: string;
  score?: number;
  pinned?: boolean;
  evidence?: string[];
};

export type LastCompactionState = {
  tokensSaved: number;
  originalMessageCount: number;
  compactedMessageCount: number;
  summarized: boolean;
  deduplicated: boolean;
  summarizationMethod: "heuristic" | "llm" | "none";
  summaryText?: string;
};

export type AutonomousLoopStatus =
  | "idle"
  | "running"
  | "completed"
  | "cancelled";

export type AutonomousLoopState = {
  status: AutonomousLoopStatus;
  iteration: number;
  maxIterations: number;
  goal?: string;
  startedAt?: number;
};

export const IDLE_AUTONOMOUS_LOOP: AutonomousLoopState = {
  status: "idle",
  iteration: 0,
  maxIterations: 0,
};

type SessionState = {
  lastSessionId?: string;
  allSessionMetadata: SessionMetadata[];
  history: ChatHistoryItemWithMessageId[];
  isStreaming: boolean;
  title: string;
  id: string;
  streamAborter: AbortController;
  codeToEdit: CodeToEdit[];
  curCheckpointIndex: number;
  mainEditorContentTrigger?: JSONContent | undefined;
  symbols: FileSymbolMap;
  mode: MessageModes;
  codeBlockApplyStates: {
    states: ApplyState[];
    curIndex: number;
  };
  newestCodeblockForInput: Record<string, string>;
  /** Provenance for memories injected into the latest turn. */
  lastInjectedMemories: InjectedMemoryItemState[];
  /** Last context-compaction event for the current chat turn. */
  lastCompaction: LastCompactionState | null;
  /**
   * Completed tool→continue rounds in the current user turn.
   * Reset when a new user message starts streaming; used for agent.maxSteps.
   */
  toolLoopSteps: number;
  /** Tools the user approved for the rest of this chat session. */
  sessionToolAllowlist: string[];
  /** Live `/autonomous` outer-loop status for the iteration banner. */
  autonomousLoop: AutonomousLoopState;
};

function isCodeToEditEqual(a: CodeToEdit, b: CodeToEdit) {
  if (a.filepath !== b.filepath || a.contents !== b.contents) {
    return false;
  }

  if ("range" in a && "range" in b) {
    const rangeA = a.range;
    const rangeB = b.range;

    return (
      rangeA.start.line === rangeB.start.line &&
      rangeA.end.line === rangeB.end.line
    );
  }

  // If neither has a range, they are considered equal in this context
  return !("range" in a) && !("range" in b);
}

const initialState: SessionState = {
  allSessionMetadata: [],
  history: [],
  isStreaming: false,
  title: NEW_SESSION_TITLE,
  id: uuidv4(),
  curCheckpointIndex: 0,
  streamAborter: new AbortController(),
  codeToEdit: [],
  symbols: {},
  mode: "agent",
  codeBlockApplyStates: {
    states: [],
    curIndex: 0,
  },
  lastSessionId: undefined,
  newestCodeblockForInput: {},
  lastInjectedMemories: [],
  lastCompaction: null,
  toolLoopSteps: 0,
  sessionToolAllowlist: [],
  autonomousLoop: { ...IDLE_AUTONOMOUS_LOOP },
};

export const sessionSlice = createSlice({
  name: "session",
  initialState,
  reducers: {
    addPromptCompletionPair: (
      state,
      { payload }: PayloadAction<PromptLog[]>,
    ) => {
      if (!state.history.length) {
        return;
      }

      const lastMessage = state.history[state.history.length - 1];

      lastMessage.promptLogs = lastMessage.promptLogs
        ? lastMessage.promptLogs.concat(payload)
        : payload;
    },
    setActive: (state) => {
      state.isStreaming = true;
    },
    setIsGatheringContext: (state, { payload }: PayloadAction<boolean>) => {
      const curMessage = state.history.at(-1);
      if (curMessage) {
        curMessage.isGatheringContext = payload;
      }
    },
    /**
     * Cancel / error cleanup that keeps tool conversations consistent.
     * After the last user or tool message, keep a partial assistant reply only
     * if it already has content or a non-generating tool call; otherwise roll
     * the empty user turn back into the main editor.
     * Incomplete tool statuses (generating / generated / calling) become canceled
     * so the UI never stays stuck on a dangling "calling" state after abort.
     */
    clearDanglingMessages: (state) => {
      // Always settle in-flight tools first. Trailing-assistant truncation
      // below misses a calling builtin_task once a sibling tool result exists.
      cancelUnsettledToolCalls(state.history);

      if (state.history.length < 2) {
        return;
      }

      const lastUserOrToolIdx = findLastHistoryIndex(
        state.history,
        (item) =>
          item.message.role === "tool" || item.message.role === "user",
      );
      if (lastUserOrToolIdx === -1) {
        return;
      }

      let validAssistantMessageIdx = -1;
      for (let i = state.history.length - 1; i > lastUserOrToolIdx; i--) {
        const item = state.history[i];
        const toolStates =
          item.toolCallStates ??
          (item.toolCallState ? [item.toolCallState] : []);
        const hasGeneratedTool = toolStates.some(
          (state) => state.status !== "generating",
        );
        if (
          messageHasVisibleContent(item.message.content) ||
          hasGeneratedTool
        ) {
          validAssistantMessageIdx = i;
          for (const toolCallState of toolStates) {
            if (
              toolCallState.status !== "done" &&
              toolCallState.status !== "canceled"
            ) {
              toolCallState.status = "canceled";
            }
          }
          item.toolCallStates = toolStates.length ? toolStates : undefined;
          item.toolCallState = primaryToolCallState(toolStates);
          break;
        }
      }

      if (validAssistantMessageIdx === -1) {
        const lastMsg = state.history[lastUserOrToolIdx];
        if (lastMsg.message.role === "user") {
          state.mainEditorContentTrigger = lastMsg.editorState;
          state.history = state.history.slice(0, lastUserOrToolIdx);
        } else {
          // Keep completed tool result; drop dangling assistant/thinking after it
          state.history = state.history.slice(0, lastUserOrToolIdx + 1);
        }
      } else {
        state.history = state.history.slice(0, validAssistantMessageIdx + 1);
      }
    },
    // Trigger value picked up by editor with isMainInput to set its content
    setMainEditorContentTrigger: (
      state,
      action: PayloadAction<JSONContent | undefined>,
    ) => {
      state.mainEditorContentTrigger = action.payload;
    },
    updateFileSymbols: (state, action: PayloadAction<FileSymbolMap>) => {
      state.symbols = {
        ...state.symbols,
        ...action.payload,
      };
    },
    setContextItemsAtIndex: (
      state,
      {
        payload: { index, contextItems },
      }: PayloadAction<{
        index: number;
        contextItems: ChatHistoryItem["contextItems"];
      }>,
    ) => {
      if (state.history[index]) {
        state.history[index].contextItems = contextItems;
      }
    },
    submitEditorAndInitAtIndex: (
      state,
      {
        payload,
      }: PayloadAction<{
        index: number;
        editorState: JSONContent;
      }>,
    ) => {
      const { index, editorState } = payload;

      if (state.history.length && index < state.history.length) {
        // Resubmission - update input message, truncate history after resubmit with new empty response message
        if (index % 2 === 1) {
          console.warn(
            "Corrupted history: resubmitting at odd index, shouldn't happen",
          );
        }
        const historyItem = state.history[index];

        historyItem.message.content = ""; // IMPORTANT - this is quickly updated by resolveEditorContent based on editor state prior to streaming
        historyItem.editorState = payload.editorState;
        historyItem.contextItems = [];
        // Keep the original createdAt timestamp for the user message
        if (!historyItem.checkpoint) {
          historyItem.checkpoint = {};
        }

        const assistantTimestamp = new Date().toISOString();
        state.history = state.history.slice(0, index + 1).concat({
          message: {
            id: uuidv4(),
            role: "assistant",
            content: "", // IMPORTANT - this is subsequently updated by response streaming
            createdAt: assistantTimestamp,
          },
          contextItems: [],
        });

        // Associate checkpoint with the resubmitted user message index (not pair heuristic)
        state.curCheckpointIndex = index;
      } else {
        // New input/response messages
        const userTimestamp = new Date().toISOString();
        const assistantTimestamp = new Date().toISOString();
        const userIndex = state.history.length;

        state.history = state.history.concat([
          {
            message: {
              id: uuidv4(),
              role: "user",
              content: "", // IMPORTANT - this is quickly updated by resolveEditorContent based on editor state prior to streaming
              createdAt: userTimestamp,
            },
            contextItems: [],
            editorState,
            checkpoint: {},
          },
          {
            message: {
              id: uuidv4(),
              role: "assistant",
              content: "", // IMPORTANT - this is subsequently updated by response streaming
              createdAt: assistantTimestamp,
            },
            contextItems: [],
          },
        ]);

        // Point at the user turn that owns this checkpoint bag
        state.curCheckpointIndex = userIndex;
      }

      state.isStreaming = true;
    },
    deleteMessage: (state, action: PayloadAction<number>) => {
      // Deletes the current assistant message and the previous user message
      state.history.splice(action.payload - 1, 2);
    },
    updateHistoryItemAtIndex: (
      state,
      {
        payload,
      }: PayloadAction<{
        index: number;
        updates: Partial<ChatHistoryItemWithMessageId>;
      }>,
    ) => {
      const { index, updates } = payload;
      if (index !== 0 && !state.history[index]) {
        console.error(
          `attempting to update history item at nonexistent index ${index}`,
          updates,
        );
        return;
      }
      // Deep merge message to preserve createdAt and other fields
      const existingMessage = state.history[index].message;
      state.history[index] = {
        ...state.history[index],
        ...updates,
        message: updates.message ? {
          ...existingMessage,
          ...updates.message,
        } : existingMessage,
      };
    },
    addContextItemsAtIndex: (
      state,
      {
        payload,
      }: PayloadAction<{
        index: number;
        contextItems: ContextItemWithId[];
      }>,
    ) => {
      const historyItem = state.history[payload.index];

      if (!historyItem) {
        return;
      }

      historyItem.contextItems = [
        ...historyItem.contextItems,
        ...payload.contextItems,
      ];
    },
    setInactive: (state) => {
      const curMessage = state.history.at(-1);

      if (curMessage) {
        curMessage.isGatheringContext = false;
      }

      state.isStreaming = false;
    },
    abortStream: (state) => {
      state.streamAborter.abort();
      state.streamAborter = new AbortController();
    },
    /**
     * Align the last streamed assistant with the hydrated turn from
     * `runAgentLoop` (DSML stripped, tool-call ids match executeTool).
     */
    hydrateLastAssistant: (state, action: PayloadAction<ChatMessage>) => {
      const assistant = action.payload;
      if (assistant.role !== "assistant") {
        return;
      }
      for (let i = state.history.length - 1; i >= 0; i--) {
        const item = state.history[i];
        if (item.message.role !== "assistant") {
          continue;
        }
        const prev = i > 0 ? state.history[i - 1] : undefined;
        // streamUpdate splits content/reasoning onto the previous assistant
        // when tool calls start. Put hydrated text there, not on the tool item.
        const contentItem =
          assistant.toolCalls?.length &&
          prev?.message.role === "assistant" &&
          !getMessageToolCalls(prev.message)?.length
            ? prev
            : item;
        if (typeof assistant.content === "string") {
          if (contentItem !== item) {
            if (assistant.content) {
              contentItem.message.content = assistant.content;
            }
            item.message.content = "";
          } else {
            item.message.content = assistant.content;
          }
        }
        if (assistant.toolCalls?.length) {
          const deltas = mergeToolCallDeltas([], assistant.toolCalls);
          item.message.toolCalls = deltas;
          item.toolCallStates = syncToolCallStatesFromDeltas(
            deltas,
            item.toolCallStates ??
              (item.toolCallState ? [item.toolCallState] : undefined),
          );
          item.toolCallState = primaryToolCallState(item.toolCallStates);
        }
        break;
      }
    },
    recoverTextToolCalls: (state) => {
      // Walk the current turn (newest first), skipping thinking blocks.
      // Stop at the previous user/tool message so we do not rewrite older turns.
      for (let i = state.history.length - 1; i >= 0; i--) {
        const item = state.history[i];
        if (!item) {
          return;
        }
        const role = item.message.role;
        if (role === "user" || role === "tool") {
          break;
        }
        if (role !== "assistant") {
          continue;
        }
        const text =
          typeof item.message.content === "string"
            ? item.message.content
            : renderChatMessage(item.message);
        if (!looksLikeTextToolCall(text)) {
          continue;
        }
        const extracted = extractTextToolCalls(text, { allowIncomplete: true });
        item.message.content = extracted.content;
        if (
          !extracted.toolCalls.length ||
          getMessageToolCalls(item.message)?.length
        ) {
          continue;
        }
        const deltas = mergeToolCallDeltas([], extracted.toolCalls);
        item.message.toolCalls = deltas;
        item.toolCallStates = syncToolCallStatesFromDeltas(deltas, undefined);
        item.toolCallState = primaryToolCallState(item.toolCallStates);
      }
    },
    streamUpdate: (state, action: PayloadAction<ChatMessage[]>) => {
      if (state.history.length) {
        for (const message of action.payload) {
          const lastItem = state.history[state.history.length - 1];
          const lastMessage = lastItem.message;

          if (message.role === "thinking" && message.redactedThinking) {
            state.history.push({
              message: {
                role: "thinking",
                content: "internal reasoning is hidden due to safety reasons",
                redactedThinking: message.redactedThinking,
                id: uuidv4(),
              },
              contextItems: [],
            });
            continue;
          }

          // When a tool call arrives after reasoning, end the reasoning phase
          // and force a new history item so reasoning and tool call render separately
          if (
            lastItem.reasoning?.active &&
            message.role === "assistant" &&
            message.toolCalls?.length
          ) {
            lastItem.reasoning.active = false;
            lastItem.reasoning.endAt = Date.now();
          }

          const lastIsEmptyPlaceholder =
            !getMessageToolCalls(lastMessage)?.length &&
            !lastMessage.content &&
            !lastItem.reasoning;
          const lastHasTools = !!getMessageToolCalls(lastMessage)?.length;
          const incomingHasTools = !!getMessageToolCalls(message)?.length;
          const splittingForTools =
            lastMessage.role === "assistant" &&
            message.role === "assistant" &&
            !lastIsEmptyPlaceholder &&
            !lastHasTools &&
            incomingHasTools;

          if (lastMessage.role !== message.role || splittingForTools) {
            // Keep already-streamed reply text on the previous item. Copying it
            // onto the new tool-call item rendered the same sentence twice
            // under the thinking block.
            if (splittingForTools) {
              const extra = renderChatMessage(message);
              if (extra) {
                writeAssistantContent(lastMessage, extra);
              }
            }
            const historyItem: ChatHistoryItemWithMessageId = {
              message: {
                ...message,
                content: splittingForTools ? "" : renderChatMessage(message),
                id: uuidv4(),
                createdAt: new Date().toISOString(),
              },
              contextItems: [],
            };
            if (message.role === "assistant" && message.toolCalls?.length) {
              const deltas = mergeToolCallDeltas([], message.toolCalls);
              if (historyItem.message.role === "assistant") {
                historyItem.message.toolCalls = deltas;
              }
              historyItem.toolCallStates = syncToolCallStatesFromDeltas(
                deltas,
                undefined,
              );
              historyItem.toolCallState = primaryToolCallState(
                historyItem.toolCallStates,
              );
            }
            state.history.push(historyItem);
          } else {
            // Add to the existing message
            // Handle reasoning content from API (include_reasoning parameter)
            if ((message as any).reasoning) {
              const reasoningContent = (message as any).reasoning;
              if (!lastItem.reasoning) {
                // Start new reasoning section
                lastItem.reasoning = {
                  startAt: Date.now(),
                  active: true,
                  text: reasoningContent,
                };
              } else if (lastItem.reasoning.active) {
                // Append to existing reasoning
                lastItem.reasoning.text += reasoningContent;
              }
              // If there's also content in the message, it means reasoning phase ended
              if (message.content) {
                const messageContent = renderChatMessage(message);
                if (lastItem.reasoning?.active) {
                  lastItem.reasoning.active = false;
                  lastItem.reasoning.endAt = Date.now();
                }
                writeAssistantContent(lastMessage, messageContent);
              }
            } else if (message.content) {
              const messageContent = renderChatMessage(message);
              // Legacy <think> tag support (for backward compatibility)
              if (messageContent.includes("<think>")) {
                lastItem.reasoning = {
                  startAt: Date.now(),
                  active: true,
                  text: messageContent.replace("<think>", "").trim(),
                };
              } else if (
                lastItem.reasoning?.active &&
                messageContent.includes("</think>")
              ) {
                const [reasoningEnd, answerStart] =
                  messageContent.split("</think>");
                lastItem.reasoning.text += reasoningEnd.trimEnd();
                lastItem.reasoning.active = false;
                lastItem.reasoning.endAt = Date.now();
                writeAssistantContent(lastMessage, answerStart.trimStart());
              } else if (lastItem.reasoning?.active) {
                // If we're in reasoning mode but content has no think tags,
                // it means reasoning phase ended and content phase started
                if (!messageContent.includes("<think>") && !messageContent.includes("</think>")) {
                  // Check if this is just more reasoning content or actual response content
                  // For API-based reasoning, content means the reasoning phase ended
                  lastItem.reasoning.active = false;
                  lastItem.reasoning.endAt = Date.now();
                  writeAssistantContent(lastMessage, messageContent);
                } else {
                  lastItem.reasoning.text += messageContent;
                }
              } else {
                // Note this only works because new message above
                // was already rendered from parts to string
                writeAssistantContent(lastMessage, messageContent);
              }
            } else if (message.role === "thinking" && message.signature) {
              if (lastMessage.role === "thinking") {
                lastMessage.signature = message.signature;
              }
            } else if (
              message.role === "assistant" &&
              message.toolCalls?.length &&
              lastMessage.role === "assistant"
            ) {
              const deltas = mergeToolCallDeltas(
                lastMessage.toolCalls ?? [],
                message.toolCalls,
              );
              lastMessage.toolCalls = deltas;
              lastItem.toolCallStates = syncToolCallStatesFromDeltas(
                deltas,
                lastItem.toolCallStates ??
                  (lastItem.toolCallState ? [lastItem.toolCallState] : undefined),
              );
              lastItem.toolCallState = primaryToolCallState(
                lastItem.toolCallStates,
              );
            }
          }
        }
      }
    },
    newSession: (state, { payload }: PayloadAction<Session | undefined>) => {
      state.lastSessionId = state.id;

      state.streamAborter.abort();
      state.streamAborter = new AbortController();

      state.isStreaming = false;
      state.symbols = {};
      state.lastInjectedMemories = [];
      state.lastCompaction = null;
      state.toolLoopSteps = 0;
      state.sessionToolAllowlist = [];
      state.autonomousLoop = { ...IDLE_AUTONOMOUS_LOOP };

      if (payload) {
        state.history = payload.history as any;
        state.title = payload.title;
        state.id = payload.sessionId;
        state.curCheckpointIndex = 0;
      } else {
        state.history = [];
        state.title = NEW_SESSION_TITLE;
        state.id = uuidv4();
        state.curCheckpointIndex = 0;
      }
    },
    resetToolLoopSteps: (state) => {
      state.toolLoopSteps = 0;
      state.autonomousLoop = { ...IDLE_AUTONOMOUS_LOOP };
    },
    incrementToolLoopSteps: (state) => {
      state.toolLoopSteps += 1;
    },
    addSessionToolAllowlist: (state, action: PayloadAction<string>) => {
      if (!state.sessionToolAllowlist.includes(action.payload)) {
        state.sessionToolAllowlist.push(action.payload);
      }
    },
    removeSessionToolAllowlist: (state, action: PayloadAction<string>) => {
      state.sessionToolAllowlist = state.sessionToolAllowlist.filter(
        (name) => name !== action.payload,
      );
    },
    setLastInjectedMemories: (
      state,
      { payload }: PayloadAction<InjectedMemoryItemState[]>,
    ) => {
      state.lastInjectedMemories = payload;
    },
    updateInjectedMemoryPinned: (
      state,
      {
        payload,
      }: PayloadAction<{ id: number; pinned: boolean }>,
    ) => {
      state.lastInjectedMemories = state.lastInjectedMemories.map((item) =>
        item.id === payload.id ? { ...item, pinned: payload.pinned } : item,
      );
    },
    removeInjectedMemory: (
      state,
      { payload }: PayloadAction<number>,
    ) => {
      state.lastInjectedMemories = state.lastInjectedMemories.filter(
        (item) => item.id !== payload,
      );
    },
    setLastCompaction: (
      state,
      { payload }: PayloadAction<LastCompactionState | null>,
    ) => {
      state.lastCompaction = payload;
    },
    updateSessionTitle: (state, { payload }: PayloadAction<string>) => {
      state.title = payload;
    },
    setAllSessionMetadata: (
      state,
      { payload }: PayloadAction<SessionMetadata[]>,
    ) => {
      state.allSessionMetadata = payload;
    },
    //////////////////////////////////////////////////////////////////////////////////
    // These are for optimistic session metadata updates, especially for History page
    addSessionMetadata: (
      state,
      { payload }: PayloadAction<SessionMetadata>,
    ) => {
      state.allSessionMetadata = [...state.allSessionMetadata, payload];
    },
    updateSessionMetadata: (
      state,
      {
        payload,
      }: PayloadAction<
        {
          sessionId: string;
        } & Partial<SessionMetadata>
      >,
    ) => {
      state.allSessionMetadata = state.allSessionMetadata.map((session) =>
        session.sessionId === payload.sessionId
          ? {
              ...session,
              ...payload,
            }
          : session,
      );
      if (payload.title && payload.sessionId === state.id) {
        state.title = payload.title;
      }
    },
    deleteSessionMetadata: (state, { payload }: PayloadAction<string>) => {
      // Note, should not be allowed to delete current session from chat session
      state.allSessionMetadata = state.allSessionMetadata.filter(
        (session) => session.sessionId !== payload,
      );
    },
    //////////////////////////////////////////////////////////////////////////////////
    addHighlightedCode: (
      state,
      {
        payload,
      }: PayloadAction<{ rangeInFileWithContents: any; edit: boolean }>,
    ) => {
      let contextItems =
        state.history[state.history.length - 1].contextItems ?? [];

      contextItems = contextItems.map((item) => {
        return { ...item, editing: false };
      });

      const { relativePathOrBasename } = findUriInDirs(
        payload.rangeInFileWithContents.filepath,
        window.workspacePaths ?? [],
      );
      const fileName = getUriPathBasename(
        payload.rangeInFileWithContents.filepath,
      );

      const lineNums = `(${
        payload.rangeInFileWithContents.range.start.line + 1
      }-${payload.rangeInFileWithContents.range.end.line + 1})`;

      contextItems.push({
        name: `${fileName} ${lineNums}`,
        description: relativePathOrBasename,
        id: {
          providerTitle: "code",
          itemId: uuidv4(),
        },
        content: payload.rangeInFileWithContents.contents,
        editing: true,
        editable: true,
        uri: {
          type: "file",
          value: payload.rangeInFileWithContents.filepath,
        },
      });

      state.history[state.history.length - 1].contextItems = contextItems;
    },

    updateCurCheckpoint: (
      state,
      {
        payload,
      }: PayloadAction<{ filepath: string; content: string | null }>,
    ) => {
      const item = state.history[state.curCheckpointIndex];
      if (!item) {
        return;
      }
      if (!item.checkpoint) {
        item.checkpoint = {};
      }
      item.checkpoint[payload.filepath] = payload.content;
    },
    setCurCheckpointIndex: (state, { payload }: PayloadAction<number>) => {
      state.curCheckpointIndex = payload;
    },
    updateApplyState: (state, { payload }: PayloadAction<ApplyState>) => {
      const applyState = state.codeBlockApplyStates.states.find(
        (state) => state.streamId === payload.streamId,
      );

      if (!applyState) {
        state.codeBlockApplyStates.states.push(payload);
      } else {
        applyState.status = payload.status ?? applyState.status;
        applyState.numDiffs = payload.numDiffs ?? applyState.numDiffs;
        applyState.filepath = payload.filepath ?? applyState.filepath;
      }

      if (payload.status === "done") {
        state.codeBlockApplyStates.curIndex++;
      }
    },
    resetNextCodeBlockToApplyIndex: (state) => {
      state.codeBlockApplyStates.curIndex = 0;
    },
    addCodeToEdit: (
      state,
      { payload }: PayloadAction<CodeToEdit | CodeToEdit[]>,
    ) => {
      const entries = Array.isArray(payload) ? payload : [payload];

      const newEntries = entries.filter(
        (entry) =>
          !state.codeToEdit.some((existingEntry) =>
            isCodeToEditEqual(existingEntry, entry),
          ),
      );

      if (newEntries.length > 0) {
        state.codeToEdit.push(...newEntries);
      }
    },
    removeCodeToEdit: (state, { payload }: PayloadAction<CodeToEdit>) => {
      state.codeToEdit = state.codeToEdit.filter(
        (entry) => !isCodeToEditEqual(entry, payload),
      );
    },
    clearCodeToEdit: (state) => {
      state.codeToEdit = [];
    },
    // Related to currentToolCallState
    setToolGenerated: (state) => {
      for (let i = state.history.length - 1; i >= 0; i--) {
        const item = state.history[i];
        const states =
          item.toolCallStates ??
          (item.toolCallState ? [item.toolCallState] : []);
        if (!states.length) {
          continue;
        }
        for (const toolCallState of states) {
          if (toolCallState.status === "generating") {
            toolCallState.status = "generated";
          }
        }
        item.toolCallStates = states;
        item.toolCallState = primaryToolCallState(states);
        break;
      }
    },
    setToolCallOutput: (
      state,
      action: PayloadAction<
        ContextItem[] | { toolCallId?: string; output: ContextItem[] }
      >,
    ) => {
      const payload = action.payload;
      const output = Array.isArray(payload) ? payload : payload.output;
      const toolCallId = Array.isArray(payload) ? undefined : payload.toolCallId;
      const toolCallState = toolCallId
        ? findToolCallStateById(state.history, toolCallId)
        : findCurrentToolCall(state.history);
      if (!toolCallState) {
        return;
      }
      // Ignore stale stream chunks after the call finished.
      if (
        toolCallState.status === "done" ||
        toolCallState.status === "canceled"
      ) {
        return;
      }
      toolCallState.output = output;
    },
    cancelToolCall: (state, action: PayloadAction<string | undefined>) => {
      const toolCallState = action.payload
        ? findToolCallStateById(state.history, action.payload)
        : findCurrentToolCall(state.history);
      if (!toolCallState) {return;}

      toolCallState.status = "canceled";
    },
    acceptToolCall: (state, action: PayloadAction<string | undefined>) => {
      const toolCallState = action.payload
        ? findToolCallStateById(state.history, action.payload)
        : findCurrentToolCall(state.history);
      if (!toolCallState) {return;}

      toolCallState.status = "done";
    },
    setCalling: (state, action: PayloadAction<string | undefined>) => {
      const toolCallState = action.payload
        ? findToolCallStateById(state.history, action.payload)
        : findCurrentToolCall(state.history);
      if (!toolCallState) {return;}

      toolCallState.status = "calling";
    },
    applyAutonomousEvent: (
      state,
      action: PayloadAction<{
        type: string;
        data: Record<string, unknown>;
      }>,
    ) => {
      const { type, data } = action.payload;
      if (
        typeof data.session_id === "string" &&
        data.session_id &&
        data.session_id !== state.id
      ) {
        return;
      }

      if (type === "autonomous:tool_start" || type === "autonomous:tool_ask") {
        const name = typeof data.name === "string" ? data.name : "";
        const callId =
          typeof data.call_id === "string" && data.call_id
            ? data.call_id
            : `${name}-${Date.now()}`;
        const args =
          data.args && typeof data.args === "object" && !Array.isArray(data.args)
            ? (data.args as Record<string, unknown>)
            : {};
        const last = state.history[state.history.length - 1];
        if (!last || last.message.role !== "assistant") {
          return;
        }
        const existing = findToolCallStateById(state.history, callId);
        if (existing) {
          existing.status = type === "autonomous:tool_ask" ? "generated" : "calling";
          last.toolCallState = primaryToolCallState(last.toolCallStates);
          return;
        }
        const deltas = mergeToolCallDeltas(last.message.toolCalls ?? [], [
          {
            id: callId,
            type: "function",
            function: {
              name,
              arguments: JSON.stringify(args),
            },
          },
        ]);
        last.message.toolCalls = deltas;
        last.toolCallStates = syncToolCallStatesFromDeltas(
          deltas,
          last.toolCallStates ??
            (last.toolCallState ? [last.toolCallState] : undefined),
        );
        const started = findToolCallStateById(state.history, callId);
        if (started) {
          started.status = type === "autonomous:tool_ask" ? "generated" : "calling";
        }
        last.toolCallState = primaryToolCallState(last.toolCallStates);
        return;
      }

      if (type === "autonomous:tool_end") {
        const callId = typeof data.call_id === "string" ? data.call_id : "";
        const toolCallState = callId
          ? findToolCallStateById(state.history, callId)
          : findCurrentToolCall(state.history);
        if (!toolCallState) {
          return;
        }
        const output = Array.isArray(data.output)
          ? (data.output as ContextItem[])
          : [];
        toolCallState.output = output;
        toolCallState.status = data.ok === false ? "canceled" : "done";
        const last = state.history[state.history.length - 1];
        if (last) {
          last.toolCallState = primaryToolCallState(last.toolCallStates);
        }
        state.toolLoopSteps += 1;
        return;
      }

      if (type === "autonomous:started") {
        state.autonomousLoop = {
          status: "running",
          iteration: 0,
          maxIterations:
            typeof data.max_iterations === "number" ? data.max_iterations : 0,
          goal: typeof data.goal === "string" ? data.goal : undefined,
          startedAt: Date.now(),
        };
        return;
      }

      if (type === "autonomous:iteration") {
        const iteration =
          typeof data.iteration === "number"
            ? data.iteration
            : state.autonomousLoop.iteration;
        const maxIterations =
          typeof data.max_iterations === "number"
            ? data.max_iterations
            : state.autonomousLoop.maxIterations;
        state.autonomousLoop = {
          ...state.autonomousLoop,
          status: "running",
          iteration,
          maxIterations,
          startedAt: state.autonomousLoop.startedAt ?? Date.now(),
        };
        return;
      }

      if (type === "autonomous:completed") {
        state.autonomousLoop = {
          ...state.autonomousLoop,
          status: "completed",
          iteration:
            typeof data.iterations === "number"
              ? data.iterations
              : state.autonomousLoop.iteration,
        };
        return;
      }

      if (type === "autonomous:cancelled") {
        state.autonomousLoop = {
          ...state.autonomousLoop,
          status: "cancelled",
          iteration:
            typeof data.iteration === "number"
              ? data.iteration
              : state.autonomousLoop.iteration,
        };
        return;
      }

      if (type === "autonomous:assistant") {
        const last = state.history[state.history.length - 1];
        if (!last || last.message.role !== "assistant") {
          return;
        }
        const chunk = typeof data.content === "string" ? data.content : "";
        if (!chunk.trim()) {
          return;
        }
        const current =
          typeof last.message.content === "string" ? last.message.content : "";
        if (current.includes(chunk.trim())) {
          return;
        }
        last.message.content = current ? `${current}${chunk}` : chunk;
      }
    },
    setMode: (state, action: PayloadAction<MessageModes>) => {
      state.mode = action.payload;
    },
    cycleMode: (state) => {
      const modes = ["chat", "agent"];
      const currentIndex = modes.indexOf(state.mode);
      const nextIndex = (currentIndex + 1) % modes.length;
      state.mode = modes[nextIndex] as MessageModes;
    },
    setNewestCodeblocksForInput: (
      state,
      {
        payload,
      }: PayloadAction<{
        inputId: string;
        contextItemId: string;
      }>,
    ) => {
      state.newestCodeblockForInput[payload.inputId] = payload.contextItemId;
    },
  },
  selectors: {
    selectIsGatheringContext: (state) => {
      const curHistoryItem = state.history.at(-1);
      return curHistoryItem?.isGatheringContext || false;
    },
    selectIsInEditMode: (state) => {
      return state.mode === "edit";
    },
    selectCurrentMode: (state) => {
      return state.mode;
    },
    selectIsSingleRangeEditOrInsertion: (state) => {
      if (state.mode !== "edit") {
        return false;
      }

      const isInsertion = state.codeToEdit.length === 0;
      const selectIsSingleRangeEdit =
        state.codeToEdit.length === 1 && "range" in state.codeToEdit[0];

      return selectIsSingleRangeEdit || isInsertion;
    },
    selectHasCodeToEdit: (state) => {
      return state.codeToEdit.length > 0;
    },
    selectUseTools: (state) => {
      return state.mode === "agent";
    },
  },
  extraReducers: (builder) => {
    addPassthroughCases(builder, [streamResponseThunk]);
  },
});

function addPassthroughCases(
  builder: ActionReducerMapBuilder<SessionState>,
  thunks: AsyncThunk<any, any, any>[],
) {
  thunks.forEach((thunk) => {
    builder
      .addCase(thunk.fulfilled, (state, action) => {})
      .addCase(thunk.rejected, (state, action) => {})
      .addCase(thunk.pending, (state, action) => {});
  });
}

export const selectCurrentToolCall = createSelector(
  (store: RootState) => store.session.history,
  (history) => {
    return findCurrentToolCall(history);
  },
);

export const selectApplyStateByStreamId = createSelector(
  [
    (state: RootState) => state.session.codeBlockApplyStates.states,
    (state: RootState, streamId: string) => streamId,
  ],
  (states, streamId) => {
    return states.find((state) => state.streamId === streamId);
  },
);

export const {
  updateFileSymbols,
  setContextItemsAtIndex,
  addContextItemsAtIndex,
  setInactive,
  streamUpdate,
  recoverTextToolCalls,
  newSession,
  updateSessionTitle,
  addHighlightedCode,
  addPromptCompletionPair,
  setActive,
  submitEditorAndInitAtIndex,
  updateHistoryItemAtIndex,
  clearDanglingMessages,
  setMainEditorContentTrigger,
  deleteMessage,
  setIsGatheringContext,
  updateCurCheckpoint,
  setCurCheckpointIndex,
  resetNextCodeBlockToApplyIndex,
  updateApplyState,
  abortStream,
  hydrateLastAssistant,
  clearCodeToEdit,
  addCodeToEdit,
  removeCodeToEdit,
  setCalling,
  cancelToolCall,
  acceptToolCall,
  setToolGenerated,
  setToolCallOutput,
  applyAutonomousEvent,
  setMode,
  setAllSessionMetadata,
  addSessionMetadata,
  updateSessionMetadata,
  deleteSessionMetadata,
  setNewestCodeblocksForInput,
  cycleMode,
  setLastInjectedMemories,
  updateInjectedMemoryPinned,
  removeInjectedMemory,
  setLastCompaction,
  resetToolLoopSteps,
  incrementToolLoopSteps,
  addSessionToolAllowlist,
  removeSessionToolAllowlist,
} = sessionSlice.actions;

export const {
  selectIsGatheringContext,
  selectIsInEditMode,
  selectCurrentMode,
  selectIsSingleRangeEditOrInsertion,
  selectHasCodeToEdit,
  selectUseTools,
} = sessionSlice.selectors;

export default sessionSlice.reducer;
