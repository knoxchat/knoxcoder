import { ChevronDown, ChevronUp } from "lucide-react";
import { ChatHistoryItem } from "core";
import { stripImages } from "core/util/messageContent";
import { useEffect, useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";

import { getFontSize } from "../../util";
import StyledMarkdownPreview from "../markdown/StyledMarkdownPreview";

interface ReasoningProps {
  item: ChatHistoryItem;
  index: number;
  isLast: boolean;
}

/**
 * ReasoningSection - Displays model reasoning/thinking process
 * Similar to code blocks but for reasoning content with auto-scroll during streaming
 * Supports markdown rendering and collapse/expand functionality
 * Matches the Chat app's behavior exactly
 */
export default function Reasoning(props: ReasoningProps) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const [reasoningTime, setReasoningTime] = useState("");
  const reasoningRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  
  const isStreaming = props.item.reasoning?.active ?? false;
  const reasoning = props.item.reasoning?.text ?? "";
  
  // Match code block's 12 lines threshold
  const DEFAULT_COLLAPSED_LINES = 12;
  const lineCount = reasoning.split('\n').length;
  const showExpandButton = lineCount > DEFAULT_COLLAPSED_LINES;
  const showScrollIndicator = lineCount > DEFAULT_COLLAPSED_LINES;

  // Calculate reasoning time
  useEffect(() => {
    if (!props.item.reasoning) return;
    if (!props.item.reasoning.endAt) return;

    const startAt = props.item.reasoning.startAt || Date.now();
    const endAt = props.item.reasoning.endAt || Date.now();
    const diff = endAt - startAt;
    const diffString = `${(diff / 1000).toFixed(1)}s`;
    setReasoningTime(diffString);
  }, [props.item.reasoning?.startAt, props.item.reasoning?.endAt]);

  // Auto-scroll reasoning section during streaming
  useEffect(() => {
    if (!reasoningRef.current || !isStreaming || collapsed) return;

    const container = reasoningRef.current;
    // Auto-scroll to bottom during streaming
    container.scrollTop = container.scrollHeight;
  }, [reasoning, isStreaming, collapsed]);

  const handleToggleCollapse = useCallback(() => {
    setCollapsed(prev => !prev);
  }, []);

  // Only render if reasoning is a valid non-empty string
  if (!reasoning || reasoning.trim().length === 0) {
    return null;
  }

  // Match code block height: 12 lines * 19px line height = 228px
  const COLLAPSED_MAX_HEIGHT = 228;

  return (
    <div className="reasoning-section-wrapper my-2" ref={wrapperRef}>
      <style dangerouslySetInnerHTML={{
        __html: `
          @keyframes ellipsis {
            0%, 100% { width: 0px; }
            33% { width: 8px; }
            66% { width: 16px; }
            90% { width: 24px; }
          }
          .thinking-ellipsis::after {
            content: "...";
            position: absolute;
            width: 0px;
            display: inline-block;
            overflow: hidden;
            animation: ellipsis 1s steps(4, end) infinite;
          }
          .reasoning-section-body {
            max-height: ${COLLAPSED_MAX_HEIGHT}px;
            overflow-y: auto;
            overflow-x: hidden;
            overflow-anchor: none;
            scroll-behavior: auto;
            scrollbar-width: thin;
          }
          .reasoning-section-body.no-scroll {
            max-height: none;
            overflow: visible;
          }
          .reasoning-section-body::-webkit-scrollbar {
            width: 6px;
            height: 6px;
          }
          .reasoning-section-body::-webkit-scrollbar-track {
            background: transparent;
          }
          .reasoning-section-body::-webkit-scrollbar-thumb {
            background: rgba(128, 128, 128, 0.4);
            border-radius: 3px;
          }
          .reasoning-section-body::-webkit-scrollbar-thumb:hover {
            background: rgba(128, 128, 128, 0.6);
          }
        `
      }} />
      <div 
        className="reasoning-section-container relative flex flex-col rounded-md overflow-hidden"
        style={{
          border: '1px solid var(--vscode-panel-border, #3c3c3c)',
          backgroundColor: 'var(--vscode-editor-background)',
        }}
      >
        {/* Header bar */}
        <div 
          className="reasoning-section-header flex items-center justify-between px-3 py-2 cursor-pointer select-none"
          style={{
            backgroundColor: 'var(--vscode-sideBar-background, var(--vscode-editor-background))',
            borderBottom: '1px solid var(--vscode-panel-border, #3c3c3c)',
          }}
          onClick={handleToggleCollapse}
        >
          <div className="flex items-center gap-2">
            <span 
              className="text-xs font-medium"
              style={{ color: 'var(--vscode-descriptionForeground, #888)' }}
            >
              {isStreaming ? (
                <span className="relative pr-5 thinking-ellipsis">
                  {t('thinking')}
                </span>
              ) : (
                `${t('thinking')} ${reasoningTime ? `(${reasoningTime})` : ''}`
              )}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {showExpandButton && (
              <button
                type="button"
                className="flex gap-1 items-center transition rounded px-2 py-0.5 text-xs"
                style={{
                  backgroundColor: 'var(--vscode-button-secondaryBackground, #3c3c3c)',
                  color: 'var(--vscode-button-secondaryForeground, #ccc)',
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  handleToggleCollapse();
                }}
              >
                {collapsed ? (
                  <>
                    <ChevronDown className="h-3 w-3" />
                    <span>{t('expand')}</span>
                  </>
                ) : (
                  <>
                    <ChevronUp className="h-3 w-3" />
                    <span>{t('collapse')}</span>
                  </>
                )}
              </button>
            )}
            {!showExpandButton && (
              collapsed ? (
                <ChevronDown className="h-3 w-3" style={{ color: 'var(--vscode-descriptionForeground)' }} />
              ) : (
                <ChevronUp className="h-3 w-3" style={{ color: 'var(--vscode-descriptionForeground)' }} />
              )
            )}
          </div>
        </div>
        
        {/* Reasoning content body */}
        {!collapsed && (
          <div
            ref={reasoningRef}
            className={`reasoning-section-body ${lineCount <= DEFAULT_COLLAPSED_LINES ? 'no-scroll' : ''}`}
            style={{
              backgroundColor: 'var(--vscode-sideBar-background, var(--vscode-editor-background))',
            }}
          >
            <div className="reasoning-section-content p-3">
              <StyledMarkdownPreview
                isRenderingInStepContainer
                source={stripImages(reasoning)}
                itemIndex={props.index}
                useParentBackgroundColor
                isStreaming={isStreaming}
              />
            </div>
          </div>
        )}
        
        {/* Collapsed indicator */}
        {collapsed && (
          <div 
            className="py-2 px-3 text-xs italic"
            style={{
              backgroundColor: 'var(--vscode-sideBar-background)',
              color: 'var(--vscode-descriptionForeground, #888)',
            }}
          >
            {t('thinkingContentHidden')}
          </div>
        )}
        
        {/* Scroll indicator */}
        {showScrollIndicator && !collapsed && (
          <div 
            className="flex items-center justify-center gap-2 py-1.5 text-xs"
            style={{
              color: 'var(--vscode-descriptionForeground, #888)',
              backgroundColor: 'var(--vscode-sideBar-background)',
              borderTop: '1px solid var(--vscode-panel-border, #3c3c3c)',
            }}
          >
            <span>{t('scrollToSeeMore')}</span>
          </div>
        )}
      </div>
    </div>
  );
}
