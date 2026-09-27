import { Tool } from "../..";
import { t } from "../../i18n/index.js";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export const KCONFIG_OPS = ["get", "search", "list"] as const;
export type KconfigOp = (typeof KCONFIG_OPS)[number];

export const kconfigTool: Tool = {
  type: "function",
  displayTitle: t("kconfig"),
  wouldLikeTo: t("wouldLikeToKconfig"),
  isCurrently: t("isReadingKconfig"),
  hasAlready: t("hasReadKconfig"),
  readonly: true,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.Kconfig,
    description: `Read Linux/.config symbols without dumping thousands of lines.

Ops:
- get: value of one CONFIG_* from .config (not the whole file)
- search: find a symbol in Kconfig files (rg)
- list: CONFIG_* names matching prefix (cap 40)

If scripts/config exists, the result mentions it. Do not run menuconfig.`,
    parameters: {
      type: "object",
      required: ["op"],
      properties: {
        op: {
          type: "string",
          enum: [...KCONFIG_OPS],
          description: "get, search, or list",
        },
        symbol: {
          type: "string",
          description: "CONFIG_FOO or FOO (get/search)",
        },
        prefix: {
          type: "string",
          description: "Prefix for list (e.g. CONFIG_MMU or MMU)",
        },
        path: {
          type: "string",
          description: "Optional .config or Kconfig directory (default workspace root)",
        },
      },
    },
  },
};
