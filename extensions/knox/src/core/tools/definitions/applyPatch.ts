import { Tool } from "../..";
import { t } from "../../i18n/index.js";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export const applyPatchTool: Tool = {
  type: "function",
  displayTitle: t("applyPatch"),
  wouldLikeTo: t("wouldLikeToApplyPatch"),
  isCurrently: t("isApplyingPatch"),
  hasAlready: t("hasAppliedPatch"),
  group: BUILT_IN_GROUP_NAME,
  readonly: false,
  function: {
    name: BuiltInToolNames.ApplyPatch,
    description: `Apply a Codex-style multi-hunk / multi-file patch atomically.

Use this when one call should change several files or several regions of a file.
Prefer builtin_edit_file for a single unique StrReplace. Prefer builtin_write_file for a full rewrite.
Never apply patches via the terminal (patch, sed, git apply).

Format:
*** Begin Patch
*** Add File: path/to/new.ts
+contents
*** Update File: path/to/existing.ts
@@
 context
-old
+new
*** Delete File: path/to/gone.ts
*** End Patch

Rules:
- Read files before updating them so context matches exactly.
- Hunks fail if the old side matches 0 times or more than once (add an @@ locator or more context).
- All operations apply or none do.`,
    parameters: {
      type: "object",
      required: ["patch"],
      properties: {
        patch: {
          type: "string",
          description:
            "Full apply_patch document starting with *** Begin Patch and ending with *** End Patch.",
        },
      },
    },
  },
};
