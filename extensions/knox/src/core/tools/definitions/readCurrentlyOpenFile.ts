import { Tool } from "../..";
import { t } from "../../i18n/index.js";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export const readCurrentlyOpenFileTool: Tool = {
  type: "function",
  displayTitle: t("readCurrentlyOpenFile"),
  wouldLikeTo: t("wouldLikeToReadCurrent"),
  isCurrently: t("isReadingCurrent"),
  hasAlready: t("hasReadCurrent"),
  readonly: true,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.ReadCurrentlyOpenFile,
    description:
      "Reads the currently open file in the IDE. If the user seems to be referring to a file that you cannot see, you can try using this function.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
};
