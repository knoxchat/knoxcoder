import { IDE } from "core";
import { deduplicateArray, splitCamelCaseAndNonAlphaNumeric } from "core/util";
// @ts-ignore
import MiniSearch from "minisearch";
import * as vscode from "vscode";

type FileMiniSearchResult = { relativePath: string; id: string };

/*
  id = file URI
*/
export class FileSearch {
  constructor(private readonly ide: IDE) {}

  private miniSearch = new MiniSearch<FileMiniSearchResult>({
    fields: ["relativePath", "id"],
    storeFields: ["relativePath", "id"],
    tokenize: text => deduplicateArray(MiniSearch.getDefault('tokenize')(text).concat(splitCamelCaseAndNonAlphaNumeric(text)), (a, b) => a === b),
    searchOptions: {
      prefix: true,
      fuzzy: 2,
      fields: ["relativePath"],
    },
  });
  private indexPromise: Promise<void> | undefined;

  /**
   * T7.3: do not index the workspace during activate. Index when the sidebar
   * is visible or a command (Quick Edit / prompt completions) searches.
   */
  ensureIndexed(): Promise<void> {
    if (!this.indexPromise) {
      this.indexPromise = this.initializeFileSearchState();
    }
    return this.indexPromise;
  }

  private async initializeFileSearchState() {
    const files = await vscode.workspace.findFiles('**/*', '**/node_modules/**');
    this.miniSearch.addAll(
      files.map((uri) => ({
        id: uri.toString(),
        relativePath: vscode.workspace.asRelativePath(uri),
      })),
    );
  }

  public search(query: string): FileMiniSearchResult[] {
    void this.ensureIndexed();
    return this.miniSearch.search(query) as unknown as FileMiniSearchResult[];
  }
}
