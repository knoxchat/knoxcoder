import { Tool } from "../..";
import { t } from "../../i18n/index.js";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export const viewRepoMapTool: Tool = {
  type: "function",
  displayTitle: t("viewRepoStructure"),
  wouldLikeTo: t("wouldLikeToBrowseRepo"),
  isCurrently: t("isRetrievingRepo"),
  hasAlready: t("hasViewedRepo"),
  readonly: true,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.ViewRepoMap,
    description: `View the repository map: subsystem directory counts first, then signatures for the hottest files (MAINTAINERS, Makefile, Kconfig, recently touched).

On kernel/QEMU trees this does not dump every file under drivers/. Pass path to zoom in (e.g. path="mm/" or path="arch/x86"). Optional query boosts matching paths.

Prefer this for orientation; use builtin_glob / builtin_exact_search for a specific filename or symbol. Who owns a path: builtin_maintainers lookup (do not dump MAINTAINERS).`,
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Workspace-relative subdirectory to map (e.g. mm/, arch/x86, drivers/gpu). Default: workspace root.",
        },
        query: {
          type: "string",
          description:
            "Optional keyword to rank matching files higher (subsystem, symbol, or folder name).",
        },
      },
    },
  },
};
