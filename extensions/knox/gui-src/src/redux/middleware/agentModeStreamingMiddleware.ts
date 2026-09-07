import { Middleware } from "@reduxjs/toolkit";
import { ChatMessage } from "core";
import { renderChatMessage } from "core/util/messageContent";

import { extractStreamingToolCode } from "../../pages/gui/ToolCallDiv/extractStreamingToolCode";
import { RootState } from "../store";

/**
 * Middleware that intercepts Redux streamUpdate actions when Agent Mode is active
 * and forwards them to the extension so ChatFlowCoordinator can emit streaming updates.
 * This ensures Agent Mode code blocks update in real-time during LLM streaming,
 * matching Chat Mode behavior.
 */
export const agentModeStreamingMiddleware: Middleware<{}, RootState> =
  (store) => (next) => {
    return (action: any) => {
      const result = next(action);

      // Check if we're in Agent Mode
      const state = store.getState();
      const isAgentMode = state.session.mode === "agent";

      // Handle streamUpdate actions in Agent Mode
      // This intercepts Redux streamUpdate actions and forwards them to the extension
      // so ChatFlowCoordinator can emit streaming updates for real-time code block rendering
      if (action.type === "session/streamUpdate" && isAgentMode && state.session.isStreaming) {
        // Get the current accumulated content from the last message in history
        const history = state.session.history;
        if (history.length > 0) {
          const lastItem = history[history.length - 1];
          const lastMessage = lastItem.message;
          
          // Check for both content updates and tool call argument updates
          // Tool call arguments are streamed incrementally and need to be forwarded for real-time rendering
          let contentToForward: string | null = null;
          
          // Handle thinking role messages (Anthropic native thinking)
          if (lastMessage.role === "thinking") {
            const thinkingContent = typeof lastMessage.content === "string"
              ? lastMessage.content
              : renderChatMessage(lastMessage);
            if (thinkingContent) {
              contentToForward = thinkingContent;
            }
          }

          // Handle reasoning on assistant messages (OpenAI/DeepSeek reasoning)
          if (lastItem.reasoning?.text && lastItem.reasoning.active) {
            contentToForward = lastItem.reasoning.text;
          }

          if (lastMessage.role === "assistant") {
            // If there's regular content, use it
            if (lastMessage.content) {
              contentToForward = typeof lastMessage.content === "string" 
                ? lastMessage.content 
                : renderChatMessage(lastMessage);
            }
            // If there's a tool call being streamed, ALWAYS extract and forward content immediately
            // Extract directly from raw JSON string to stream even before parsedArgs is complete
            if (lastMessage.toolCalls?.[0]?.function?.arguments) {
              const toolCall = lastMessage.toolCalls[0];
              const rawArgs = toolCall.function?.arguments;
              const { filepath, codeContent, contentKey } = extractStreamingToolCode({
                parsedArgs: lastItem.toolCallState?.parsedArgs,
                rawArguments: rawArgs,
              });
              if (codeContent || filepath) {
                const isDiff = contentKey === "patch" || contentKey === "diff";
                const language = isDiff
                  ? "diff"
                  : (filepath.split(".").pop() || "");
                const label = filepath || (isDiff ? "patch" : "file");
                const toolCallContent = `\`\`\`${language} ${label}\n${codeContent}\n\`\`\``;
                contentToForward = contentToForward
                  ? `${contentToForward}\n\n${toolCallContent}`
                  : toolCallContent;
              } else if (!contentToForward && typeof rawArgs === "string") {
                contentToForward = rawArgs;
              }
            }
          }
            
          // Forward streaming update for any role (assistant, thinking, reasoning)
          if (contentToForward !== null && typeof vscode !== "undefined") {
            try {
              const sanitizedContent = typeof contentToForward === "string" 
                ? contentToForward 
                : String(contentToForward || "");
              
              if (sanitizedContent !== undefined && sanitizedContent !== null) {
                vscode.postMessage({
                  messageType: "agentStreamingUpdateFromRedux",
                  messageId: `stream-${Date.now()}-${Math.random()}`,
                  data: {
                    content: sanitizedContent,
                    isComplete: false,
                  },
                });
              }
            } catch (error) {
              console.warn("Failed to send Agent Mode streaming update:", error);
            }
          }
        }
      }

      // Handle setInactive to mark streaming as complete
      if (action.type === "session/setInactive" && isAgentMode) {
        // Get the final content from the last message
        const history = state.session.history;
        if (history.length > 0) {
          const lastItem = history[history.length - 1];
          const lastMessage = lastItem.message;
          
          if (lastMessage.role === "assistant" && lastMessage.content) {
            const content = typeof lastMessage.content === "string" 
              ? lastMessage.content 
              : renderChatMessage(lastMessage);
            
            // Send final update with isComplete flag
            if (typeof vscode !== "undefined") {
              try {
                // Ensure content is a string and sanitize if needed
                const sanitizedContent = typeof content === "string" 
                  ? content 
                  : String(content || "");
                
                // Only send if content is valid (not undefined/null)
                if (sanitizedContent !== undefined && sanitizedContent !== null) {
                  vscode.postMessage({
                    messageType: "agentStreamingUpdateFromRedux",
                    messageId: `stream-complete-${Date.now()}-${Math.random()}`,
                    data: {
                      content: sanitizedContent,
                      isComplete: true,
                    },
                  });
                }
              } catch (error) {
                console.warn("Failed to send Agent Mode streaming completion:", error);
              }
            }
          }
        }
      }

      return result;
    };
  };

