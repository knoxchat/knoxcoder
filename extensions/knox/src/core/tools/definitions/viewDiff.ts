import { Tool } from "../..";
import { t } from "../../i18n/index.js";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export const viewDiffTool: Tool = {
  type: "function",
  displayTitle: t("viewDiff"),
  wouldLikeTo: t("wouldLikeToViewDiff"),
  isCurrently: t("isGettingDiff"),
  hasAlready: t("hasViewedDiff"),
  readonly: true,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.ViewDiff,
    description: "View the differences of current workspace changes",
    parameters: {
      type: "object",
      properties: {},
    },
  },
};
