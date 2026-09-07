import React, { useContext, useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/redux/hooks";
import { selectUIConfig } from "@/redux/slices/configSlice";

import { defaultBorderRadius, vscForeground } from "..";
import { VscThemeContext } from "../../context/VscTheme";

// Default number of visible lines when collapsed
const DEFAULT_COLLAPSED_LINES = 12;
// Line height in pixels (approximate) - matches VS Code editor line height
const LINE_HEIGHT_PX = 19;

const generateThemeStyles = (theme: any) => {
  return Object.keys(theme)
    .map((key) => {
      return `
        & ${key} {
          color: ${theme[key]};
        }
      `;
    })
    .join("");
};

// Define the styled components as Tailwind CSS components
const StyledPre = React.forwardRef<HTMLPreElement, React.HTMLAttributes<HTMLPreElement>>(
  ({ className, style, ...props }, ref) => (
    <pre
      ref={ref}
      className={cn(
        "[&_.hljs]:text-vsc-foreground",
        "mt-0 mb-0 rounded-b-none!",
        className
      )}
      style={{
        borderRadius: `0 0 ${defaultBorderRadius} ${defaultBorderRadius} !important`,
        ...style
      }}
      {...props}
    />
  )
);

StyledPre.displayName = "StyledPre";

// Line component for streaming - renders each line individually for real-time updates
const CodeLine = React.memo(({ 
  lineNumber, 
  content, 
  isLastLine,
  isGenerating,
  codeWrap
}: { 
  lineNumber: number; 
  content: React.ReactNode; 
  isLastLine: boolean;
  isGenerating: boolean;
  codeWrap: boolean;
}) => (
  <div className="code-line flex" data-line={lineNumber}>
    <span 
      className={cn(
        "line-number select-none pr-2 text-right min-w-[2.5em] shrink-0",
        "text-(--vscode-editorLineNumber-foreground,#6e6e77) opacity-60",
        "border-r border-(--vscode-editorLineNumber-foreground,#6e6e77)/30"
      )}
      style={{ 
        backgroundColor: 'var(--vscode-editor-background)',
        position: 'sticky',
        left: 0,
        zIndex: 1,
      }}
    >
      {lineNumber}
    </span>
    <span className={cn("line-content pl-2 flex-1", codeWrap ? "whitespace-pre-wrap wrap-break-word" : "whitespace-pre")}>
      {content}
      {isLastLine && isGenerating && (
        <span className="streaming-cursor" />
      )}
    </span>
  </div>
));

CodeLine.displayName = "CodeLine";

interface SyntaxHighlightedPreProps {
  children?: React.ReactNode;
  'data-codeblockindex'?: number;
  'data-generating'?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

// Extract text content and HTML from the code element
const extractCodeContent = (children: React.ReactNode): { lines: React.ReactNode[], rawText: string } => {
  // Find the code element in children
  const childArray = React.Children.toArray(children);
  
  for (const child of childArray) {
    if (React.isValidElement(child)) {
      const childProps = child.props as Record<string, any>;
      const isCodeElement = child.type === 'code' || 
        (typeof childProps?.className === 'string' && childProps.className.includes('hljs'));
      
      if (isCodeElement) {
        // Found the code element - extract its content
        if (childProps.dangerouslySetInnerHTML?.__html) {
          // Parse HTML content into lines while preserving syntax highlighting
          const html = childProps.dangerouslySetInnerHTML.__html as string;
          const lines = splitHighlightedHtmlIntoLines(html);
          const rawText = html.replace(/<[^>]*>/g, '');
          return { lines, rawText };
        }
        
        // Handle regular children
        const text = typeof childProps.children === 'string' ? childProps.children : '';
        return { 
          lines: text.split('\n').map((line: string) => line || ' '),
          rawText: text 
        };
      }
    }
  }

  // Fallback: treat children as raw content
  const text = typeof children === 'string' ? children : '';
  return { 
    lines: text.split('\n').map((line) => line || ' '),
    rawText: text 
  };
};

// Split highlighted HTML into lines while preserving span tags
const splitHighlightedHtmlIntoLines = (html: string): React.ReactNode[] => {
  const lines: string[] = [];
  const openTags: string[] = [];
  let currentLine = '';
  let i = 0;

  while (i < html.length) {
    const char = html[i];

    if (char === '\n') {
      // Close all open tags for this line
      const closingTags = [...openTags].reverse().map(() => '</span>').join('');
      lines.push(currentLine + closingTags);
      // Start new line with open tags
      currentLine = openTags.join('');
      i++;
    } else if (char === '<') {
      const tagEnd = html.indexOf('>', i);
      if (tagEnd !== -1) {
        const tag = html.slice(i, tagEnd + 1);
        if (tag.startsWith('</')) {
          openTags.pop();
          currentLine += tag;
        } else if (tag.startsWith('<span')) {
          openTags.push(tag);
          currentLine += tag;
        } else {
          currentLine += tag;
        }
        i = tagEnd + 1;
      } else {
        currentLine += char;
        i++;
      }
    } else {
      currentLine += char;
      i++;
    }
  }

  // Don't forget the last line
  if (currentLine || lines.length === 0) {
    const closingTags = [...openTags].reverse().map(() => '</span>').join('');
    lines.push(currentLine + closingTags);
  }

  // Convert HTML strings to React elements
  return lines.map((lineHtml, index) => (
    <span key={index} dangerouslySetInnerHTML={{ __html: lineHtml || '&nbsp;' }} />
  ));
};

// Create a component that will render StyledPre with the current theme and line numbers
export const SyntaxHighlightedPre = (props: SyntaxHighlightedPreProps) => {
  const { t } = useTranslation();
  const currentTheme = useContext(VscThemeContext);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastLineRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const prevLineCountRef = useRef(0);
  const prevRawTextLengthRef = useRef(0);
  const isGenerating = props['data-generating'] || false;
  const uiConfig = useAppSelector(selectUIConfig);
  const codeWrap = uiConfig?.codeWrap ?? false;
  
  const themeStyles = useMemo(() => ({
    __html: generateThemeStyles(currentTheme.theme)
  }), [currentTheme.theme]);

  // Extract and memoize code lines
  const { lines, rawText } = useMemo(() => 
    extractCodeContent(props.children), 
    [props.children]
  );

  const lineCount = lines.length;

  // Detect user scroll (scrolling up during generation)
  const handleScroll = useCallback(() => {
    if (!containerRef.current || !isGenerating) return;
    
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom = Math.abs(scrollHeight - scrollTop - clientHeight) < 30;
    
    // If user scrolled up (scrollTop decreased and not at bottom), mark as user scrolled
    if (scrollTop < lastScrollTopRef.current && !isAtBottom) {
      userScrolledRef.current = true;
    } else if (isAtBottom) {
      userScrolledRef.current = false;
    }
    
    lastScrollTopRef.current = scrollTop;
  }, [isGenerating]);

  // Reset user scroll state when generation starts
  useEffect(() => {
    if (isGenerating) {
      userScrolledRef.current = false;
      prevRawTextLengthRef.current = 0;
    }
  }, [isGenerating]);

  // Auto-scroll to bottom during code generation - on new lines AND content changes
  useEffect(() => {
    if (!isGenerating || !containerRef.current) return;
    if (userScrolledRef.current) return; // Don't auto-scroll if user scrolled away
    
    const hasNewLines = lineCount > prevLineCountRef.current;
    const hasContentGrowth = rawText.length > prevRawTextLengthRef.current;
    
    // Scroll when new lines are added OR when content within the last line grows
    if (hasNewLines || hasContentGrowth) {
      // Use requestAnimationFrame for smooth scrolling
      requestAnimationFrame(() => {
        if (containerRef.current) {
          containerRef.current.scrollTop = containerRef.current.scrollHeight;
          lastScrollTopRef.current = containerRef.current.scrollTop;
        }
      });
    }
    
    prevLineCountRef.current = lineCount;
    prevRawTextLengthRef.current = rawText.length;
  }, [lineCount, rawText.length, isGenerating]);

  // Attach scroll listener
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  // Calculate max height based on collapsed lines
  const collapsedMaxHeight = DEFAULT_COLLAPSED_LINES * LINE_HEIGHT_PX;
  
  // During generation, always show scrollable; after generation, only if lines > 12
  const needsScroll = isGenerating || lineCount > DEFAULT_COLLAPSED_LINES;
  
  return (
    <>
      <style dangerouslySetInnerHTML={themeStyles} />
      <div
        ref={containerRef}
        className={cn(
          "code-block-scrollable-container",
          "overflow-y-auto overflow-x-auto",
          isGenerating && "generating-code-block"
        )}
        style={{
          maxHeight: needsScroll ? `${collapsedMaxHeight}px` : 'none',
          fontFamily: "var(--vscode-editor-font-family, 'Monaco', 'Menlo', 'Ubuntu Mono', monospace)",
        }}
        data-streaming={isGenerating}
      >
        <div className="code-lines-container">
          {lines.map((lineContent, index) => (
            <CodeLine
              key={index}
              lineNumber={index + 1}
              content={lineContent}
              isLastLine={index === lines.length - 1}
              isGenerating={isGenerating}
              codeWrap={codeWrap}
            />
          ))}
        </div>
      </div>
      {/* Show line count indicator when collapsed and has more lines */}
      {!isGenerating && lineCount > DEFAULT_COLLAPSED_LINES && (
        <div 
          className="text-xs text-center py-1 opacity-60 border-t border-(--vscode-editorLineNumber-foreground,#6e6e77)/20"
          style={{
            color: 'var(--vscode-editorLineNumber-foreground, #6e6e77)',
            backgroundColor: 'var(--vscode-editor-background)',
          }}
        >
          {t('linesTotalScrollMore', { count: lineCount })}
        </div>
      )}
    </>
  );
};
