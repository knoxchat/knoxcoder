import { Editor, JSONContent } from "@tiptap/react";
import { ChatHistoryItem, InputModifiers, RangeInFileWithContents } from "core";
import { BuiltInToolNames } from "core/tools/builtIn";
import { streamResponse } from "core/llm/stream";
import { renderChatMessage, stripImages } from "core/util/messageContent";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { useTranslation } from "react-i18next";

import { Button, lightGray, vscBackground, vscForeground } from "../../components";
import CodeToEditCard from "../../components/CodeToEditCard";
import { useFindWidget } from "../../components/find/FindWidget";
import TimelineItem from "../../components/gui/TimelineItem";
import ThinkingBlockPeek from "../../components/mainInput/belowMainInput/ThinkingBlockPeek";
import KnoxInputBox from "../../components/mainInput/KnoxInputBox";
import LoadingState from "../../components/loaders/LoadingState";
import resolveEditorContent from "../../components/mainInput/tiptap/resolveInput";
import UserMessageWithRestore from "../../components/mainInput/UserMessageWithRestore";
import StepContainer from "../../components/StepContainer";
import AcceptRejectAllButtons from "../../components/StepContainer/AcceptRejectAllButtons";
import Reasoning from "../../components/StepContainer/Reasoning";
import { TabBar } from "../../components/TabBar/TabBar";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useEnhancedScroll } from '../../hooks/useEnhancedScroll';
import { useWebviewListener } from "../../hooks/useWebviewListener";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import { selectCurrentToolCall, selectIsCurrentToolAutoApproved } from "../../redux/selectors/selectCurrentToolCall";
import { callTool } from "../../redux/thunks/callTool";
import { isGuiAgentLoopRunning } from "../../redux/util/guiToolApproval";
import { selectDefaultModel } from "../../redux/slices/configSlice";
import { submitEdit } from "../../redux/slices/editModeState";
import {
  newSession,
  selectCurrentMode,
  selectIsInEditMode,
  selectIsSingleRangeEditOrInsertion,
  applyAutonomousEvent,
} from "../../redux/slices/sessionSlice";
import {
  setDialogEntryOn,
  setShowDialog,
} from "../../redux/slices/uiSlice";
import { cancelStream } from "../../redux/thunks/cancelStream";
import { exitEditMode } from "../../redux/thunks/exitEditMode";
import { loadLastSession } from "../../redux/thunks/session";
import { streamResponseThunk } from "../../redux/thunks/streamResponse";
import {
  ChatBubbleOvalLeftIcon,
  CodeIcon,
  ExclamationTriangleIcon,
} from "../../svg-icons";
import { getFontSize, isMetaEquivalentKeyPressed } from "../../util";
import getMultifileEditPrompt from "../../util/getMultifileEditPrompt";
import { getLocalStorage, setLocalStorage } from "../../util/localStorage";

import { activityAnchorId, itemCreatedAtMs } from "../../redux/util/agentActivity";

import { AgentActivityTimeline } from "./AgentActivityTimeline";
import { ToolCallDiv } from "./ToolCallDiv";
import { ToolCallButtons } from "./ToolCallDiv/ToolCallButtonsDiv";
import ToolOutput from "./ToolCallDiv/ToolOutput";

import i18n from "../../i18n";

function assistantReplyText(item: ChatHistoryItem): string {
  return stripImages(item.message.content).trim();
}

/** Same visible reply already shown on the previous assistant (skip thinking). */
function isDuplicateAssistantReply(
  history: ChatHistoryItem[],
  index: number,
): boolean {
  const item = history[index];
  if (item.message.role !== "assistant") {
    return false;
  }
  const content = assistantReplyText(item);
  if (!content) {
    return false;
  }
  for (let i = index - 1; i >= 0; i--) {
    const prev = history[i];
    if (prev.message.role === "thinking") {
      continue;
    }
    if (prev.message.role !== "assistant") {
      return false;
    }
    return assistantReplyText(prev) === content;
  }
  return false;
}

function turnHasVisibleProgress(
  history: ChatHistoryItem[],
  userIndex: number,
): boolean {
  for (let i = userIndex + 1; i < history.length; i++) {
    const item = history[i];
    if (item.message.role === "user") {
      break;
    }
    if (item.toolCallState || (item.toolCallStates?.length ?? 0) > 0) {
      return true;
    }
    if (item.message.role === "thinking") {
      return true;
    }
    if (item.reasoning?.text?.trim()) {
      return true;
    }
    const content = item.message.content;
    if (typeof content === "string") {
      if (content.trim()) {
        return true;
      }
    } else if (
      Array.isArray(content) &&
      content.some((part) => part.type !== "text" || part.text.trim())
    ) {
      return true;
    }
  }
  return false;
}

function fallbackRender({ error, resetErrorBoundary }: any) {
  // Call resetErrorBoundary() to reset the error boundary and retry the render.

  return (
    <div
      role="alert"
      className="px-2"
      style={{ backgroundColor: vscBackground }}
    >
      <p>{i18n.t('somethingWentWrong')}</p>
      <pre style={{ color: "red" }}>{error.message}</pre>
      <pre style={{ color: lightGray }}>{error.stack}</pre>

      <div className="text-center">
        <Button onClick={resetErrorBoundary}>{i18n.t('restart')}</Button>
      </div>
    </div>
  );
}

export function Chat() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const ideMessenger = useContext(IdeMessengerContext);
  const showSessionTabs = useAppSelector(
    (store) => store.config.config.ui?.showSessionTabs,
  );
  const defaultModel = useAppSelector(selectDefaultModel);
  const isStreaming = useAppSelector((state) => state.session.isStreaming);
  const [stepsOpen, setStepsOpen] = useState<(boolean | undefined)[]>([]);
  const mainTextInputRef = useRef<HTMLInputElement>(null);
  const stepsDivRef = useRef<HTMLDivElement>(null);
  const history = useAppSelector((state) => state.session.history);
  const showChatScrollbar = useAppSelector(
    (state) => state.config.config.ui?.showChatScrollbar,
  );
  const codeToEdit = useAppSelector((state) => state.session.codeToEdit);
  const toolCallState = useAppSelector(selectCurrentToolCall);
  const pendingToolAutoApproved = useAppSelector(
    selectIsCurrentToolAutoApproved,
  );
  const applyStates = useAppSelector(
    (state) => state.session.codeBlockApplyStates.states,
  );
  const pendingApplyStates = applyStates.filter(
    (state) => state.status === "done",
  );
  const hasPendingApplies = pendingApplyStates.length > 0;
  const isInEditMode = useAppSelector(selectIsInEditMode);
  const isSingleRangeEditOrInsertion = useAppSelector(
    selectIsSingleRangeEditOrInsertion,
  );
  const mode = useAppSelector(selectCurrentMode);

  // Use the enhanced scroll hook that matches Chat app behavior
  const {
    scrollState,
    scrollContainerRef,
    newMessagesCount,
    scrollToBottom,
    scrollToTop,
    enableAutoScroll,
    handleEscapeKey,
    forceCheckScrollState,
    isStreaming: enhancedIsStreaming
  } = useEnhancedScroll(history, isStreaming);

  // Handle escape key to scroll to bottom
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && scrollState.userHasScrolledUp) {
        handleEscapeKey();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleEscapeKey, scrollState.userHasScrolledUp]);

  useEffect(() => {
    if (
      isGuiAgentLoopRunning() ||
      toolCallState?.status !== "generated" ||
      !pendingToolAutoApproved ||
      !toolCallState.toolCallId
    ) {
      return;
    }
    void dispatch(callTool({ toolCallId: toolCallState.toolCallId }));
  }, [
    dispatch,
    pendingToolAutoApproved,
    toolCallState?.status,
    toolCallState?.toolCallId,
  ]);

  useEffect(() => {
    // Cmd + Backspace to delete current step
    const listener = (e: any) => {
      if (
        e.key === "Backspace" &&
        isMetaEquivalentKeyPressed(e) &&
        !e.shiftKey
      ) {
        dispatch(cancelStream());
      }
    };
    window.addEventListener("keydown", listener);

    return () => {
      window.removeEventListener("keydown", listener);
    };
  }, [isStreaming]);

  const { widget, highlights } = useFindWidget(stepsDivRef as React.RefObject<HTMLDivElement>);

  const sendInput = useCallback(
    (
      editorState: JSONContent,
      modifiers: InputModifiers,
      index?: number,
      editorToClearOnSend?: Editor,
    ) => {
      if (toolCallState?.status === "generated") {
        return console.error(
          t('cannotSubmitWhileAwaitingTool'),
        );
      }
      if (isSingleRangeEditOrInsertion) {
        handleSingleRangeEditOrInsertion(editorState);
        return;
      }

      const promptPreamble = isInEditMode
        ? getMultifileEditPrompt(codeToEdit)
        : undefined;

      // Reset scroll state and scroll to bottom when sending a message
      enableAutoScroll();
      
      // Scroll to bottom immediately when sending a message
      setTimeout(() => {
        scrollToBottom(true);
      }, 50);

      dispatch(
        streamResponseThunk({ editorState, modifiers, promptPreamble, index }),
      );

      if (editorToClearOnSend) {
        editorToClearOnSend.commands.clearContent();
      }

      // Increment localstorage counter for popup (async)
      getLocalStorage("mainTextEntryCounter").then((currentCount) => {
        if (currentCount) {
          setLocalStorage("mainTextEntryCounter", currentCount + 1);
          if (currentCount === 300) {
            dispatch(setDialogEntryOn(false));
            dispatch(setShowDialog(true));
          }
        } else {
          setLocalStorage("mainTextEntryCounter", 1);
        }
      });
    },
    [
      history,
      defaultModel,
      streamResponse,
      isSingleRangeEditOrInsertion,
      codeToEdit,
      toolCallState,
      enableAutoScroll,
      scrollToBottom,
    ],
  );

  async function handleSingleRangeEditOrInsertion(editorState: JSONContent) {
    if (!defaultModel) {
      console.error("No selected chat model");
      return;
    }
    const [contextItems, __, userInstructions] = await resolveEditorContent({
      editorState,
      modifiers: {
        noContext: true,
      },
      ideMessenger,
      defaultContextProviders: [],
      dispatch,
      selectedModelTitle: defaultModel.title,
    });

    const prompt = [
      ...contextItems.map((item) => item.content),
      stripImages(userInstructions),
    ].join("\n\n");

    ideMessenger.post("edit/sendPrompt", {
      prompt,
      range: codeToEdit[0] as RangeInFileWithContents,
      selectedModelTitle: defaultModel.title,
    });

    dispatch(submitEdit(prompt));
  }

  useWebviewListener(
    "newSession",
    async () => {
      // unwrapResult(response) // errors if session creation failed
      mainTextInputRef.current?.focus?.();
      
      // Ensure we scroll to the bottom when a new session starts
      if (stepsDivRef.current) {
        setTimeout(() => {
          if (stepsDivRef.current) {
            stepsDivRef.current.scrollTop = stepsDivRef.current.scrollHeight;
          }
        }, 100); // Small delay to ensure DOM is updated
      }
    },
    [mainTextInputRef, stepsDivRef],
  );

  useWebviewListener(
    "brain/memoryEvent",
    async (event) => {
      if (
        typeof event?.type === "string" &&
        event.type.startsWith("autonomous:")
      ) {
        dispatch(applyAutonomousEvent(event));
      }
    },
    [dispatch],
  );

  const isLastUserInput = useCallback(
    (index: number): boolean => {
      return !history
        .slice(index + 1)
        .some((entry) => entry.message.role === "user");
    },
    [history],
  );

  const showScrollbar = showChatScrollbar ?? window.innerHeight > 5000;

  const showPageHeader = isInEditMode;

  return (
    <div className="chat-container flex flex-col h-full relative overflow-hidden">
      {widget}

      {!!showSessionTabs && <TabBar />}

      <div
        ref={scrollContainerRef}
        className={`relative bg-transparent flex flex-col min-h-0 flex-1 mt-0.5 overflow-y-scroll ${showPageHeader ? "" : "pt-2"} ${showScrollbar ? "thin-scrollbar" : "no-scrollbar"} chat-message-container *:relative [&_.thread-message]:m-[0px_0px_0px_1px]`}
      >
        {highlights}
        <div className="grow" /> {/* Spacer to push content to bottom */}
        {history.map((item, index: number) => {
          const duplicateReply = isDuplicateAssistantReply(history, index);
          const replyText =
            item.message.role === "assistant" ? assistantReplyText(item) : "";
          const showAssistantReply = !!replyText && !duplicateReply;
          return (
            <div
              key={item.message.id}
              className={`message-container ${index === history.length - 1 ? "last-message" : ""}`}
            >
            <ErrorBoundary
              FallbackComponent={fallbackRender}
              onReset={() => {
                dispatch(newSession());
              }}
            >
              {item.message.role === "user" ? (
                <>
                  {isInEditMode && index === 0 && <CodeToEditCard />}
                  <UserMessageWithRestore
                    item={item}
                    index={index}
                    isEditMode={isInEditMode}
                    onEnter={(editorState, modifiers) =>
                      sendInput(editorState, modifiers, index)
                    }
                    isLastUserInput={isLastUserInput(index)}
                  />
                  {mode === "agent" ? (
                    !isLastUserInput(index) && (
                      <AgentActivityTimeline
                        history={history}
                        userIndex={index}
                      />
                    )
                  ) : (
                    isStreaming &&
                    isLastUserInput(index) &&
                    !turnHasVisibleProgress(history, index) && (
                      <div
                        className="mx-3 mb-1 mt-1"
                        style={{ fontSize: `${getFontSize() - 2}px` }}
                      >
                        <LoadingState
                          label={t("activityLoading")}
                          startedAt={itemCreatedAtMs(item)}
                        />
                      </div>
                    )
                  )}
                </>
              ) : item.message.role === "tool" ? (
                <ToolOutput
                  contextItems={item.contextItems}
                  toolCallId={item.message.toolCallId}
                />
              ) : item.message.role === "assistant" &&
                item.message.toolCalls &&
                item.toolCallState ? (
                <div>
                  {item.reasoning && !showAssistantReply && (
                    <div
                      id={activityAnchorId(`reasoning:${item.message.id}`)}
                    >
                      <Reasoning item={item} index={index} isLast={index === history.length - 1} />
                    </div>
                  )}
                  {showAssistantReply ? (
                    <div
                      className="thread-message"
                      id={activityAnchorId(`reply:${item.message.id}`)}
                    >
                      <StepContainer
                        index={index}
                        isLast={index === history.length - 1}
                        item={item}
                      />
                    </div>
                  ) : null}
                  {(item.toolCallStates?.length
                    ? item.toolCallStates
                    : item.toolCallState
                      ? [item.toolCallState]
                      : []
                  ).map((toolCallState) => {
                    const toolOutputItem = history.find(
                      (h, idx) =>
                        idx > index &&
                        h.message.role === "tool" &&
                        h.message.toolCallId === toolCallState.toolCallId,
                    );
                    const toolOutputContextItems =
                      toolOutputItem?.contextItems || [];
                    const stepId = `tool:${toolCallState.toolCallId || toolCallState.toolCall.id}`;

                    return (
                      <div
                        key={toolCallState.toolCallId || toolCallState.toolCall.id}
                        id={activityAnchorId(stepId)}
                      >
                        <ToolCallDiv
                          toolCallState={toolCallState}
                          toolCall={toolCallState.toolCall}
                          toolOutputContextItems={toolOutputContextItems}
                        />
                      </div>
                    );
                  })}
                </div>
              ) : item.message.role === "thinking" ? (
                <div id={activityAnchorId(`thinking:${item.message.id}`)}>
                  <ThinkingBlockPeek
                    content={renderChatMessage(item.message)}
                    redactedThinking={item.message.redactedThinking}
                    index={index}
                    prevItem={index > 0 ? history[index - 1] : null}
                    inProgress={index === history.length - 1}
                    signature={item.message.signature}
                  />
                </div>
              ) : duplicateReply ? null : (
                <div
                  className="thread-message"
                  id={activityAnchorId(`reply:${item.message.id}`)}
                >
                  <TimelineItem
                    item={item}
                    iconElement={
                      false ? (
                        <CodeIcon />
                      ) : false ? (
                        <ExclamationTriangleIcon />
                      ) : (
                        <ChatBubbleOvalLeftIcon />
                      )
                    }
                    open={
                      index === history.length - 1 || // Always show the latest message
                      (typeof stepsOpen[index] !== "undefined" ? stepsOpen[index] : true) // Default to showing messages
                    }
                    onToggle={() => {}}
                  >
                    <StepContainer
                      index={index}
                      isLast={index === history.length - 1}
                      item={item}
                    />
                  </TimelineItem>
                </div>
              )}
            </ErrorBoundary>
          </div>
          );
        })}
        
        {/* Scroll sentinel for intersection observer */}
        <div id="scroll-sentinel" style={{ height: '1px' }} />
      </div>
      
      <div className="input-container relative">
        {toolCallState?.status === "generated" &&
          !pendingToolAutoApproved &&
          toolCallState.toolCall.function.name !== BuiltInToolNames.AskUser && (
            <ToolCallButtons />
          )}

        {isInEditMode && history.length === 0 && <CodeToEditCard />}

        {isInEditMode && history.length > 0 ? null : (
          <KnoxInputBox
            isMainInput
            isEditMode={isInEditMode}
            isLastUserInput={false}
            onEnter={(editorState, modifiers, editor) =>
              sendInput(editorState, modifiers, undefined, editor)
            }
            inputId={"main-editor"}
            showScrollButtons={scrollState.hasScrollableContent && history.length > 0}
            isAtTop={scrollState.isAtTop}
            isAtBottom={scrollState.isAtBottom}
            onScrollToTop={scrollToTop}
            onScrollToBottom={() => scrollToBottom(true)}
          />
        )}

        <div
          style={{
            pointerEvents: isStreaming ? "none" : "auto",
          }}
        >
          {hasPendingApplies && isSingleRangeEditOrInsertion && (
            <AcceptRejectAllButtons
              pendingApplyStates={pendingApplyStates}
              onAcceptOrReject={async (outcome) => {
                if (outcome === "acceptDiff") {
                  await dispatch(
                    loadLastSession({
                      saveCurrentSession: false,
                    }),
                  );
                  dispatch(exitEditMode());
                }
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
