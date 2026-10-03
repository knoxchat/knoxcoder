import { Tool } from "../..";
import { t } from "../../i18n/index.js";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export const fetchUrlTool: Tool = {
  type: "function",
  displayTitle: t("fetchUrl"),
  wouldLikeTo: t("wouldLikeToFetchUrl"),
  isCurrently: t("isFetchingUrl"),
  hasAlready: t("hasFetchedUrl"),
  readonly: true,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.FetchUrl,
    description:
      "Fetch a web page by URL and return it as readable Markdown (JSON and text are returned as-is). Public http(s) only; localhost and private networks are blocked. Output is size-limited.",
    parameters: {
      type: "object",
      required: ["url"],
      properties: {
        url: { type: "string", description: "Absolute http(s) URL" },
      },
    },
  },
};
