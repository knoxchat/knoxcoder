import { Tool } from "../..";
import { t } from "../../i18n/index.js";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export const askUserTool: Tool = {
  type: "function",
  displayTitle: t("askUser"),
  wouldLikeTo: t("wouldLikeToAskUser"),
  isCurrently: t("isAskingUser"),
  hasAlready: t("hasAskedUser"),
  group: BUILT_IN_GROUP_NAME,
  readonly: false,
  function: {
    name: BuiltInToolNames.AskUser,
    description: `Ask the user a clarifying question before continuing (Claude AskUserQuestion).

Use when a choice would change edits (library, approach, scope) and guessing would waste work.
Prefer multiple-choice options. This tool is never auto-approved — the user must answer.

Do not use for progress updates.`,
    parameters: {
      type: "object",
      required: ["questions"],
      properties: {
        questions: {
          type: "array",
          description: "One or more questions to present.",
          items: {
            type: "object",
            required: ["prompt"],
            properties: {
              id: {
                type: "string",
                description: "Stable id for this question.",
              },
              prompt: {
                type: "string",
                description: "The question text.",
              },
              options: {
                type: "array",
                items: { type: "string" },
                description: "Multiple-choice options. Omit for free-form.",
              },
              allow_multiple: {
                type: "boolean",
                description: "If true, the user may pick more than one option.",
              },
              allow_freeform: {
                type: "boolean",
                description:
                  "If true, the user may type an answer even when options exist.",
              },
            },
          },
        },
      },
    },
  },
};
