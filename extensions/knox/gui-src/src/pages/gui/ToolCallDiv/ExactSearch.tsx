import { ContextItemWithId, ToolCallState } from "core";
import { cn } from "@/lib/utils";
import { MagnifyingGlassIcon } from "../../../svg-icons";
import { useMemo, useState, useContext } from "react";
import { useTranslation } from "react-i18next";
import hljs from "highlight.js";
import ClickableFilePath from "../../../components/markdown/ClickableFilePath";
import { IdeMessengerContext } from "../../../context/IdeMessenger";
import { VscThemeContext } from "../../../context/VscTheme";
import { openFileInEditor } from "../../../util/openFileInEditor";

// VSCode CSS variable mappings for theme support
const vscColors = {
  // Backgrounds
  bg: 'var(--vscode-editor-background)',
  bgSecondary: 'var(--vscode-sideBar-background, var(--vscode-editor-background))',
  bgHover: 'var(--vscode-list-hoverBackground)',
  bgActive: 'var(--vscode-list-activeSelectionBackground)',
  
  // Foregrounds
  fg: 'var(--vscode-editor-foreground)',
  fgMuted: 'var(--vscode-descriptionForeground)',
  fgSecondary: 'var(--vscode-foreground)',
  
  // Borders
  border: 'var(--vscode-panel-border)',
  borderActive: 'var(--vscode-focusBorder)',
  
  // Semantic colors
  link: 'var(--vscode-textLink-foreground)',
  linkActive: 'var(--vscode-textLink-activeForeground)',
  
  // Editor colors for syntax
  lineNumber: 'var(--vscode-editorLineNumber-foreground)',
  lineNumberActive: 'var(--vscode-editorLineNumber-activeForeground)',
  matchHighlight: 'var(--vscode-editor-findMatchHighlightBackground, rgba(234, 179, 8, 0.3))',
  matchBorder: 'var(--vscode-editor-findMatchHighlightBorder, #eab308)',
  selectionBg: 'var(--vscode-editor-selectionBackground)',
  
  // Badge/button colors
  badge: 'var(--vscode-badge-background)',
  badgeFg: 'var(--vscode-badge-foreground)',
  
  // Status colors (using VSCode's built-in colors)
  info: 'var(--vscode-editorInfo-foreground, #3794ff)',
  warning: 'var(--vscode-editorWarning-foreground, #cca700)',
  error: 'var(--vscode-editorError-foreground, #f14c4c)',
  success: 'var(--vscode-testing-iconPassed, #73c991)',
};

// Generate CSS for hljs theme based on VscTheme
const generateThemeStyles = (theme: Record<string, string>) => {
  return Object.keys(theme)
    .map((key) => `& ${key} { color: ${theme[key]}; }`)
    .join("\n");
};

// Detect language from file extension
function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const langMap: Record<string, string> = {
    'ts': 'typescript',
    'tsx': 'typescript',
    'js': 'javascript',
    'jsx': 'javascript',
    'py': 'python',
    'rb': 'ruby',
    'rs': 'rust',
    'go': 'go',
    'java': 'java',
    'kt': 'kotlin',
    'swift': 'swift',
    'c': 'c',
    'cpp': 'cpp',
    'h': 'c',
    'hpp': 'cpp',
    'cs': 'csharp',
    'php': 'php',
    'html': 'html',
    'css': 'css',
    'scss': 'scss',
    'less': 'less',
    'json': 'json',
    'yaml': 'yaml',
    'yml': 'yaml',
    'xml': 'xml',
    'md': 'markdown',
    'sql': 'sql',
    'sh': 'bash',
    'bash': 'bash',
    'zsh': 'bash',
    'dockerfile': 'dockerfile',
    'vue': 'vue',
    'svelte': 'svelte',
  };
  return langMap[ext] || 'plaintext';
}

interface ExactSearchToolCallProps {
  query: string;
  toolCallState: ToolCallState;
  toolOutputContextItems: ContextItemWithId[];
}

interface SearchMatch {
  filePath: string;
  language: string;
  lines: Array<{
    lineNum: number;
    content: string;
    isMatch: boolean;
  }>;
}

/**
 * Parse ripgrep output into structured data
 */
function parseSearchResults(content: string): SearchMatch[] {
  if (!content || content === "No matches found" || content.startsWith("Error:")) {
    return [];
  }
  
  const results: SearchMatch[] = [];
  let currentFile: SearchMatch | null = null;
  
  const lines = content.split('\n');
  
  for (const line of lines) {
    if (!line.trim()) continue;
    
    // Skip separator / truncation lines
    if (line === '--' || line.startsWith('…') || line.startsWith('...')) continue;

    // Line with line number (format: "123:content" or "123-content")
    const lineNumMatch = line.match(/^(\d+)([:|-])(.*)$/);
    if (lineNumMatch && currentFile) {
      const [, lineNum, separator, content] = lineNumMatch;
      currentFile.lines.push({
        lineNum: parseInt(lineNum, 10),
        content: content,
        isMatch: separator === ':',
      });
      continue;
    }

    // Count mode: path:N
    const countMatch = line.match(/^(.*):(\d+)\s*$/);
    if (countMatch && !/^\d+[:\-]/.test(line) && /[\\/]/.test(countMatch[1] ?? "")) {
      if (currentFile) {
        results.push(currentFile);
      }
      currentFile = {
        filePath: countMatch[1] ?? line,
        language: detectLanguage(countMatch[1] ?? line),
        lines: [],
      };
      continue;
    }

    // File heading or files_with_matches path
    if (currentFile) {
      results.push(currentFile);
    }
    currentFile = {
      filePath: line,
      language: detectLanguage(line),
      lines: [],
    };
  }
  
  // Don't forget the last file
  if (currentFile) {
    results.push(currentFile);
  }
  
  return results;
}

/**
 * Highlight code using highlight.js and wrap query matches
 */
function highlightCode(code: string, language: string, query: string): string {
  let highlighted: string;
  
  try {
    if (hljs.getLanguage(language)) {
      highlighted = hljs.highlight(code, { language }).value;
    } else {
      highlighted = hljs.highlightAuto(code).value;
    }
  } catch {
    // Escape HTML for safety
    highlighted = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
  
  // Now wrap query matches with a highlight span
  if (query) {
    try {
      const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // We need to be careful not to break HTML tags
      // Only highlight text content, not inside tags
      const regex = new RegExp(`(${escapedQuery})`, 'gi');
      
      // Split by tags, highlight text parts, rejoin
      const parts = highlighted.split(/(<[^>]+>)/);
      highlighted = parts.map(part => {
        if (part.startsWith('<')) {
          return part; // Don't modify tags
        }
        return part.replace(regex, '<mark class="search-match">$1</mark>');
      }).join('');
    } catch {
      // If regex fails, just use the highlighted code without query marks
    }
  }
  
  return highlighted;
}

export function ExactSearch(props: ExactSearchToolCallProps) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(true);
  const { theme } = useContext(VscThemeContext);
  const ideMessenger = useContext(IdeMessengerContext);
  
  const query = props.query ?? "";
  const isStreaming = props.toolCallState.status === "generating" || props.toolCallState.status === "calling";

  // Extract search results from context items
  const searchResults = props.toolOutputContextItems
    .find(item => item.description?.includes("search") || item.name?.includes("search") || item.name?.includes("Search"))
    ?.content || "";

  // Parse results into structured data
  const parsedResults = useMemo(() => parseSearchResults(searchResults), [searchResults]);

  // Calculate stats
  const stats = useMemo(() => {
    const files = parsedResults.length;
    const matches = parsedResults.reduce(
      (acc, file) => acc + file.lines.filter(l => l.isMatch).length, 
      0
    );
    return { files, matches };
  }, [parsedResults]);

  // Generate theme styles for hljs
  const themeStyles = useMemo(() => generateThemeStyles(theme), [theme]);

  return (
    <div className="flex flex-col gap-2">
      {/* Inject theme styles */}
      <style>{`
        .search-results-code {
          ${themeStyles}
        }
        .search-results-code .search-match {
          background-color: ${vscColors.matchHighlight};
          color: inherit;
          padding: 1px 2px;
          border-radius: 2px;
          font-weight: 600;
          border: 1px solid var(--vscode-editor-findMatchBorder, transparent);
          box-shadow: 0 0 0 1px var(--vscode-editor-findMatchHighlightBorder, transparent);
        }
        .search-results-code .hljs {
          color: var(--vscode-editor-foreground);
          background: transparent;
        }
      `}</style>
      
      <div className="flex flex-row items-center gap-2 px-1">
        <MagnifyingGlassIcon />
        <span className="text-sm font-medium text-knoxcyan">{t('exactSearch')}</span>
      </div>
      
      <div
        className="rounded-lg overflow-hidden"
        style={{
          backgroundColor: vscColors.bg,
          border: `1px solid ${vscColors.border}`,
        }}
      >
        {/* Header */}
        <div 
          className="px-3 py-2 flex items-center justify-between"
          style={{
            backgroundColor: vscColors.bgSecondary,
            borderBottom: `1px solid ${vscColors.border}`,
          }}
        >
          <div className="flex items-center gap-3">
            {/* Search icon */}
            <svg 
              width="14" 
              height="14" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor"
              strokeWidth="2"
              style={{ color: vscColors.fgMuted }}
            >
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            
            {/* Query badge */}
            <div className="flex items-center gap-2">
              <code 
                className="text-xs font-semibold px-2 py-0.5 rounded"
                style={{ 
                  backgroundColor: vscColors.badge,
                  color: vscColors.badgeFg,
                  fontFamily: 'var(--vscode-editor-font-family, "JetBrains Mono", monospace)',
                }}
              >
                {query || "..."}
              </code>
              
              {/* Stats */}
              <span 
                className="text-xs"
                style={{ color: vscColors.fgMuted }}
              >
                {isStreaming 
                  ? t('searching')
                  : stats.files > 0 
                    ? `• ${t('matchesInFiles', { matches: stats.matches, files: stats.files })}`
                    : t('noMatchesFound')
                }
              </span>
            </div>
          </div>
          
          {/* Expand/Collapse button */}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 rounded transition-colors"
            style={{ 
              color: vscColors.fgMuted,
            }}
          >
            <svg 
              width="14" 
              height="14" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={cn("transition-transform duration-200", isExpanded ? "" : "rotate-180")}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
        
        {/* Results content */}
        {isExpanded && (
          <div 
            className="overflow-auto"
            style={{ 
              maxHeight: '400px',
              minHeight: '100px',
            }}
          >
            {isStreaming ? (
              <div 
                className="flex items-center justify-center py-10"
                style={{ color: vscColors.fgMuted }}
              >
                <div className="flex items-center gap-2">
                  <div 
                    className="animate-spin w-4 h-4 border-2 rounded-full" 
                    style={{ 
                      borderColor: vscColors.info, 
                      borderTopColor: 'transparent' 
                    }} 
                  />
                  <span className="text-sm">{t('searchingRepository')}</span>
                </div>
              </div>
            ) : parsedResults.length === 0 ? (
              <div 
                className="flex flex-col items-center justify-center py-10 gap-2"
                style={{ color: vscColors.fgMuted }}
              >
                <svg 
                  width="28" 
                  height="28" 
                  viewBox="0 0 24 24" 
                  fill="none" 
                  stroke="currentColor" 
                  strokeWidth="1.5"
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="M21 21l-4.35-4.35" />
                </svg>
                <span className="text-sm">{t('noMatchesFound')}</span>
              </div>
            ) : (
              <div className="search-results-code">
                {parsedResults.map((file, fileIdx) => (
                  <div 
                    key={fileIdx}
                    style={{ 
                      borderBottom: fileIdx < parsedResults.length - 1 ? `1px solid ${vscColors.border}` : 'none' 
                    }}
                  >
                    {/* File header */}
                    <div 
                      className="px-3 py-1.5 flex items-center gap-2 sticky top-0 z-10"
                      style={{ 
                        backgroundColor: vscColors.bgSecondary,
                        borderBottom: `1px solid ${vscColors.border}`,
                      }}
                    >
                      <ClickableFilePath
                        filepath={file.filePath}
                        showIcon
                        iconSize="14px"
                        className="min-w-0 flex-1 text-xs"
                        dirStyle={{
                          color: vscColors.fgMuted,
                          fontFamily: 'var(--vscode-editor-font-family, monospace)',
                        }}
                        nameClassName="font-medium"
                        nameStyle={{
                          fontFamily: 'var(--vscode-editor-font-family, monospace)',
                        }}
                      />
                      
                      {/* Language badge */}
                      <span 
                        className="text-[10px] px-1.5 py-0.5 rounded ml-auto"
                        style={{ 
                          backgroundColor: vscColors.badge,
                          color: vscColors.badgeFg,
                          opacity: 0.8,
                        }}
                      >
                        {file.language}
                      </span>
                    </div>
                    
                    {/* Code lines */}
                    <div 
                      className="text-xs leading-relaxed"
                      style={{ 
                        fontFamily: 'var(--vscode-editor-font-family, "JetBrains Mono", monospace)',
                        fontSize: 'var(--vscode-editor-font-size, 12px)',
                      }}
                    >
                      {file.lines.map((line, lineIdx) => {
                        const highlightedContent = highlightCode(line.content, file.language, line.isMatch ? query : '');
                        
                        return (
                          <div 
                            key={lineIdx}
                            role="button"
                            tabIndex={0}
                            title={`${file.filePath}:${line.lineNum}`}
                            className="flex cursor-pointer hover:opacity-90 transition-opacity"
                            onClick={() => {
                              void openFileInEditor(ideMessenger, file.filePath, {
                                startLine: line.lineNum,
                                endLine: line.lineNum,
                              });
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                void openFileInEditor(ideMessenger, file.filePath, {
                                  startLine: line.lineNum,
                                  endLine: line.lineNum,
                                });
                              }
                            }}
                            style={{ 
                              backgroundColor: line.isMatch ? vscColors.matchHighlight : 'transparent',
                              borderLeft: line.isMatch 
                                ? `3px solid ${vscColors.warning}` 
                                : '3px solid transparent',
                            }}
                          >
                            {/* Line number */}
                            <span 
                              className="shrink-0 px-2 py-0.5 text-right select-none"
                              style={{ 
                                minWidth: '45px',
                                color: line.isMatch ? vscColors.lineNumberActive : vscColors.lineNumber,
                                backgroundColor: vscColors.bgSecondary,
                                fontWeight: line.isMatch ? 600 : 400,
                                borderRight: `1px solid ${vscColors.border}`,
                              }}
                            >
                              {line.lineNum}
                            </span>
                            
                            {/* Code content with syntax highlighting */}
                            <code 
                              className="hljs flex-1 py-0.5 px-2 whitespace-pre overflow-x-auto"
                              style={{ 
                                color: line.isMatch ? vscColors.fg : vscColors.fgMuted,
                                opacity: line.isMatch ? 1 : 0.7,
                              }}
                              dangerouslySetInnerHTML={{ __html: highlightedContent }}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
