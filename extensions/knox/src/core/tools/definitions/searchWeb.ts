import { Tool } from "../..";
import { t } from "../../i18n/index.js";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export const searchWebTool: Tool = {
  type: "function",
  displayTitle: t("webSearch"),
  wouldLikeTo: t("wouldLikeToSearchWeb"),
  isCurrently: t("isSearchingWeb"),
  hasAlready: t("hasSearchedWeb"),
  readonly: true,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.SearchWeb,
    description:
      "Performs a live web search via the retrieval endpoint (or provider-native web_search when retrieval is unavailable and the model supports it). Returns real search results — not model guesswork. Use only when external, up-to-date information is required; common programming questions usually do not need web search. Prefer the Web Search toggle when the chat model advertises native web_search.",
    parameters: {
      type: "object",
      required: ["query"],
      properties: {
        query: {
          type: "string",
          description: "Natural language search keywords",
        },
      },
    },
  },
};
