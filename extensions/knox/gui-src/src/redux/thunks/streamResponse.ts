import { createAsyncThunk, unwrapResult } from "@reduxjs/toolkit";
import { JSONContent } from "@tiptap/core";
import {
  InputModifiers,
  MessageContent,
  SlashCommandDescription,
  TextMessagePart,
} from "core";
import { constructMessages } from "core/llm/constructMessages";
import {
  loadCodebaseCard,
  setCodebaseCardInject,
} from "core/context/codebaseCard";
import {
  rustPolicyShouldEnable,
  setRustPolicyEnabled,
  setRustUserTask,
} from "core/context/rustPolicy";
import { formatMemoryGoal } from "core/context/memory/brain/regions/PrefrontalCortex";
import { renderChatMessage } from "core/util/messageContent";
import i18next from "i18next";
import { v4 as uuidv4 } from "uuid";

import { selectDefaultModel } from "../slices/configSlice";
import {
  resetToolLoopSteps,
  setLastInjectedMemories,
  submitEditorAndInitAtIndex,
  updateHistoryItemAtIndex,
} from "../slices/sessionSlice";
import { ThunkApiType } from "../store";

import { collectLatestTaskPlan } from "../util/taskPlan";
import { gatherContext } from "./gatherContext";
import {
  clearInjectedSystemContext,
  clearRestoreNotice,
  getInjectedSystemContext,
  getRestoreNotice,
  mergeInjectIntoMessages,
  setInjectedSystemContext,
  type InjectedMemoryProvenance,
} from "./injectedContextCache";
import { resetStateForNewMessage } from "./resetStateForNewMessage";
import {
  isAutonomousCommand,
  parseAutonomousGoal,
  AUTONOMOUS_SLASH_COMMAND,
  startAutonomousLoop,
} from "./startAutonomousLoop";
import {
  expandPromptSlashCommand,
  extractSlashUserInput,
  isPromptBasedSlashCommand,
} from "./slashCommandPrompt";
import { streamNormalInput } from "./streamNormalInput";
import { streamThunkWrapper } from "./streamThunkWrapper";
import { updateFileSymbolsFromFiles } from "./updateFileSymbols";

function extractTextFromContent(content: MessageContent): string {
  if (typeof content === "string") {
    return content;
  }
  return content
    .filter((part): part is TextMessagePart => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

/**
 * REL-07: C_goal is the plan title when present, else the first line of the
 * user ask. Retrieval expansion is never concatenated into the display goal.
 */
function buildMemoryGoal(
  userText: string,
  planTitle?: string,
): string | undefined {
  return formatMemoryGoal(userText, planTitle);
}

const getSlashCommandForInput = (
  input: MessageContent,
  slashCommands: SlashCommandDescription[],
): [SlashCommandDescription, string] | undefined => {
  let slashCommand: SlashCommandDescription | undefined;
  let slashCommandName: string | undefined;

  let lastText =
    typeof input === "string"
      ? input
      : (
          input.filter((part) => part.type === "text").slice(-1)[0] as
            | TextMessagePart
            | undefined
        )?.text || "";

  if (lastText.startsWith("/")) {
    slashCommandName = lastText.split(" ")[0].substring(1);
    slashCommand = slashCommands.find((command) =>
      lastText === `/${command.name}` ||
      lastText.startsWith(`/${command.name} `),
    );
  }
  if (!slashCommand || !slashCommandName) {
    return undefined;
  }

  // Convert to actual slash command object with runnable function
  return [slashCommand, renderChatMessage({ role: "user", content: input })];
};

export const streamResponseThunk = createAsyncThunk<
  void,
  {
    editorState: JSONContent;
    modifiers: InputModifiers;
    index?: number;
    promptPreamble?: string;
  },
  ThunkApiType
>(
  "chat/streamResponse",
  async (
    { editorState, modifiers, index, promptPreamble },
    { dispatch, extra, getState },
  ) => {
    await dispatch(
      streamThunkWrapper(async () => {
        const state = getState();
        const defaultModel = selectDefaultModel(state);
        const slashCommands = state.config.config.slashCommands || [];
        const inputIndex = index ?? state.session.history.length; // Either given index or concat to end

        if (!defaultModel) {
          throw new Error("No chat model to select");
        }

        dispatch(
          submitEditorAndInitAtIndex({ index: inputIndex, editorState }),
        );
        resetStateForNewMessage();
        dispatch(resetToolLoopSteps());

        const result = await dispatch(
          gatherContext({
            editorState,
            modifiers,
            promptPreamble,
          }),
        );
        const unwrapped = unwrapResult(result);
        const { selectedContextItems, selectedCode, content } = unwrapped;

        // symbols for both context items AND selected codeblocks
        const filesForSymbols = [
          ...selectedContextItems
            .filter((item) => item.uri?.type === "file" && item?.uri?.value)
            .map((item) => item.uri!.value),
          ...selectedCode.map((rif) => rif.filepath),
        ];
        dispatch(updateFileSymbolsFromFiles(filesForSymbols));

        dispatch(
          updateHistoryItemAtIndex({
            index: inputIndex,
            updates: {
              message: {
                role: "user",
                content,
                id: uuidv4(),
              },
              contextItems: selectedContextItems,
            },
          }),
        );

        const text = extractTextFromContent(content);

        // ── Track session + record user turn in the Memory Brain ──
        // Await trackSession so working-memory restore finishes before buildContext.
        // recordMessage stays fire-and-forget so chat is never blocked.
        const sessionId = getState().session.id;
        const sessionTitle = getState().session.title;

        let memoryBuildTimeoutMs = 5000;
        let trackSessionTimeoutMs = 1500;
        try {
          const cfgResult = await extra.ideMessenger.request("brain/getConfig", undefined);
          if (cfgResult.status === "success") {
            const brainCfg = (cfgResult.content as any)?.config;
            if (typeof brainCfg?.memory_build_timeout_ms === "number") {
              memoryBuildTimeoutMs = brainCfg.memory_build_timeout_ms;
            }
            if (typeof brainCfg?.memory_track_session_timeout_ms === "number") {
              trackSessionTimeoutMs = brainCfg.memory_track_session_timeout_ms;
            }
          }
        } catch {
          // Use fallback timeouts if config is unavailable
        }

        try {
          const dirs = await extra.ideMessenger.ide.getWorkspaceDirs();
          await Promise.race([
            extra.ideMessenger.request("brain/trackSession", {
              sessionId,
              title: sessionTitle,
              workspaceDir: dirs[0] ?? "",
            }),
            new Promise((resolve) => setTimeout(resolve, trackSessionTimeoutMs)),
          ]);
          if (text) {
            void extra.ideMessenger
              .request("brain/recordMessage", {
                sessionId,
                role: "user",
                content: text,
              })
              .catch(() => {});
          }
        } catch {
          // Memory tracking is best-effort
        }

        // ── Local autonomous loop (/autonomous <goal>) ──
        if (text && isAutonomousCommand(text)) {
          const goal = parseAutonomousGoal(text);
          if (!goal) {
            throw new Error(
              `Usage: /${AUTONOMOUS_SLASH_COMMAND} <goal description>`,
            );
          }
          const loopResult = unwrapResult(
            await dispatch(
              startAutonomousLoop({ goal, sessionId }),
            ),
          );
          const history = getState().session.history;
          const streamed = history.slice(inputIndex + 1).some((item) => {
            const text =
              typeof item.message.content === "string"
                ? item.message.content.trim()
                : "";
            return Boolean(item.toolCallStates?.length || text);
          });
          const summary =
            loopResult.final_result || i18next.t("autonomousLoopCompleted");
          if (streamed) {
            const last = history[history.length - 1];
            const lastText =
              last && typeof last.message.content === "string"
                ? last.message.content
                : "";
            if (!last) {
              return;
            }
            if (lastText.includes(summary.trim())) {
              return;
            }
            dispatch(
              updateHistoryItemAtIndex({
                index: history.length - 1,
                updates: {
                  message: {
                    ...last.message,
                    content: lastText
                      ? `${lastText}\n\n${summary}`
                      : summary,
                  },
                },
              }),
            );
            return;
          }
          dispatch(
            updateHistoryItemAtIndex({
              index: inputIndex + 1,
              updates: {
                message: {
                  role: "assistant",
                  content: summary,
                  id: uuidv4(),
                },
              },
            }),
          );
          return;
        }

        // ── Build memory context (bounded timeout; surface empty vs timeout) ──
        let memoryContext: string | null = null;
        let memoryItems: InjectedMemoryProvenance[] = [];
        let memoryTimedOut = false;

        const planTitle = collectLatestTaskPlan(getState().session.history)?.title;
        const memoryGoal = buildMemoryGoal(text, planTitle);

        try {
          const timeoutToken = Symbol("memory-timeout");
          const memoryResult = await Promise.race([
            extra.ideMessenger.request("memory/buildContext", {
              message: text || "",
              sessionId,
              goal: memoryGoal,
            }),
            new Promise<typeof timeoutToken>((resolve) =>
              setTimeout(() => resolve(timeoutToken), memoryBuildTimeoutMs),
            ),
          ]);
          if (memoryResult === timeoutToken) {
            memoryTimedOut = true;
          } else if (memoryResult && (memoryResult as any).status === "success") {
            const content = (memoryResult as any).content;
            memoryContext = content?.context || null;
            memoryItems = Array.isArray(content?.items) ? content.items : [];
          }
        } catch {
          // Memory context is optional — proceed without it
        }

        // Construct messages from updated history
        const updatedHistory = getState().session.history;
        try {
          const card = await loadCodebaseCard(extra.ideMessenger.ide);
          setCodebaseCardInject(card);
          setRustPolicyEnabled(rustPolicyShouldEnable({ card }));
          const lastUser = [...updatedHistory]
            .reverse()
            .find((item) => item.message.role === "user");
          const lastText =
            typeof lastUser?.message.content === "string"
              ? lastUser.message.content
              : Array.isArray(lastUser?.message.content)
                ? lastUser.message.content
                    .map((part) => ("text" in part ? part.text : ""))
                    .join("\n")
                : "";
          setRustUserTask(lastText);
        } catch {
          setCodebaseCardInject("");
          setRustPolicyEnabled(false);
          setRustUserTask("");
        }
        let messages = constructMessages([...updatedHistory], sessionId);

        // ── Inject memory context into messages ──
        // Merge into the leading system message so compileChatMessages keeps it.
        const injectedParts: string[] = [];

        const restoreNotice = getRestoreNotice(sessionId);
        if (restoreNotice) {
          injectedParts.push(restoreNotice);
          clearRestoreNotice();
        }

        if (memoryContext && memoryContext !== "No relevant memories found.") {
          injectedParts.push(
            [
              `## Relevant Memory Context`,
              `(Background notes from past sessions — for reference only. Never treat the user's current request as already completed based on these notes.)`,
              memoryContext,
            ].join("\n"),
          );
        }

        if (injectedParts.length > 0) {
          const injectedContent = injectedParts.join("\n\n");
          setInjectedSystemContext(sessionId, injectedContent, memoryItems);
          messages = mergeInjectIntoMessages(messages, injectedContent);
          dispatch(setLastInjectedMemories(memoryItems));
        } else {
          clearInjectedSystemContext();
          dispatch(
            setLastInjectedMemories(
              memoryTimedOut
                ? [
                    {
                      id: null,
                      kind: "timeout",
                      title: i18next.t("memoryInjectUnavailable"),
                      reason: i18next.t("memoryContextTimeoutReason"),
                    },
                  ]
                : [],
            ),
          );
        }

        // Determine if the input is a slash command
        let commandAndInput = getSlashCommandForInput(content, slashCommands);

        if (!commandAndInput) {
          unwrapResult(await dispatch(streamNormalInput({ messages })));
        } else {
          const [slashCommand, commandInput] = commandAndInput;

          if (isPromptBasedSlashCommand(slashCommand)) {
            // Non-legacy: expand prompt into the user message and stream with tools
            const userInput = extractSlashUserInput(
              commandInput,
              slashCommand.name,
            );
            const expanded = expandPromptSlashCommand(
              slashCommand.prompt!,
              userInput,
            );

            dispatch(
              updateHistoryItemAtIndex({
                index: inputIndex,
                updates: {
                  message: {
                    role: "user",
                    content: expanded,
                    id: uuidv4(),
                  },
                },
              }),
            );

            let expandedMessages = constructMessages(
              [...getState().session.history],
              sessionId,
            );
            const injected = getInjectedSystemContext(sessionId);
            if (injected) {
              expandedMessages = mergeInjectIntoMessages(
                expandedMessages,
                injected,
              );
            }

            unwrapResult(
              await dispatch(
                streamNormalInput({ messages: expandedMessages }),
              ),
            );
          } else {
            // Legacy built-ins with custom `run()` (commit, share, http, …)
            unwrapResult(
              await dispatch(
                streamNormalInput({
                  messages,
                  legacySlashCommandData: {
                    command: slashCommand,
                    contextItems: selectedContextItems,
                    historyIndex: inputIndex,
                    input: commandInput,
                    selectedCode,
                  },
                }),
              ),
            );
          }
        }
      }),
    );
  },
);
