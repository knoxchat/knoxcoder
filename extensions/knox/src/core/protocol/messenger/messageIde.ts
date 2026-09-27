import { FromIdeProtocol } from "..";
import { ToIdeFromWebviewOrCoreProtocol } from "../ide";

import type {
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
} from "../..";

export class MessageIde implements IDE {
  constructor(
    private readonly request: <T extends keyof ToIdeFromWebviewOrCoreProtocol>(
      messageType: T,
      data: ToIdeFromWebviewOrCoreProtocol[T][0],
    ) => Promise<ToIdeFromWebviewOrCoreProtocol[T][1]>,
    private readonly on: <T extends keyof FromIdeProtocol>(
      messageType: T,
      callback: (data: FromIdeProtocol[T][0]) => FromIdeProtocol[T][1],
    ) => void,
  ) {}

  async readSecrets(keys: string[]): Promise<Record<string, string>> {
    return this.request("readSecrets", { keys });
  }

  async writeSecrets(secrets: { [key: string]: string }): Promise<void> {
    return this.request("writeSecrets", { secrets });
  }

  fileExists(fileUri: string): Promise<boolean> {
    return this.request("fileExists", { filepath: fileUri });
  }
  async gotoDefinition(location: Location): Promise<RangeInFile[]> {
    return this.request("gotoDefinition", { location });
  }
  async findReferences(location: Location): Promise<RangeInFile[]> {
    return this.request("findReferences", { location });
  }
  async getHover(location: Location): Promise<string | null> {
    return this.request("getHover", { location });
  }
  async getDocumentSymbols(filepath: string): Promise<LspSymbol[]> {
    return this.request("getDocumentSymbols", { filepath });
  }
  async getWorkspaceSymbols(query: string): Promise<LspSymbol[]> {
    return this.request("getWorkspaceSymbols", { query });
  }
  async gotoImplementation(location: Location): Promise<RangeInFile[]> {
    return this.request("gotoImplementation", { location });
  }
  async prepareCallHierarchy(location: Location): Promise<LspCallHierarchyItem[]> {
    return this.request("prepareCallHierarchy", { location });
  }
  async getIncomingCalls(location: Location): Promise<LspCallHierarchyCall[]> {
    return this.request("getIncomingCalls", { location });
  }
  async getOutgoingCalls(location: Location): Promise<LspCallHierarchyCall[]> {
    return this.request("getOutgoingCalls", { location });
  }
  onDidChangeActiveTextEditor(callback: (fileUri: string) => void): void {
    this.on("didChangeActiveTextEditor", (data) => callback(data.filepath));
  }

  getIdeSettings(): Promise<IdeSettings> {
    return this.request("getIdeSettings", undefined);
  }
  getFileStats(files: string[]): Promise<FileStatsMap> {
    return this.request("getFileStats", { files });
  }
  getGitRootPath(dir: string): Promise<string | undefined> {
    return this.request("getGitRootPath", { dir });
  }
  listDir(dir: string): Promise<[string, FileType][]> {
    return this.request("listDir", { dir });
  }

  showToast: IDE["showToast"] = (...params) => {
    return this.request("showToast", params);
  };

  getRepoName(dir: string): Promise<string | undefined> {
    return this.request("getRepoName", { dir });
  }

  getDebugLocals(threadIndex: number): Promise<string> {
    return this.request("getDebugLocals", { threadIndex });
  }

  getTopLevelCallStackSources(
    threadIndex: number,
    stackDepth: number,
  ): Promise<string[]> {
    return this.request("getTopLevelCallStackSources", {
      threadIndex,
      stackDepth,
    });
  }

  getAvailableThreads(): Promise<Thread[]> {
    return this.request("getAvailableThreads", undefined);
  }

  debugControl(request: DebugControlRequest): Promise<DebugControlResult> {
    return this.request("debugControl", request);
  }

  getTags(artifactId: string): Promise<IndexTag[]> {
    return this.request("getTags", artifactId);
  }

  getIdeInfo(): Promise<IdeInfo> {
    return this.request("getIdeInfo", undefined);
  }

  readRangeInFile(filepath: string, range: Range): Promise<string> {
    return this.request("readRangeInFile", { filepath, range });
  }

  getUniqueId(): Promise<string> {
    return this.request("getUniqueId", undefined);
  }

  async getDiff(includeUnstaged: boolean) {
    return await this.request("getDiff", { includeUnstaged });
  }

  async getGitChangedFiles() {
    return await this.request("getGitChangedFiles", undefined);
  }

  async getClipboardContent(): Promise<{ text: string; copiedAt: string }> {
    return {
      text: "",
      copiedAt: new Date().toISOString(),
    };
  }

  async getTerminalContents() {
    return await this.request("getTerminalContents", undefined);
  }

  async getWorkspaceDirs(): Promise<string[]> {
    return await this.request("getWorkspaceDirs", undefined);
  }

  async showLines(
    fileUri: string,
    startLine: number,
    endLine: number,
  ): Promise<void> {
    return await this.request("showLines", {
      filepath: fileUri,
      startLine,
      endLine,
    });
  }

  async writeFile(fileUri: string, contents: string): Promise<void> {
    await this.request("writeFile", { path: fileUri, contents });
  }

  async showVirtualFile(title: string, contents: string): Promise<void> {
    await this.request("showVirtualFile", { name: title, content: contents });
  }

  async openFile(fileUri: string): Promise<void> {
    await this.request("openFile", { path: fileUri });
  }

  async openUrl(url: string): Promise<void> {
    await this.request("openUrl", url);
  }

  async runCommand(command: string, options?: TerminalOptions): Promise<void> {
    await this.request("runCommand", { command, options });
  }

  async saveFile(fileUri: string): Promise<void> {
    await this.request("saveFile", { filepath: fileUri });
  }
  async readFile(fileUri: string): Promise<string> {
    return await this.request("readFile", { filepath: fileUri });
  }

  getOpenFiles(): Promise<string[]> {
    return this.request("getOpenFiles", undefined);
  }

  getCurrentFile() {
    return this.request("getCurrentFile", undefined);
  }

  getPinnedFiles(): Promise<string[]> {
    return this.request("getPinnedFiles", undefined);
  }

  getSearchResults(query: string, options?: any): Promise<string> {
    return this.request("getSearchResults", { query, options });
  }

  getProblems(fileUri: string): Promise<Problem[]> {
    return this.request("getProblems", { filepath: fileUri });
  }

  subprocess(command: string, cwd?: string): Promise<[string, string]> {
    return this.request("subprocess", { command, cwd });
  }

  async getBranch(dir: string): Promise<string> {
    return this.request("getBranch", { dir });
  }
}
