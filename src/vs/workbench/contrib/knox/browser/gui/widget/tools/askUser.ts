/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Ask-user form: stepped questions, choices, freeform, keyboard shortcuts, submit/deny. */

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { t } from '../t.js';
import * as DOM from '../../../../../../../base/browser/dom.js';
import { appendKnoxGuiSvg } from '../../knoxGuiIcons.js';
import {
	formatAskUserDisplayAnswer,
	isAskUserAnswered,
	resolveAskUserQuestions,
	splitChoiceText,
} from '../../../../common/knoxGuiTools.js';
import { IKnoxGuiState, IKnoxGuiToolCall } from '../../../../common/knoxGuiState.js';

export function renderAskUser(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, tool: IKnoxGuiToolCall): void {
	let questions = resolveAskUserQuestions(tool);
	const waiting = tool.status === 'generated';
	if (!questions.length) {
		const invalid = DOM.append(parent, DOM.$('.knox-gui-muted', undefined, t(state, 'askUserInvalid')));
		invalid.setAttribute('data-testid', 'knox-gui-ask-invalid');
		if (!waiting) {
			return;
		}
		questions = [{ id: 'q1', prompt: t(state, 'askUserFallbackPrompt') }];
	}
	const drafts = widget.askUserDrafts.get(tool.id) ?? { ...(tool.answers ?? {}) };
	widget.askUserDrafts.set(tool.id, drafts);
	const declined = tool.status === 'canceled';
	if (!waiting) {
		const card = DOM.append(parent, DOM.$('.knox-gui-ask-card'));
		card.setAttribute('data-testid', 'knox-gui-ask');
		for (const question of questions) {
			const row = DOM.append(card, DOM.$('.knox-gui-ask-done'));
			DOM.append(row, DOM.$('div.knox-gui-muted', undefined, question.prompt));
			const answer = DOM.append(row, DOM.$('.knox-gui-ask-answer'));
			appendKnoxGuiSvg(answer, 'check', 14);
			DOM.append(answer, DOM.$('span', undefined, formatAskUserDisplayAnswer(drafts, question.id, tool.answers?.[question.id]) || (declined ? t(state, 'askUserDeclined') : t(state, 'askUserAnswered'))));
		}
		return;
	}
	const card = DOM.append(parent, DOM.$('.knox-gui-ask-card'));
	card.setAttribute('data-testid', 'knox-gui-ask');
	card.setAttribute('role', 'form');
	card.tabIndex = 0;
	const step = Math.min(widget.askUserStep.get(tool.id) ?? 0, Math.max(0, questions.length - 1));
	if (questions.length > 1) {
		const progress = DOM.append(card, DOM.$('.knox-gui-ask-progress', undefined, t(state, 'askUserProgress', { current: step + 1, total: questions.length })));
		progress.setAttribute('data-testid', 'knox-gui-ask-progress');
		const track = DOM.append(progress, DOM.$('.knox-gui-ask-progress-track'));
		const fill = DOM.append(track, DOM.$('.knox-gui-ask-progress-fill'));
		fill.style.width = `${((step + 1) / questions.length) * 100}%`;
	}
	const question = questions[step];
	card.setAttribute('aria-label', question.prompt);
	const item = DOM.append(card, DOM.$('.knox-gui-ask-item'));
	DOM.append(item, DOM.$('.knox-gui-ask-prompt', undefined, question.prompt));
	if (question.allowMultiple) {
		DOM.append(item, DOM.$('.knox-gui-muted', undefined, t(state, 'askUserMultipleHint')));
	}
	const freeformKey = `${question.id}::freeform`;
	const selected = new Set((drafts[question.id] ?? '').split('\u0001').filter(Boolean));
	const setChoice = (option: string) => {
		if (question.allowMultiple) {
			if (selected.has(option)) {
				selected.delete(option);
			} else {
				selected.add(option);
			}
			drafts[question.id] = [...selected].join('\u0001');
		} else {
			drafts[question.id] = option;
		}
		widget.askUserDrafts.set(tool.id, drafts);
		widget.render();
	};
	if (question.options?.length) {
		const choices = DOM.append(item, DOM.$('.knox-gui-ask-choices'));
		question.options.forEach((option, optionIndex) => {
			const split = splitChoiceText(option);
			const btn = DOM.append(choices, DOM.$('button.knox-gui-ask-choice')) as HTMLButtonElement;
			btn.type = 'button';
			if (selected.has(option)) {
				btn.classList.add('selected');
			}
			const row = DOM.append(btn, DOM.$('.knox-gui-ask-choice-row'));
			const mark = DOM.append(row, DOM.$('input')) as HTMLInputElement;
			mark.type = question.allowMultiple ? 'checkbox' : 'radio';
			mark.checked = selected.has(option);
			mark.tabIndex = -1;
			const texts = DOM.append(row, DOM.$('span.knox-gui-ask-choice-texts'));
			DOM.append(texts, DOM.$('span.knox-gui-ask-choice-label', undefined, split.label));
			if (split.description) {
				DOM.append(texts, DOM.$('span.knox-gui-muted.knox-gui-ask-choice-desc', undefined, split.description));
			}
			if (optionIndex < 9) {
				DOM.append(row, DOM.$('kbd.knox-gui-ask-kbd', undefined, String(optionIndex + 1)));
			}
			widget.renderStore.add(DOM.addDisposableListener(btn, 'click', () => setChoice(option)));
		});
	}
	if (question.allowFreeform || !question.options?.length) {
		const input = DOM.append(item, DOM.$('input.knox-gui-ask-input')) as HTMLInputElement;
		input.placeholder = t(state, 'askUserFreeform');
		input.setAttribute('aria-label', t(state, 'askUserFreeformLabel'));
		input.value = drafts[freeformKey] ?? (question.allowMultiple || question.options?.length ? '' : (drafts[question.id] ?? ''));
		widget.renderStore.add(DOM.addDisposableListener(input, 'input', () => {
			if (question.allowMultiple || question.options?.length) {
				drafts[freeformKey] = input.value;
			} else {
				drafts[question.id] = input.value;
			}
			widget.askUserDrafts.set(tool.id, drafts);
		}));
	}
	const answered = isAskUserAnswered(drafts[question.id]) || isAskUserAnswered(drafts[freeformKey]);
	const goNext = () => {
		if (!answered || step >= questions.length - 1) {
			return;
		}
		widget.askUserStep.set(tool.id, step + 1);
		widget.render();
	};
	const submit = () => {
		if (!answered) {
			return;
		}
		const answers: Record<string, string> = {};
		const latest = widget.askUserDrafts.get(tool.id) ?? drafts;
		for (const q of questions) {
			const choices = (latest[q.id] ?? '').split('\u0001').filter(Boolean);
			const extra = (latest[`${q.id}::freeform`] ?? '').trim();
			answers[q.id] = [...choices, extra].filter(Boolean).join(', ');
		}
		widget.controller.answerAskUser(tool.id, answers);
	};
	const isTypingTarget = (target: EventTarget | null) => {
		if (!(target instanceof HTMLElement)) {
			return false;
		}
		const tag = target.tagName;
		return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
	};
	widget.renderStore.add(DOM.addDisposableListener(card, 'keydown', e => {
		if (e.key === 'Enter' && !e.shiftKey) {
			if (isTypingTarget(e.target) && !answered) {
				return;
			}
			e.preventDefault();
			if (step < questions.length - 1) {
				goNext();
			} else {
				submit();
			}
			return;
		}
		if (isTypingTarget(e.target) || e.key.length !== 1) {
			return;
		}
		const index = Number(e.key) - 1;
		const option = question.options?.[index];
		if (option) {
			e.preventDefault();
			setChoice(option);
		}
	}));
	const actions = DOM.append(card, DOM.$('.knox-gui-ask-actions'));
	widget.chromeButton(actions, { label: t(state, 'deny'), extraClass: 'knox-gui-tool-deny', testId: 'ask-user-deny', onClick: () => widget.controller.denyTool(tool.id) });
	if (questions.length > 1 && step > 0) {
		widget.chromeButton(actions, {
			label: t(state, 'askUserPrevious'),
			testId: 'ask-user-previous',
			onClick: () => {
				widget.askUserStep.set(tool.id, step - 1);
				widget.render();
			},
		});
	}
	if (questions.length > 1 && step < questions.length - 1) {
		widget.chromeButton(actions, {
			label: t(state, 'askUserNext'),
			testId: 'ask-user-next',
			disabled: !answered,
			onClick: goNext,
		});
	} else {
		widget.chromeButton(actions, {
			label: t(state, 'askUserSubmit'),
			extraClass: 'knox-gui-tool-approve',
			testId: 'ask-user-submit',
			disabled: !answered,
			onClick: submit,
		});
	}
}
