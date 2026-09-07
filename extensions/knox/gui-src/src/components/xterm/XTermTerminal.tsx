import { useRef, useMemo, useState, useCallback, useContext, useEffect } from "react";
import { useTranslation } from "react-i18next";
import "./xterm-custom.css";
import {
  vscEditorBackground,
  vscCommandCenterInactiveBorder,
} from "../../components";
import { VscThemeContext } from "../../context/VscTheme";
import { getFontSize } from "../../util";

// One Dark Pro terminal color palette
const ONE_DARK_PRO = {
  foreground: '#abb2bf',
  black: '#282c34',
  red: '#e06c75',
  green: '#98c379',
  yellow: '#e5c07b',
  blue: '#61afef',
  magenta: '#c678dd',
  cyan: '#56b6c2',
  white: '#abb2bf',
  brightBlack: '#5c6370',
  brightRed: '#e06c75',
  brightGreen: '#98c379',
  brightYellow: '#e5c07b',
  brightBlue: '#61afef',
  brightMagenta: '#c678dd',
  brightCyan: '#56b6c2',
  brightWhite: '#ffffff',
};

// One Dark Pro light variant
const ONE_DARK_LIGHT = {
  foreground: '#383a42',
  black: '#383a42',
  red: '#e45649',
  green: '#50a14f',
  yellow: '#c18401',
  blue: '#4078f2',
  magenta: '#a626a4',
  cyan: '#0184bc',
  white: '#a0a1a7',
  brightBlack: '#696c77',
  brightRed: '#e45649',
  brightGreen: '#50a14f',
  brightYellow: '#c18401',
  brightBlue: '#4078f2',
  brightMagenta: '#a626a4',
  brightCyan: '#0184bc',
  brightWhite: '#383a42',
};

function isLightTheme(): boolean {
  const bg = getComputedStyle(document.documentElement)
    .getPropertyValue('--vscode-editor-background').trim();
  if (!bg) return false;
  if (bg.startsWith('#')) {
    const hex = bg.slice(1);
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) > 128;
  }
  return false;
}

/** Parse basic ANSI escape codes into styled <span> elements */
function parseAnsiToReact(text: string, palette: typeof ONE_DARK_PRO): React.ReactNode[] {
  if (!text) return [];

  const ansiRegex = /\x1b\[([0-9;]*)m/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let currentColor: string | null = null;
  let bold = false;
  let dim = false;
  let match: RegExpExecArray | null;

  const colorMap: Record<number, string> = {
    30: palette.black,   31: palette.red,     32: palette.green,
    33: palette.yellow,  34: palette.blue,    35: palette.magenta,
    36: palette.cyan,    37: palette.white,
    90: palette.brightBlack,  91: palette.brightRed,   92: palette.brightGreen,
    93: palette.brightYellow, 94: palette.brightBlue,  95: palette.brightMagenta,
    96: palette.brightCyan,   97: palette.brightWhite,
  };

  while ((match = ansiRegex.exec(text)) !== null) {
    // Push text before this escape
    if (match.index > lastIndex) {
      const segment = text.slice(lastIndex, match.index);
      if (segment) {
        const style: React.CSSProperties = {};
        if (currentColor) style.color = currentColor;
        if (bold) style.fontWeight = 'bold';
        if (dim) style.opacity = 0.6;
        parts.push(
          Object.keys(style).length > 0
            ? <span key={parts.length} style={style}>{segment}</span>
            : segment
        );
      }
    }

    // Parse the SGR codes
    const codes = match[1].split(';').map(Number);
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      if (code === 0) { currentColor = null; bold = false; dim = false; }
      else if (code === 1) { bold = true; }
      else if (code === 2) { dim = true; }
      else if (code === 22) { bold = false; dim = false; }
      else if (code === 39) { currentColor = null; }
      else if (colorMap[code]) { currentColor = colorMap[code]; }
      else if (code === 38 && codes[i + 1] === 2 && i + 4 < codes.length) {
        // 24-bit color: ESC[38;2;r;g;b m
        currentColor = `rgb(${codes[i + 2]}, ${codes[i + 3]}, ${codes[i + 4]})`;
        i += 4;
      }
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining text
  if (lastIndex < text.length) {
    const segment = text.slice(lastIndex);
    const style: React.CSSProperties = {};
    if (currentColor) style.color = currentColor;
    if (bold) style.fontWeight = 'bold';
    if (dim) style.opacity = 0.6;
    parts.push(
      Object.keys(style).length > 0
        ? <span key={parts.length} style={style}>{segment}</span>
        : segment
    );
  }

  return parts.length > 0 ? parts : [text];
}

interface XTermTerminalProps {
  content: string;
  command?: string;
  className?: string;
  showHeader?: boolean;
  title?: string;
  isStreaming?: boolean;
  isDone?: boolean;
  isCanceled?: boolean;
  minHeight?: number;
  maxHeight?: number;
  wordWrap?: boolean;
}

export function XTermTerminal({
  content,
  command,
  className,
  showHeader = true,
  title,
  isStreaming = false,
  isDone = false,
  isCanceled = false,
  minHeight = 80,
  maxHeight = 400,
  wordWrap = true,
}: XTermTerminalProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const userScrolledRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const prevContentLengthRef = useRef(0);

  // Use the same theme context as code blocks
  const { theme: vscTheme } = useContext(VscThemeContext);

  // Pick One Dark Pro palette based on current theme
  const palette = useMemo(() => isLightTheme() ? ONE_DARK_LIGHT : ONE_DARK_PRO, []);

  // Get theme-aware colors for prompt/command (from VscThemeContext, like code blocks)
  const promptColor = useMemo(() =>
    vscTheme['.hljs-title.function_'] || vscTheme['.hljs-built_in'] || palette.green,
    [vscTheme, palette]
  );
  const commandColor = useMemo(() =>
    vscTheme['.hljs-string'] || palette.foreground,
    [vscTheme, palette]
  );

  // Determine status
  const status: "running" | "done" | "canceled" | "idle" = useMemo(() => {
    if (isStreaming) return "running";
    if (isDone) return "done";
    if (isCanceled) return "canceled";
    return "idle";
  }, [isStreaming, isDone, isCanceled]);

  // Dynamic height
  const dynamicHeight = useMemo(() => {
    const lineCount = (content?.split('\n').length || 0) + (command ? 1 : 0);
    const lineHeight = 18;
    const padding = 24;
    return Math.min(Math.max(lineCount * lineHeight + padding, minHeight), maxHeight);
  }, [content, command, minHeight, maxHeight]);

  // Parse ANSI in terminal output
  const renderedContent = useMemo(() => parseAnsiToReact(content, palette), [content, palette]);

  // Detect user scroll (scrolling up while content is visible)
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom = Math.abs(scrollHeight - scrollTop - clientHeight) < 30;

    if (scrollTop < lastScrollTopRef.current && !isAtBottom) {
      userScrolledRef.current = true;
    } else if (isAtBottom) {
      userScrolledRef.current = false;
    }

    lastScrollTopRef.current = scrollTop;
  }, []);

  // Reset user scroll state when new content first appears (empty → non-empty)
  useEffect(() => {
    const currentLength = content?.length || 0;
    if (currentLength > 0 && prevContentLengthRef.current === 0) {
      userScrolledRef.current = false;
    }
  }, [content]);

  // Auto-scroll to bottom whenever content changes (grows), regardless of streaming state
  // Terminal output may arrive all at once when tool completes, not incrementally
  useEffect(() => {
    if (!containerRef.current) return;
    if (userScrolledRef.current) return;

    const currentLength = content?.length || 0;
    if (currentLength > prevContentLengthRef.current) {
      // Scroll after React renders the new content
      requestAnimationFrame(() => {
        if (containerRef.current) {
          containerRef.current.scrollTop = containerRef.current.scrollHeight;
          lastScrollTopRef.current = containerRef.current.scrollTop;
        }
        // Second scroll after layout settles (height may change after first paint)
        requestAnimationFrame(() => {
          if (containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;
            lastScrollTopRef.current = containerRef.current.scrollTop;
          }
        });
      });
    }

    prevContentLengthRef.current = currentLength;
  }, [content]);

  // Attach scroll listener
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  // Copy command to clipboard
  const handleCopyCommand = useCallback(() => {
    if (command) {
      navigator.clipboard.writeText(command).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  }, [command]);

  return (
    <div
      className={`knox-term rounded-md mb-2 min-w-0 ${status === "running" ? "knox-term--running" : ""} ${className || ''}`}
      style={{
        outline: `1px solid ${vscCommandCenterInactiveBorder}`,
        outlineOffset: '-0.5px',
        backgroundColor: vscEditorBackground,
      }}
    >
      {/* Terminal header — matches code block toolbar */}
      {showHeader && (
        <div
          className="knox-term__header flex justify-between items-center bg-inherit p-1 px-1.5 m-0 find-widget-skip border-b"
          style={{
            fontSize: `${getFontSize() - 2}px`,
            borderBottomColor: vscCommandCenterInactiveBorder,
          }}
        >
          {/* Left: icon + title */}
          <div className="knox-term__header-left">
            <svg className="knox-term__icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M2 3.5C2 2.67 2.67 2 3.5 2h9c.83 0 1.5.67 1.5 1.5v9c0 .83-.67 1.5-1.5 1.5h-9A1.5 1.5 0 012 12.5v-9z" stroke="currentColor" strokeWidth="1" fill="none" />
              <path d="M5 10l2.5-2L5 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M9 10h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>

            <span className="knox-term__title">
              {title || "Terminal"}
            </span>
          </div>

          {/* Right: status badge + copy */}
          <div className="knox-term__header-right">
            {status === "running" && (
              <div className="knox-term__badge knox-term__badge--running">
                <span className="knox-term__pulse" />
                <span>{t('running')}</span>
              </div>
            )}
            {status === "done" && (
              <div className="knox-term__badge knox-term__badge--done">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <path d="M3.5 8.5L6.5 11.5L12.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span>{t('toolUsed', 'Done')}</span>
              </div>
            )}
            {status === "canceled" && (
              <div className="knox-term__badge knox-term__badge--canceled">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                <span>{t('toolCanceled', 'Canceled')}</span>
              </div>
            )}

            {command && (
              <button
                className="knox-term__copy-btn"
                onClick={handleCopyCommand}
                title={copied ? "Copied!" : "Copy command"}
              >
                {copied ? (
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M3.5 8.5L6.5 11.5L12.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <rect x="5" y="5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
                    <path d="M3 11V3.5C3 3.22 3.22 3 3.5 3H11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                  </svg>
                )}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Terminal body */}
      <div
        ref={containerRef}
        className="knox-term__body"
        style={{
          height: `${dynamicHeight}px`,
          minHeight: `${minHeight}px`,
          maxHeight: `${maxHeight}px`,
          backgroundColor: vscEditorBackground,
          overflowX: wordWrap ? 'hidden' : 'auto',
          overflowY: 'auto',
        }}
      >
        <pre className="knox-term__pre" style={{
          color: palette.foreground,
          whiteSpace: wordWrap ? 'pre-wrap' : 'pre',
          wordBreak: wordWrap ? 'break-word' : 'normal',
          minWidth: wordWrap ? 'auto' : 'max-content',
        }}>
          {command && (
            <span className="knox-term__prompt-line">
              <span className="knox-term__prompt" style={{ color: promptColor }}>❯</span>
              <span className="knox-term__command" style={{ color: commandColor }}>{command}</span>
            </span>
          )}
          {content && (
            <span className="knox-term__output">{renderedContent}</span>
          )}
          {isStreaming && !content && (
            <span className="knox-term__cursor">▋</span>
          )}
        </pre>
      </div>
    </div>
  );
}

