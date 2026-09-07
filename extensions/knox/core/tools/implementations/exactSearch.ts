import { t } from "../../i18n/index.js";
import type { SearchOptions, SearchOutputMode } from "../../protocol/ide";
import { detectSystemsWorkspace } from "../../config/agentProfile";
import {
  DEFAULT_SEARCH_CONTEXT_LINES,
  resolveSearchMaxResults,
  SEARCH_TRUNCATION_HINT,
  summarizeSearchOutput,
} from "../ripgrep";
import { ToolImpl } from ".";

export interface ExactSearchArgs {
  query: string;
  path?: string;
  fileType?: string;
  fileGlob?: string;
  excludeGlob?: string;
  contextLines?: number;
  beforeContext?: number;
  afterContext?: number;
  maxResults?: number;
  offset?: number;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  multiline?: boolean;
  hidden?: boolean;
  follow?: boolean;
  fixedStrings?: boolean;
  pcre2?: boolean;
  outputMode?: SearchOutputMode;
}

function normalizeOutputMode(mode?: string): SearchOutputMode {
  if (mode === "files_with_matches" || mode === "count") {
    return mode;
  }
  return "content";
}

export const exactSearchImpl: ToolImpl = async (args: ExactSearchArgs, extras) => {
  if (!args.query || typeof args.query !== "string") {
    throw new Error(t("missingRequiredParam", { param: "query" }));
  }

  const outputMode = normalizeOutputMode(args.outputMode);
  const systems = await detectSystemsWorkspace(extras.ide);
  const maxResults = resolveSearchMaxResults(
    typeof args.maxResults === "number" ? args.maxResults : undefined,
    systems,
  );
  const searchOptions: SearchOptions = {
    query: args.query,
    path: args.path,
    fileType: args.fileType,
    fileGlob: args.fileGlob,
    excludeGlob: args.excludeGlob,
    contextLines: args.contextLines ?? DEFAULT_SEARCH_CONTEXT_LINES,
    beforeContext: args.beforeContext,
    afterContext: args.afterContext,
    maxResults,
    offset: args.offset,
    caseSensitive: args.caseSensitive ?? false,
    wholeWord: args.wholeWord ?? false,
    multiline: args.multiline ?? false,
    hidden: args.hidden ?? false,
    follow: args.follow ?? false,
    // Literal by default. PCRE2 / explicit fixedStrings=false opt into regex.
    fixedStrings: args.pcre2 === true ? false : (args.fixedStrings ?? true),
    pcre2: args.pcre2 === true && args.fixedStrings !== true,
    outputMode,
  };

  let content = await extras.ide.getSearchResults(args.query, searchOptions);
  const { fileCount, matchCount } = summarizeSearchOutput(content, outputMode);
  const hitCap =
    maxResults > 0 &&
    matchCount >= maxResults &&
    !content.includes(SEARCH_TRUNCATION_HINT);
  if (hitCap) {
    content = `${content.trimEnd()}\n${SEARCH_TRUNCATION_HINT}`;
  }
  const summary =
    fileCount > 0
      ? outputMode === "files_with_matches"
        ? `Found ${fileCount} file(s)`
        : `Found ${matchCount} match(es) in ${fileCount} file(s)`
      : content.startsWith("Error:") || content.startsWith("Search error:")
        ? content.split("\n")[0]
        : "No matches found";

  return [
    {
      name: "Search Results",
      description: `Exact search results for "${args.query}" - ${summary}`,
      content,
    },
  ];
};
