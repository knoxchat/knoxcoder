import { Tool } from "../..";
import { t } from "../../i18n/index.js";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export const MAINTAINERS_OPS = ["lookup", "search", "list"] as const;
export type MaintainersOp = (typeof MAINTAINERS_OPS)[number];

export const maintainersTool: Tool = {
  type: "function",
  displayTitle: t("maintainers"),
  wouldLikeTo: t("wouldLikeToMaintainers"),
  isCurrently: t("isReadingMaintainers"),
  hasAlready: t("hasReadMaintainers"),
  readonly: true,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.Maintainers,
    description: `Look up Linux/QEMU MAINTAINERS without dumping the file.

Ops:
- lookup: who owns a path (F:/X: glob match, most specific first). path=mm/filemap.c
- search: subsystem title / M: / L: / F: substring (query=mm or "MEMORY MANAGEMENT")
- list: subsystem titles (optional query prefix, cap 40)

Do not read MAINTAINERS with builtin_read_file. scripts/get_maintainer.pl is mentioned when present.`,
    parameters: {
      type: "object",
      required: [],
      properties: {
        op: {
          type: "string",
          enum: [...MAINTAINERS_OPS],
          description:
            "lookup (path), search (query), or list. Inferred from path/query when omitted.",
        },
        path: {
          type: "string",
          description: "Workspace-relative file or directory (lookup).",
        },
        query: {
          type: "string",
          description: "Substring for search, or title prefix for list.",
        },
        file: {
          type: "string",
          description: "Optional MAINTAINERS path (default workspace root).",
        },
      },
    },
  },
};
