/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { incrementalParseJson, parseToolArgs } from '../knoxGuiChat.js';
import { IKnoxGuiAskQuestion, IKnoxGuiToolCall } from '../knoxGuiState.js';

/** Ask-user question parsing, choice labels, and submitted-answer display. */

export function splitChoiceText(option: string): { value: string; label: string; description?: string } {
	// allow-any-unicode-next-line
	const match = option.match(/^(.+?)\s+[—–-]\s+(.+)$/u);
	if (match) {
		return { value: option, label: match[1].trim(), description: match[2].trim() };
	}
	return { value: option, label: option };
}

const ASK_USER_PROMPT_KEYS = ['prompt', 'question', 'header', 'title', 'text', 'label', 'message', 'query'] as const;
const ASK_USER_OPTION_KEYS = ['options', 'choices'] as const;

function askUserNonEmptyString(value: unknown): string | undefined {
	if (typeof value === 'string' && value.trim()) {
		return value.trim();
	}
	if (typeof value === 'number' && Number.isFinite(value)) {
		return String(value);
	}
	return undefined;
}

function tryParseAskUserJson(value: string): unknown {
	const trimmed = value.trim();
	if (!(trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('"'))) {
		return undefined;
	}
	try {
		return JSON.parse(trimmed);
	} catch {
		const [, parsed] = incrementalParseJson(trimmed);
		return parsed && typeof parsed === 'object' ? parsed : undefined;
	}
}

function askUserOptionToString(option: unknown): string | undefined {
	const asString = askUserNonEmptyString(option);
	if (asString) {
		return asString;
	}
	if (!option || typeof option !== 'object' || Array.isArray(option)) {
		return undefined;
	}
	const rec = option as Record<string, unknown>;
	const label = askUserNonEmptyString(rec.label)
		?? askUserNonEmptyString(rec.name)
		?? askUserNonEmptyString(rec.text)
		?? askUserNonEmptyString(rec.value)
		?? askUserNonEmptyString(rec.prompt)
		?? askUserNonEmptyString(rec.id);
	const description = askUserNonEmptyString(rec.description)
		?? askUserNonEmptyString(rec.desc)
		?? askUserNonEmptyString(rec.detail);
	if (label && description && label !== description) {
		return `${label} — ${description}`;
	}
	return label;
}

function askUserExtractOptions(rec: Record<string, unknown>): string[] | undefined {
	for (const key of ASK_USER_OPTION_KEYS) {
		const raw = rec[key];
		if (!Array.isArray(raw)) {
			continue;
		}
		const options = raw.map(askUserOptionToString).filter((option): option is string => Boolean(option));
		if (options.length) {
			return options;
		}
	}
	return undefined;
}

function askUserLooksLikeQuestion(rec: Record<string, unknown>): boolean {
	return ASK_USER_PROMPT_KEYS.some(key => Boolean(askUserNonEmptyString(rec[key])))
		|| ASK_USER_OPTION_KEYS.some(key => Array.isArray(rec[key]));
}

function askUserParseOneQuestion(item: unknown, index: number, fallbackPrompt?: string): IKnoxGuiAskQuestion | undefined {
	const fallbackId = `q${index + 1}`;
	if (typeof item === 'string') {
		const parsed = tryParseAskUserJson(item);
		if (parsed !== undefined) {
			return askUserParseOneQuestion(parsed, index, fallbackPrompt);
		}
		const prompt = item.trim() || fallbackPrompt;
		return prompt ? { id: fallbackId, prompt } : undefined;
	}
	if (typeof item === 'number' && Number.isFinite(item)) {
		return { id: fallbackId, prompt: String(item) };
	}
	if (!item || typeof item !== 'object' || Array.isArray(item)) {
		return undefined;
	}
	const rec = item as Record<string, unknown>;
	const options = askUserExtractOptions(rec);
	let prompt: string | undefined;
	for (const key of ASK_USER_PROMPT_KEYS) {
		prompt = askUserNonEmptyString(rec[key]);
		if (prompt) {
			break;
		}
	}
	prompt = prompt ?? fallbackPrompt ?? (options?.length ? 'Choose an option' : undefined);
	if (!prompt) {
		return undefined;
	}
	const id = askUserNonEmptyString(rec.id) ?? askUserNonEmptyString(rec.name) ?? askUserNonEmptyString(rec.key) ?? fallbackId;
	return {
		id,
		prompt,
		options: options?.length ? options : undefined,
		allowMultiple: rec.allow_multiple === true || rec.allowMultiple === true || rec.multiSelect === true || rec.multi_select === true || rec.multiple === true,
		allowFreeform: rec.allow_freeform === true || rec.allowFreeform === true || rec.freeform === true || rec.allow_other === true || Boolean(rec.input),
	};
}

function askUserCollectItems(raw: unknown, fallbackPrompt?: string): unknown[] {
	if (raw === undefined || raw === null) {
		return [];
	}
	if (typeof raw === 'string') {
		const parsed = tryParseAskUserJson(raw);
		if (parsed !== undefined) {
			return askUserCollectItems(parsed, fallbackPrompt);
		}
		return raw.trim() ? [raw.trim()] : [];
	}
	if (Array.isArray(raw)) {
		return raw;
	}
	if (typeof raw !== 'object') {
		return [];
	}
	const rec = raw as Record<string, unknown>;
	const title = askUserNonEmptyString(rec.title) ?? askUserNonEmptyString(rec.header);
	const combinedFallback = fallbackPrompt ?? title;
	for (const key of ['questions', 'asks', 'queries'] as const) {
		if (rec[key] === undefined) {
			continue;
		}
		const items = askUserCollectItems(rec[key], combinedFallback);
		if (items.length) {
			return items;
		}
	}
	if (rec.question !== undefined && typeof rec.question === 'object') {
		const items = askUserCollectItems(rec.question, combinedFallback);
		if (items.length) {
			return items;
		}
	}
	if (Array.isArray(rec.value) && rec.value.length) {
		return rec.value;
	}
	if (askUserLooksLikeQuestion(rec)) {
		return [rec];
	}
	const values = Object.values(rec);
	if (values.length && values.every(value => value && typeof value === 'object' && !Array.isArray(value) && askUserLooksLikeQuestion(value as Record<string, unknown>))) {
		return values;
	}
	if (combinedFallback) {
		return [{ prompt: combinedFallback, options: askUserExtractOptions(rec) }];
	}
	return [];
}

/**
 * Same default ids as core `parseAskUserQuestions` (`q1`, `q2`, …).
 * Accepts the catalog schema plus common Cursor/Claude shapes: a questions
 * array, a single question object, a JSON string, object `{id,label}` options,
 * `title`/`header` when `prompt` is missing, and a root questions array wrapped
 * as `{ value: [...] }` by `parseToolArgs`.
 */
export function parseAskUserQuestionsForGui(raw: unknown): IKnoxGuiAskQuestion[] {
	const fallbackPrompt = raw && typeof raw === 'object' && !Array.isArray(raw)
		? askUserNonEmptyString((raw as Record<string, unknown>).title) ?? askUserNonEmptyString((raw as Record<string, unknown>).header)
		: undefined;
	const questions: IKnoxGuiAskQuestion[] = [];
	const seen = new Set<string>();
	askUserCollectItems(raw, fallbackPrompt).forEach((item, index) => {
		const question = askUserParseOneQuestion(item, index, fallbackPrompt);
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
	return questions;
}

export function resolveAskUserQuestions(tool: Pick<IKnoxGuiToolCall, 'questions' | 'parsedArgs' | 'arguments'>): IKnoxGuiAskQuestion[] {
	if (tool.questions?.length) {
		return tool.questions;
	}
	const fromParsed = parseAskUserQuestionsForGui(tool.parsedArgs ?? {});
	if (fromParsed.length) {
		return fromParsed;
	}
	return parseAskUserQuestionsForGui(parseToolArgs(tool.arguments));
}

export function isAskUserAnswered(value: string | undefined): boolean {
	return typeof value === 'string' && value.split('\u0001').some(part => part.trim().length > 0);
}

/** `AskUser.tsx` `formatAnswer`: join multi-select + freeform with `", "`. */
export function formatAskUserDisplayAnswer(drafts: Record<string, string> | undefined, questionId: string, submitted?: string): string {
	const choices = (drafts?.[questionId] ?? '').split('\u0001').map(part => part.trim()).filter(Boolean);
	const extra = (drafts?.[`${questionId}::freeform`] ?? '').trim();
	const parts = [...choices, extra].filter(Boolean);
	if (parts.length) {
		return parts.join(', ');
	}
	return typeof submitted === 'string' ? submitted.trim() : '';
}
