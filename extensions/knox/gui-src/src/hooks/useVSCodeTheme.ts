import { useState, useEffect, useMemo } from "react";

/**
 * Helper to detect if the current VS Code theme is light or dark
 * by checking the luminance of the editor background color
 */
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

export interface ThemeColors {
  isLight: boolean;
  background: string;
  headerBackground: string;
  border: string;
  foreground: string;
  foregroundMuted: string;
  accent: string;
  accentForeground: string;
  success: string;
  warning: string;
  error: string;
}

/**
 * Hook to detect and react to VS Code theme changes
 * Returns the current light/dark theme state and theme-appropriate colors
 */
export function useVSCodeTheme(): ThemeColors {
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

  // Return theme-appropriate colors
  return useMemo(() => ({
    isLight,
    background: isLight ? '#ffffff' : '#1e1e1e',
    headerBackground: isLight ? '#f3f3f3' : '#252526',
    border: isLight ? '#e5e5e5' : '#3c3c3c',
    foreground: isLight ? '#383a42' : '#cccccc',
    foregroundMuted: isLight ? '#6a737d' : '#858585',
    accent: isLight ? '#0f7a76' : '#159994',
    accentForeground: '#ffffff',
    success: isLight ? '#22863a' : '#27c93f',
    warning: isLight ? '#b08800' : '#ffbd2e',
    error: isLight ? '#cb2431' : '#ff5f56',
  }), [isLight]);
}

// Dark theme for xterm (VS Code Dark+ inspired)
export const DARK_TERMINAL_THEME = {
  background: '#1e1e1e',
  foreground: '#cccccc',
  cursor: '#aeafad',
  cursorAccent: '#1e1e1e',
  selectionBackground: '#264f78',
  selectionForeground: '#ffffff',
  selectionInactiveBackground: '#3a3d41',
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#e5e5e5',
};

// Light theme for xterm (VS Code Light+ inspired)
export const LIGHT_TERMINAL_THEME = {
  background: '#ffffff',
  foreground: '#383a42',
  cursor: '#526fff',
  cursorAccent: '#ffffff',
  selectionBackground: '#add6ff',
  selectionForeground: '#383a42',
  selectionInactiveBackground: '#e5ebf1',
  black: '#000000',
  red: '#cd3131',
  green: '#00bc00',
  yellow: '#949800',
  blue: '#0451a5',
  magenta: '#bc05bc',
  cyan: '#0598bc',
  white: '#555555',
  brightBlack: '#666666',
  brightRed: '#cd3131',
  brightGreen: '#14ce14',
  brightYellow: '#b5ba00',
  brightBlue: '#0451a5',
  brightMagenta: '#bc05bc',
  brightCyan: '#0598bc',
  brightWhite: '#a5a5a5',
};

// ANSI color codes for dark theme - for command prompt styling
export const DARK_ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[38;2;13;188;121m',
  blue: '\x1b[38;2;36;114;200m',
  cyan: '\x1b[38;2;17;168;205m',
  yellow: '\x1b[38;2;229;229;16m',
  red: '\x1b[38;2;205;49;49m',
  magenta: '\x1b[38;2;188;63;188m',
  gray: '\x1b[38;2;102;102;102m',
  white: '\x1b[38;2;204;204;204m',
};

// ANSI color codes for light theme
export const LIGHT_ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[38;2;0;188;0m',
  blue: '\x1b[38;2;4;81;165m',
  cyan: '\x1b[38;2;5;152;188m',
  yellow: '\x1b[38;2;148;152;0m',
  red: '\x1b[38;2;205;49;49m',
  magenta: '\x1b[38;2;188;5;188m',
  gray: '\x1b[38;2;102;102;102m',
  white: '\x1b[38;2;56;58;66m',
};

/**
 * Get the appropriate terminal theme based on current VS Code theme
 */
export function useTerminalTheme() {
  const { isLight } = useVSCodeTheme();
  
  return useMemo(() => ({
    theme: isLight ? LIGHT_TERMINAL_THEME : DARK_TERMINAL_THEME,
    ansi: isLight ? LIGHT_ANSI : DARK_ANSI,
  }), [isLight]);
}
