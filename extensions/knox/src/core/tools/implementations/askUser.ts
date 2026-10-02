import { t } from "../../i18n/index.js";

import { ToolImpl } from ".";

export interface AskUserQuestion {
  id: string;
  prompt: string;
  options?: string[];
  allow_multiple?: boolean;
  allow_freeform?: boolean;
}

const PROMPT_KEYS = [
  "prompt",
  "question",
  "header",
  "title",
  "text",
  "label",
  "message",
  "query",
] as const;

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function tryParseJson(value: string): unknown {
  const trimmed = value.trim();
  if (
    !(
      trimmed.startsWith("{") ||
      trimmed.startsWith("[") ||
      trimmed.startsWith('"')
    )
  ) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function optionToString(option: unknown): string | undefined {
  const asString = nonEmptyString(option);
  if (asString) {
    return asString;
  }
  if (!option || typeof option !== "object" || Array.isArray(option)) {
    return undefined;
  }
  const rec = option as Record<string, unknown>;
  const label =
    nonEmptyString(rec.label) ??
    nonEmptyString(rec.name) ??
    nonEmptyString(rec.text) ??
    nonEmptyString(rec.value) ??
    nonEmptyString(rec.prompt) ??
    nonEmptyString(rec.id);
  const description =
    nonEmptyString(rec.description) ??
    nonEmptyString(rec.desc) ??
    nonEmptyString(rec.detail);
  if (label && description && label !== description) {
    return `${label} — ${description}`;
  }
  return label;
}

function extractOptions(rec: Record<string, unknown>): string[] | undefined {
  for (const key of ["options", "choices"] as const) {
    const raw = rec[key];
    if (!Array.isArray(raw)) {
      continue;
    }
    const options = raw
      .map(optionToString)
      .filter((option): option is string => Boolean(option));
    if (options.length) {
      return options;
    }
  }
  return undefined;
}

function looksLikeQuestion(rec: Record<string, unknown>): boolean {
  return (
    PROMPT_KEYS.some((key) => Boolean(nonEmptyString(rec[key]))) ||
    Array.isArray(rec.options) ||
    Array.isArray(rec.choices)
  );
}

function parseOneQuestion(
  item: unknown,
  index: number,
  fallbackPrompt?: string,
): AskUserQuestion | undefined {
  const fallbackId = `q${index + 1}`;
  if (typeof item === "string") {
    const parsed = tryParseJson(item);
    if (parsed !== undefined) {
      return parseOneQuestion(parsed, index, fallbackPrompt);
    }
    const prompt = item.trim() || fallbackPrompt;
    if (!prompt) {
      return undefined;
    }
    return { id: fallbackId, prompt };
  }
  if (typeof item === "number" && Number.isFinite(item)) {
    return { id: fallbackId, prompt: String(item) };
  }
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return undefined;
  }
  const rec = item as Record<string, unknown>;
  const options = extractOptions(rec);
  let prompt: string | undefined;
  for (const key of PROMPT_KEYS) {
    prompt = nonEmptyString(rec[key]);
    if (prompt) {
      break;
    }
  }
  prompt =
    prompt ?? fallbackPrompt ?? (options?.length ? "Choose an option" : undefined);
  if (!prompt) {
    return undefined;
  }
  const id =
    nonEmptyString(rec.id) ??
    nonEmptyString(rec.name) ??
    nonEmptyString(rec.key) ??
    fallbackId;
  return {
    id,
    prompt,
    options: options?.length ? options : undefined,
    allow_multiple:
      rec.allow_multiple === true ||
      rec.allowMultiple === true ||
      rec.multiSelect === true ||
      rec.multi_select === true ||
      rec.multiple === true,
    allow_freeform:
      rec.allow_freeform === true ||
      rec.allowFreeform === true ||
      rec.freeform === true ||
      rec.allow_other === true ||
      Boolean(rec.input),
  };
}

function collectQuestionItems(
  raw: unknown,
  fallbackPrompt?: string,
): unknown[] {
  if (raw == null) {
    return [];
  }
  if (typeof raw === "string") {
    const parsed = tryParseJson(raw);
    if (parsed !== undefined) {
      return collectQuestionItems(parsed, fallbackPrompt);
    }
    return raw.trim() ? [raw.trim()] : [];
  }
  if (Array.isArray(raw)) {
    return raw;
  }
  if (typeof raw !== "object") {
    return [];
  }
  const rec = raw as Record<string, unknown>;
  const title = nonEmptyString(rec.title) ?? nonEmptyString(rec.header);
  const combinedFallback = fallbackPrompt ?? title;
  for (const key of ["questions", "asks", "queries"] as const) {
    if (rec[key] === undefined) {
      continue;
    }
    const items = collectQuestionItems(rec[key], combinedFallback);
    if (items.length) {
      return items;
    }
  }
  if (rec.question !== undefined && typeof rec.question === "object") {
    const items = collectQuestionItems(rec.question, combinedFallback);
    if (items.length) {
      return items;
    }
  }
  if (Array.isArray(rec.value) && rec.value.length) {
    return rec.value;
  }
  if (looksLikeQuestion(rec)) {
    return [rec];
  }
  const values = Object.values(rec);
  if (
    values.length &&
    values.every(
      (value) =>
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        looksLikeQuestion(value as Record<string, unknown>),
    )
  ) {
    return values;
  }
  if (combinedFallback) {
    return [{ prompt: combinedFallback, options: extractOptions(rec) }];
  }
  return [];
}

/** Keep in sync with GUI `parseAskUserQuestionsForGui`. */
export function parseAskUserQuestions(raw: unknown): AskUserQuestion[] {
  const fallbackPrompt =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? nonEmptyString((raw as Record<string, unknown>).title) ??
        nonEmptyString((raw as Record<string, unknown>).header)
      : undefined;
  const questions: AskUserQuestion[] = [];
  const seen = new Set<string>();
  collectQuestionItems(raw, fallbackPrompt).forEach((item, index) => {
    const question = parseOneQuestion(item, index, fallbackPrompt);
    if (!question) {
      return;
    }
    let id = question.id;
    if (seen.has(id)) {
      id = `${id}_${index + 1}`;
    }
    seen.add(id);
    questions.push(id === question.id ? question : { ...question, id });
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
  const questions = parseAskUserQuestions(args);
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
