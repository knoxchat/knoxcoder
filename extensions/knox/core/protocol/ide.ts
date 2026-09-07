import type {
  DiffLine,
  FileStatsMap,
  FileType,
  IDE,
  IdeInfo,
  IdeSettings,
  IndexTag,
  Location,
  LspCallHierarchyCall,
  LspCallHierarchyItem,
  LspSymbol,
  Problem,
  Range,
  RangeInFile,
  TerminalOptions,
  Thread,
  DebugControlRequest,
  DebugControlResult,
} from "../";

export type SearchOutputMode = "content" | "files_with_matches" | "count";

/**
 * Options for ripgrep 15.2.0-based search
 */
export interface SearchOptions {
  query: string;
  /** Directory or file to search, relative to a workspace root. */
  path?: string;
  fileType?: string;
  fileGlob?: string;
  /** Exclude glob. A leading `!` is added when missing. */
  excludeGlob?: string;
  contextLines?: number;
  beforeContext?: number;
  afterContext?: number;
  maxResults?: number;
  /** Skip this many matches before applying maxResults (pagination). */
  offset?: number;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  multiline?: boolean;
  hidden?: boolean;
  follow?: boolean;
  fixedStrings?: boolean;
  /** Use PCRE2 (`-P`). Requires the bundled +pcre2 build. */
  pcre2?: boolean;
  outputMode?: SearchOutputMode;
  maxFilesize?: string;
  maxColumns?: number;
}

export type ToIdeFromWebviewOrCoreProtocol = {
  // Methods from IDE type
  getIdeInfo: [undefined, IdeInfo];
  getWorkspaceDirs: [undefined, string[]];
  writeFile: [{ path: string; contents: string }, void];
  showVirtualFile: [{ name: string; content: string }, void];
  openFile: [{ path: string }, void];
  openGitChange: [{ uri: string }, void];
  openUrl: [string, void];
  runCommand: [{ command: string; options?: TerminalOptions }, void];
  getSearchResults: [{ query: string; options?: SearchOptions }, string];
  subprocess: [{ command: string; cwd?: string }, [string, string]];
  saveFile: [{ filepath: string }, void];
  fileExists: [{ filepath: string }, boolean];
  readFile: [{ filepath: string }, string];
  diffLine: [
    {
      diffLine: DiffLine;
      filepath: string;
      startLine: number;
      endLine: number;
    },
    void,
  ];
  getProblems: [{ filepath: string }, Problem[]];
  getOpenFiles: [undefined, string[]];
  getCurrentFile: [
    undefined,
    (
      | undefined
      | {
          isUntitled: boolean;
          path: string;
          contents: string;
        }
    ),
  ];
  getPinnedFiles: [undefined, string[]];
  showLines: [{ filepath: string; startLine: number; endLine: number }, void];
  readRangeInFile: [{ filepath: string; range: Range }, string];
  getDiff: [{ includeUnstaged: boolean }, string[]];
  getGitChangedFiles: [
    undefined,
    Array<{
      filepath: string;
      uri: string;
      status: "modified" | "added" | "deleted" | "renamed" | "untracked";
      staged: boolean;
      additions?: number;
      deletions?: number;
      isBinary?: boolean;
    }>,
  ];
  getTerminalContents: [undefined, string];
  getDebugLocals: [{ threadIndex: number }, string];
  getTopLevelCallStackSources: [
    { threadIndex: number; stackDepth: number },
    string[],
  ];
  getAvailableThreads: [undefined, Thread[]];
  debugControl: [DebugControlRequest, DebugControlResult];
  getUniqueId: [undefined, string];
  getTags: [string, IndexTag[]];
  readSecrets: [{ keys: string[] }, Record<string, string>];
  writeSecrets: [{ secrets: Record<string, string> }, void];
  // end methods from IDE type

  getIdeSettings: [undefined, IdeSettings];

  // Git
  getBranch: [{ dir: string }, string];
  getRepoName: [{ dir: string }, string | undefined];

  showToast: [
    Parameters<IDE["showToast"]>,
    Awaited<ReturnType<IDE["showToast"]>>,
  ];
  getGitRootPath: [{ dir: string }, string | undefined];
  listDir: [{ dir: string }, [string, FileType][]];
  getFileStats: [{ files: string[] }, FileStatsMap];

  gotoDefinition: [{ location: Location }, RangeInFile[]];
  findReferences: [{ location: Location }, RangeInFile[]];
  getHover: [{ location: Location }, string | null];
  getDocumentSymbols: [{ filepath: string }, LspSymbol[]];
  getWorkspaceSymbols: [{ query: string }, LspSymbol[]];
  gotoImplementation: [{ location: Location }, RangeInFile[]];
  prepareCallHierarchy: [{ location: Location }, LspCallHierarchyItem[]];
  getIncomingCalls: [{ location: Location }, LspCallHierarchyCall[]];
  getOutgoingCalls: [{ location: Location }, LspCallHierarchyCall[]];

};

export type ToWebviewOrCoreFromIdeProtocol = {
  didChangeActiveTextEditor: [{ filepath: string }, void];
  didChangeIdeSettings: [{ settings: IdeSettings }, void];
};
