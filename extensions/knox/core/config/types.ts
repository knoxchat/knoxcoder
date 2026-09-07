const Types = `
declare global {
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
  
  export type ContextProviderType = "normal" | "query" | "submenu";

  export type ContextProviderCategory = "core" | "integration";

  export interface ContextProviderDescription {
    title: ContextProviderName;
    displayTitle: string;
    description: string;
    renderInlineAs?: string;
    type: ContextProviderType;
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
  
  
  export interface IContextProvider {
    get description(): ContextProviderDescription;
  
    getContextItems(
      query: string,
      extras: ContextProviderExtras,
    ): Promise<ContextItem[]>;
  
    loadSubmenuItems(args: LoadSubmenuItemsArgs): Promise<ContextSubmenuItem[]>;
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
  
  export type ChatMessageRole = "user" | "assistant" | "system" | "tool";
  
  export interface MessagePart {
    type: "text" | "imageUrl";
    text?: string;
    imageUrl?: { url: string };
  }
  
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
  
  export interface AssistantChatMessage {
    role: "assistant";
    content: MessageContent;
    toolCalls?: ToolCallDelta[];
    reasoning?: string;
  }
  
  export interface SystemChatMessage {
    role: "system";
    content: string;
  }
  
  export type ChatMessage =
    | UserChatMessage
    | AssistantChatMessage
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
  
  type MessageModes = "chat" | "edit";
  
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
    aiGatewaySlug?: string;
    apiBase?: string;
    cacheBehavior?: CacheBehavior;
  
    useLegacyCompletionsEndpoint?: boolean;
  
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
    ) => AsyncGenerator<string>;
    listModels?: (
      fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
    ) => Promise<string[]>;
  }
  
  /**
   * The LLM interface requires you to specify either \`streamCompletion\` or \`streamChat\` (or both).
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
  
  export class Problem {
    filepath: string;
    range: Range;
    message: string;
  }
  
  export class Thread {
    name: string;
    id: number;
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

    debugControl?(request: {
      op: string;
      [key: string]: unknown;
    }): Promise<{ ok: boolean; content: string; sessionActive?: boolean }>;
  
    getWorkspaceDirs(): Promise<string[]>;
  
    fileExists(filepath: string): Promise<boolean>;
  
    writeFile(path: string, contents: string): Promise<void>;
  
    showVirtualFile(title: string, contents: string): Promise<void>;
    openFile(path: string): Promise<void>;
  
    openUrl(url: string): Promise<void>;
  
    runCommand(command: string): Promise<void>;
  
    saveFile(filepath: string): Promise<void>;
  
    readFile(filepath: string): Promise<string>;
  
    readRangeInFile(filepath: string, range: Range): Promise<string>;
  
    showLines(
      filepath: string,
      startLine: number,
      endLine: number,
    ): Promise<void>;
    getOpenFiles(): Promise<string[]>;
  
    getCurrentFile(): Promise<
      | undefined
      | {
          isUntitled: boolean;
          path: string;
          contents: string;
        }
    >;
  
    getPinnedFiles(): Promise<string[]>;
  
    getSearchResults(query: string, options?: any): Promise<string>;
  
    subprocess(command: string, cwd?: string): Promise<[string, string]>;
  
    getProblems(filepath?: string | undefined): Promise<Problem[]>;
  
    getBranch(dir: string): Promise<string>;
  
  
    getRepoName(dir: string): Promise<string | undefined>;
  
    showToast(
      type: ToastType,
      message: string,
      ...otherParams: any[]
    ): Promise<any>;
  
    getGitRootPath(dir: string): Promise<string | undefined>;
  
    listDir(dir: string): Promise<[string, FileType][]>;
  
    getLastModified(files: string[]): Promise<{ [path: string]: number }>;
  
  
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
  
    // Callbacks
    onDidChangeActiveTextEditor(callback: (filepath: string) => void): void;
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
  }
  
  export interface SlashCommand {
    name: string;
    description: string;
    params?: { [key: string]: any };
    run: (sdk: KnoxSDK) => AsyncGenerator<string | undefined>;
  }
  
  // Config
  
  type StepName =
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
  
  type ContextProviderName =
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
    | "os"
    | "currentFile"
    | "greptile"
    | "file"
    | "issue"
    | "repo-map"
    | "url"
    | "memory"
    | "web"
    | "discord"
    | "commit"
    | "clipboard"
    | string;
  
  type TemplateType =
    | "anthropic"
    | "none";
  
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
  
  export interface SlashCommandDescription {
    name: string;
    description: string;
    params?: { [key: string]: any };
  }
  
  export interface CustomCommand {
    name: string;
    prompt: string;
    description: string;
  }
  
  interface Prediction {
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
    wouldLikeTo: string;
    readonly: boolean;
    uri?: string;
  }
  
  interface BaseCompletionOptions {
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
    reasoningEffort?: string;
    webSearch?: boolean;
  }
  
  export interface ModelCapability {
    uploadImage?: boolean;
    tools?: boolean;
    reasoning?: boolean;
    webSearch?: boolean;
    imageOutput?: boolean;
  }
  
  export interface ModelDescription {
    title: string;
    provider: string;
    model: string;
    apiKey?: string;
    apiBase?: string;
    contextLength?: number;
    maxStopWords?: number;
    template?: TemplateType;
    completionOptions?: BaseCompletionOptions;
    systemMessage?: string;
    requestOptions?: RequestOptions;
    promptTemplates?: { [key: string]: string };
    capabilities?: ModelCapability;
    cacheBehavior?: CacheBehavior;
  }
  
  export interface KnoxUIConfig {
    codeBlockToolbarPosition?: "top" | "bottom";
    fontSize?: number;
    displayRawMarkdown?: boolean;
    showChatScrollbar?: boolean;
    codeWrap?: boolean;
  }
  
  interface ContextMenuConfig {
    comment?: string;
    docstring?: string;
    fix?: string;
    optimize?: string;
    fixGrammar?: string;
  }
  
  interface ExperimentalModelRoles {
    inlineEdit?: string;
    applyCodeBlock?: string;
    repoMapFileSelection?: string;
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
  interface QuickActionConfig {
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
     * If \`true\`, the result of the quick action will be sent to the chat panel.
     * If \`false\`, the streamed result will be inserted into the document.
     *
     * Defaults to \`false\`.
     */
    sendToChat: boolean;
  }
  
  export type DefaultContextProvider = ContextProviderWithParams & {
    query?: string;
  };
  
  interface ExperimentalConfig {
    contextMenuPrompts?: ContextMenuConfig;
    modelRoles?: ExperimentalModelRoles;
    defaultContext?: DefaultContextProvider[];
    promptPath?: string;

    /**
     * Quick actions are a way to add custom commands to the Code Lens of
     * function and class declarations.
     */
    quickActions?: QuickActionConfig[];

    useTools?: boolean;

    /**
     * When true, context compaction may call the summarize-role model
     * (falling back to the chat model) to compress older turns.
     */
    useLlmSummarization?: boolean;

    /**
     * Agent loop profile (HL-12 / RL-02). \`systems\` defaults: unlimited
     * steps, doom-loop 5, verifyCommand=make. \`rust\`: unlimited steps,
     * doom-loop 4, \`cargo check --workspace --all-targets\`. \`auto\` becomes
     * systems on kernel/QEMU trees and rust on a root Cargo.toml.
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
     * summary turn. Default: 3. Set to \`0\` to disable.
     */
    agentDoomLoopThreshold?: number;

    /**
     * Default maxFiles for builtin_view_subdirectory when the model omits it.
     * Default: 1000.
     */
    agentViewSubdirectoryMaxFiles?: number;

    /**
     * Post-edit oracle: diagnostics (LSP, default) | command (verifyCommand) | off.
     * A non-empty agentVerifyCommand selects command even when mode is omitted.
     */
    agentVerifyMode?: "diagnostics" | "command" | "off";
    /** Incremental build to run after edits when mode is command (e.g. \`make -j8\`). */
    agentVerifyCommand?: string;
    /** Identical compiler-error signatures before skipping further auto-builds. Default 8. */
    agentVerifyMaxIterations?: number;

    /** Job artifact directory from config.yaml \`agent.jobs.logDir\` (default ~/.knox/jobs). */
    agentJobsLogDir?: string;
    /** Default builtin_await_shell wait from \`agent.jobs.awaitTimeoutMs\` (default 600000). */
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
  export interface Config {
    /** Each entry in this array will originally be a ModelDescription from config.yaml, but you may add CustomLLMs.
     * A CustomLLM requires you only to define an AsyncGenerator that calls the LLM and yields string updates. You can choose to define either \`streamCompletion\` or \`streamChat\` (or both).
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
     * A CustomContextProvider requires you only to define a title and getContextItems function. When you type '@title <query>', Knox will call \`getContextItems(query)\`.
     */
    contextProviders?: (CustomContextProvider | ContextProviderWithParams)[];
    /** If set to true, Knox will not make extra requests to the LLM to generate a summary title of each session. */
    disableSessionTitles?: boolean;
    /** UI styles customization */
    ui?: KnoxUIConfig;
    /** Experimental configuration */
    experimental?: ExperimentalConfig;

  }
  
  // in the actual Knox source code
  export interface KnoxConfig {
    models: ILLM[];
    systemMessage?: string;
    completionOptions?: BaseCompletionOptions;
    requestOptions?: RequestOptions;
    slashCommands?: SlashCommand[];
    contextProviders?: IContextProvider[];
    disableSessionTitles?: boolean;
    ui?: KnoxUIConfig;
    experimental?: ExperimentalConfig;
    skills?: {
      paths?: string[];
      urls?: string[];
      disableExternalSkills?: boolean;
      pins?: Record<string, string>;
    };
    tools: Tool[];
  }
  
  export interface BrowserSerializedKnoxConfig {
    models: ModelDescription[];
    systemMessage?: string;
    completionOptions?: BaseCompletionOptions;
    requestOptions?: RequestOptions;
    slashCommands?: SlashCommandDescription[];
    contextProviders?: ContextProviderDescription[];
    disableSessionTitles?: boolean;
    ui?: KnoxUIConfig;
    experimental?: ExperimentalConfig;
    tools: Tool[];
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
}

export {};
`;

export default Types;
