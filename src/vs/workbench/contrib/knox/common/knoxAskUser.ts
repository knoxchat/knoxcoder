/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IKnoxAskUserQuestion {
	id: string;
	prompt: string;
	options?: string[];
	allow_multiple?: boolean;
	allow_freeform?: boolean;
}

export interface IKnoxAskUserChoice {
	value: string;
	label: string;
	description?: string;
}

export interface IKnoxAskUserItem {
	name: string;
	prompt: string;
	required: boolean;
	multiple: boolean;
	choices?: IKnoxAskUserChoice[];
	input?: { label: string };
}

export type KnoxAskUserAnswers = Record<string, string | string[]>;

export function knoxParseAskUserQuestions(raw: unknown): IKnoxAskUserQuestion[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	const questions: IKnoxAskUserQuestion[] = [];
	for (let index = 0; index < raw.length; index++) {
		const item = raw[index];
		if (!item || typeof item !== 'object') {
			continue;
		}
		const prompt =
			typeof (item as { prompt?: unknown }).prompt === 'string'
				? (item as { prompt: string }).prompt.trim()
				: '';
		if (!prompt) {
			continue;
		}
		const idRaw = (item as { id?: unknown }).id;
		const id =
			typeof idRaw === 'string' && idRaw.trim()
				? idRaw.trim()
				: `q${index + 1}`;
		const options = Array.isArray((item as { options?: unknown }).options)
			? (item as { options: unknown[] }).options.filter(
				(option): option is string =>
					typeof option === 'string' && option.trim().length > 0,
			)
			: undefined;
		questions.push({
			id,
			prompt,
			options: options?.length ? options : undefined,
			allow_multiple: (item as { allow_multiple?: boolean }).allow_multiple === true,
			allow_freeform: (item as { allow_freeform?: boolean }).allow_freeform === true,
		});
	}
	return questions;
}

export function knoxSplitChoiceText(option: string): IKnoxAskUserChoice {
	const match = option.match(/^(.+?)\s+[—–-]\s+(.+)$/u);
	if (match) {
		return {
			value: option,
			label: match[1].trim(),
			description: match[2].trim(),
		};
	}
	return { value: option, label: option };
}

export function knoxAskUserItems(questions: readonly IKnoxAskUserQuestion[]): IKnoxAskUserItem[] {
	return questions.map(question => ({
		name: question.id,
		prompt: question.prompt,
		required: true,
		multiple: question.allow_multiple === true,
		choices: question.options?.map(knoxSplitChoiceText),
		input:
			question.allow_freeform || !question.options?.length
				? { label: question.prompt }
				: undefined,
	}));
}

export function knoxIsAskUserAnswered(value: string | string[] | undefined): boolean {
	if (Array.isArray(value)) {
		return value.some(item => item.trim().length > 0);
	}
	return typeof value === 'string' && value.trim().length > 0;
}

export function knoxFormatAskUserAnswer(value: string | string[] | undefined): string {
	if (Array.isArray(value)) {
		return value.filter(item => item.trim().length > 0).join(', ');
	}
	return typeof value === 'string' ? value.trim() : '';
}

export function knoxAskUserChoiceValues(item: IKnoxAskUserItem | undefined): string[] {
	return item?.choices?.map(choice => choice.value) ?? [];
}

export function knoxAskUserSelectedValues(
	item: IKnoxAskUserItem | undefined,
	answer: string | string[] | undefined,
): string[] {
	const choiceValues = knoxAskUserChoiceValues(item);
	if (Array.isArray(answer)) {
		return answer.filter(value => choiceValues.includes(value));
	}
	return typeof answer === 'string' && choiceValues.includes(answer) ? [answer] : [];
}

export function knoxAskUserFreeformValue(
	item: IKnoxAskUserItem | undefined,
	answer: string | string[] | undefined,
): string {
	const choiceValues = knoxAskUserChoiceValues(item);
	if (typeof answer === 'string' && !choiceValues.includes(answer)) {
		return answer;
	}
	if (Array.isArray(answer)) {
		return answer.find(value => !choiceValues.includes(value)) ?? '';
	}
	return '';
}

export function knoxSetAskUserChoice(
	item: IKnoxAskUserItem,
	answer: string | string[] | undefined,
	value: string,
): string | string[] {
	const selected = knoxAskUserSelectedValues(item, answer);
	const freeform = knoxAskUserFreeformValue(item, answer).trim();
	if (item.multiple) {
		const next = selected.includes(value)
			? selected.filter(entry => entry !== value)
			: [...selected, value];
		const extras = freeform ? [freeform] : [];
		return [...next, ...extras];
	}
	return value;
}

export function knoxSetAskUserFreeform(
	item: IKnoxAskUserItem,
	answer: string | string[] | undefined,
	value: string,
): string | string[] {
	const selected = knoxAskUserSelectedValues(item, answer);
	if (item.multiple) {
		const extras = value.trim() ? [value] : [];
		return [...selected, ...extras];
	}
	return value;
}

export function knoxAskUserShortcutIndex(key: string, shortcuts: 'numbers' | 'letters' | false): number {
	if (!shortcuts) {
		return -1;
	}
	if (shortcuts === 'numbers') {
		const n = Number(key);
		return Number.isInteger(n) ? n - 1 : -1;
	}
	return key.length === 1 ? key.toLowerCase().charCodeAt(0) - 97 : -1;
}
