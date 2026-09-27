/**
 * KN-356: vscode-free MiniSearch index for `@` file mentions.
 *
 * Prompt-file completions and QuickEdit `@path` use this index. Native chat
 * `@` still live-walks via `context/searchFiles`; the MiniSearch rows are
 * the fast first hit list for editor `@`.
 */

// @ts-ignore
import MiniSearch from "minisearch";

function splitCamelCaseAndNonAlphaNumeric(value: string): string[] {
  return value
    .split(/(?<=[a-z0-9])(?=[A-Z])|[^a-zA-Z0-9]/)
    .filter((token) => token.length > 0)
    .map((token) => token.toLowerCase());
}

function uniqueTokens(tokens: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const token of tokens) {
    if (seen.has(token)) {
      continue;
    }
    seen.add(token);
    result.push(token);
  }
  return result;
}

export type FileMiniSearchResult = { relativePath: string; id: string };

const SKIP_INDEX_SEGMENTS = new Set(["node_modules", ".git"]);

export function tokenizeFileSearchText(text: string): string[] {
  const defaultTokens = MiniSearch.getDefault("tokenize")(text) as string[];
  return uniqueTokens(defaultTokens.concat(splitCamelCaseAndNonAlphaNumeric(text)));
}

export function shouldIndexWorkspaceFile(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  return !normalized.split("/").some((part) => SKIP_INDEX_SEGMENTS.has(part));
}

export function fileSearchEntry(
  uri: string,
  relativePath: string,
): FileMiniSearchResult {
  return { id: uri, relativePath };
}

export function createFileMiniSearch(): MiniSearch<FileMiniSearchResult> {
  return new MiniSearch<FileMiniSearchResult>({
    fields: ["relativePath", "id"],
    storeFields: ["relativePath", "id"],
    tokenize: tokenizeFileSearchText,
    searchOptions: {
      prefix: true,
      fuzzy: 2,
      fields: ["relativePath"],
    },
  });
}

export class FileSearchIndex {
  constructor(
    private readonly miniSearch: MiniSearch<FileMiniSearchResult> = createFileMiniSearch(),
  ) {}

  replaceAll(files: FileMiniSearchResult[]): void {
    this.miniSearch.removeAll();
    this.miniSearch.addAll(files.filter((file) => shouldIndexWorkspaceFile(file.relativePath)));
  }

  add(file: FileMiniSearchResult): void {
    if (!shouldIndexWorkspaceFile(file.relativePath)) {
      return;
    }
    if (this.miniSearch.has(file.id)) {
      this.miniSearch.replace(file);
      return;
    }
    this.miniSearch.add(file);
  }

  remove(id: string): void {
    if (this.miniSearch.has(id)) {
      this.miniSearch.discard(id);
    }
  }

  search(query: string): FileMiniSearchResult[] {
    if (!query.trim()) {
      return [];
    }
    return this.miniSearch.search(query) as unknown as FileMiniSearchResult[];
  }
}
