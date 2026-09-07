import { EXTENSION_NAME } from "core/config/extensionName";
import { findUriInDirs } from "core/util/uri";
import * as URI from "core/util/uriApi";
import * as vscode from "vscode";

import { t } from "../i18n";

import { threadStopped } from "../debug/debug";
import { VsCodeExtension } from "../extension/VsCodeExtension";
import { GitExtension, Repository } from "../otherExtensions/git";
import {
  SuggestionRanges,
  acceptSuggestionCommand,
  rejectSuggestionCommand,
  showSuggestion as showSuggestionInEditor,
} from "../suggestions";

import { getUniqueId, openEditorAndRevealRange } from "./vscode";

import type { DebugControlRequest, DebugControlResult, Range, RangeInFile, Thread } from "core";
import { formatBacktrace } from "core/tools/debug/types";

const util = require("node:util");
const asyncExec = util.promisify(require("node:child_process").exec);

export class VsCodeIdeUtils {
  visibleMessages: Set<string> = new Set();

  async gotoDefinition(
    uri: vscode.Uri,
    position: vscode.Position,
  ): Promise<vscode.Location[]> {
    const locations: vscode.Location[] = await vscode.commands.executeCommand(
      "vscode.executeDefinitionProvider",
      uri,
      position,
    );
    return locations;
  }

  async documentSymbol(uri: vscode.Uri): Promise<vscode.DocumentSymbol[]> {
    return await vscode.commands.executeCommand(
      "vscode.executeDocumentSymbolProvider",
      uri,
    );
  }

  async references(
    uri: vscode.Uri,
    position: vscode.Position,
  ): Promise<vscode.Location[]> {
    return await vscode.commands.executeCommand(
      "vscode.executeReferenceProvider",
      uri,
      position,
    );
  }

  async foldingRanges(uri: vscode.Uri): Promise<vscode.FoldingRange[]> {
    return await vscode.commands.executeCommand(
      "vscode.executeFoldingRangeProvider",
      uri,
    );
  }

  private _workspaceDirectories: vscode.Uri[] | undefined = undefined;
  getWorkspaceDirectories(): vscode.Uri[] {
    if (this._workspaceDirectories === undefined) {
      this._workspaceDirectories =
        vscode.workspace.workspaceFolders?.map((folder) => folder.uri) || [];
    }

    return this._workspaceDirectories;
  }

  getUniqueId() {
    return getUniqueId();
  }

  showSuggestion(uri: vscode.Uri, range: Range, suggestion: string) {
    showSuggestionInEditor(
      uri,
      new vscode.Range(
        range.start.line,
        range.start.character,
        range.end.line,
        range.end.character,
      ),
      suggestion,
    );
  }

  async openFile(uri: vscode.Uri, range?: vscode.Range) {
    // vscode has a builtin open/get open files
    return await openEditorAndRevealRange(
      uri,
      range,
      vscode.ViewColumn.One,
      false,
    );
  }

  async fileExists(uri: vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }

  showVirtualFile(name: string, contents: string) {
    vscode.workspace
      .openTextDocument(
        vscode.Uri.parse(
          `${
            VsCodeExtension.knoxVirtualDocumentScheme
          }:${encodeURIComponent(name)}?${encodeURIComponent(contents)}`,
        ),
      )
      .then((doc) => {
        vscode.window.showTextDocument(doc, { preview: false });
      });
  }

  async getUserSecret(key: string) {
    // Check if secret already exists in VS Code settings (global)
    let secret = vscode.workspace.getConfiguration(EXTENSION_NAME).get(key);
    if (typeof secret !== "undefined" && secret !== null) {
      return secret;
    }

    // If not, ask user for secret
    secret = await vscode.window.showInputBox({
      prompt: t("ideUtils.enterSecret", { key }),
      password: true,
    });

    // Add secret to VS Code settings
    vscode.workspace
      .getConfiguration(EXTENSION_NAME)
      .update(key, secret, vscode.ConfigurationTarget.Global);

    return secret;
  }

  // ------------------------------------ //
  // Initiate Request

  acceptRejectSuggestion(accept: boolean, key: SuggestionRanges) {
    if (accept) {
      acceptSuggestionCommand(key);
    } else {
      rejectSuggestionCommand(key);
    }
  }

  // ------------------------------------ //
  // Respond to request

  // Checks to see if the editor is a code editor.
  // In some cases vscode.window.visibleTextEditors can return non-code editors
  // e.g. terminal editors in side-by-side mode
  private documentIsCode(uri: vscode.Uri) {
    return uri.scheme === "file" || uri.scheme === "vscode-remote";
  }

  getOpenFiles(): vscode.Uri[] {
    return vscode.window.tabGroups.all
      .map((group) => {
        return group.tabs.map((tab) => {
          return (tab.input as any)?.uri;
        });
      })
      .flat()
      .filter(Boolean) // filter out undefined values
      .filter((uri) => this.documentIsCode(uri)); // Filter out undesired documents
  }

  saveFile(uri: vscode.Uri) {
    vscode.window.visibleTextEditors
      .filter((editor) => this.documentIsCode(editor.document.uri))
      .forEach((editor) => {
        if (URI.equal(editor.document.uri.toString(), uri.toString())) {
          editor.document.save();
        }
      });
  }

  async readRangeInFile(uri: vscode.Uri, range: vscode.Range): Promise<string> {
    const contents = new TextDecoder().decode(
      await vscode.workspace.fs.readFile(uri),
    );
    const lines = contents.split("\n");
    return `${lines
      .slice(range.start.line, range.end.line)
      .join("\n")}\n${lines[
      range.end.line < lines.length - 1 ? range.end.line : lines.length - 1
    ].slice(0, range.end.character)}`;
  }

  async getTerminalContents(commands = -1): Promise<string> {
    const tempCopyBuffer = await vscode.env.clipboard.readText();
    if (commands < 0) {
      await vscode.commands.executeCommand(
        "workbench.action.terminal.selectAll",
      );
    } else {
      for (let i = 0; i < commands; i++) {
        await vscode.commands.executeCommand(
          "workbench.action.terminal.selectToPreviousCommand",
        );
      }
    }
    await vscode.commands.executeCommand(
      "workbench.action.terminal.copySelection",
    );
    await vscode.commands.executeCommand(
      "workbench.action.terminal.clearSelection",
    );
    let terminalContents = (await vscode.env.clipboard.readText()).trim();
    await vscode.env.clipboard.writeText(tempCopyBuffer);

    if (tempCopyBuffer === terminalContents) {
      // This means there is no terminal open to select text from
      return "";
    }

    // Sometimes the above won't successfully separate by command, so we attempt manually
    const lines = terminalContents.split("\n");
    const lastLine = lines.pop()?.trim();
    if (lastLine) {
      let i = lines.length - 1;
      while (i >= 0 && !lines[i].trim().startsWith(lastLine)) {
        i--;
      }
      terminalContents = lines.slice(Math.max(i, 0)).join("\n");
    }

    return terminalContents;
  }

  private async _getThreads(session: vscode.DebugSession) {
    const threadsResponse = await session.customRequest("threads");
    const threads = threadsResponse.threads.filter((thread: any) =>
      threadStopped.get(thread.id),
    );
    threads.sort((a: any, b: any) => a.id - b.id);
    threadsResponse.threads = threads;

    return threadsResponse;
  }

  async getAvailableThreads(): Promise<Thread[]> {
    const session = vscode.debug.activeDebugSession;
    if (!session) {
      return [];
    }

    const threadsResponse = await this._getThreads(session);
    return threadsResponse.threads;
  }

  async debugControl(request: DebugControlRequest): Promise<DebugControlResult> {
    const session = vscode.debug.activeDebugSession;
    const folder = vscode.workspace.workspaceFolders?.[0];
    const threadId = request.threadId ?? 1;

    const noSession = (): DebugControlResult => ({
      ok: false,
      content:
        "No active debug session. Use op=launch with a launch.json name, or op=attach target=:1234 (QEMU -s -S).",
      sessionActive: false,
    });

    try {
      switch (request.op) {
        case "status":
          return {
            ok: true,
            content: session
              ? `session ${session.name} (${session.type})`
              : "no debug session",
            sessionActive: Boolean(session),
          };
        case "launch": {
          const named = request.name?.trim();
          const program = request.program?.trim();
          if (!named && !program) {
            return {
              ok: false,
              content: "launch needs name= (launch.json) or program=.",
              sessionActive: Boolean(session),
            };
          }
          const config = named
            ? named
            : {
                type: "gdb",
                request: "launch" as const,
                name: "Knox Agent",
                program,
                cwd: request.cwd,
                args: request.args,
              };
          const ok = await vscode.debug.startDebugging(folder, config);
          return {
            ok,
            content: ok
              ? `Launched ${named || program}`
              : `Failed to launch ${named || program}. Check launch.json / Native Debug / CodeLLDB.`,
            sessionActive: ok,
          };
        }
        case "attach": {
          const named = request.name?.trim();
          const port = request.port ?? 1234;
          const target =
            request.target?.trim() ||
            (typeof request.port === "number" ? `:${port}` : ":1234");
          const config = named
            ? named
            : {
                type: "gdb",
                request: "attach" as const,
                name: "Knox gdbstub",
                target: target.replace(/^:/, "localhost:"),
                cwd: request.cwd,
                remote: true,
              };
          const ok = await vscode.debug.startDebugging(folder, config);
          return {
            ok,
            content: ok
              ? `Attached ${named || target}`
              : `Failed to attach ${named || target}. Prefer a launch.json attach config.`,
            sessionActive: ok,
          };
        }
        case "breakpoint": {
          const filePath = request.filePath?.trim();
          const line = request.line;
          if (!filePath || typeof line !== "number" || line < 1) {
            return {
              ok: false,
              content: "breakpoint needs filePath and a 1-based line.",
              sessionActive: Boolean(session),
            };
          }
          const uri = vscode.Uri.file(filePath);
          if (request.enabled === false) {
            const existing = vscode.debug.breakpoints.filter((bp) => {
              if (!(bp instanceof vscode.SourceBreakpoint)) {
                return false;
              }
              return (
                bp.location.uri.fsPath === uri.fsPath &&
                bp.location.range.start.line === line - 1
              );
            });
            vscode.debug.removeBreakpoints(existing);
            return {
              ok: true,
              content: `Removed breakpoint ${filePath}:${line}`,
              sessionActive: Boolean(session),
            };
          }
          vscode.debug.addBreakpoints([
            new vscode.SourceBreakpoint(
              new vscode.Location(uri, new vscode.Position(line - 1, 0)),
              true,
            ),
          ]);
          return {
            ok: true,
            content: `Breakpoint ${filePath}:${line}`,
            sessionActive: Boolean(session),
          };
        }
        case "continue": {
          if (!session) {
            return noSession();
          }
          await session.customRequest("continue", { threadId });
          return { ok: true, content: "continue", sessionActive: true };
        }
        case "step": {
          if (!session) {
            return noSession();
          }
          const dap =
            request.step === "into"
              ? "stepIn"
              : request.step === "out"
                ? "stepOut"
                : "next";
          await session.customRequest(dap, { threadId });
          return {
            ok: true,
            content: `step ${request.step ?? "over"}`,
            sessionActive: true,
          };
        }
        case "backtrace": {
          if (!session) {
            return noSession();
          }
          const trace = await session.customRequest("stackTrace", {
            threadId,
            startFrame: 0,
            levels: 32,
          });
          const frames = (trace?.stackFrames ?? []).map((frame: any) => ({
            id: frame.id as number,
            name: String(frame.name ?? "?"),
            file: frame.source?.path as string | undefined,
            line: frame.line as number | undefined,
            column: frame.column as number | undefined,
          }));
          return {
            ok: true,
            content: formatBacktrace(frames),
            sessionActive: true,
            frames,
          };
        }
        case "locals": {
          if (!session) {
            return noSession();
          }
          const locals = await this.getDebugLocals(threadId);
          return {
            ok: true,
            content: locals.trim() || "(no locals)",
            sessionActive: true,
          };
        }
        case "evaluate": {
          if (!session) {
            return noSession();
          }
          const expression = request.expression?.trim();
          if (!expression) {
            return {
              ok: false,
              content: "evaluate needs expression.",
              sessionActive: true,
            };
          }
          let frameId = request.frameId;
          if (typeof frameId !== "number") {
            const trace = await session.customRequest("stackTrace", {
              threadId,
              startFrame: 0,
              levels: 1,
            });
            frameId = trace?.stackFrames?.[0]?.id;
          }
          const evaluated = await session.customRequest("evaluate", {
            expression,
            frameId,
            context: "repl",
          });
          return {
            ok: true,
            content: `${expression} = ${evaluated?.result ?? "(no result)"}`,
            sessionActive: true,
          };
        }
        case "disconnect": {
          if (!session) {
            return { ok: true, content: "no session", sessionActive: false };
          }
          await vscode.debug.stopDebugging(session);
          return { ok: true, content: "disconnected", sessionActive: false };
        }
        default:
          return {
            ok: false,
            content: `Unknown debug op: ${request.op}`,
            sessionActive: Boolean(session),
          };
      }
    } catch (error) {
      return {
        ok: false,
        content: `DAP error: ${(error as Error).message}`,
        sessionActive: Boolean(vscode.debug.activeDebugSession),
      };
    }
  }

  async getDebugLocals(threadIndex = 0): Promise<string> {
    const session = vscode.debug.activeDebugSession;

    if (!session) {
      vscode.window.showWarningMessage(
        "No active debug session found, therefore no debug context will be provided for the llm.",
      );
      return "";
    }

    const variablesResponse = await session
      .customRequest("stackTrace", {
        threadId: threadIndex,
        startFrame: 0,
      })
      .then((traceResponse) =>
        session.customRequest("scopes", {
          frameId: traceResponse.stackFrames[0].id,
        }),
      )
      .then((scopesResponse) =>
        session.customRequest("variables", {
          variablesReference: scopesResponse.scopes[0].variablesReference,
        }),
      );

    const variableContext = variablesResponse.variables
      .filter((variable: any) => variable.type !== "global")
      .reduce(
        (acc: any, variable: any) =>
          `${acc}\nname: ${variable.name}, type: ${variable.type}, ` +
          `value: ${variable.value}`,
        "",
      );

    return variableContext;
  }

  async getTopLevelCallStackSources(
    threadIndex: number,
    stackDepth = 3,
  ): Promise<string[]> {
    const session = vscode.debug.activeDebugSession;
    if (!session) {
      return [];
    }

    const sourcesPromises = await session
      .customRequest("stackTrace", {
        threadId: threadIndex,
        startFrame: 0,
      })
      .then((traceResponse) =>
        traceResponse.stackFrames
          .slice(0, stackDepth)
          .map(async (stackFrame: any) => {
            const scopeResponse = await session.customRequest("scopes", {
              frameId: stackFrame.id,
            });

            const scope = scopeResponse.scopes[0];

            return await this.retrieveSource(
              scope.source && Object.keys(scope.source).length > 0
                ? scope
                : stackFrame,
            );
          }),
      );

    return Promise.all(sourcesPromises);
  }

  private async retrieveSource(sourceContainer: any): Promise<string> {
    if (!sourceContainer.source) {
      return "";
    }

    const sourceRef = sourceContainer.source.sourceReference;
    if (sourceRef && sourceRef > 0) {
      // according to the spec, source might be ony available in a debug session
      // not yet able to test this branch
      const sourceResponse =
        await vscode.debug.activeDebugSession?.customRequest("source", {
          source: sourceContainer.source,
          sourceReference: sourceRef,
        });
      return sourceResponse.content;
    } else if (sourceContainer.line && sourceContainer.endLine) {
      return await this.readRangeInFile(
        sourceContainer.source.path,
        new vscode.Range(
          sourceContainer.line - 1, // The line number from scope response starts from 1
          sourceContainer.column,
          sourceContainer.endLine - 1,
          sourceContainer.endColumn,
        ),
      );
    } else if (sourceContainer.line) {
      // fall back to 5 line of context
      return await this.readRangeInFile(
        sourceContainer.source.path,
        new vscode.Range(
          Math.max(0, sourceContainer.line - 3),
          0,
          sourceContainer.line + 2,
          0,
        ),
      );
    } else {
      return "unavailable";
    }
  }

  private async _getRepo(
    forDirectory: vscode.Uri,
  ): Promise<Repository | undefined> {
    // Use the native git extension to get the branch name
    const extension =
      vscode.extensions.getExtension<GitExtension>("vscode.git");
    if (
      typeof extension === "undefined" ||
      !extension.isActive ||
      typeof vscode.workspace.workspaceFolders === "undefined"
    ) {
      return undefined;
    }

    try {
      const git = extension.exports.getAPI(1);
      return git.getRepository(forDirectory) ?? undefined;
    } catch (e) {
      this._repoWasNone = true;
      console.warn("Git not found: ", e);
      return undefined;
    }
  }

  private _getRepositories(): Repository[] | undefined {
    const extension =
      vscode.extensions.getExtension<GitExtension>("vscode.git");
    if (
      typeof extension === "undefined" ||
      !extension.isActive ||
      typeof vscode.workspace.workspaceFolders === "undefined"
    ) {
      return undefined;
    }

    try {
      const git = extension.exports.getAPI(1);
      return git.repositories;
    } catch (e) {
      this._repoWasNone = true;
      console.warn("Git not found: ", e);
      return undefined;
    }
  }

  private _repoWasNone: boolean = false;
  private repoCache: Map<string, Repository> = new Map();
  private gitChangeListeners = new Set<() => void>();
  private gitWatchDisposables: vscode.Disposable[] = [];
  private gitChangeDebounce?: NodeJS.Timeout;
  private static secondsToWaitForGitToLoad =
    process.env.NODE_ENV === "test" ? 1 : 20;
  async getRepo(forDirectory: vscode.Uri): Promise<Repository | undefined> {
    const workspaceDirs = this.getWorkspaceDirectories().map((dir) =>
      dir.toString(),
    );
    const { foundInDir } = findUriInDirs(
      forDirectory.toString(),
      workspaceDirs,
    );
    if (foundInDir) {
      // Check if the repository is already cached
      const cachedRepo = this.repoCache.get(foundInDir);
      if (cachedRepo) {
        return cachedRepo;
      }
    }

    let repo = await this._getRepo(forDirectory);

    let i = 0;
    while (!repo?.state?.HEAD?.name) {
      if (this._repoWasNone) {
        return undefined;
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
      i++;
      if (i >= VsCodeIdeUtils.secondsToWaitForGitToLoad) {
        this._repoWasNone = true;
        return undefined;
      }
      repo = await this._getRepo(forDirectory);
    }

    if (foundInDir) {
      // Cache the repository for the parent directory
      this.repoCache.set(foundInDir, repo);
    }

    return repo;
  }

  async getGitRoot(forDirectory: vscode.Uri): Promise<vscode.Uri | undefined> {
    const repo = await this.getRepo(forDirectory);
    return repo?.rootUri;
  }

  async getBranch(forDirectory: vscode.Uri) {
    const repo = await this.getRepo(forDirectory);
    if (repo?.state?.HEAD?.name === undefined) {
      try {
        const { stdout } = await asyncExec("git rev-parse --abbrev-ref HEAD", {
          cwd: forDirectory.fsPath,
        });
        return stdout?.trim() || "NONE";
      } catch (e) {
        return "NONE";
      }
    }

    return repo?.state?.HEAD?.name || "NONE";
  }

  private splitDiff(diffString: string): string[] {
    const fileDiffHeaderRegex = /(?=diff --git a\/.* b\/.*)/;

    const diffs = diffString.split(fileDiffHeaderRegex);

    if (diffs[0].trim() === "") {
      diffs.shift();
    }

    return diffs;
  }

  private parseDiffNumstat(
    output: string,
  ): Map<string, { additions: number; deletions: number; isBinary: boolean }> {
    const stats = new Map<
      string,
      { additions: number; deletions: number; isBinary: boolean }
    >();

    for (const line of output.split("\n")) {
      if (!line.trim()) continue;
      const parts = line.split("\t");
      if (parts.length < 3) continue;

      const [additionsRaw, deletionsRaw, ...pathParts] = parts;
      const filepath = pathParts.join("\t").trim().replace(/\\/g, "/");
      const normalizedPath = this.normalizeGitNumstatPath(filepath);
      const isBinary = additionsRaw === "-" && deletionsRaw === "-";
      const additions = isBinary ? 0 : Number.parseInt(additionsRaw, 10) || 0;
      const deletions = isBinary ? 0 : Number.parseInt(deletionsRaw, 10) || 0;

      const existing = stats.get(normalizedPath);
      if (existing) {
        stats.set(normalizedPath, {
          additions: existing.additions + additions,
          deletions: existing.deletions + deletions,
          isBinary: existing.isBinary || isBinary,
        });
      } else {
        stats.set(normalizedPath, { additions, deletions, isBinary });
      }
    }

    return stats;
  }

  private normalizeGitNumstatPath(filepath: string): string {
    const renamedMatch = filepath.match(/^(.*)\{(.+) => (.+)\}(.*)$/);
    if (renamedMatch) {
      const [, prefix, , newName, suffix] = renamedMatch;
      return `${prefix}${newName}${suffix}`.replace(/\\/g, "/");
    }
    return filepath.replace(/\\/g, "/");
  }

  private async getRepoDiffStats(
    repo: Repository,
  ): Promise<Map<string, { additions: number; deletions: number; isBinary: boolean }>> {
    const stats = new Map<
      string,
      { additions: number; deletions: number; isBinary: boolean }
    >();

    try {
      const { stdout } = await asyncExec("git diff HEAD --numstat", {
        cwd: repo.rootUri.fsPath,
        maxBuffer: 10 * 1024 * 1024,
      });
      for (const [path, value] of this.parseDiffNumstat(stdout)) {
        stats.set(path, value);
      }
    } catch (e) {
      console.error("[getRepoDiffStats] git diff HEAD --numstat failed", e);
    }

    // Fallback: merge staged + unstaged hunk stats when numstat is unavailable.
    if (stats.size === 0) {
      try {
        const staged = await repo.diff(true);
        const unstaged = await repo.diff(false);
        for (const diff of this.splitDiff(`${staged}\n${unstaged}`)) {
          const parsed = this.parseDiffHunkStats(diff);
          if (!parsed) continue;
          const existing = stats.get(parsed.filepath);
          if (existing) {
            stats.set(parsed.filepath, {
              additions: existing.additions + parsed.additions,
              deletions: existing.deletions + parsed.deletions,
              isBinary: existing.isBinary || parsed.isBinary,
            });
          } else {
            stats.set(parsed.filepath, parsed);
          }
        }
      } catch (e) {
        console.error("[getRepoDiffStats] repo.diff fallback failed", e);
      }
    }

    return stats;
  }

  private parseDiffHunkStats(diffString: string): {
    filepath: string;
    additions: number;
    deletions: number;
    isBinary: boolean;
  } | null {
    const headerMatch = diffString.match(/^diff --git a\/(.*?) b\/(.*)/m);
    if (!headerMatch) return null;

    const filepath = headerMatch[2].replace(/\\/g, "/");
    const isBinary = /Binary files/.test(diffString);
    let additions = 0;
    let deletions = 0;

    if (!isBinary) {
      const lines = diffString.split("\n");
      let inHunk = false;
      for (const line of lines) {
        if (line.startsWith("@@")) {
          inHunk = true;
          continue;
        }
        if (!inHunk) continue;
        if (line.startsWith("+") && !line.startsWith("+++")) additions++;
        else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
      }
    }

    return { filepath, additions, deletions, isBinary };
  }

  private findDiffStats(
    filepath: string,
    diffStats: Map<string, { additions: number; deletions: number; isBinary: boolean }>,
  ): { additions: number; deletions: number; isBinary: boolean } | undefined {
    const normalized = filepath.replace(/\\/g, "/");
    if (diffStats.has(normalized)) {
      return diffStats.get(normalized);
    }

    for (const [diffPath, stats] of diffStats) {
      if (
        normalized === diffPath ||
        normalized.endsWith(`/${diffPath}`) ||
        diffPath.endsWith(`/${normalized}`)
      ) {
        return stats;
      }
    }

    return undefined;
  }

  private toRepoRelativePath(uri: vscode.Uri, repo: Repository): string {
    const root = repo.rootUri.fsPath.replace(/\\/g, "/");
    const full = uri.fsPath.replace(/\\/g, "/");
    if (full === root) {
      return "";
    }
    if (full.startsWith(`${root}/`)) {
      return full.slice(root.length + 1);
    }
    return full;
  }

  watchGitChanges(onChange: () => void): vscode.Disposable {
    this.gitChangeListeners.add(onChange);
    this.ensureGitWatchers();
    return new vscode.Disposable(() => {
      this.gitChangeListeners.delete(onChange);
    });
  }

  private notifyGitChanged() {
    if (this.gitChangeDebounce) {
      clearTimeout(this.gitChangeDebounce);
    }
    this.gitChangeDebounce = setTimeout(() => {
      for (const listener of this.gitChangeListeners) {
        listener();
      }
    }, 300);
  }

  private ensureGitWatchers() {
    if (this.gitWatchDisposables.length > 0) {
      return;
    }

    const extension =
      vscode.extensions.getExtension<GitExtension>("vscode.git");
    if (!extension?.isActive) {
      return;
    }

    try {
      const git = extension.exports.getAPI(1);
      const watchRepo = (repo: Repository) => {
        this.gitWatchDisposables.push(
          repo.state.onDidChange(() => this.notifyGitChanged()),
        );
      };

      for (const repo of git.repositories) {
        watchRepo(repo);
      }

      this.gitWatchDisposables.push(
        git.onDidOpenRepository((repo) => {
          watchRepo(repo);
          this.notifyGitChanged();
        }),
        git.onDidCloseRepository(() => this.notifyGitChanged()),
      );
    } catch (e) {
      console.warn("[watchGitChanges] Git watcher setup failed:", e);
    }
  }

  async openGitChange(uri: string): Promise<void> {
    const parsed = vscode.Uri.parse(uri);
    await vscode.commands.executeCommand("git.openChange", parsed);
  }

  async getDiff(includeUnstaged: boolean): Promise<string[]> {
    const diffs: string[] = [];

    const repos = this._getRepositories();

    try {
      if (repos) {
        for (const repo of repos) {

          const staged = await repo.diff(true);

          diffs.push(staged);
          if (includeUnstaged) {
            const unstaged = await repo.diff(false);
            diffs.push(unstaged);
          }
        }
      }

      return diffs.flatMap((diff) => this.splitDiff(diff));

    } catch (e) {
      console.error(e);
      return [];
    }

  }

  async getGitChangedFiles(): Promise<
    Array<{
      filepath: string;
      uri: string;
      status: "modified" | "added" | "deleted" | "renamed" | "untracked";
      staged: boolean;
      additions?: number;
      deletions?: number;
      isBinary?: boolean;
    }>
  > {
    type ChangedFile = {
      filepath: string;
      uri: string;
      status: "modified" | "added" | "deleted" | "renamed" | "untracked";
      staged: boolean;
      additions?: number;
      deletions?: number;
      isBinary?: boolean;
    };

    const byPath = new Map<string, ChangedFile>();
    const repos = this._getRepositories();
    if (!repos) return [];

    const toRelativePath = (uri: vscode.Uri): string => {
      const workspaceDirs = this.getWorkspaceDirectories().map((dir) =>
        dir.toString(),
      );
      const { relativePathOrBasename } = findUriInDirs(
        uri.toString(),
        workspaceDirs,
      );
      return relativePathOrBasename.replace(/\\/g, "/");
    };

    const countFileLines = async (uri: vscode.Uri): Promise<number> => {
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        if (bytes.length === 0) return 0;
        let lines = 1;
        for (const byte of bytes) {
          if (byte === 10) lines++;
        }
        return lines;
      } catch {
        return 0;
      }
    };

    const applyDiffStats = async (
      entry: ChangedFile,
      diffStats: Map<string, { additions: number; deletions: number; isBinary: boolean }>,
      repo: Repository,
      uri: vscode.Uri,
    ) => {
      const repoRelativePath = this.toRepoRelativePath(uri, repo);
      const stats =
        this.findDiffStats(repoRelativePath, diffStats) ??
        this.findDiffStats(entry.filepath, diffStats);

      if (stats) {
        entry.additions = stats.additions;
        entry.deletions = stats.deletions;
        if (stats.isBinary) {
          entry.isBinary = true;
        }
      } else if (entry.status === "added" || entry.status === "untracked") {
        entry.additions = await countFileLines(uri);
        entry.deletions = 0;
      } else if (entry.status === "deleted") {
        entry.additions = 0;
        const deletedPath = repoRelativePath || entry.filepath;
        try {
          const { stdout } = await asyncExec(
            `git show HEAD:"${deletedPath.replace(/"/g, '\\"')}"`,
            { cwd: repo.rootUri.fsPath, maxBuffer: 10 * 1024 * 1024 },
          );
          const lineCount = stdout.length === 0 ? 0 : stdout.split("\n").length;
          entry.deletions = lineCount;
        } catch {
          entry.deletions = 0;
        }
      }

      entry.additions = entry.additions ?? 0;
      entry.deletions = entry.deletions ?? 0;
    };

    const mapGitStatus = (
      status: number,
      staged: boolean,
    ): ChangedFile["status"] => {
      if (staged) {
        switch (status) {
          case 0:
            return "modified";
          case 1:
          case 4:
            return "added";
          case 2:
            return "deleted";
          case 3:
            return "renamed";
          default:
            return "modified";
        }
      }

      switch (status) {
        case 5:
          return "modified";
        case 6:
          return "deleted";
        case 7:
          return "untracked";
        case 9:
          return "added";
        default:
          return "modified";
      }
    };

    const upsert = (entry: ChangedFile) => {
      const existing = byPath.get(entry.filepath);
      if (!existing) {
        byPath.set(entry.filepath, entry);
        return;
      }
      if (!entry.staged || existing.staged) {
        byPath.set(entry.filepath, {
          ...entry,
          additions: entry.additions ?? existing.additions,
          deletions: entry.deletions ?? existing.deletions,
          isBinary: entry.isBinary ?? existing.isBinary,
        });
      }
    };

    const processChanges = async (
      changes: Repository["state"]["indexChanges"] | undefined,
      staged: boolean,
      repo: Repository,
      diffStats: Map<string, { additions: number; deletions: number; isBinary: boolean }>,
    ) => {
      if (!changes) return;

      for (const change of changes) {
        const filepath = toRelativePath(change.uri);
        const entry: ChangedFile = {
          filepath,
          uri: change.uri.toString(),
          status: mapGitStatus(change.status, staged),
          staged,
        };
        await applyDiffStats(entry, diffStats, repo, change.uri);
        upsert(entry);
      }
    };

    try {
      for (const repo of repos) {
        const diffStats = await this.getRepoDiffStats(repo);
        const state = repo.state;

        await processChanges(state.indexChanges, true, repo, diffStats);
        await processChanges(state.workingTreeChanges, false, repo, diffStats);
        await processChanges(state.mergeChanges, false, repo, diffStats);
      }
    } catch (e) {
      console.error("[getGitChangedFiles]", e);
    }

    return Array.from(byPath.values()).sort((a, b) =>
      a.filepath.localeCompare(b.filepath),
    );
  }
}
