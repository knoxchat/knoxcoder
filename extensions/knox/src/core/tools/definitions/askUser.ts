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
    description: `Ask the user a clarifying question when a choice would change the edits (library, approach, scope). Prefer multiple-choice options. Never auto-approved. Always pass a non-empty questions array; options may be strings or {id,label}. Not for progress updates.
Example: {"questions":[{"id":"runtime","prompt":"How should this run?","options":["Terminal","Desktop GUI"]}]}`,
    parameters: {
      type: "object",
      required: ["questions"],
      properties: {
        title: {
          type: "string",
          description: "Optional short heading shown above the questions.",
        },
        questions: {
          type: "array",
          description: "One or more questions to present. Must not be empty.",
          items: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description: "Stable id for this question.",
              },
              prompt: {
                type: "string",
                description: "The question text.",
              },
              question: {
                type: "string",
                description: "Alias for prompt.",
              },
              header: {
                type: "string",
                description: "Short heading used when prompt is omitted.",
              },
              options: {
                type: "array",
                // Strings only in the schema: `items` is required by Gemini and
                // some OpenAI-compatible gateways. {id,label} objects are still
                // accepted by the implementation (ask_user skips type checks).
                items: { type: "string" },
                description:
                  "Multiple-choice options as plain strings (use \"Label — description\" for detail). Omit for free-form.",
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
