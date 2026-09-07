import { ContextItemWithId, ToolCallState } from "core";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { TreeIcon } from "../../../svg-icons";
import { repoMapToTreeColorized } from "../../../util/repoMapToTree";
import { useMemo, useState, useEffect, useRef } from "react";
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

interface ViewRepoMapToolCallProps {
  toolCallState: ToolCallState;
  toolOutputContextItems: ContextItemWithId[];
}

export function ViewRepoMap(props: ViewRepoMapToolCallProps) {
  const { t } = useTranslation();
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstanceRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [isExpanded, setIsExpanded] = useState(true);
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

  // Extract repo structure from context items
  const rawRepoStructure = props.toolOutputContextItems
    .find(item => item.description?.includes("repo") || item.name?.includes("repo") || item.description?.includes("structure"))
    ?.content || "";

  // Convert flat file list to colorized tree structure with ANSI codes
  const treeStructure = useMemo(() => {
    if (!rawRepoStructure) {
      return { plain: t('retrievingRepoStructure'), colorized: `\x1b[90m${t('retrievingRepoStructure')}\x1b[0m` };
    }
    return repoMapToTreeColorized(rawRepoStructure);
  }, [rawRepoStructure]);

  // Count files and folders
  const stats = useMemo(() => {
    const lines = treeStructure.plain.split('\n').filter(l => l.trim());
    const folders = lines.filter(l => l.endsWith('/') || (!l.includes('.') && !l.includes('└') && !l.includes('├'))).length;
    const files = lines.length - folders;
    return { files, folders, total: lines.length };
  }, [treeStructure.plain]);

  useEffect(() => {
    if (!terminalRef.current || !isExpanded) return;

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
        rows: 15, // Fixed rows to fill the 300px height properly
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

      // Write colorized content with ANSI codes
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
  }, [treeStructure.colorized, isExpanded, terminalTheme]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-row items-center gap-2 px-1">
        <TreeIcon />
        <span className="text-sm font-medium text-knoxcyan">{t('viewRepoStructure')}</span>
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
          className="px-3 py-1.5 flex items-center justify-between"
          style={{
            background: `linear-gradient(135deg, ${themeColors.backgroundGradientStart} 0%, ${themeColors.backgroundGradientEnd} 100%)`,
            borderBottom: `1px solid ${themeColors.border}`,
          }}
        >
          <div className="flex items-center gap-3 min-w-0 flex-1 overflow-hidden">
            <div className="flex items-center gap-2 overflow-x-auto scrollbar-header flex-1 min-w-0 py-0.5">
              <span 
                className="text-xs font-semibold whitespace-nowrap shrink-0"
                style={{ color: themeColors.foreground }}
              >
                {t('repositoryStructure')}
              </span>
              <span 
                className="text-[10px] whitespace-nowrap shrink-0"
                style={{ color: themeColors.foregroundMuted }}
              >
                {stats.total > 0 ? `• ${t('foldersFolders', { folders: stats.folders, files: stats.files })}` : `• ${t('browsingEntireRepo')}`}
              </span>
            </div>
          </div>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="transition-colors p-1 rounded shrink-0"
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
        
        {/* Terminal content */}
        {isExpanded && (
          <div 
            className="relative overflow-hidden"
            style={{ 
              height: '300px',
              backgroundColor: themeColors.background,
            }}
          >
            <div 
              ref={terminalRef}
              style={{
                position: 'absolute',
                top: '8px',
                left: '12px',
                right: '0',
                bottom: '8px',
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

