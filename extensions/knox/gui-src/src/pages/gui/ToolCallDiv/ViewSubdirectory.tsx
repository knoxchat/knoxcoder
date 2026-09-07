import { ContextItemWithId, ToolCallState } from "core";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { FolderIcon } from "../../../svg-icons";
import { repoMapToTreeColorized } from "../../../util/repoMapToTree";
import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

// Helper to detect if theme is light or dark
function isLightTheme(): boolean {
  const backgroundColor = getComputedStyle(document.documentElement)
    .getPropertyValue('--vscode-editor-background')
    .trim();
  
  if (!backgroundColor) return false;
  
  // Parse the color
  let r = 0, g = 0, b = 0;
  if (backgroundColor.startsWith('#')) {
    const hex = backgroundColor.slice(1);
    r = parseInt(hex.substring(0, 2), 16);
    g = parseInt(hex.substring(2, 4), 16);
    b = parseInt(hex.substring(4, 6), 16);
  } else if (backgroundColor.startsWith('rgb')) {
    const match = backgroundColor.match(/\d+/g);
    if (match && match.length >= 3) {
      r = parseInt(match[0]);
      g = parseInt(match[1]);
      b = parseInt(match[2]);
    }
  }
  
  // Calculate luminance - higher means lighter
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b);
  return luminance > 128;
}

// Get CSS variable value with fallback
function getCssVar(varName: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim();
  return value || fallback;
}

// Dark theme (One Dark Pro inspired)
const DARK_TERMINAL_THEME = {
  background: '#282c34',
  foreground: '#abb2bf',
  cursor: '#528bff',
  cursorAccent: '#282c34',
  selectionBackground: '#3e4451',
  selectionForeground: '#abb2bf',
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

// Light theme (VS Code Light+ inspired)
const LIGHT_TERMINAL_THEME = {
  background: '#ffffff',
  foreground: '#383a42',
  cursor: '#526fff',
  cursorAccent: '#ffffff',
  selectionBackground: '#add6ff',
  selectionForeground: '#383a42',
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

// ANSI color codes for dark theme
const DARK_ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  blue: '\x1b[38;2;97;175;239m',
  cyan: '\x1b[38;2;86;182;194m',
  green: '\x1b[38;2;152;195;121m',
  yellow: '\x1b[38;2;229;192;123m',
  red: '\x1b[38;2;224;108;117m',
  magenta: '\x1b[38;2;198;120;221m',
  gray: '\x1b[38;2;92;99;112m',
  white: '\x1b[38;2;171;178;191m',
};

// ANSI color codes for light theme
const LIGHT_ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  blue: '\x1b[38;2;64;120;242m',
  cyan: '\x1b[38;2;1;132;188m',
  green: '\x1b[38;2;80;161;79m',
  yellow: '\x1b[38;2;193;132;1m',
  red: '\x1b[38;2;228;86;73m',
  magenta: '\x1b[38;2;166;38;164m',
  gray: '\x1b[38;2;105;108;119m',
  white: '\x1b[38;2;56;58;66m',
};

interface ViewSubdirectoryToolCallProps {
  directory_path: string;
  depth?: number;
  fileTypes?: string[];
  pattern?: string;
  includeStats?: boolean;
  includeGitStatus?: boolean;
  sortBy?: string;
  outputFormat?: string;
  toolCallState: ToolCallState;
  toolOutputContextItems: ContextItemWithId[];
}

/**
 * Parse summary content and convert to colorized ANSI output
 */
function colorizeSummary(summary: string, ANSI: typeof DARK_ANSI): string {
  if (!summary) return '';
  
  let result = summary;
  
  // Colorize headers (lines with ══)
  result = result.replace(/^(.*══+.*)$/gm, `${ANSI.cyan}$1${ANSI.reset}`);
  
  // Colorize section headers (lines starting with emoji)
  result = result.replace(/^(📁|📊|📂|💾|📏|🔢|📈|📋|📦|🕐|🔍|⚠️)(.*)$/gm, `${ANSI.yellow}$1${ANSI.reset}${ANSI.white}$2${ANSI.reset}`);
  
  // Colorize path after "Path:"
  result = result.replace(/(Path: )(.+)$/gm, `$1${ANSI.blue}$2${ANSI.reset}`);
  
  // Colorize numbers
  result = result.replace(/(\d+)(?= files| folders| directories| B| KB| MB| GB|%|\))/g, `${ANSI.green}$1${ANSI.reset}`);
  
  // Colorize file extensions
  result = result.replace(/(\.\w+):/g, `${ANSI.cyan}$1${ANSI.reset}:`);
  
  // Colorize bar charts
  result = result.replace(/(█+)/g, `${ANSI.green}$1${ANSI.reset}`);
  
  // Colorize percentages
  result = result.replace(/(\(\d+\.\d+%\))/g, `${ANSI.dim}$1${ANSI.reset}`);
  
  return result;
}

/**
 * Colorize tree structure with ANSI codes for file type highlighting
 */
function colorizeTreeStructure(content: string, ANSI: typeof DARK_ANSI): string {
  if (!content) return '';
  
  // If it already looks like a tree structure (has └── or ├──), use specific coloring
  if (content.includes('├──') || content.includes('└──')) {
    return content.split('\n').map(line => {
      // Colorize tree connectors
      let colored = line.replace(/(│|├|└|──|─)/g, `${ANSI.gray}$1${ANSI.reset}`);
      
      // Colorize directory names (ending with /)
      colored = colored.replace(/(\S+)\/$/, `${ANSI.blue}${ANSI.bold}$1/${ANSI.reset}`);
      
      // Colorize file types
      colored = colored.replace(/(\S+\.tsx?)(?=\s|$|\()/g, `${ANSI.cyan}$1${ANSI.reset}`);
      colored = colored.replace(/(\S+\.jsx?)(?=\s|$|\()/g, `${ANSI.yellow}$1${ANSI.reset}`);
      colored = colored.replace(/(\S+\.py)(?=\s|$|\()/g, `${ANSI.green}$1${ANSI.reset}`);
      colored = colored.replace(/(\S+\.rs)(?=\s|$|\()/g, `${ANSI.red}$1${ANSI.reset}`);
      colored = colored.replace(/(\S+\.json)(?=\s|$|\()/g, `${ANSI.green}$1${ANSI.reset}`);
      colored = colored.replace(/(\S+\.md)(?=\s|$|\()/g, `${ANSI.white}$1${ANSI.reset}`);
      colored = colored.replace(/(\S+\.css|\.scss|\.sass)(?=\s|$|\()/g, `${ANSI.magenta}$1${ANSI.reset}`);
      colored = colored.replace(/(\S+\.html?)(?=\s|$|\()/g, `${ANSI.red}$1${ANSI.reset}`);
      
      // Colorize stats in parentheses
      colored = colored.replace(/(\([^)]+\))$/g, `${ANSI.dim}$1${ANSI.reset}`);
      
      // Colorize git status indicators
      colored = colored.replace(/\[M\]/g, `${ANSI.yellow}[M]${ANSI.reset}`);
      colored = colored.replace(/\[A\]/g, `${ANSI.green}[A]${ANSI.reset}`);
      colored = colored.replace(/\[D\]/g, `${ANSI.red}[D]${ANSI.reset}`);
      colored = colored.replace(/\[\?\]/g, `${ANSI.gray}[?]${ANSI.reset}`);
      
      return colored;
    }).join('\n');
  }
  
  // For flat file lists without tree structure
  return repoMapToTreeColorized(content).colorized;
}

export function ViewSubdirectory(props: ViewSubdirectoryToolCallProps) {
  const { t } = useTranslation();
  const terminalRef = useRef<HTMLDivElement>(null);
  const summaryTerminalRef = useRef<HTMLDivElement>(null);
  const terminalInstanceRef = useRef<Terminal | null>(null);
  const summaryTerminalInstanceRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const summaryFitAddonRef = useRef<FitAddon | null>(null);
  const [isExpanded, setIsExpanded] = useState(true);
  const [activeTab, setActiveTab] = useState<'structure' | 'summary'>('structure');
  const [isLight, setIsLight] = useState(() => isLightTheme());

  // Listen for theme changes
  useEffect(() => {
    const checkTheme = () => {
      setIsLight(isLightTheme());
    };
    
    // Check on mount
    checkTheme();
    
    // Create observer for theme changes
    const observer = new MutationObserver(() => {
      checkTheme();
    });
    
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'class']
    });
    
    // Also listen to window for theme change events
    window.addEventListener('focus', checkTheme);
    
    return () => {
      observer.disconnect();
      window.removeEventListener('focus', checkTheme);
    };
  }, []);

  // Get theme-appropriate values
  const terminalTheme = isLight ? LIGHT_TERMINAL_THEME : DARK_TERMINAL_THEME;
  const ANSI = isLight ? LIGHT_ANSI : DARK_ANSI;
  
  // Theme colors for UI elements
  const themeColors = useMemo(() => ({
    background: isLight ? '#ffffff' : '#282c34',
    backgroundGradientStart: isLight ? '#f8f9fa' : '#2c313a',
    backgroundGradientEnd: isLight ? '#ffffff' : '#282c34',
    border: isLight ? '#e1e4e8' : '#3e4451',
    foreground: isLight ? '#383a42' : '#abb2bf',
    foregroundMuted: isLight ? '#6a737d' : '#5c6370',
    accent: isLight ? '#4078f2' : '#61afef',
  }), [isLight]);

  const directoryPath = props.directory_path ?? "";
  
  // Extract summary and structure from context items
  const summaryContent = props.toolOutputContextItems
    .find(item => item.name?.includes("Summary") || item.description?.includes("Analysis"))
    ?.content || "";
    
  const structureContent = props.toolOutputContextItems
    .find(item => item.name?.includes("Structure") || item.description?.includes("Structure"))
    ?.content || "";
    
  const noticeContent = props.toolOutputContextItems
    .find(item => item.name?.includes("Notice"))
    ?.content || "";

  // Check if we have the enhanced output format
  const hasEnhancedOutput = summaryContent.includes("Directory Analysis Summary") || 
                            structureContent.includes("├──") || 
                            structureContent.includes("└──");

  // For backward compatibility with old repo map format
  const rawDirectoryOutput = hasEnhancedOutput ? structureContent : 
    (props.toolOutputContextItems
      .find(item => item.description?.includes("directory") || item.name?.includes("directory") || item.description?.includes("Structure"))
      ?.content || "");

  // Colorize tree structure
  const treeStructure = useMemo(() => {
    if (!rawDirectoryOutput) {
      return { plain: t('retrievingDirStructure'), colorized: `${ANSI.gray}${t('retrievingDirStructure')}${ANSI.reset}` };
    }
    
    if (hasEnhancedOutput) {
      // Already in tree format from enhanced tool
      return {
        plain: rawDirectoryOutput,
        colorized: colorizeTreeStructure(rawDirectoryOutput, ANSI)
      };
    }
    
    // Legacy: convert repo map to tree
    return repoMapToTreeColorized(rawDirectoryOutput);
  }, [rawDirectoryOutput, hasEnhancedOutput, ANSI]);

  // Colorize summary
  const colorizedSummary = useMemo(() => {
    if (!summaryContent) return '';
    return colorizeSummary(summaryContent, ANSI);
  }, [summaryContent, ANSI]);

  // Extract stats from summary or count from tree
  const stats = useMemo(() => {
    // Try to parse from summary first
    const fileMatch = summaryContent.match(/Total Files:\s*(\d+)/);
    const dirMatch = summaryContent.match(/Total Directories:\s*(\d+)/);
    const sizeMatch = summaryContent.match(/Total Size:\s*([\d.]+\s*[BKMG]B?)/);
    
    if (fileMatch || dirMatch) {
      return {
        files: fileMatch ? parseInt(fileMatch[1]) : 0,
        folders: dirMatch ? parseInt(dirMatch[1]) : 0,
        total: (fileMatch ? parseInt(fileMatch[1]) : 0) + (dirMatch ? parseInt(dirMatch[1]) : 0),
        size: sizeMatch ? sizeMatch[1] : undefined
      };
    }
    
    // Fallback: count from tree
    const lines = treeStructure.plain.split('\n').filter(l => l.trim());
    const folders = lines.filter(l => l.endsWith('/')).length;
    const files = lines.length - folders;
    return { files, folders, total: lines.length };
  }, [summaryContent, treeStructure.plain]);

  // Initialize main terminal (for structure)
  useEffect(() => {
    if (!terminalRef.current || !isExpanded || activeTab !== 'structure') return;

    let terminal: Terminal | null = null;
    let fitAddon: FitAddon | null = null;

    try {
      terminal = new Terminal({
        theme: terminalTheme,
        fontSize: 12,
        fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", "Monaco", "Menlo", "Ubuntu Mono", monospace',
        fontWeight: '400',
        letterSpacing: 0,
        lineHeight: 1.4,
        cursorBlink: false,
        cursorStyle: 'block',
        allowProposedApi: true,
        convertEol: true,
        scrollback: 5000,
        smoothScrollDuration: 100,
        rows: 18,
      });

      fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(terminalRef.current);
      
      setTimeout(() => {
        try {
          fitAddon?.fit();
        } catch (e) {
          console.warn('Failed to fit terminal:', e);
        }
      }, 50);

      terminalInstanceRef.current = terminal;
      fitAddonRef.current = fitAddon;

      // Write colorized content
      if (treeStructure.colorized && terminal) {
        const lines = treeStructure.colorized.split('\n');
        lines.forEach((line, index) => {
          if (index === lines.length - 1 && line === '') return;
          try {
            terminal?.writeln(line);
          } catch (e) {
            console.warn('Failed to write line to terminal:', e);
          }
        });
      }
    } catch (error) {
      console.error('Failed to initialize terminal:', error);
      return;
    }

    const handleResize = () => {
      try {
        fitAddonRef.current?.fit();
      } catch (e) {
        console.warn('Failed to resize terminal:', e);
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      try {
        terminal?.dispose();
      } catch (e) {
        console.warn('Error disposing terminal:', e);
      }
      terminalInstanceRef.current = null;
      fitAddonRef.current = null;
    };
  }, [treeStructure.colorized, isExpanded, activeTab, terminalTheme]);

  // Initialize summary terminal
  useEffect(() => {
    if (!summaryTerminalRef.current || !isExpanded || activeTab !== 'summary' || !colorizedSummary) return;

    let terminal: Terminal | null = null;
    let fitAddon: FitAddon | null = null;

    try {
      terminal = new Terminal({
        theme: terminalTheme,
        fontSize: 12,
        fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", "Monaco", "Menlo", "Ubuntu Mono", monospace',
        fontWeight: '400',
        letterSpacing: 0,
        lineHeight: 1.4,
        cursorBlink: false,
        cursorStyle: 'block',
        allowProposedApi: true,
        convertEol: true,
        scrollback: 5000,
        smoothScrollDuration: 100,
        rows: 18,
      });

      fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(summaryTerminalRef.current);
      
      setTimeout(() => {
        try {
          fitAddon?.fit();
        } catch (e) {
          console.warn('Failed to fit summary terminal:', e);
        }
      }, 50);

      summaryTerminalInstanceRef.current = terminal;
      summaryFitAddonRef.current = fitAddon;

      // Write colorized summary
      if (colorizedSummary && terminal) {
        const lines = colorizedSummary.split('\n');
        lines.forEach((line, index) => {
          if (index === lines.length - 1 && line === '') return;
          try {
            terminal?.writeln(line);
          } catch (e) {
            console.warn('Failed to write line to summary terminal:', e);
          }
        });
      }
    } catch (error) {
      console.error('Failed to initialize summary terminal:', error);
      return;
    }

    const handleResize = () => {
      try {
        summaryFitAddonRef.current?.fit();
      } catch (e) {
        console.warn('Failed to resize summary terminal:', e);
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      try {
        terminal?.dispose();
      } catch (e) {
        console.warn('Error disposing summary terminal:', e);
      }
      summaryTerminalInstanceRef.current = null;
      summaryFitAddonRef.current = null;
    };
  }, [colorizedSummary, isExpanded, activeTab, terminalTheme]);

  // Get short directory name for display
  const shortDirName = directoryPath ? directoryPath.split('/').filter(Boolean).pop() || '/' : '/';

  // Build filter badges
  const filterBadges = useMemo(() => {
    const badges: string[] = [];
    if (props.fileTypes?.length) {
      badges.push(props.fileTypes.join(', '));
    }
    if (props.pattern) {
      badges.push(props.pattern);
    }
    if (props.depth !== undefined && props.depth !== -1) {
      badges.push(`depth: ${props.depth}`);
    }
    if (props.includeStats) {
      badges.push('stats');
    }
    if (props.includeGitStatus) {
      badges.push('git');
    }
    return badges;
  }, [props.fileTypes, props.pattern, props.depth, props.includeStats, props.includeGitStatus]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-row items-center gap-2 px-1">
        <FolderIcon />
        <span className="text-sm font-medium text-knoxcyan">{t('viewSubdirectory')}</span>
        {filterBadges.length > 0 && (
          <div className="flex gap-1">
            {filterBadges.map((badge, i) => (
              <span 
                key={i} 
                className="text-[10px] px-1.5 py-0.5 rounded"
                style={{
                  backgroundColor: themeColors.border,
                  color: themeColors.foreground,
                }}
              >
                {badge}
              </span>
            ))}
          </div>
        )}
      </div>
      <div
        className={cn(
          "rounded-md overflow-hidden",
          "shadow-lg"
        )}
        style={{
          backgroundColor: themeColors.background,
          border: `1px solid ${themeColors.border}`,
        }}
      >
        {/* Header with gradient background */}
        <div 
          className="p-1 px-1.5 flex items-center justify-between"
          style={{
            background: `linear-gradient(135deg, ${themeColors.backgroundGradientStart} 0%, ${themeColors.backgroundGradientEnd} 100%)`,
            borderBottom: `1px solid ${themeColors.border}`,
          }}
        >
          <div className="flex items-center gap-3 min-w-0 flex-1 overflow-hidden">
            <div 
              className="flex items-center gap-2 overflow-x-auto scrollbar-header flex-1 min-w-0 py-0.5"
            >
              <span 
                className="text-xs font-semibold whitespace-nowrap shrink-0"
                style={{ color: themeColors.accent }}
              >
                {shortDirName}
              </span>
              <code 
                className="text-[10px] font-mono whitespace-nowrap shrink-0 max-w-50 truncate"
                style={{ color: themeColors.foregroundMuted }}
              >
                {directoryPath || "/"}
              </code>
              <span 
                className="text-[10px] whitespace-nowrap shrink-0"
                style={{ color: themeColors.foregroundMuted }}
              >
                {stats.total > 0 ? `• ${t('foldersFolders', { folders: stats.folders, files: stats.files })}` : ''}
                {stats.size ? ` • ${stats.size}` : ''}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Tab buttons for summary/structure */}
            {summaryContent && (
              <div 
                className="flex rounded-md overflow-hidden"
                style={{ border: `1px solid ${themeColors.border}` }}
              >
                <button
                  onClick={() => setActiveTab('structure')}
                  className="text-[10px] px-2 py-1 transition-colors"
                  style={{
                    backgroundColor: activeTab === 'structure' ? themeColors.border : 'transparent',
                    color: activeTab === 'structure' ? themeColors.foreground : themeColors.foregroundMuted,
                  }}
                >
                  {t('structureTab')}
                </button>
                <button
                  onClick={() => setActiveTab('summary')}
                  className="text-[10px] px-2 py-1 transition-colors"
                  style={{
                    backgroundColor: activeTab === 'summary' ? themeColors.border : 'transparent',
                    color: activeTab === 'summary' ? themeColors.foreground : themeColors.foregroundMuted,
                  }}
                >
                  {t('summaryTab')}
                </button>
              </div>
            )}
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="transition-colors p-1 rounded"
              style={{ 
                color: themeColors.foregroundMuted,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = themeColors.foreground;
                e.currentTarget.style.backgroundColor = themeColors.border;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = themeColors.foregroundMuted;
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              <svg 
                width="14" 
                height="14" 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke="currentColor" 
                strokeWidth="2"
                className={cn("transition-transform", isExpanded ? "" : "rotate-180")}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          </div>
        </div>
        
        {/* Terminal content */}
        {isExpanded && (
          <div 
            className="relative overflow-hidden"
            style={{ 
              height: '350px',
              backgroundColor: themeColors.background,
            }}
          >
            {/* Structure tab */}
            <div 
              ref={terminalRef}
              style={{
                position: 'absolute',
                top: '8px',
                left: '12px',
                right: '0',
                bottom: '8px',
                display: activeTab === 'structure' ? 'block' : 'none',
              }}
            />
            {/* Summary tab */}
            {summaryContent && (
              <div 
                ref={summaryTerminalRef}
                style={{
                  position: 'absolute',
                  top: '8px',
                  left: '12px',
                  right: '0',
                  bottom: '8px',
                  display: activeTab === 'summary' ? 'block' : 'none',
                }}
              />
            )}
          </div>
        )}
        
        {/* Notice/Warning footer */}
        {noticeContent && isExpanded && (
          <div 
            className="px-4 py-2 text-[11px]"
            style={{ 
              background: isLight ? 'rgba(193, 132, 1, 0.1)' : 'rgba(229, 192, 123, 0.1)',
              borderTop: `1px solid ${themeColors.border}`,
              color: isLight ? '#c18401' : '#e5c07b',
            }}
          >
            {noticeContent}
          </div>
        )}
      </div>
    </div>
  );
}