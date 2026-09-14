/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append } from '../../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { knoxGuiIconClass } from '../knoxGuiIcons.js';
import { IKnoxChatService } from '../../common/knoxChatService.js';
import { IKnoxToolCallState } from '../../common/knoxChatTypes.js';
import { knoxAsArgsRecord } from '../../common/knoxStreamingToolCode.js';
import {
	IKnoxAskUserItem,
	knoxAskUserFreeformValue,
	knoxAskUserItems,
	knoxAskUserSelectedValues,
	knoxAskUserShortcutIndex,
	knoxFormatAskUserAnswer,
	knoxIsAskUserAnswered,
	knoxParseAskUserQuestions,
	knoxSetAskUserChoice,
	knoxSetAskUserFreeform,
} from '../../common/knoxAskUser.js';
import { IKnoxToolUiState } from './knoxToolCard.js';

export function renderKnoxAskUserCard(
	parent: HTMLElement,
	state: IKnoxToolCallState,
	ui: IKnoxToolUiState,
	chat: IKnoxChatService,
	store: DisposableStore,
	onDidChange: () => void,
): void {
	const args = knoxAsArgsRecord(state.parsedArgs);
	const questions = knoxParseAskUserQuestions(args?.questions ?? []);
	if (!questions.length) {
		append(parent, $('div.knox-ask-invalid')).textContent = localize('knox.askUserInvalid', "No valid questions were provided.");
		return;
	}

	const items = knoxAskUserItems(questions);
	const toolId = state.toolCallId || state.toolCall.id;
	const answers = ui.askAnswers.get(toolId) ?? {};
	const waiting = state.status === 'generated';
	const declined = state.status === 'canceled';

	if (!waiting) {
		const summary = append(parent, $('.knox-ask-summary'));
		for (const question of questions) {
			const row = append(summary, $('.knox-ask-summary-row'));
			append(row, $('div.knox-ask-prompt')).textContent = question.prompt;
			const value = append(row, $('.knox-ask-answer'));
			append(value, $('span')).className = knoxGuiIconClass('check');
			append(value, $('span')).textContent = knoxFormatAskUserAnswer(answers[question.id])
				|| (declined
					? localize('knox.askUserDeclined', "Declined")
					: localize('knox.askUserAnswered', "Answered"));
		}
		return;
	}

	const index = Math.min(ui.askIndex.get(toolId) ?? 0, Math.max(items.length - 1, 0));
	const item = items[index];
	const form = append(parent, $<HTMLFormElement>('form.knox-ask-form'));
	form.tabIndex = -1;
	form.setAttribute('aria-label', localize('knox.askUser', "Ask user"));

	if (items.length > 1) {
		append(form, $('div.knox-ask-progress')).textContent = localize(
			'knox.askUserProgress',
			"Question {0} of {1}",
			index + 1,
			items.length,
		);
	}

	append(form, $('div.knox-ask-title')).textContent = item.prompt;
	if (item.multiple) {
		append(form, $('div.knox-ask-hint')).textContent = localize('knox.askUserMultipleHint', "Select every option that applies.");
	}

	const selected = knoxAskUserSelectedValues(item, answers[item.name]);
	if (item.choices?.length) {
		const list = append(form, $('.knox-ask-choices'));
		item.choices.forEach((choice, choiceIndex) => {
			const option = append(list, $<HTMLButtonElement>('button.knox-ask-choice'));
			option.type = 'button';
			option.classList.toggle('selected', selected.includes(choice.value));
			option.setAttribute('aria-pressed', String(selected.includes(choice.value)));
			const shortcut = choiceIndex < 9 ? String(choiceIndex + 1) : '';
			if (shortcut) {
				append(option, $('span.knox-ask-shortcut')).textContent = shortcut;
			}
			const body = append(option, $('span.knox-ask-choice-body'));
			append(body, $('span.knox-ask-choice-label')).textContent = choice.label;
			if (choice.description) {
				append(body, $('span.knox-ask-choice-desc')).textContent = choice.description;
			}
			store.add(addDisposableListener(option, 'click', e => {
				e.preventDefault();
				e.stopPropagation();
				const current = ui.askAnswers.get(toolId) ?? answers;
				writeAnswer(ui, toolId, current, item, knoxSetAskUserChoice(item, current[item.name], choice.value));
				onDidChange();
			}));
		});
	}

	if (item.input) {
		const input = append(form, $<HTMLInputElement>('input.knox-ask-input'));
		input.type = 'text';
		input.value = knoxAskUserFreeformValue(item, answers[item.name]);
		input.placeholder = localize('knox.askUserFreeform', "Type an answer…");
		input.setAttribute('aria-label', localize('knox.askUserFreeformLabel', "Another answer"));
		store.add(addDisposableListener(input, 'input', () => {
			const current = ui.askAnswers.get(toolId) ?? answers;
			writeAnswer(ui, toolId, current, item, knoxSetAskUserFreeform(item, current[item.name], input.value));
		}));
		store.add(addDisposableListener(input, 'click', e => e.stopPropagation()));
	}

	const actions = append(form, $('.knox-ask-actions'));
	const deny = actionButton(actions, localize('knox.deny', "Deny"), false);
	store.add(addDisposableListener(deny, 'click', e => {
		e.preventDefault();
		e.stopPropagation();
		void chat.cancelTool({ toolCallId: toolId });
	}));

	const canAdvance = knoxIsAskUserAnswered(answers[item.name]);
	if (items.length > 1) {
		const previous = actionButton(actions, localize('knox.askUserPrevious', "Previous"), index === 0);
		store.add(addDisposableListener(previous, 'click', e => {
			e.preventDefault();
			e.stopPropagation();
			ui.askIndex.set(toolId, Math.max(index - 1, 0));
			onDidChange();
		}));
		if (index < items.length - 1) {
			const next = actionButton(actions, localize('knox.askUserNext', "Next"), !canAdvance);
			store.add(addDisposableListener(next, 'click', e => {
				e.preventDefault();
				e.stopPropagation();
				if (!canAdvance) {
					return;
				}
				ui.askIndex.set(toolId, index + 1);
				onDidChange();
			}));
		}
	}

	if (index >= items.length - 1) {
		const submit = actionButton(actions, localize('knox.askUserSubmit', "Submit answers"), !canAdvance);
		submit.classList.add('knox-ask-submit');
		store.add(addDisposableListener(submit, 'click', e => {
			e.preventDefault();
			e.stopPropagation();
			if (!canAdvance) {
				return;
			}
			void chat.answerAskUser(toolId, ui.askAnswers.get(toolId) ?? answers);
		}));
	}

	store.add(addDisposableListener(form, 'keydown', e => {
		if (e.key === 'Enter' && !e.shiftKey) {
			const target = e.target as HTMLElement | null;
			if (isTypingTarget(target) && !canAdvance) {
				return;
			}
			e.preventDefault();
			e.stopPropagation();
			if (index < items.length - 1) {
				if (canAdvance) {
					ui.askIndex.set(toolId, index + 1);
					onDidChange();
				}
			} else if (canAdvance) {
				void chat.answerAskUser(toolId, ui.askAnswers.get(toolId) ?? answers);
			}
			return;
		}
		if (isTypingTarget(e.target as HTMLElement | null)) {
			return;
		}
		const choiceIndex = knoxAskUserShortcutIndex(e.key, 'numbers');
		const choice = item.choices?.[choiceIndex];
		if (choice) {
			e.preventDefault();
			e.stopPropagation();
			const current = ui.askAnswers.get(toolId) ?? answers;
			writeAnswer(ui, toolId, current, item, knoxSetAskUserChoice(item, current[item.name], choice.value));
			onDidChange();
		}
	}));
}

function writeAnswer(
	ui: IKnoxToolUiState,
	toolId: string,
	answers: Record<string, string | string[]>,
	item: IKnoxAskUserItem,
	value: string | string[],
): void {
	const next = { ...answers, [item.name]: value };
	ui.askAnswers.set(toolId, next);
}

function actionButton(parent: HTMLElement, label: string, disabled: boolean): HTMLButtonElement {
	const button = append(parent, $<HTMLButtonElement>('button.knox-ask-action'));
	button.type = 'button';
	button.textContent = label;
	button.disabled = disabled;
	return button;
}

function isTypingTarget(target: HTMLElement | null): boolean {
	if (!target) {
		return false;
	}
	const tag = target.tagName;
	return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}
