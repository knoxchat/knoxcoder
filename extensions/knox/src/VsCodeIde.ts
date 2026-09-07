import { exec } from "node:child_process";

import { IndexTag, Range } from "core";
import { EXTENSION_NAME } from "core/config/extensionName";
import {
  resolveRipgrepBinary,
  searchWorkspaceWithRipgrep,
  setRipgrepAppRoot,
} from "core/tools/ripgrep";
import type { SearchOptions } from "core/protocol/ide";
import * as URI from "core/util/uriApi";
import * as vscode from "vscode";

import { t } from "./i18n";

import { executeGotoProvider } from "./util/lsp";
import { Repository } from "./otherExtensions/git";
import { SecretStorage } from "./stubs/SecretStorage";
import { VsCodeIdeUtils } from "./util/ideUtils";
import {
  getKnoxExtension,
  openEditorAndRevealRange,
} from "./util/vscode";
import { VsCodeWebviewProtocol } from "./webviewProtocol";

import type {
  ContextItem,
  FileStatsMap,
  FileType,
  IDE,
  IdeInfo,
  IdeSettings,
  Location,
  LspCallHierarchyCall,
  LspCallHierarchyItem,
  LspSymbol,
  Problem,
  RangeInFile,
  TerminalOptions,
  Thread,
  DebugControlRequest,
  DebugControlResult,
} from "core";

class VsCodeIde implements IDE {
  ideUtils: VsCodeIdeUtils;
  secretStorage: SecretStorage;
  private lastFileSaveTimestamp: number = Date.now();

  constructor(
    private readonly vscodeWebviewProtocolPromise: Promise<VsCodeWebviewProtocol>,
    private readonly context: vscode.ExtensionContext,
  ) {
    this.ideUtils = new VsCodeIdeUtils();
    this.secretStorage = new SecretStorage(context);
    setRipgrepAppRoot(vscode.env.appRoot);
  }

  public updateLastFileSaveTimestamp(): void {
    this.lastFileSaveTimestamp = Date.now();
  }

  public getLastFileSaveTimestamp(): number {
    return this.lastFileSaveTimestamp;
  }

  async readSecrets(keys: string[]): Promise<Record<string, string>> {
    const secretValuePromises = keys.map((key) => this.secretStorage.get(key));
    const secretValues = await Promise.all(secretValuePromises);

    return keys.reduce(
      (acc, key, index) => {
        if (secretValues[index] === undefined) {
          return acc;
        }

        acc[key] = secretValues[index];
        return acc;
      },
      {} as Record<string, string>,
    );
  }

  async writeSecrets(secrets: { [key: string]: string }): Promise<void> {
    for (const [key, value] of Object.entries(secrets)) {
      await this.secretStorage.store(key, value);
    }
  }

  async fileExists(uri: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.parse(uri));
      return true;
    } catch (error) {
      if (
        error instanceof vscode.FileSystemError ||
        (error instanceof Error && error.message.includes("ENOENT"))
      ) {
        return false;
      }
      // Log unexpected errors but still return false to avoid breaking callers
      console.warn(
        `[VsCodeIde.fileExists] Unexpected error checking "${uri}":`,
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  }

  /**
   * Convert a filepath string to a VS Code URI.
   * Handles both raw filesystem paths (/Users/...) and file:// URIs.
   */
  private _toUri(filepath: string): vscode.Uri {
    if (filepath.startsWith("file://") || filepath.includes("://")) {
      return vscode.Uri.parse(filepath);
    }
    return vscode.Uri.file(filepath);
  }

  async gotoDefinition(location: Location): Promise<RangeInFile[]> {
    const result = await executeGotoProvider({
      uri: this._toUri(location.filepath),
      line: location.position.line,
      character: location.position.character,
      name: "vscode.executeDefinitionProvider",
    });

    return result;
  }

  async findReferences(location: Location): Promise<RangeInFile[]> {
    const result = await executeGotoProvider({
      uri: this._toUri(location.filepath),
      line: location.position.line,
      character: location.position.character,
      name: "vscode.executeReferenceProvider",
    });

    return result;
  }

  async getHover(location: Location): Promise<string | null> {
    try {
      const uri = this._toUri(location.filepath);
      const position = new vscode.Position(
        location.position.line,
        location.position.character,
      );
      const hovers = (await vscode.commands.executeCommand(
        "vscode.executeHoverProvider",
        uri,
        position,
      )) as vscode.Hover[];

      if (!hovers || hovers.length === 0) {
        return null;
      }

      // Concatenate all hover contents into a single string
      const parts: string[] = [];
      for (const hover of hovers) {
        for (const content of hover.contents) {
          if (typeof content === "string") {
            parts.push(content);
          } else if ("value" in content) {
            parts.push(content.value);
          }
        }
      }

      return parts.length > 0 ? parts.join("\n\n") : null;
    } catch (e) {
      console.warn("Error executing hover provider:", e);
      return null;
    }
  }

  async getDocumentSymbols(filepath: string): Promise<LspSymbol[]> {
    try {
      const uri = this._toUri(filepath);
      const symbols = (await vscode.commands.executeCommand(
        "vscode.executeDocumentSymbolProvider",
        uri,
      )) as (vscode.DocumentSymbol | vscode.SymbolInformation)[] | undefined;

      if (!symbols || symbols.length === 0) {
        return [];
      }

      return symbols.map((s) => this._convertSymbol(s, filepath));
    } catch (e) {
      console.warn("Error executing document symbol provider:", e);
      return [];
    }
  }

  async getWorkspaceSymbols(query: string): Promise<LspSymbol[]> {
    try {
      const symbols = (await vscode.commands.executeCommand(
        "vscode.executeWorkspaceSymbolProvider",
        query,
      )) as vscode.SymbolInformation[] | undefined;

      if (!symbols || symbols.length === 0) {
        return [];
      }

      // Filter to important symbol kinds (matching opencode's filter)
      const importantKinds = new Set([
        vscode.SymbolKind.Class,        // 4
        vscode.SymbolKind.Function,     // 11
        vscode.SymbolKind.Method,       // 5
        vscode.SymbolKind.Interface,    // 10
        vscode.SymbolKind.Variable,     // 12
        vscode.SymbolKind.Constant,     // 13
        vscode.SymbolKind.Struct,       // 22
        vscode.SymbolKind.Enum,         // 9
      ]);

      return symbols
        .filter((s) => importantKinds.has(s.kind))
        .slice(0, 10)
        .map((s) => this._convertSymbol(s));
    } catch (e) {
      console.warn("Error executing workspace symbol provider:", e);
      return [];
    }
  }

  async gotoImplementation(location: Location): Promise<RangeInFile[]> {
    const result = await executeGotoProvider({
      uri: this._toUri(location.filepath),
      line: location.position.line,
      character: location.position.character,
      name: "vscode.executeImplementationProvider",
    });

    return result;
  }

  async prepareCallHierarchy(
    location: Location,
  ): Promise<LspCallHierarchyItem[]> {
    try {
      const uri = this._toUri(location.filepath);
      const position = new vscode.Position(
        location.position.line,
        location.position.character,
      );
      const items = (await vscode.commands.executeCommand(
        "vscode.prepareCallHierarchy",
        uri,
        position,
      )) as vscode.CallHierarchyItem[] | undefined;

      if (!items || items.length === 0) {
        return [];
      }

      return items.map((item) => this._convertCallHierarchyItem(item));
    } catch (e) {
      console.warn("Error executing prepareCallHierarchy:", e);
      return [];
    }
  }

  async getIncomingCalls(
    location: Location,
  ): Promise<LspCallHierarchyCall[]> {
    try {
      const uri = this._toUri(location.filepath);
      const position = new vscode.Position(
        location.position.line,
        location.position.character,
      );

      // First prepare the call hierarchy
      const items = (await vscode.commands.executeCommand(
        "vscode.prepareCallHierarchy",
        uri,
        position,
      )) as vscode.CallHierarchyItem[] | undefined;

      if (!items || items.length === 0) {
        return [];
      }

      const incomingCalls = (await vscode.commands.executeCommand(
        "vscode.provideIncomingCalls",
        items[0],
      )) as vscode.CallHierarchyIncomingCall[] | undefined;

      if (!incomingCalls || incomingCalls.length === 0) {
        return [];
      }

      return incomingCalls.map((call) => ({
        from: this._convertCallHierarchyItem(call.from),
        fromRanges: call.fromRanges.map((r) => ({
          start: { line: r.start.line, character: r.start.character },
          end: { line: r.end.line, character: r.end.character },
        })),
      }));
    } catch (e) {
      console.warn("Error executing incomingCalls:", e);
      return [];
    }
  }

  async getOutgoingCalls(
    location: Location,
  ): Promise<LspCallHierarchyCall[]> {
    try {
      const uri = this._toUri(location.filepath);
      const position = new vscode.Position(
        location.position.line,
        location.position.character,
      );

      // First prepare the call hierarchy
      const items = (await vscode.commands.executeCommand(
        "vscode.prepareCallHierarchy",
        uri,
        position,
      )) as vscode.CallHierarchyItem[] | undefined;

      if (!items || items.length === 0) {
        return [];
      }

      const outgoingCalls = (await vscode.commands.executeCommand(
        "vscode.provideOutgoingCalls",
        items[0],
      )) as vscode.CallHierarchyOutgoingCall[] | undefined;

      if (!outgoingCalls || outgoingCalls.length === 0) {
        return [];
      }

      return outgoingCalls.map((call) => ({
        to: this._convertCallHierarchyItem(call.to),
        fromRanges: call.fromRanges.map((r) => ({
          start: { line: r.start.line, character: r.start.character },
          end: { line: r.end.line, character: r.end.character },
        })),
      }));
    } catch (e) {
      console.warn("Error executing outgoingCalls:", e);
      return [];
    }
  }

  /**
   * Convert a VS Code symbol to a serializable LspSymbol.
   */
  private _convertSymbol(
    symbol: vscode.DocumentSymbol | vscode.SymbolInformation,
    defaultFilepath?: string,
  ): LspSymbol {
    if ("children" in symbol) {
      // DocumentSymbol
      return {
        name: symbol.name,
        kind: symbol.kind,
        detail: symbol.detail,
        range: {
          start: {
            line: symbol.range.start.line,
            character: symbol.range.start.character,
          },
          end: {
            line: symbol.range.end.line,
            character: symbol.range.end.character,
          },
        },
        selectionRange: {
          start: {
            line: symbol.selectionRange.start.line,
            character: symbol.selectionRange.start.character,
          },
          end: {
            line: symbol.selectionRange.end.line,
            character: symbol.selectionRange.end.character,
          },
        },
        children: symbol.children?.map((c) =>
          this._convertSymbol(c, defaultFilepath),
        ),
      };
    } else {
      // SymbolInformation
      return {
        name: symbol.name,
        kind: symbol.kind,
        filepath: symbol.location.uri.toString(),
        range: {
          start: {
            line: symbol.location.range.start.line,
            character: symbol.location.range.start.character,
          },
          end: {
            line: symbol.location.range.end.line,
            character: symbol.location.range.end.character,
          },
        },
      };
    }
  }

  /**
   * Convert a VS Code CallHierarchyItem to a serializable LspCallHierarchyItem.
   */
  private _convertCallHierarchyItem(
    item: vscode.CallHierarchyItem,
  ): LspCallHierarchyItem {
    return {
      name: item.name,
      kind: item.kind,
      detail: item.detail,
      filepath: item.uri.toString(),
      range: {
        start: {
          line: item.range.start.line,
          character: item.range.start.character,
        },
        end: {
          line: item.range.end.line,
          character: item.range.end.character,
        },
      },
      selectionRange: {
        start: {
          line: item.selectionRange.start.line,
          character: item.selectionRange.start.character,
        },
        end: {
          line: item.selectionRange.end.line,
          character: item.selectionRange.end.character,
        },
      },
    };
  }

  onDidChangeActiveTextEditor(callback: (uri: string) => void): void {
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        callback(editor.document.uri.toString());
      }
    });
  }

  showToast: IDE["showToast"] = async (...params) => {
    const [type, message, ...otherParams] = params;
    const { showErrorMessage, showWarningMessage, showInformationMessage } =
      vscode.window;

    switch (type) {
      case "error":
        return showErrorMessage(message, t("ide.showLog")).then((selection) => {
          if (selection === t("ide.showLog")) {
            vscode.commands.executeCommand("workbench.action.toggleDevTools");
          }
        });
      case "info":
        return showInformationMessage(message, ...otherParams);
      case "warning":
        return showWarningMessage(message, ...otherParams);
    }
  };

  async getRepoName(dir: string): Promise<string | undefined> {
    const repo = await this.getRepo(dir);
    const remotes = repo?.state.remotes;
    if (!remotes) {
      return undefined;
    }
    const remote =
      remotes?.find((r: any) => r.name === "origin") ?? remotes?.[0];
    if (!remote) {
      return undefined;
    }
    const ownerAndRepo = remote.fetchUrl
      ?.replace(".git", "")
      .split("/")
      .slice(-2);
    return ownerAndRepo?.join("/");
  }

  async getTags(artifactId: string): Promise<IndexTag[]> {
    const workspaceDirs = await this.getWorkspaceDirs();

    const branches = await Promise.all(
      workspaceDirs.map((dir) => this.getBranch(dir)),
    );

    const tags: IndexTag[] = workspaceDirs.map((directory, i) => ({
      directory,
      branch: branches[i],
      artifactId,
    }));

    return tags;
  }

  getIdeInfo(): Promise<IdeInfo> {
    return Promise.resolve({
      ideType: "vscode",
      name: vscode.env.appName,
      version: vscode.version,
      remoteName: vscode.env.remoteName || "local",
      extensionVersion:
        getKnoxExtension()?.packageJSON.version,
    });
  }

  readRangeInFile(fileUri: string, range: Range): Promise<string> {
    return this.ideUtils.readRangeInFile(
      vscode.Uri.parse(fileUri),
      new vscode.Range(
        new vscode.Position(range.start.line, range.start.character),
        new vscode.Position(range.end.line, range.end.character),
      ),
    );
  }

  async getFileStats(files: string[]): Promise<FileStatsMap> {
    const pathToLastModified: FileStatsMap = {};
    await Promise.all(
      files.map(async (file) => {
        const stat = await vscode.workspace.fs.stat(vscode.Uri.parse(file));
        pathToLastModified[file] = {
          lastModified: stat.mtime,
          size: stat.size,
        };
      }),
    );

    return pathToLastModified;
  }

  async getRepo(dir: string): Promise<Repository | undefined> {
    return this.ideUtils.getRepo(vscode.Uri.parse(dir));
  }



  getUniqueId(): Promise<string> {
    return Promise.resolve(vscode.env.machineId);
  }

  async getDiff(includeUnstaged: boolean): Promise<string[]> {
    return await this.ideUtils.getDiff(includeUnstaged);
  }

  async getGitChangedFiles() {
    return await this.ideUtils.getGitChangedFiles();
  }

  async getClipboardContent() {
    return this.context.workspaceState.get("knoxchat.copyBuffer", {
      text: "",
      copiedAt: new Date("1900-01-01").toISOString(),
    });
  }

  async getTerminalContents(): Promise<string> {
    return await this.ideUtils.getTerminalContents(1);
  }

  async getDebugLocals(threadIndex: number): Promise<string> {
    return await this.ideUtils.getDebugLocals(threadIndex);
  }

  async getTopLevelCallStackSources(
    threadIndex: number,
    stackDepth: number,
  ): Promise<string[]> {
    return await this.ideUtils.getTopLevelCallStackSources(
      threadIndex,
      stackDepth,
    );
  }
  async getAvailableThreads(): Promise<Thread[]> {
    return await this.ideUtils.getAvailableThreads();
  }

  async debugControl(request: DebugControlRequest): Promise<DebugControlResult> {
    return await this.ideUtils.debugControl(request);
  }

  async getWorkspaceDirs(): Promise<string[]> {
    return this.ideUtils.getWorkspaceDirectories().map((uri) => uri.toString());
  }

  private static WRITE_RETRY_ATTEMPTS = 3;
  private static WRITE_RETRY_DELAY_MS = 300;
  private static WRITE_TIMEOUT_MS = 15_000;

  private findOpenTextDocument(uri: vscode.Uri): vscode.TextDocument | undefined {
    return vscode.workspace.textDocuments.find((doc) =>
      URI.equal(doc.uri.toString(), uri.toString()),
    );
  }

  /**
   * Write through the open editor buffer. `workspace.fs.writeFile` on a
   * dirty/open document races the buffer, can pop a revert dialog, and
   * often surfaces as a cancelled tool call that stops the agent.
   */
  private async writeOpenDocument(
    document: vscode.TextDocument,
    contents: string,
  ): Promise<boolean> {
    if (document.getText() === contents) {
      if (document.isDirty) {
        await document.save();
      }
      return true;
    }

    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length),
    );
    edit.replace(document.uri, fullRange, contents);
    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      return false;
    }
    if (document.isDirty) {
      await document.save();
    }
    return true;
  }

  async writeFile(fileUri: string, contents: string): Promise<void> {
    const uri = vscode.Uri.parse(fileUri);
    const openDoc = this.findOpenTextDocument(uri);
    if (openDoc) {
      try {
        if (await this.writeOpenDocument(openDoc, contents)) {
          return;
        }
      } catch (error) {
        console.warn(
          `[VsCodeIde.writeFile] Open-document edit failed for "${fileUri}", falling back to filesystem write:`,
          error instanceof Error ? error.message : error,
        );
      }
    }

    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= VsCodeIde.WRITE_RETRY_ATTEMPTS; attempt++) {
      try {
        await this.writeFileWithTimeout(uri, contents, VsCodeIde.WRITE_TIMEOUT_MS);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const isRetryable =
          lastError.message.includes("EBUSY") ||
          lastError.message.includes("EPERM") ||
          lastError.message.includes("EAGAIN") ||
          lastError.message.includes("disposed") ||
          lastError.message.includes("timeout") ||
          lastError.message.toLowerCase().includes("canceled") ||
          lastError.message.toLowerCase().includes("cancelled");

        if (!isRetryable || attempt >= VsCodeIde.WRITE_RETRY_ATTEMPTS) {
          break;
        }

        console.warn(
          `[VsCodeIde.writeFile] Attempt ${attempt}/${VsCodeIde.WRITE_RETRY_ATTEMPTS} failed for "${fileUri}": ${lastError.message}. Retrying in ${VsCodeIde.WRITE_RETRY_DELAY_MS * attempt}ms...`,
        );
        await new Promise((r) => setTimeout(r, VsCodeIde.WRITE_RETRY_DELAY_MS * attempt));
      }
    }

    throw new Error(
      `Failed to write file "${fileUri}" after ${VsCodeIde.WRITE_RETRY_ATTEMPTS} attempts: ${lastError?.message ?? "unknown error"}`,
    );
  }

  /**
   * Delete a file (used by ToolTransaction create-rollback).
   */
  async removeFile(fileUri: string): Promise<void> {
    const uri = vscode.Uri.parse(fileUri);
    try {
      await vscode.workspace.fs.delete(uri, { useTrash: false });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "FileNotFound" || code === "EntryNotFound") {
        return;
      }
      if (
        error instanceof vscode.FileSystemError &&
        (error.code === "FileNotFound" || error.code === "EntryNotFound")
      ) {
        return;
      }
      throw error;
    }
  }

  private async writeFileWithTimeout(
    uri: vscode.Uri,
    contents: string,
    timeoutMs: number,
  ): Promise<void> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const writePromise = vscode.workspace.fs.writeFile(
        uri,
        Buffer.from(contents),
      );
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () =>
            reject(
              new Error(
                `Write timeout after ${timeoutMs}ms for ${uri.toString()}`,
              ),
            ),
          timeoutMs,
        );
      });
      await Promise.race([writePromise, timeoutPromise]);
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  }

  async showVirtualFile(title: string, contents: string): Promise<void> {
    this.ideUtils.showVirtualFile(title, contents);
  }

  async openFile(fileUri: string): Promise<void> {
    await this.ideUtils.openFile(vscode.Uri.parse(fileUri));
  }

  async openGitChange(uri: string): Promise<void> {
    await this.ideUtils.openGitChange(uri);
  }

  async showLines(
    fileUri: string,
    startLine: number,
    endLine: number,
  ): Promise<void> {
    const range = new vscode.Range(
      new vscode.Position(startLine, 0),
      new vscode.Position(endLine, 0),
    );
    openEditorAndRevealRange(vscode.Uri.parse(fileUri), range).then(
      (editor) => {
        // Select the lines
        editor.selection = new vscode.Selection(
          new vscode.Position(startLine, 0),
          new vscode.Position(endLine, 0),
        );
      },
    );
  }

  async runCommand(
    command: string,
    options: TerminalOptions = { reuseTerminal: true },
  ): Promise<void> {
    let terminal: vscode.Terminal | undefined;
    if (vscode.window.terminals.length && options.reuseTerminal) {
      if (options.terminalName) {
        terminal = vscode.window.terminals.find(
          (t) => t?.name === options.terminalName,
        );
      } else {
        terminal = vscode.window.activeTerminal ?? vscode.window.terminals[0];
      }
    }

    if (!terminal) {
      terminal = vscode.window.createTerminal(options?.terminalName);
    }
    terminal.show();
    terminal.sendText(command, true);
  }

  async saveFile(fileUri: string): Promise<void> {
    await this.ideUtils.saveFile(vscode.Uri.parse(fileUri));
  }

  private static MAX_BYTES = 100000;

  private static READ_RETRY_ATTEMPTS = 3;
  private static READ_RETRY_DELAY_MS = 200;
  private static READ_TIMEOUT_MS = 10_000;

  async readFile(fileUri: string): Promise<string> {
    const uri = vscode.Uri.parse(fileUri);
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= VsCodeIde.READ_RETRY_ATTEMPTS; attempt++) {
      try {
        return await this.readFileInternal(uri);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Non-retryable errors: file not found, too large, permission denied
        const isNonRetryable =
          lastError.message.includes("FILE_TOO_LARGE") ||
          lastError.message.includes("ENOENT") ||
          lastError.message.includes("EACCES") ||
          lastError.message.includes("FileNotFound") ||
          lastError.message.includes("does not exist");

        if (isNonRetryable || attempt >= VsCodeIde.READ_RETRY_ATTEMPTS) {
          break;
        }

        console.warn(
          `[VsCodeIde.readFile] Attempt ${attempt}/${VsCodeIde.READ_RETRY_ATTEMPTS} failed for "${fileUri}": ${lastError.message}. Retrying...`,
        );
        await new Promise((r) => setTimeout(r, VsCodeIde.READ_RETRY_DELAY_MS * attempt));
      }
    }

    const message =
      lastError?.message ??
      `Failed to read "${fileUri}" after ${VsCodeIde.READ_RETRY_ATTEMPTS} attempts`;
    console.error(`[VsCodeIde.readFile] ${message}`);
    throw lastError ?? new Error(message);
  }

  private async readFileInternal(uri: vscode.Uri): Promise<string> {
    // Check notebook documents first
    const notebook =
      vscode.workspace.notebookDocuments.find((doc) =>
        URI.equal(doc.uri.toString(), uri.toString()),
      ) ??
      (uri.path.endsWith("ipynb")
        ? await vscode.workspace.openNotebookDocument(uri)
        : undefined);
    if (notebook) {
      return notebook
        .getCells()
        .map((cell) => cell.document.getText())
        .join("\n\n");
    }

    // Check open text documents (fast path — no disk I/O)
    const openTextDocument = vscode.workspace.textDocuments.find((doc) =>
      URI.equal(doc.uri.toString(), uri.toString()),
    );
    if (openTextDocument !== undefined) {
      return openTextDocument.getText();
    }

    // Read from disk with timeout
    const readPromise = this.readFileFromDisk(uri);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Read timeout after ${VsCodeIde.READ_TIMEOUT_MS}ms`)),
        VsCodeIde.READ_TIMEOUT_MS,
      ),
    );
    return Promise.race([readPromise, timeoutPromise]);
  }

  private async readFileFromDisk(uri: vscode.Uri): Promise<string> {
    const fileStats = await vscode.workspace.fs.stat(uri);
    if (fileStats.size > 10 * VsCodeIde.MAX_BYTES) {
      throw new Error(
        `FILE_TOO_LARGE: ${uri.toString()} is ${fileStats.size} bytes (max ${10 * VsCodeIde.MAX_BYTES})`,
      );
    }

    const bytes = await vscode.workspace.fs.readFile(uri);
    const truncatedBytes = bytes.slice(0, VsCodeIde.MAX_BYTES);
    return new TextDecoder().decode(truncatedBytes);
  }

  async openUrl(url: string): Promise<void> {
    await vscode.env.openExternal(vscode.Uri.parse(url));
  }

  async getOpenFiles(): Promise<string[]> {
    return this.ideUtils.getOpenFiles().map((uri) => uri.toString());
  }

  async getCurrentFile() {
    if (!vscode.window.activeTextEditor) {
      return undefined;
    }
    return {
      isUntitled: vscode.window.activeTextEditor.document.isUntitled,
      path: vscode.window.activeTextEditor.document.uri.toString(),
      contents: vscode.window.activeTextEditor.document.getText(),
    };
  }

  async getPinnedFiles(): Promise<string[]> {
    const tabArray = vscode.window.tabGroups.all[0].tabs;

    return tabArray
      .filter((t) => t.isPinned)
      .map((t) => (t.input as vscode.TabInputText).uri.toString());
  }

  private resolveRipgrepBinary(): string | undefined {
    return resolveRipgrepBinary([], vscode.env.appRoot);
  }

  async getSearchResults(query: string, options?: SearchOptions): Promise<string> {
    const ripGrepPath = this.resolveRipgrepBinary();
    if (!ripGrepPath) {
      console.error("[ExactSearch] ripgrep binary not found");
      return "Error: ripgrep binary not found. KnoxCoder product ripgrep was not resolved from vscode.env.appRoot.";
    }

    const workspaceFsPaths = (await this.getWorkspaceDirs()).map((dir) =>
      vscode.Uri.parse(dir).fsPath,
    );
    return searchWorkspaceWithRipgrep(
      workspaceFsPaths,
      query,
      options,
      ripGrepPath,
    );
  }

  async getProblems(fileUri?: string | undefined): Promise<Problem[]> {
    const uri = fileUri
      ? vscode.Uri.parse(fileUri)
      : vscode.window.activeTextEditor?.document.uri;
    if (!uri) {
      return [];
    }
    return vscode.languages.getDiagnostics(uri).map((d) => {
      return {
        filepath: uri.toString(),
        range: {
          start: {
            line: d.range.start.line,
            character: d.range.start.character,
          },
          end: { line: d.range.end.line, character: d.range.end.character },
        },
        message: d.message,
      };
    });
  }

  /**
   * Shared post-edit verification hook used by Core tools/call (GUI + agent).
   */
  async runPostEditVerification(params: {
    toolName: string;
    toolArguments: unknown;
    selectedModelTitle: string;
  }): Promise<ContextItem[]> {
    const { runPostEditVerification } = await import(
      "./agent/postEditVerification"
    );
    return runPostEditVerification(params);
  }

  /**
   * Safety checkpoint before mutating tools (GUI chat + agent via Core tools/call).
   */
  async runPreRiskyCheckpoint(params: {
    toolName: string;
    sessionId?: string;
    turnId?: string;
  }): Promise<{ checkpointId?: string } | void> {
    const { AutoCheckpointSystem } = await import(
      "./checkpoints/AutoCheckpointSystem"
    );
    await AutoCheckpointSystem.getInstance().onBeforeRiskyOperation(
      params.toolName,
    );
  }

  async ensureTurnCheckpoint(params: {
    sessionId: string;
    turnId: string;
    toolName: string;
  }): Promise<string | undefined> {
    const { CheckpointManager } = await import("./checkpoints/CheckpointManager");
    return CheckpointManager.getInstance().ensureTurnCheckpoint(params);
  }

  async listWorkspaceCheckpoints(limit?: number): Promise<
    Array<{
      id: string;
      description: string;
      created: string;
      sessionId?: string;
      fileCount?: number;
    }>
  > {
    const { CheckpointManager, listedCheckpointFileCount } = await import(
      "./checkpoints/CheckpointManager"
    );
    const cap =
      typeof limit === "number" && Number.isFinite(limit)
        ? Math.min(50, Math.max(1, Math.floor(limit)))
        : 15;
    return CheckpointManager.getInstance()
      .getCheckpointHistoryForWorkspace()
      .sort((a, b) => b.created.getTime() - a.created.getTime())
      .slice(0, cap)
      .map((checkpoint) => ({
        id: checkpoint.id,
        description: checkpoint.description,
        created: checkpoint.created.toISOString(),
        sessionId: checkpoint.conversationContext?.sessionId,
        fileCount: listedCheckpointFileCount(checkpoint),
      }));
  }

  async createWorkspaceCheckpoint(params: {
    description?: string;
    sessionId?: string;
  }): Promise<string | undefined> {
    const { CheckpointManager } = await import("./checkpoints/CheckpointManager");
    return CheckpointManager.getInstance().createAgentCheckpoint({
      description: params.description,
      sessionId: params.sessionId,
    });
  }

  async restoreWorkspaceCheckpoint(params: {
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
  }> {
    const { CheckpointChatIntegration } = await import(
      "./checkpoints/commands"
    );
    const result =
      await CheckpointChatIntegration.getInstance().restoreCheckpointDirect(
        params.checkpointId,
        { rewindMemory: params.rewindMemory },
      );
    return {
      success: result.success,
      restoredFiles: result.restoredFiles ?? [],
      failedFiles: result.failedFiles,
      skippedFiles: result.skippedFiles,
      message: result.message,
      memoryRewound: result.memoryRewound,
      memoryMessage: result.memoryMessage,
    };
  }

  async previewWorkspaceCheckpointRestore(params: {
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
  } | null> {
    const { CheckpointManager } = await import("./checkpoints/CheckpointManager");
    return CheckpointManager.getInstance().previewRestore(params.checkpointId);
  }

  async diffWorkspaceCheckpoint(params: {
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
  } | null> {
    const { CheckpointManager } = await import("./checkpoints/CheckpointManager");
    const { summarizeCheckpointDiff } = await import(
      "./checkpoints/manager/restorePreview"
    );
    const manager = CheckpointManager.getInstance();
    const diff = params.compareToWorkspace
      ? await manager.computeCheckpointDiffAgainstWorkspace(params.checkpointId)
      : await manager.computeCheckpointDiff(
          params.checkpointId,
          params.compareToCheckpointId,
        );
    return diff ? summarizeCheckpointDiff(diff) : null;
  }

  async deleteWorkspaceCheckpoint(params: {
    checkpointId: string;
  }): Promise<{ success: boolean; message?: string }> {
    const { CheckpointChatIntegration } = await import(
      "./checkpoints/commands"
    );
    const success = await CheckpointChatIntegration.getInstance().deleteCheckpoint(
      params.checkpointId,
    );
    return {
      success,
      message: success ? undefined : "Checkpoint not found or could not be deleted",
    };
  }

  async pinWorkspaceCheckpoint(params: {
    checkpointId: string;
    pinned: boolean;
  }): Promise<{ success: boolean; message?: string }> {
    const { CheckpointChatIntegration } = await import(
      "./checkpoints/commands"
    );
    const success = await CheckpointChatIntegration.getInstance().pinCheckpoint(
      params.checkpointId,
      params.pinned,
    );
    return {
      success,
      message: success
        ? undefined
        : "Checkpoint not found or pin state could not be updated",
    };
  }

  /**
   * Snapshot target file before mutation (GUI chat + agent via Core tools/call).
   */
  async captureMutatingToolBefore(params: {
    toolName: string;
    toolArguments: unknown;
  }): Promise<string | null> {
    const { captureMutatingToolBefore } = await import(
      "./agent/mutatingToolUndo"
    );
    return captureMutatingToolBefore(params);
  }

  /**
   * Record undo/redo snapshots after mutation (GUI chat + agent via Core tools/call).
   */
  async recordMutatingToolAfter(params: {
    toolName: string;
    toolArguments: unknown;
    beforeId: string | null;
    commit?: boolean;
  }): Promise<void> {
    const { recordMutatingToolAfter } = await import(
      "./agent/mutatingToolUndo"
    );
    return recordMutatingToolAfter(params);
  }

  async subprocess(command: string, cwd?: string): Promise<[string, string]> {
    return new Promise((resolve, reject) => {
      exec(command, { cwd }, (error, stdout, stderr) => {
        if (error) {
          console.warn(error);
          reject(stderr);
        }
        resolve([stdout, stderr]);
      });
    });
  }

  async getBranch(dir: string): Promise<string> {
    return this.ideUtils.getBranch(vscode.Uri.parse(dir));
  }

  async getGitRootPath(dir: string): Promise<string | undefined> {
    const root = await this.ideUtils.getGitRoot(vscode.Uri.parse(dir));
    return root?.toString();
  }

  async listDir(dir: string): Promise<[string, FileType][]> {
    return vscode.workspace.fs.readDirectory(vscode.Uri.parse(dir)) as any;
  }

  private getIdeSettingsSync(): IdeSettings {
    const knox = vscode.workspace.getConfiguration(EXTENSION_NAME);
    const verifyMaxIterations = knox.get<number>("verifyMaxIterations");
    const verifyCommand = knox.get<string>("verifyCommand")?.trim();
    const ideSettings: IdeSettings = {
      agentProfile: knox.get<"default" | "systems" | "rust" | "auto">(
        "agentProfile",
      ),
      agentVerifyCommand: verifyCommand || undefined,
      agentVerifyMode: knox.get<"diagnostics" | "command" | "off">(
        "verifyMode",
      ),
      agentVerifyMaxIterations:
        typeof verifyMaxIterations === "number"
          ? verifyMaxIterations
          : undefined,
    };
    return ideSettings;
  }

  async getIdeSettings(): Promise<IdeSettings> {
    const ideSettings = this.getIdeSettingsSync();
    return ideSettings;
  }
}

export { VsCodeIde };
