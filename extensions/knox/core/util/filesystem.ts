import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

import { searchWorkspaceWithRipgrep } from "../tools/ripgrep";

import {
  FileStatsMap,
  FileType,
  IDE,
  IdeInfo,
  IdeSettings,
  IndexTag,
  Location,
  Problem,
  Range,
  RangeInFile,
  TerminalOptions,
  Thread,
  ToastType,
} from "../index.js";

class FileSystemIde implements IDE {
  constructor(private readonly workspaceDir: string) {}

  async readSecrets(keys: string[]): Promise<Record<string, string>> {
    return {};
  }

  async writeSecrets(secrets: { [key: string]: string }): Promise<void> {}

  showToast(
    type: ToastType,
    message: string,
    ...otherParams: any[]
  ): Promise<void> {
    return Promise.resolve();
  }
  fileExists(fileUri: string): Promise<boolean> {
    const filepath = fileURLToPath(fileUri);
    return Promise.resolve(fs.existsSync(filepath));
  }

  gotoDefinition(location: Location): Promise<RangeInFile[]> {
    return Promise.resolve([]);
  }
  findReferences(location: Location): Promise<RangeInFile[]> {
    return Promise.resolve([]);
  }
  getHover(location: Location): Promise<string | null> {
    return Promise.resolve(null);
  }
  getDocumentSymbols(filepath: string): Promise<any[]> {
    return Promise.resolve([]);
  }
  getWorkspaceSymbols(query: string): Promise<any[]> {
    return Promise.resolve([]);
  }
  gotoImplementation(location: Location): Promise<RangeInFile[]> {
    return Promise.resolve([]);
  }
  prepareCallHierarchy(location: Location): Promise<any[]> {
    return Promise.resolve([]);
  }
  getIncomingCalls(location: Location): Promise<any[]> {
    return Promise.resolve([]);
  }
  getOutgoingCalls(location: Location): Promise<any[]> {
    return Promise.resolve([]);
  }
  onDidChangeActiveTextEditor(callback: (fileUri: string) => void): void {
    return;
  }

  async getIdeSettings(): Promise<IdeSettings> {
    return {};
  }
  async getFileStats(fileUris: string[]): Promise<FileStatsMap> {
    const result: FileStatsMap = {};
    for (const uri of fileUris) {
      try {
        const filepath = fileURLToPath(uri);
        const stats = fs.statSync(filepath);
        result[uri] = {
          lastModified: stats.mtimeMs,
          size: stats.size,
        };
      } catch (error) {
        console.error(`Error getting last modified time for ${uri}:`, error);
      }
    }
    return result;
  }
  getGitRootPath(dir: string): Promise<string | undefined> {
    return Promise.resolve(dir);
  }
  async listDir(dir: string): Promise<[string, FileType][]> {
    const filepath = fileURLToPath(dir);
    const all: [string, FileType][] = fs
      .readdirSync(filepath, { withFileTypes: true })
      .map((dirent: any) => [
        dirent.name,
        dirent.isDirectory()
          ? (2 as FileType.Directory)
          : dirent.isSymbolicLink()
            ? (64 as FileType.SymbolicLink)
            : (1 as FileType.File),
      ]);
    return Promise.resolve(all);
  }

  getRepoName(dir: string): Promise<string | undefined> {
    return Promise.resolve(undefined);
  }

  async getTags(artifactId: string): Promise<IndexTag[]> {
    const directory = (await this.getWorkspaceDirs())[0];
    return [
      {
        artifactId,
        branch: await this.getBranch(directory),
        directory,
      },
    ];
  }

  getIdeInfo(): Promise<IdeInfo> {
    return Promise.resolve({
      ideType: "vscode",
      name: "na",
      version: "0.1",
      remoteName: "na",
      extensionVersion: "na",
    });
  }

  readRangeInFile(fileUri: string, range: Range): Promise<string> {
    return Promise.resolve("");
  }

  getUniqueId(): Promise<string> {
    return Promise.resolve("NOT_UNIQUE");
  }

  getDiff(includeUnstaged: boolean): Promise<string[]> {
    return Promise.resolve([]);
  }

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
  > {
    return Promise.resolve([]);
  }

  getClipboardContent(): Promise<{ text: string; copiedAt: string }> {
    return Promise.resolve({ text: "", copiedAt: new Date().toISOString() });
  }

  getTerminalContents(): Promise<string> {
    return Promise.resolve("");
  }

  async getDebugLocals(threadIndex: number): Promise<string> {
    return Promise.resolve("");
  }

  async getTopLevelCallStackSources(
    threadIndex: number,
    stackDepth: number,
  ): Promise<string[]> {
    return Promise.resolve([]);
  }

  async getAvailableThreads(): Promise<Thread[]> {
    return Promise.resolve([]);
  }

  async debugControl(): Promise<{
    ok: boolean;
    content: string;
    sessionActive?: boolean;
  }> {
    return {
      ok: false,
      content: "No DAP backend in filesystem IDE.",
      sessionActive: false,
    };
  }

  showLines(
    fileUri: string,
    startLine: number,
    endLine: number,
  ): Promise<void> {
    return Promise.resolve();
  }

  getWorkspaceDirs(): Promise<string[]> {
    return Promise.resolve([this.workspaceDir]);
  }

  writeFile(fileUri: string, contents: string): Promise<void> {
    const filepath = fileURLToPath(fileUri);
    return new Promise((resolve, reject) => {
      fs.writeFile(filepath, contents, (err) => {
        if (err) {
          reject(err);
        }
        resolve();
      });
    });
  }

  removeFile(fileUri: string): Promise<void> {
    const filepath = fileURLToPath(fileUri);
    return new Promise((resolve, reject) => {
      fs.unlink(filepath, (err) => {
        if (err && (err as NodeJS.ErrnoException).code !== "ENOENT") {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }

  showVirtualFile(title: string, contents: string): Promise<void> {
    return Promise.resolve();
  }

  openFile(path: string): Promise<void> {
    return Promise.resolve();
  }

  openUrl(url: string): Promise<void> {
    return Promise.resolve();
  }

  runCommand(command: string, options?: TerminalOptions): Promise<void> {
    return Promise.resolve();
  }

  saveFile(fileUri: string): Promise<void> {
    return Promise.resolve();
  }

  readFile(fileUri: string): Promise<string> {
    const filepath = fileURLToPath(fileUri);
    return new Promise((resolve, reject) => {
      fs.readFile(filepath, "utf8", (err, contents) => {
        if (err) {
          reject(err);
        }
        resolve(contents);
      });
    });
  }

  getCurrentFile(): Promise<undefined> {
    return Promise.resolve(undefined);
  }

  getBranch(dir: string): Promise<string> {
    return Promise.resolve("");
  }

  getOpenFiles(): Promise<string[]> {
    return Promise.resolve([]);
  }

  getPinnedFiles(): Promise<string[]> {
    return Promise.resolve([]);
  }

  async getSearchResults(query: string, options?: any): Promise<string> {
    const cwd = fileURLToPath(this.workspaceDir);
    return searchWorkspaceWithRipgrep([cwd], query, options);
  }

  async getProblems(fileUri?: string | undefined): Promise<Problem[]> {
    return Promise.resolve([]);
  }

  async subprocess(command: string, cwd?: string): Promise<[string, string]> {
    return ["", ""];
  }
}

export default FileSystemIde;
