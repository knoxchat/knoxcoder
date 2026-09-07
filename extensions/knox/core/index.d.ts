import { DataDestination, ModelRole } from "knoxdev-package/config-yaml";
import Parser from "web-tree-sitter";
declare global {
  interface Window {
    ide?: "vscode";
    windowId: string;
    serverUrl: string;
    vscMachineId: string;
    vscMediaUrl: string;
    fullColorTheme?: {
      rules?: {
        token?: string;
        foreground?: string;
      }[];
    };
    colorThemeName?: string;
    workspacePaths?: string[];
  }
}

export type PromptTemplateFunction = (
  history: ChatMessage[],
  otherData: Record<string, string>,
) => string | ChatMessage[];

export type PromptTemplate = string | PromptTemplateFunction;

export interface ILLM extends LLMOptions {
  get providerName(): string;

  uniqueId: string;
  model: string;

  title?: string;
  systemMessage?: string;
  contextLength: number;
  maxStopWords?: number;
  completionOptions: CompletionOptions;
  requestOptions?: RequestOptions;
  promptTemplates?: Record<string, PromptTemplate>;
  templateMessages?: (messages: ChatMessage[]) => string;
  writeLog?: (str: string) => Promise<void>;
  llmRequestHook?: (model: string, prompt: string) => any;
  apiKey?: string;
  apiBase?: string;
  cacheBehavior?: CacheBehavior;
  capabilities?: ModelCapability;
  supportedParameters?: string[];
  inputModalities?: string[];
  outputModalities?: string[];
  roles?: ModelRole[];

  deployment?: string;
  apiVersion?: string;
  apiType?: string;
  region?: string;
  projectId?: string;

  complete(
    prompt: string,
    signal: AbortSignal,
    options?: LLMFullCompletionOptions,
  ): Promise<string>;

  streamComplete(
    prompt: string,
    signal: AbortSignal,
    options?: LLMFullCompletionOptions,
  ): AsyncGenerator<string, PromptLog>;

  streamChat(
    messages: ChatMessage[],
    signal: AbortSignal,
    options?: LLMFullCompletionOptions,
  ): AsyncGenerator<ChatMessage, PromptLog>;

  chat(
    messages: ChatMessage[],
    signal: AbortSignal,
    options?: LLMFullCompletionOptions,
  ): Promise<ChatMessage>;

  countTokens(text: string): number;

  supportsImages(): boolean;

  supportsCompletions(): boolean;

  supportsPrefill(): boolean;

  listModels(): Promise<string[]>;

  renderPromptTemplate(
    template: PromptTemplate,
    history: ChatMessage[],
    otherData: Record<string, string>,
    canPutWordsInModelsMouth?: boolean,
  ): string | ChatMessage[];
}

export interface ModelInstaller {
  installModel(
    modelName: string,
    signal: AbortSignal,
    progressReporter?: (task: string, increment: number, total: number) => void,
  ): Promise<any>;
}

export type ContextProviderType = "normal" | "query" | "submenu";

/** core = built-in; integration = key-gated / opt-in only */
export type ContextProviderCategory = "core" | "integration";

export interface ContextProviderDescription {
  title: ContextProviderName;
  displayTitle: string;
  description: string;
  renderInlineAs?: string;
  type: ContextProviderType;
  /** When omitted, inferred from the provider registry. */
  category?: ContextProviderCategory;
}

export type FetchFunction = (url: string | URL, init?: any) => Promise<any>;

export interface ContextProviderExtras {
  config: KnoxConfig;
  fullInput: string;
  llm: ILLM;
  ide: IDE;
  selectedCode: RangeInFile[];
  fetch: FetchFunction;
}

export interface LoadSubmenuItemsArgs {
  config: KnoxConfig;
  ide: IDE;
  fetch: FetchFunction;
}

export interface CustomContextProvider {
  title: string;
  displayTitle?: string;
  description?: string;
  renderInlineAs?: string;
  type?: ContextProviderType;

  getContextItems(
    query: string,
    extras: ContextProviderExtras,
  ): Promise<ContextItem[]>;

  loadSubmenuItems?: (
    args: LoadSubmenuItemsArgs,
  ) => Promise<ContextSubmenuItem[]>;
}

export interface ContextSubmenuItem {
  id: string;
  title: string;
  description: string;
  icon?: string;
  metadata?: any;
}

export interface ContextSubmenuItemWithProvider extends ContextSubmenuItem {
  providerTitle: string;
}

export interface IContextProvider {
  get description(): ContextProviderDescription;

  getContextItems(
    query: string,
    extras: ContextProviderExtras,
  ): Promise<ContextItem[]>;

  loadSubmenuItems(args: LoadSubmenuItemsArgs): Promise<ContextSubmenuItem[]>;
}

export interface Chunk {
  filepath: string;
  startLine: number;
  endLine: number;
  digest: string;
  index: number;
  content: string;
}

export interface IndexTag {
  artifactId: string;
  branch: string;
  directory: string;
}

export interface Checkpoint {
  /** Prior file contents; null means the file did not exist (undo deletes it). */
  [filepath: string]: string | null;
}

export interface Session {
  sessionId: string;
  title: string;
  workspaceDirectory: string;
  history: ChatHistoryItem[];
}

export interface SessionMetadata {
  sessionId: string;
  title: string;
  dateCreated: string;
  workspaceDirectory: string;
}

export interface RangeInFile {
  filepath: string;
  range: Range;
}

export interface Location {
  filepath: string;
  position: Position;
}

export interface FileWithContents {
  filepath: string;
  contents: string;
}

export interface Range {
  start: Position;
  end: Position;
}

export interface Position {
  line: number;
  character: number;
}

export interface FileEdit {
  filepath: string;
  range: Range;
  replacement: string;
}

export interface LspSymbol {
  name: string;
  kind: number;
  detail?: string;
  filepath?: string;
  range?: Range;
  selectionRange?: Range;
  children?: LspSymbol[];
}

export interface LspCallHierarchyItem {
  name: string;
  kind: number;
  detail?: string;
  filepath: string;
  range: Range;
  selectionRange: Range;
}

export interface LspCallHierarchyCall {
  from?: LspCallHierarchyItem;
  to?: LspCallHierarchyItem;
  fromRanges: Range[];
}

export interface KnoxError {
  title: string;
  message: string;
}

export interface CompletionOptions extends BaseCompletionOptions {
  model: string;
}

export type ChatMessageRole =
  | "user"
  | "assistant"
  | "thinking"
  | "system"
  | "tool";

export type TextMessagePart = {
  type: "text";
  text: string;
};

export type ImageMessagePart = {
  type: "imageUrl";
  imageUrl: { url: string };
};

export type MessagePart = TextMessagePart | ImageMessagePart;

export type MessageContent = string | MessagePart[];

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolCallDelta {
  id?: string;
  type?: "function";
  /** OpenAI parallel tool-call index (0-based). */
  index?: number;
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface ToolResultChatMessage {
  role: "tool";
  content: string;
  toolCallId: string;
}

export interface UserChatMessage {
  role: "user";
  content: MessageContent;
}

export interface ThinkingChatMessage {
  role: "thinking";
  content: MessageContent;
  signature?: string;
  redactedThinking?: string;
  toolCalls?: ToolCallDelta[];
}

export interface KnoxMsTask {
  taskId: string;
  name: string;
  status: "pending" | "running" | "completed" | "failed";
  type?: "coding" | "analysis" | "research" | "general";
  model?: string;
  difficulty?: "easy" | "medium" | "hard";
  tokensUsed?: number;
  executionTimeMs?: number;
  resultPreview?: string;
  attempt?: number;
  maxAttempts?: number;
  dependsOn?: string[];
  priority?: number;
}

export interface KnoxMsMeta {
  sessionId?: string;
  planId?: string;
  planDescription?: string;
  currentTask?: string;
  taskStatus?: string;
  tasksCompleted: number;
  tasksTotal: number;
  tasksFailed: number;
  totalModelCalls?: number;
  modelsUsed?: Record<string, number>;
  memoryMode?: string;
  memoryTokensSaved?: number;
  contextTokensUsed?: number;
  executionTimeMs?: number;
  memoryRetrievalResults?: number;
  summaryUpdated?: boolean;
  tasks?: KnoxMsTask[];
  /** Goal confidence level (0.0-1.0) from autonomous execution */
  goalConfidence?: number;
  /** Current iteration in the autonomous execution loop */
  currentIteration?: number;
  /** Maximum iterations configured */
  maxIterations?: number;
  /** Whether knowledge was extracted from this response */
  knowledgeExtracted?: boolean;
  /** Number of checkpoints created during execution */
  checkpointsCreated?: number;
}

export interface AssistantChatMessage {
  role: "assistant";
  content: MessageContent;
  toolCalls?: ToolCallDelta[];
  reasoning?: string;
  knoxMsMeta?: KnoxMsMeta;
}

export interface SystemChatMessage {
  role: "system";
  content: string;
}

export type ChatMessage =
  | UserChatMessage
  | AssistantChatMessage
  | ThinkingChatMessage
  | SystemChatMessage
  | ToolResultChatMessage;

export interface ContextItemId {
  providerTitle: string;
  itemId: string;
}

export type ContextItemUriTypes = "file" | "url";

export interface ContextItemUri {
  type: ContextItemUriTypes;
  value: string;
}

export interface ContextItem {
  content: string;
  name: string;
  description: string;
  editing?: boolean;
  editable?: boolean;
  icon?: string;
  uri?: ContextItemUri;
  hidden?: boolean;
}

export interface ContextItemWithId extends ContextItem {
  id: ContextItemId;
}

export interface InputModifiers {
  noContext: boolean;
}

export interface SymbolWithRange extends RangeInFile {
  name: string;
  type: Parser.SyntaxNode["type"];
  content: string;
}

export type FileSymbolMap = Record<string, SymbolWithRange[]>;

export interface PromptLog {
  modelTitle: string;
  completionOptions: CompletionOptions;
  prompt: string;
  completion: string;
}

export type MessageModes = "chat" | "edit" | "agent";

export type ToolStatus =
  | "generating"
  | "generated"
  | "calling"
  | "done"
  | "canceled";

// Will exist only on "assistant" messages with tool calls
interface ToolCallState {
  toolCallId: string;
  toolCall: ToolCall;
  status: ToolStatus;
  parsedArgs: any;
  output?: ContextItem[];
}

interface Reasoning {
  active: boolean;
  text: string;
  startAt: number;
  endAt?: number;
}

export interface ChatHistoryItem {
  message: ChatMessage;
  contextItems: ContextItemWithId[];
  editorState?: any;
  modifiers?: InputModifiers;
  promptLogs?: PromptLog[];
  toolCallState?: ToolCallState;
  /** All tool calls on this assistant turn (parallel reads). `toolCallState` is the primary/pending one. */
  toolCallStates?: ToolCallState[];
  isGatheringContext?: boolean;
  checkpoint?: Checkpoint;
  isBeforeCheckpoint?: boolean;
  reasoning?: Reasoning;
}

export interface LLMFullCompletionOptions extends BaseCompletionOptions {
  log?: boolean;
  model?: string;
}

export type ToastType = "info" | "error" | "warning";

export interface LLMOptions {
  model: string;

  title?: string;
  uniqueId?: string;
  systemMessage?: string;
  contextLength?: number;
  maxStopWords?: number;
  completionOptions?: CompletionOptions;
  requestOptions?: RequestOptions;
  template?: TemplateType;
  promptTemplates?: Record<string, PromptTemplate>;
  templateMessages?: (messages: ChatMessage[]) => string;
  writeLog?: (str: string) => Promise<void>;
  llmRequestHook?: (model: string, prompt: string) => any;
  apiKey?: string;

  // knoxProperties
  apiKeyLocation?: string;
  apiBase?: string;

  aiGatewaySlug?: string;
  cacheBehavior?: CacheBehavior;
  capabilities?: ModelCapability;
  supportedParameters?: string[];
  inputModalities?: string[];
  outputModalities?: string[];
  roles?: ModelRole[];

  useLegacyCompletionsEndpoint?: boolean;

  env?: Record<string, string | number | boolean>;
}

type RequireAtLeastOne<T, Keys extends keyof T = keyof T> = Pick<
  T,
  Exclude<keyof T, Keys>
> &
  {
    [K in Keys]-?: Required<Pick<T, K>> & Partial<Pick<T, Exclude<Keys, K>>>;
  }[Keys];

export interface CustomLLMWithOptionals {
  options: LLMOptions;
  streamCompletion?: (
    prompt: string,
    signal: AbortSignal,
    options: CompletionOptions,
    fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  ) => AsyncGenerator<string>;
  streamChat?: (
    messages: ChatMessage[],
    signal: AbortSignal,
    options: CompletionOptions,
    fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  ) => AsyncGenerator<ChatMessage | string>;
  listModels?: (
    fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  ) => Promise<string[]>;
}

/**
 * The LLM interface requires you to specify either `streamCompletion` or `streamChat` (or both).
 */
export type CustomLLM = RequireAtLeastOne<
  CustomLLMWithOptionals,
  "streamCompletion" | "streamChat"
>;

// IDE

export type DiffLineType = "new" | "old" | "same";

export interface DiffLine {
  type: DiffLineType;
  line: string;
}

export interface Problem {
  filepath: string;
  range: Range;
  message: string;
}

export interface Thread {
  name: string;
  id: number;
}

export type DebugControlOp =
  | "launch"
  | "attach"
  | "breakpoint"
  | "continue"
  | "step"
  | "backtrace"
  | "locals"
  | "evaluate"
  | "status"
  | "disconnect";

export interface DebugControlRequest {
  op: DebugControlOp;
  name?: string;
  program?: string;
  cwd?: string;
  args?: string[];
  target?: string;
  port?: number;
  filePath?: string;
  line?: number;
  enabled?: boolean;
  threadId?: number;
  frameId?: number;
  expression?: string;
  step?: "over" | "into" | "out";
}

export interface DebugStackFrame {
  id: number;
  name: string;
  file?: string;
  line?: number;
  column?: number;
}

export interface DebugControlResult {
  ok: boolean;
  content: string;
  sessionActive?: boolean;
  frames?: DebugStackFrame[];
}

export type IdeType = "vscode";

export interface IdeInfo {
  ideType: IdeType;
  name: string;
  version: string;
  remoteName: string;
  extensionVersion: string;
}

export interface BranchAndDir {
  branch: string;
  directory: string;
}

export enum FileType {
  Unkown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64,
}

/** IDE host settings (VS Code knoxchat.* overlay). */
export interface IdeSettings {
  agentProfile?: "default" | "systems" | "rust" | "auto";
  agentMaxSteps?: number;
  agentDoomLoopThreshold?: number;
  agentVerifyCommand?: string;
  agentVerifyMode?: "diagnostics" | "command" | "off";
  agentVerifyMaxIterations?: number;
}

export interface FileStats {
  size: number;
  lastModified: number;
}

/** Map of file name to stats */
export type FileStatsMap = {
  [path: string]: FileStats;
};

export interface IDE {
  getIdeInfo(): Promise<IdeInfo>;

  getIdeSettings(): Promise<IdeSettings>;

  getDiff(includeUnstaged: boolean): Promise<string[]>;

  getGitChangedFiles(): Promise<
    Array<{
      filepath: string;
      uri: string;
      status: "modified" | "added" | "deleted" | "renamed" | "untracked";
      staged: boolean;
      additions?: number;
      deletions?: number;
      isBinary?: boolean;
    }>
  >;

  getClipboardContent(): Promise<{ text: string; copiedAt: string }>;

  getUniqueId(): Promise<string>;

  getTerminalContents(): Promise<string>;

  getDebugLocals(threadIndex: number): Promise<string>;

  getTopLevelCallStackSources(
    threadIndex: number,
    stackDepth: number,
  ): Promise<string[]>;

  getAvailableThreads(): Promise<Thread[]>;

  /** DAP control for builtin_debug (HL-31). Optional on headless IDEs. */
  debugControl?(request: DebugControlRequest): Promise<DebugControlResult>;

  getWorkspaceDirs(): Promise<string[]>;

  fileExists(fileUri: string): Promise<boolean>;

  writeFile(path: string, contents: string): Promise<void>;

  /**
   * Optional: delete a file by URI/path. Used by ToolTransaction rollback
   * when undoing a create. VS Code + FileSystemIde implement this.
   */
  removeFile?(path: string): Promise<void>;

  showVirtualFile(title: string, contents: string): Promise<void>;

  openFile(path: string): Promise<void>;

  openUrl(url: string): Promise<void>;

  runCommand(command: string, options?: TerminalOptions): Promise<void>;

  saveFile(fileUri: string): Promise<void>;

  readFile(fileUri: string): Promise<string>;

  readRangeInFile(fileUri: string, range: Range): Promise<string>;

  showLines(fileUri: string, startLine: number, endLine: number): Promise<void>;

  getOpenFiles(): Promise<string[]>;

  getCurrentFile(): Promise<
    | undefined
    | {
        isUntitled: boolean;
        path: string;
        contents: string;
      }
  >;

  getLastFileSaveTimestamp?(): number;

  updateLastFileSaveTimestamp?(): void;

  getPinnedFiles(): Promise<string[]>;

  getSearchResults(query: string, options?: any): Promise<string>;

  subprocess(command: string, cwd?: string): Promise<[string, string]>;

  getProblems(fileUri?: string | undefined): Promise<Problem[]>;

  /**
   * Optional IDE hook: after a mutating tool writes files, run diagnostics
   * and auto-fix. Implemented by VS Code host; no-op on headless IDEs.
   * Returns context items describing verification results (may be empty).
   */
  runPostEditVerification?(params: {
    toolName: string;
    toolArguments: unknown;
    selectedModelTitle: string;
  }): Promise<ContextItem[]>;

  /**
   * Optional IDE hook: before a mutating tool runs, create a safety
   * checkpoint when enabled. Implemented by VS Code host; no-op elsewhere.
   */
  runPreRiskyCheckpoint?(params: {
    toolName: string;
    sessionId?: string;
    turnId?: string;
  }): Promise<{ checkpointId?: string } | void>;

  /**
   * Optional IDE hook: create one workspace checkpoint for the first
   * mutating tool of a chat turn (not gated by auto-CP interval).
   */
  ensureTurnCheckpoint?(params: {
    sessionId: string;
    turnId: string;
    toolName: string;
  }): Promise<string | undefined>;

  listWorkspaceCheckpoints?(limit?: number): Promise<
    Array<{
      id: string;
      description: string;
      created: string;
      sessionId?: string;
      fileCount?: number;
    }>
  >;

  createWorkspaceCheckpoint?(params: {
    description?: string;
    sessionId?: string;
  }): Promise<string | undefined>;

  restoreWorkspaceCheckpoint?(params: {
    checkpointId: string;
    rewindMemory?: boolean;
  }): Promise<{
    success: boolean;
    restoredFiles: string[];
    failedFiles?: Array<{ path: string; error: string }>;
    skippedFiles?: Array<{ path: string; reason: string }>;
    message?: string;
    memoryRewound?: boolean;
    memoryMessage?: string;
  }>;

  previewWorkspaceCheckpointRestore?(params: {
    checkpointId: string;
  }): Promise<{
    checkpointId: string;
    description: string;
    modified: number;
    added: number;
    deleted: number;
    files: Array<{
      relativePath: string;
      action: "overwrite" | "create" | "delete";
      additions: number;
      deletions: number;
      hunkCount: number;
    }>;
    writePaths: string[];
    extraPaths: string[];
    skippedFiles: Array<{ path: string; reason: string }>;
  } | null>;

  diffWorkspaceCheckpoint?(params: {
    checkpointId: string;
    compareToCheckpointId?: string;
    compareToWorkspace?: boolean;
  }): Promise<{
    oldCheckpoint: { id: string; description: string; created: string } | null;
    newCheckpoint: { id: string; description: string; created: string };
    files: Array<{
      relativePath: string;
      status: "added" | "deleted" | "modified";
      additions: number;
      deletions: number;
      hunkCount: number;
    }>;
  } | null>;

  deleteWorkspaceCheckpoint?(params: {
    checkpointId: string;
  }): Promise<{ success: boolean; message?: string }>;

  pinWorkspaceCheckpoint?(params: {
    checkpointId: string;
    pinned: boolean;
  }): Promise<{ success: boolean; message?: string }>;

  /**
   * Optional IDE hook: snapshot target file bytes before a mutating tool.
   * Returns an opaque beforeId for recordMutatingToolAfter, or null when
   * there is nothing to snapshot. Implemented by VS Code host.
   */
  captureMutatingToolBefore?(params: {
    toolName: string;
    toolArguments: unknown;
  }): Promise<string | null>;

  /**
   * Optional IDE hook: after a mutating tool (and verification) finishes,
   * record before/after snapshots for undo/redo. Pass commit:false on
   * failure to discard a pending before snapshot without recording.
   */
  recordMutatingToolAfter?(params: {
    toolName: string;
    toolArguments: unknown;
    beforeId: string | null;
    commit?: boolean;
  }): Promise<void>;

  getBranch(dir: string): Promise<string>;

  getRepoName(dir: string): Promise<string | undefined>;

  showToast(
    type: ToastType,
    message: string,
    ...otherParams: any[]
  ): Promise<any>;

  getGitRootPath(dir: string): Promise<string | undefined>;

  listDir(dir: string): Promise<[string, FileType][]>;

  getFileStats(files: string[]): Promise<FileStatsMap>;

  // Secret Storage
  readSecrets(keys: string[]): Promise<Record<string, string>>;

  writeSecrets(secrets: { [key: string]: string }): Promise<void>;

  // LSP
  gotoDefinition(location: Location): Promise<RangeInFile[]>;
  findReferences(location: Location): Promise<RangeInFile[]>;
  getHover(location: Location): Promise<string | null>;
  getDocumentSymbols(filepath: string): Promise<LspSymbol[]>;
  getWorkspaceSymbols(query: string): Promise<LspSymbol[]>;
  gotoImplementation(location: Location): Promise<RangeInFile[]>;
  prepareCallHierarchy(location: Location): Promise<LspCallHierarchyItem[]>;
  getIncomingCalls(location: Location): Promise<LspCallHierarchyCall[]>;
  getOutgoingCalls(location: Location): Promise<LspCallHierarchyCall[]>;

  // Tags
  getTags(artifactId: string): Promise<IndexTag[]>;

  // Callbacks
  onDidChangeActiveTextEditor(callback: (fileUri: string) => void): void;
}

// Slash Commands

export interface KnoxSDK {
  ide: IDE;
  llm: ILLM;
  addContextItem: (item: ContextItemWithId) => void;
  history: ChatMessage[];
  input: string;
  params?: { [key: string]: any } | undefined;
  contextItems: ContextItemWithId[];
  selectedCode: RangeInFile[];
  config: KnoxConfig;
  fetch: FetchFunction;
  completionOptions?: LLMFullCompletionOptions;
}

export interface SlashCommand {
  name: string;
  description: string;
  prompt?: string;
  params?: { [key: string]: any };
  run: (sdk: KnoxSDK) => AsyncGenerator<string | undefined>;
}

// Config

export type StepName =
  | "AnswerQuestionChroma"
  | "GenerateShellCommandStep"
  | "EditHighlightedCodeStep"
  | "ShareSessionStep"
  | "CommentCodeStep"
  | "ClearHistoryStep"
  | "StackOverflowStep"
  | "OpenConfigStep"
  | "GenerateShellCommandStep"
  | "DraftIssueStep";

export type ContextProviderName =
  | "diff"
  | "terminal"
  | "debugger"
  | "open"
  | "google"
  | "search"
  | "tree"
  | "http"
  | "problems"
  | "folder"
  | "postgres"
  | "database"
  | "code"
  | "os"
  | "currentFile"
  | "greptile"
  | "file"
  | "issue"
  | "repo-map"
  | "url"
  | "commit"
  | "web"
  | "discord"
  | "clipboard"
  | "memory"
  | string;

export type TemplateType = "anthropic" | "none";

export interface RequestOptions {
  timeout?: number;
  verifySsl?: boolean;
  caBundlePath?: string | string[];
  proxy?: string;
  headers?: { [key: string]: string };
  extraBodyProperties?: { [key: string]: any };
  noProxy?: string[];
  clientCertificate?: ClientCertificateOptions;
}

export interface CacheBehavior {
  cacheSystemMessage?: boolean;
  cacheConversation?: boolean;
}

export interface ClientCertificateOptions {
  cert: string;
  key: string;
  passphrase?: string;
}

export interface StepWithParams {
  name: StepName;
  params: { [key: string]: any };
}

export interface ContextProviderWithParams {
  name: ContextProviderName;
  params: { [key: string]: any };
}

export type SlashCommandDescription = Omit<SlashCommand, "run">;

export interface CustomCommand {
  name: string;
  prompt: string;
  description?: string;
}

export interface Prediction {
  type: "content";
  content:
    | string
    | {
        type: "text";
        text: string;
      }[];
}

export interface ToolExtras {
  ide: IDE;
  llm: ILLM;
  fetch: FetchFunction;
  tool: Tool;
  /** When aborted, long-running tools (terminal, etc.) should stop promptly. */
  abortSignal?: AbortSignal;
  /** Tool call id for streaming partial output to the GUI. */
  toolCallId?: string;
  /** Incremental tool result (e.g. terminal stdout) while the call is still running. */
  onPartialOutput?: (items: ContextItem[]) => void;
  /** Shared agent/memory/checkpoint identity for nested tool calls. */
  soul?: {
    sessionId?: string;
    turnId?: string;
    readonlyMemory?: boolean;
  };
}

export interface Tool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, any>;
    strict?: boolean | null;
  };

  displayTitle: string;
  wouldLikeTo?: string;
  isCurrently?: string;
  hasAlready?: string;
  readonly: boolean;
  uri?: string;
  faviconUrl?: string;
  group: string;
}

interface ToolChoice {
  type: "function";
  function: {
    name: string;
  };
}

export interface BaseCompletionOptions {
  temperature?: number;
  topP?: number;
  topK?: number;
  minP?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  mirostat?: number;
  stop?: string[];
  maxTokens?: number;
  numThreads?: number;
  useMmap?: boolean;
  keepAlive?: number;
  raw?: boolean;
  stream?: boolean;
  prediction?: Prediction;
  tools?: Tool[];
  toolChoice?: ToolChoice;
  reasoning?: boolean;
  reasoningBudgetTokens?: number;
  reasoningEffort?: string;
  webSearch?: boolean;
}

export interface ModelCapability {
  uploadImage?: boolean;
  tools?: boolean;
  /** Model can produce reasoning / thinking traces */
  reasoning?: boolean;
  /** Model supports provider-native web search */
  webSearch?: boolean;
  /** Model can generate/edit images as output */
  imageOutput?: boolean;
}

export interface ModelDescription {
  title: string;
  provider: string;
  model: string;
  apiKey?: string;

  // knoxProperties
  apiKeyLocation?: string;
  apiBase?: string;

  contextLength?: number;
  maxStopWords?: number;
  template?: TemplateType;
  completionOptions?: BaseCompletionOptions;
  systemMessage?: string;
  requestOptions?: RequestOptions;
  promptTemplates?: { [key: string]: string };
  cacheBehavior?: CacheBehavior;
  capabilities?: ModelCapability;
  /** From /v1/models supported_parameters when available */
  supportedParameters?: string[];
  /** From /v1/models architecture.input_modalities */
  inputModalities?: string[];
  /** From /v1/models architecture.output_modalities */
  outputModalities?: string[];
  roles?: ModelRole[];
}

// Leaving here to ideate on
// export type KnoxConfigSource = "local-yaml" | "local-json" | "hub-assistant" | "hub"

export interface KnoxUIConfig {
  codeBlockToolbarPosition?: "top" | "bottom";
  fontSize?: number;
  displayRawMarkdown?: boolean;
  showChatScrollbar?: boolean;
  codeWrap?: boolean;
  showSessionTabs?: boolean;
}

export interface ContextMenuConfig {
  comment?: string;
  docstring?: string;
  fix?: string;
  optimize?: string;
  fixGrammar?: string;
}

export interface ExperimentalModelRoles {
  repoMapFileSelection?: string;
  inlineEdit?: string;
  applyCodeBlock?: string;
  chat?: string;
  summarize?: string;
  viewRead?: string;
  realTimeSearch?: string;
}

export type EditStatus =
  | "not-started"
  | "streaming"
  | "accepting"
  | "accepting:full-diff"
  | "done";

export type ApplyStateStatus =
  | "streaming" // Changes are being applied to the file
  | "done" // All changes have been applied, awaiting user to accept/reject
  | "closed"; // All changes have been applied. Note that for new files, we immediately set the status to "closed"

export interface ApplyState {
  streamId: string;
  status?: ApplyStateStatus;
  numDiffs?: number;
  filepath?: string;
  fileContent?: string;
}

export interface RangeInFileWithContents {
  filepath: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  contents: string;
}

export type CodeToEdit = RangeInFileWithContents | FileWithContents;

/**
 * Represents the configuration for a quick action in the Code Lens.
 * Quick actions are custom commands that can be added to function and class declarations.
 */
export interface QuickActionConfig {
  /**
   * The title of the quick action that will display in the Code Lens.
   */
  title: string;

  /**
   * The prompt that will be sent to the model when the quick action is invoked,
   * with the function or class body concatenated.
   */
  prompt: string;

  /**
   * If `true`, the result of the quick action will be sent to the chat panel.
   * If `false`, the streamed result will be inserted into the document.
   *
   * Defaults to `false`.
   */
  sendToChat: boolean;
}

export type DefaultContextProvider = ContextProviderWithParams & {
  query?: string;
};

export interface ExperimentalConfig {
  contextMenuPrompts?: ContextMenuConfig;
  modelRoles?: ExperimentalModelRoles;
  defaultContext?: DefaultContextProvider[];
  promptPath?: string;

  /**
   * Quick actions are a way to add custom commands to the Code Lens of
   * function and class declarations.
   */
  quickActions?: QuickActionConfig[];

  /**
   * When true, context compaction may call the summarize-role model
   * (falling back to the chat model) to compress older turns. Heuristic
   * compaction is used on timeout/failure. Default: false.
   */
  useLlmSummarization?: boolean;

  /**
   * Agent loop profile. `systems` defaults: unlimited steps, doom-loop 5, verifyCommand=make.
   * `rust`: unlimited steps, doom-loop 4, `cargo check --workspace --all-targets`.
   * `auto` becomes systems on kernel/QEMU trees and rust on a root Cargo.toml.
   */
  agentProfile?: "default" | "systems" | "rust" | "auto";

  /**
   * Max tool→continue rounds per user turn in Agent mode before the next
   * LLM call is forced to text-only (summary). Default: unlimited (0).
   * Set a positive number to cap.
   */
  agentMaxSteps?: number;

  /**
   * Identical tool+args repeats (or consecutive failures) before a text-only
   * summary turn. Default: 3. Set to `0` to disable.
   */
  agentDoomLoopThreshold?: number;

  /**
   * Default maxFiles for builtin_view_subdirectory when the model omits it.
   * Default: 1000. Configurable in Settings.
   */
  agentViewSubdirectoryMaxFiles?: number;

  /**
   * Post-edit oracle: diagnostics (LSP) | command (verifyCommand) | off.
   * A non-empty agentVerifyCommand selects command even when mode is omitted.
   */
  agentVerifyMode?: "diagnostics" | "command" | "off";
  /** Incremental build after edits when the oracle is command (e.g. `make -j8`). */
  agentVerifyCommand?: string;
  /** Identical compiler-error signatures before skipping further auto-builds. Default 8. */
  agentVerifyMaxIterations?: number;

  /** Job artifact directory from config.yaml `agent.jobs.logDir` (default ~/.knox/jobs). */
  agentJobsLogDir?: string;
  /** Default builtin_await_shell wait from `agent.jobs.awaitTimeoutMs` (default 600000). */
  agentJobsAwaitTimeoutMs?: number;

  /**
   * User / shared-config path & command policy (allow / ask / deny globs).
   */
  agentPolicy?: {
    paths?: Array<{ pattern: string; action: "allow" | "ask" | "deny" }>;
    commands?: Array<{ pattern: string; action: "allow" | "ask" | "deny" }>;
    externalDirectory?: "deny" | "ask" | "allow";
    sandboxDestructive?: boolean;
  };
  /** always / ask / never blocks loaded from AGENTS.md / .knoxrules. */
  agentPolicyFromRules?: {
    paths?: Array<{ pattern: string; action: "allow" | "ask" | "deny" }>;
    commands?: Array<{ pattern: string; action: "allow" | "ask" | "deny" }>;
  };
}

// config.yaml
/**
 * Skills configuration block — can be specified in config.yaml.
 */
export interface SkillsConfig {
  /** Additional filesystem paths to scan for skills */
  paths?: string[];
  /** Remote skill index URLs */
  urls?: string[];
  /** When true, disable loading skills from .claude, .agents, .opencode dirs */
  disableExternalSkills?: boolean;
  /** Pin remote skills by name → sha256 of SKILL.md */
  pins?: Record<string, string>;
}

// config.ts - give users simplified interfaces
export interface Config {
  /** Each entry in this array will originally be a ModelDescription from config.yaml, but you may add CustomLLMs.
   * A CustomLLM requires you only to define an AsyncGenerator that calls the LLM and yields string updates. You can choose to define either `streamCompletion` or `streamChat` (or both).
   * Knox will do the rest of the work to construct prompt templates, handle context items, prune context, etc.
   */
  models: (CustomLLM | ModelDescription)[];
  /** A system message to be followed by all of your models */
  systemMessage?: string;
  /** The default completion options for all models */
  completionOptions?: BaseCompletionOptions;
  /** Request options that will be applied to all models and context providers */
  requestOptions?: RequestOptions;
  /** The list of slash commands that will be available in the sidebar */
  slashCommands?: SlashCommand[];
  /** Each entry in this array will originally be a ContextProviderWithParams from config.yaml, but you may add CustomContextProviders.
   * A CustomContextProvider requires you only to define a title and getContextItems function. When you type '@title <query>', Knox will call `getContextItems(query)`.
   */
  contextProviders?: (CustomContextProvider | ContextProviderWithParams)[];
  /** If set to true, Knox will not make extra requests to the LLM to generate a summary title of each session. */
  disableSessionTitles?: boolean;
  /** UI styles customization */
  ui?: KnoxUIConfig;
  /** Experimental configuration */
  experimental?: ExperimentalConfig;
  /** Skills system configuration */
  skills?: SkillsConfig;

  data?: DataDestination[];
}

// in the actual Knox source code
export interface KnoxConfig {
  models: ILLM[];
  systemMessage?: string;
  completionOptions?: BaseCompletionOptions;
  requestOptions?: RequestOptions;
  slashCommands: SlashCommand[];
  contextProviders: IContextProvider[];
  disableSessionTitles?: boolean;
  ui?: KnoxUIConfig;
  experimental?: ExperimentalConfig;
  skills?: SkillsConfig;
  tools: Tool[];
  rules?: string[];
  modelsByRole: Record<ModelRole, ILLM[]>;
  selectedModelByRole: Record<ModelRole, ILLM | null>;
  data?: DataDestination[];
}

export interface BrowserSerializedKnoxConfig {
  models: ModelDescription[];
  systemMessage?: string;
  completionOptions?: BaseCompletionOptions;
  requestOptions?: RequestOptions;
  slashCommands: SlashCommandDescription[];
  contextProviders: ContextProviderDescription[];
  disableSessionTitles?: boolean;
  ui?: KnoxUIConfig;
  experimental?: ExperimentalConfig;
  tools: Tool[];
  rules?: string[];
  modelsByRole: Record<ModelRole, ModelDescription[]>;
  selectedModelByRole: Record<ModelRole, ModelDescription | null>;
}

// DOCS SUGGESTIONS AND PACKAGE INFO
export interface FilePathAndName {
  path: string;
  name: string;
}

export interface PackageFilePathAndName extends FilePathAndName {
  packageRegistry: string; // e.g. npm, pypi
}

export type ParsedPackageInfo = {
  name: string;
  packageFile: PackageFilePathAndName;
  language: string;
  version: string;
};

export type PackageDetails = {
  docsLink?: string;
  docsLinkWarning?: string;
  title?: string;
  description?: string;
  repo?: string;
  license?: string;
};

export type PackageDetailsSuccess = PackageDetails & {
  docsLink: string;
};

export type PackageDocsResult = {
  packageInfo: ParsedPackageInfo;
} & (
  | { error: string; details?: never }
  | { details: PackageDetailsSuccess; error?: never }
);

export interface TerminalOptions {
  reuseTerminal?: boolean;
  terminalName?: string;
}
