// src/components/ThinkingBlockPeek.tsx
import { ChevronDown, ChevronUp } from "lucide-react";
import { ChatHistoryItem } from "core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { lightGray } from "../..";
import { getFontSize } from "../../../util";
import StyledMarkdownPreview from "../../markdown/StyledMarkdownPreview";

interface ThinkingBlockPeekProps {
  content: string;
  redactedThinking?: string;
  index: number;
  prevItem: ChatHistoryItem | null;
  inProgress?: boolean;
  signature?: string;
  tokens?: number;
}

function ThinkingBlockPeek({
  content,
  redactedThinking,
  index,
  prevItem,
  inProgress,
  tokens,
}: ThinkingBlockPeekProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState<string>("");

  const duplicateRedactedThinkingBlock =
    prevItem &&
    prevItem.message.role === "thinking" &&
    redactedThinking &&
    prevItem.message.redactedThinking;

  useEffect(() => {
    if (inProgress) {
      setStartTime(Date.now());
      setElapsedTime("");
    } else if (startTime) {
      const endTime = Date.now();
      const diff = endTime - startTime;
      const diffString = `${(diff / 1000).toFixed(1)}s`;
      setElapsedTime(diffString);
    }
  }, [inProgress]);

  return duplicateRedactedThinkingBlock ? null : (
    <div className="thread-message">
      <div className="" style={{ backgroundColor: 'var(--vscode-background)' }}>
        <div
          className="flex items-center justify-start pl-2 text-xs text-gray-300"
          data-testid="thinking-block-peek"
        >
          <div 
            className="w-fit m-2 mt-2 mr-1.5 ml-0.5 px-2 py-1 cursor-pointer rounded shadow-md transition-shadow hover:shadow-lg"
            style={{
              backgroundColor: 'var(--vscode-background)',
              fontSize: `${getFontSize() - 2}px`,
              border: `0.5px solid ${lightGray}`,
              color: lightGray
            }}
            onClick={() => setOpen((prev) => !prev)}
          >
            <div className="flex items-center gap-1.5">
              <style dangerouslySetInnerHTML={{
                __html: `
                  @keyframes thinking {
                    0% { width: 24px; }
                    33% { width: 8px; }
                    66% { width: 16px; }
                    90% { width: 24px; }
                  }
                `
              }} />
              {inProgress ? (
                <span className="animate-[thinking_2s_infinite_linear] whitespace-nowrap overflow-hidden inline-block w-6">
                  {redactedThinking ? t('hiddenThinking') : t('thinking')}
                </span>
              ) : redactedThinking ? (
                t('hiddenThinking')
              ) : (
                t('thinkingResult') +
                (elapsedTime ? ` ${t('forDuration', { time: elapsedTime })}` : "")
              )}
              {open ? (
                <ChevronUp className="text-knoxcyan h-3 w-3" />
              ) : (
                <ChevronDown className="text-knoxcyan h-3 w-3" />
              )}
            </div>
          </div>
        </div>

        <div
          className={`ml-2 mt-2 overflow-y-auto transition-none duration-300 ease-in-out ${
            open ? "mb-2 mt-5 opacity-100" : "max-h-0 border-0 opacity-0"
          }`}
          style={{
            borderLeft:
              open && !redactedThinking
                ? "2px solid var(--vscode-input-border, #606060)"
                : "none",
          }}
        >
          {redactedThinking ? (
            <div className="text-orange pl-4 text-xs">
              {t('thinkingDeletedSecurity')}
            </div>
          ) : (
            <>
              <div className="-mt-1 px-0 pl-1 [&>div>*:first-child]:mt-0">
                <StyledMarkdownPreview
                  isRenderingInStepContainer
                  source={content}
                  itemIndex={index}
                  isStreaming={!!inProgress}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default ThinkingBlockPeek;
