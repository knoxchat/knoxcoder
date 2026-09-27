import { IDE } from "core";
import * as vscode from "vscode";

import {
  FileMiniSearchResult,
  FileSearchIndex,
  fileSearchEntry,
} from "./fileSearchIndex";

export type { FileMiniSearchResult };

const FIND_FILES_EXCLUDE = "{**/node_modules/**,**/.git/**}";

/*
  id = file URI. MiniSearch index for prompt-file / QuickEdit `@` (KN-356).
*/
export class FileSearch {
  private readonly index = new FileSearchIndex();

  constructor(_ide: IDE) {
    void this.refresh();
  }

  public async refresh(): Promise<void> {
    const files = await vscode.workspace.findFiles("**/*", FIND_FILES_EXCLUDE);
    this.index.replaceAll(
      files.map((uri) =>
        fileSearchEntry(uri.toString(), vscode.workspace.asRelativePath(uri)),
      ),
    );
  }

  public addUris(uris: readonly vscode.Uri[]): void {
    for (const uri of uris) {
      this.index.add(
        fileSearchEntry(uri.toString(), vscode.workspace.asRelativePath(uri)),
      );
    }
  }

  public removeUris(uris: readonly vscode.Uri[]): void {
    for (const uri of uris) {
      this.index.remove(uri.toString());
    }
  }

  public renameUris(
    files: readonly { oldUri: vscode.Uri; newUri: vscode.Uri }[],
  ): void {
    this.removeUris(files.map((file) => file.oldUri));
    this.addUris(files.map((file) => file.newUri));
  }

  public search(query: string): FileMiniSearchResult[] {
    return this.index.search(query);
  }
}
