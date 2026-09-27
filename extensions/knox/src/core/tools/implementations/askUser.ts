import { t } from "../../i18n/index.js";

import { ToolImpl } from ".";

export interface AskUserQuestion {
  id: string;
  prompt: string;
  options?: string[];
  allow_multiple?: boolean;
  allow_freeform?: boolean;
}

export function parseAskUserQuestions(raw: unknown): AskUserQuestion[] {
  if (!Array.isArray(raw)) {
    throw new Error(t("missingRequiredParam", { param: "questions" }));
  }
  const questions: AskUserQuestion[] = [];
  raw.forEach((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(t("askUserInvalidQuestion"));
    }
    const prompt =
      typeof (item as { prompt?: unknown }).prompt === "string"
        ? (item as { prompt: string }).prompt.trim()
        : "";
    if (!prompt) {
      throw new Error(t("askUserEmptyPrompt"));
    }
    const idRaw = (item as { id?: unknown }).id;
    const id =
      typeof idRaw === "string" && idRaw.trim()
        ? idRaw.trim()
        : `q${index + 1}`;
    const options = Array.isArray((item as { options?: unknown }).options)
      ? (item as { options: unknown[] }).options.filter(
          (option): option is string =>
            typeof option === "string" && option.trim().length > 0,
        )
      : undefined;
    questions.push({
      id,
      prompt,
      options: options?.length ? options : undefined,
      allow_multiple: (item as { allow_multiple?: boolean }).allow_multiple === true,
      allow_freeform: (item as { allow_freeform?: boolean }).allow_freeform === true,
    });
  });
  if (questions.length === 0) {
    throw new Error(t("missingRequiredParam", { param: "questions" }));
  }
  return questions;
}

export function formatAskUserAnswers(
  questions: AskUserQuestion[],
  answers: Record<string, unknown>,
): string {
  return questions
    .map((question) => {
      const raw = answers[question.id];
      const rendered = Array.isArray(raw)
        ? raw.map(String).join(", ")
        : raw == null || raw === ""
          ? "(no answer)"
          : String(raw);
      return `Q: ${question.prompt}\nA: ${rendered}`;
    })
    .join("\n\n");
}

export const askUserImpl: ToolImpl = async (args) => {
  const questions = parseAskUserQuestions(args.questions);
  const answers =
    args.answers && typeof args.answers === "object" && !Array.isArray(args.answers)
      ? (args.answers as Record<string, unknown>)
      : null;

  if (!answers) {
    return [
      {
        name: "questions",
        description: "Waiting for user answers",
        content:
          "No answers were provided. Present these questions in the UI and wait for the user.\n\n" +
          questions.map((q) => `- ${q.prompt}`).join("\n"),
      },
    ];
  }

  return [
    {
      name: "answers",
      description: `Answered ${questions.length} question${
        questions.length === 1 ? "" : "s"
      }`,
      content: formatAskUserAnswers(questions, answers),
    },
  ];
};
