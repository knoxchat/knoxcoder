/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { t } from '../t.js';
import * as DOM from '../../../../../../../base/browser/dom.js';
import { renderLoadingState } from '../panels.js';
import {
	groupHistoryTurns,
	lastUserHistoryIndex,
	resolveDisplayStart,
	shouldFloatLastUser,
	visibleTurnIndexes,
} from '../../../../common/knoxGuiChat.js';
import { applyFloatingSentExpanded } from '../chrome.js';
import { IKnoxGuiHistoryItem, IKnoxGuiState } from '../../../../common/knoxGuiState.js';
import { knoxGuiRecipeNotice, recipePreviewToMarkdown } from '../../../../common/knoxGuiRecipe.js';
import {
	collectDuplicateAssistantMessageIds,
	assistantReplyText,
	isDuplicateAssistantReply,
	shouldShineSentFrame,
	turnHasVisibleProgress,
} from '../../../../common/knoxGuiTranscript.js';

export function renderChat(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
	if (state.isLoadingHistory) {
		widget.historyLoadingStartedAt ??= Date.now();
		const loading = DOM.append(body, DOM.$('.knox-gui-history-loading'));
		loading.setAttribute('data-testid', 'chat-history-loading');
		renderLoadingState(widget, loading, {
			label: t(state, 'loadingConversation'),
			variant: 'drive',
			startedAt: widget.historyLoadingStartedAt,
			testId: 'sent-message-loading-state',
			ownClock: true,
		});
	} else {
		widget.historyLoadingStartedAt = undefined;
	}
	if (state.historyHydrateNotice === 'large') {
		const banner = DOM.append(body, DOM.$('.knox-gui-large-banner'));
		banner.setAttribute('role', 'status');
		banner.setAttribute('data-testid', 'large-session-banner');
		DOM.append(banner, DOM.$('span', undefined, t(state, 'largeSessionBanner')));
		widget.chromeButton(banner, {
			label: t(state, 'hide'),
			onClick: () => widget.controller.store.patch({ historyHydrateNotice: null }),
		});
	}
	if (!state.permissionNoticeDismissed && state.permissionMode === 'default' && state.permissionDefaultReason === 'fresh_clone' && state.history.length === 0) {
		const banner = DOM.append(body, DOM.$('.knox-gui-large-banner'));
		banner.setAttribute('role', 'status');
		banner.setAttribute('data-testid', 'permission-notice');
		DOM.append(banner, DOM.$('span', undefined, t(state, 'permissionNoticeFreshClone')));
		widget.chromeButton(banner, {
			label: t(state, 'permissionNoticeKeepAsk'),
			testId: 'permission-notice-keep',
			onClick: () => widget.controller.store.patch({ permissionNoticeDismissed: true }),
		});
		widget.chromeButton(banner, {
			label: t(state, 'permissionNoticeUseAuto'),
			testId: 'permission-notice-auto',
			onClick: () => {
				widget.controller.setPermissionMode('fullAuto');
				widget.controller.store.patch({ permissionNoticeDismissed: true });
			},
		});
	} else if (!state.permissionNoticeDismissed && state.permissionMode === 'fullAuto' && state.history.length === 0) {
		const banner = DOM.append(body, DOM.$('.knox-gui-large-banner'));
		banner.setAttribute('role', 'status');
		banner.setAttribute('data-testid', 'permission-notice');
		DOM.append(banner, DOM.$('span', undefined, t(state, 'permissionNoticeTitle')));
		widget.chromeButton(banner, {
			label: t(state, 'permissionNoticeKeep'),
			testId: 'permission-notice-keep',
			onClick: () => widget.controller.store.patch({ permissionNoticeDismissed: true }),
		});
		widget.chromeButton(banner, {
			label: t(state, 'permissionNoticeAsk'),
			testId: 'permission-notice-ask',
			onClick: () => {
				widget.controller.setPermissionMode('default');
				widget.controller.store.patch({ permissionNoticeDismissed: true });
			},
		});
	}
	if (!state.memoryNoticeDismissed && state.history.length === 0) {
		const banner = DOM.append(body, DOM.$('.knox-gui-large-banner'));
		banner.setAttribute('role', 'status');
		banner.setAttribute('data-testid', 'memory-notice');
		DOM.append(banner, DOM.$('span', undefined, t(state, 'memoryNoticeTitle')));
		widget.chromeButton(banner, {
			label: t(state, 'memoryNoticeOk'),
			testId: 'memory-notice-ok',
			onClick: () => widget.controller.store.patch({ memoryNoticeDismissed: true }),
		});
	}
	if (state.history.length === 0 && state.models.length === 0 && !state.isStreaming && !state.addModelModal) {
		const banner = DOM.append(body, DOM.$('.knox-gui-large-banner'));
		banner.setAttribute('role', 'status');
		banner.setAttribute('data-testid', 'first-run-no-model');
		DOM.append(banner, DOM.$('span', undefined, t(state, 'firstRunNoModel')));
		widget.chromeButton(banner, {
			label: t(state, 'addModel'),
			testId: 'first-run-open-settings',
			onClick: () => widget.controller.openAddModel('chat', { bulk: true }),
		});
		widget.chromeButton(banner, {
			label: t(state, 'signInKnoxStudio'),
			testId: 'first-run-sign-in',
			onClick: () => widget.controller.openAddModel('chat', { bulk: true }),
		});
	}
	if (state.streamRetry && state.isStreaming) {
		const retry = state.streamRetry;
		const banner = DOM.append(body, DOM.$('.knox-gui-large-banner'));
		banner.setAttribute('role', 'status');
		banner.setAttribute('data-testid', 'stream-retry-banner');
		const fallback = retry.usingFallback ? `, ${t(state, 'retryingStreamFallback')}` : '';
		DOM.append(banner, DOM.$('span', undefined, `${t(state, 'retryingStream')} (${retry.attempt}/${retry.maxAttempts})${fallback}`));
	}
	DOM.append(body, DOM.$('.knox-gui-body-spacer'));
	if (!state.history.length) {
		widget.displayStart = 0;
		renderRecipeDecision(widget, body, state);
		return;
	}
	const lastUserIndex = lastUserHistoryIndex(state.history);
	const floatLastUser = shouldFloatLastUser({
		isStreaming: state.isStreaming,
		// Keep the live prompt pinned while the turn runs, even if the user scrolled
		// up to read thinking / tools. Un-floating mid-stream inserts the prompt into
		// the scroller and shoves the paused view down.
		followLive: true,
		lastUserIndex,
	});
	const turns = groupHistoryTurns(state.history);
	if (state.find.open && state.find.matchIndexes.length) {
		const hit = state.find.matchIndexes[state.find.current];
		if (Number.isFinite(hit) && hit < resolveDisplayStart({ historyLength: state.history.length, expandedStart: widget.expandedStart, turns })) {
			widget.expandedStart = hit;
		}
	}
	const displayStart = resolveDisplayStart({
		historyLength: state.history.length,
		expandedStart: widget.expandedStart,
		turns,
	});
	widget.displayStart = displayStart;
	const content = DOM.append(body, DOM.$('div'));
	content.setAttribute('data-testid', 'chat-scroll-content');
	if (displayStart > 0) {
		widget.chromeButton(content, {
			label: t(state, 'loadEarlierMessages', { count: displayStart }),
			testId: 'load-earlier-messages',
			extraClass: 'knox-gui-load-earlier',
			onClick: () => widget.loadEarlier(),
		});
	}
	// Chat.tsx: the ErrorBoundary wraps only the list; the loading row, large-session banner and spacer stay outside it.
	if (widget.chatListFailed) {
		content.replaceChildren();
		widget.renderChatListError(content, state);
		return;
	}
	try {
		const list = DOM.append(content, DOM.$('.knox-gui-history'));
		list.setAttribute('data-testid', 'chat-virtual-list');
		list.setAttribute('role', 'log');
		list.setAttribute('aria-live', 'polite');
		list.setAttribute('aria-relevant', 'additions');
		list.setAttribute('aria-label', t(state, 'chatTranscript'));
		const duplicateIds = collectDuplicateAssistantMessageIds(state.history, state.history.length - (state.isStreaming ? 2 : 1));
		for (const turn of turns) {
			const indexes = visibleTurnIndexes(turn, displayStart, lastUserIndex);
			if (!indexes.length) {
				continue;
			}
			const group = DOM.append(list, DOM.$('.knox-gui-turn'));
			group.setAttribute('data-testid', `chat-turn-${turn.startIndex}`);
			for (const i of indexes) {
				if (floatLastUser && i === lastUserIndex) {
					continue;
				}
				const currentHit = state.find.open && state.find.matchIndexes[state.find.current] === i;
				const anyHit = state.find.open && state.find.matchIndexes.includes(i);
				widget.renderHistoryRow(group, state, i, anyHit, currentHit, lastUserIndex, duplicateIds);
			}
		}
		renderRecipeDecision(widget, list, state);
		if (floatLastUser && widget.floatingHostEl && lastUserIndex >= 0) {
			const currentHit = state.find.open && state.find.matchIndexes[state.find.current] === lastUserIndex;
			const anyHit = state.find.open && state.find.matchIndexes.includes(lastUserIndex);
			widget.renderHistoryRow(widget.floatingHostEl, state, lastUserIndex, anyHit, currentHit, lastUserIndex, duplicateIds);
			const fade = DOM.append(widget.floatingHostEl, DOM.$('.knox-gui-sticky-last-user-fade'));
			fade.setAttribute('aria-hidden', 'true');
			fade.setAttribute('data-testid', 'sticky-last-user-fade');
			applyFloatingSentExpanded(widget);
		} else {
			widget.floatingSentExpanded = false;
			widget.floatingHostEl?.classList.remove('knox-gui-floating-sent-expanded');
		}
	} catch (error) {
		widget.chatListFailed = true;
		content.replaceChildren();
		widget.renderChatListError(content, state, error);
	}
}

function renderRecipeDecision(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
	const recipeNotice = knoxGuiRecipeNotice(state.recipeDecision);
	if (recipeNotice && recipeNotice.key !== 'recipeDecisionSkipped' && recipeNotice.key !== 'recipeDecisionSkippedNear') {
		const banner = DOM.append(parent, DOM.$('.knox-gui-large-banner'));
		banner.setAttribute('role', 'status');
		banner.setAttribute('data-testid', 'recipe-decision-notice');
		DOM.append(banner, DOM.$('span', undefined, t(state, recipeNotice.key, recipeNotice.params)));
		if (recipeNotice.whatIfBranch) {
			const whatIf = DOM.append(banner, DOM.$('p.knox-gui-muted'));
			whatIf.setAttribute('data-testid', 'recipe-whatif-branch');
			whatIf.textContent = t(state, 'recipeWhatIfBranch', { branch: recipeNotice.whatIfBranch });
		}
		const undoId = recipeNotice.undoCheckpointId;
		if (undoId) {
			widget.chromeButton(banner, {
				label: t(state, 'recipeUndo'),
				testId: 'recipe-decision-undo',
				onClick: () => widget.controller.restoreCheckpoint(undoId),
			});
		}
		const decision = state.recipeDecision;
		if (decision?.recipe?.skillEligible && !decision.awaitingChoice) {
			if (decision.skillResult) {
				DOM.append(banner, DOM.$('span', undefined, decision.skillResult));
			} else {
				widget.chromeButton(banner, {
					label: t(state, 'recipePromoteProject'),
					testId: 'recipe-promote-project',
					onClick: () => widget.controller.promoteRecipeSkill('project'),
				});
				widget.chromeButton(banner, {
					label: t(state, 'recipePromoteGlobal'),
					testId: 'recipe-promote-global',
					onClick: () => widget.controller.promoteRecipeSkill('global'),
				});
			}
		}
	}
	const pending = state.recipeDecision;
	if (pending?.awaitingChoice && pending.recipe && (pending.preview || pending.slots?.length || pending.files?.length || pending.compose)) {
		const card = DOM.append(parent, DOM.$('.knox-gui-recipe-preview-card'));
		card.setAttribute('role', 'group');
		card.setAttribute('data-testid', 'recipe-preview-card');
		const title = DOM.append(card, DOM.$('span.knox-gui-recipe-preview-title', undefined, t(state, pending.compose ? 'recipeComposeTitle' : 'recipePreviewTitle', { title: pending.recipe.title, count: pending.compose?.recipes.length ?? 1 })));
		title.id = 'knox-recipe-preview-title';
		card.setAttribute('aria-labelledby', title.id);
		const latency = DOM.append(card, DOM.$('p.knox-gui-muted'));
		latency.setAttribute('data-testid', 'recipe-preview-latency');
		latency.textContent = t(state, 'recipePreviewLatency');
		if (pending.compose?.recipes.length) {
			const plan = DOM.append(card, DOM.$('ol'));
			plan.setAttribute('data-testid', 'recipe-compose-plan');
			for (const [index, child] of pending.compose.recipes.entries()) {
				const item = DOM.append(plan, DOM.$('li'));
				item.textContent = t(state, 'recipeComposeStep', { index: index + 1, title: child.title });
			}
		}
		const slotsHost = pending.slots?.length ? DOM.append(card, DOM.$('div')) : undefined;
		if (slotsHost) {
			slotsHost.setAttribute('data-testid', 'recipe-slot-fields');
		}
		if (pending.files?.length) {
			const filesHost = DOM.append(card, DOM.$('div'));
			filesHost.setAttribute('data-testid', 'recipe-file-fields');
			const extra = pending.files.some(file => file.extra);
			DOM.append(filesHost, DOM.$('p.knox-gui-muted', undefined, t(state, extra ? 'recipeExtraFiles' : 'recipePartialFiles')));
			for (const [index, file] of pending.files.entries()) {
				const row = DOM.append(filesHost, DOM.$('label'));
				const input = document.createElement('input');
				input.type = 'checkbox';
				input.checked = file.included;
				input.setAttribute('data-testid', `recipe-file-include-${index}`);
				row.appendChild(input);
				row.append(` ${file.path}${file.extra ? ` (${t(state, 'recipeFileExtra')})` : ''}`);
			}
		}
		if (pending.preview) {
			const preview = DOM.append(card, DOM.$('.knox-gui-recipe-preview-md'));
			widget.appendMarkdown(preview, recipePreviewToMarkdown(pending.preview));
		}
		const actions = DOM.append(card, DOM.$('.knox-gui-recipe-preview-actions'));
		const slotsReady = !pending.slots?.length || pending.slots.every(slot => Boolean(slot.value?.trim()));
		const applyBtn = widget.chromeButton(actions, {
			label: t(state, 'recipeApply'),
			testId: 'recipe-preview-apply',
			disabled: !slotsReady,
			onClick: () => {
				widget.controller.flushRecipeSlotInputs(card);
				widget.controller.answerRecipeChoice('apply');
			},
		});
		widget.chromeButton(actions, {
			label: t(state, 'recipeSkip'),
			testId: 'recipe-preview-skip',
			onClick: () => widget.controller.answerRecipeChoice('skip'),
		});
		if (slotsHost && pending.slots) {
			DOM.append(slotsHost, DOM.$('p.knox-gui-muted', undefined, t(state, 'recipeSlotsNeedValues')));
			for (const slot of pending.slots) {
				const row = DOM.append(slotsHost, DOM.$('label'));
				row.textContent = slot.name;
				const input = document.createElement('input');
				input.type = 'text';
				input.value = slot.value ?? '';
				input.placeholder = slot.examples?.[0] ?? '';
				input.setAttribute('data-testid', `recipe-slot-input-${slot.name}`);
				input.addEventListener('input', () => {
					applyBtn.disabled = ![...slotsHost.querySelectorAll('input')].every(el => (el as HTMLInputElement).value.trim());
				});
				row.appendChild(input);
			}
		}
	}
}

export function renderChatListError(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState, error?: unknown): void {
	const card = DOM.append(body, DOM.$('.knox-gui-error-fallback'));
	card.setAttribute('role', 'alert');
	card.setAttribute('data-testid', 'chat-list-error');
	DOM.append(card, DOM.$('p', undefined, t(state, 'chatListFailed')));
	if (error) {
		DOM.append(card, DOM.$('pre.knox-gui-error', undefined, error instanceof Error ? error.message : String(error)));
	}
	widget.chromeButton(card, {
		label: t(state, 'retry'),
		onClick: () => {
			widget.chatListFailed = false;
			widget.render();
		},
	});
}

export function renderHistoryRow(widget: KnoxGuiWidget,
	parent: HTMLElement,
	state: IKnoxGuiState,
	index: number,
	highlight: boolean,
	currentHit: boolean,
	lastUserIndex: number,
	duplicateIds: Set<string>,
): void {
	const item = state.history[index];
	const wrap = DOM.append(parent, DOM.$('.knox-gui-turn'));
	wrap.classList.toggle('last-message', index === state.history.length - 1);
	wrap.classList.toggle('knox-gui-floating-last-user', parent === widget.floatingHostEl);
	wrap.setAttribute('data-testid', `history-row-${index}`);
	if (widget.failedRows.has(item.id)) {
		widget.renderRowError(wrap, state, item);
		return;
	}
	try {
		widget.renderMessage(wrap, state, item, highlight, currentHit, index, lastUserIndex, duplicateIds);
	} catch (error) {
		widget.failedRows.add(item.id);
		wrap.replaceChildren();
		widget.renderRowError(wrap, state, item, error);
	}
}

export function renderRowError(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiHistoryItem, error?: unknown): void {
	const card = DOM.append(parent, DOM.$('.knox-gui-error-fallback'));
	card.setAttribute('role', 'alert');
	card.setAttribute('data-testid', 'history-row-error');
	DOM.append(card, DOM.$('p', undefined, t(state, 'somethingWentWrong')));
	DOM.append(card, DOM.$('pre.knox-gui-error', undefined, error instanceof Error ? error.message : (item.error || String(error ?? ''))));
	widget.chromeButton(card, {
		label: t(state, 'retry'),
		onClick: () => {
			widget.failedRows.delete(item.id);
			widget.render();
		},
	});
}

export function renderMessage(widget: KnoxGuiWidget,
	body: HTMLElement,
	state: IKnoxGuiState,
	item: IKnoxGuiHistoryItem,
	highlight: boolean,
	currentHit: boolean,
	index: number,
	lastUserIndex: number,
	duplicateIds: Set<string>,
): void {
	if (item.role === 'tool') {
		widget.renderToolOutputPeek(body, state, item);
		const doomName = t(state, 'doomLoopName');
		const isDoomBlock = item.toolCalls?.some(call => call.outputItems?.some(out => out.name === doomName));
		if (isDoomBlock && index === state.history.length - 1 && !state.isStreaming) {
			const banner = DOM.append(body, DOM.$('.knox-gui-large-banner'));
			banner.setAttribute('role', 'status');
			banner.setAttribute('data-testid', 'change-strategy-banner');
			DOM.append(banner, DOM.$('span', undefined, t(state, 'doomLoopDescription')));
			widget.chromeButton(banner, {
				label: t(state, 'changeStrategy'),
				testId: 'change-strategy',
				onClick: () => { void widget.controller.submit(t(state, 'changeStrategyPrompt')); },
			});
		}
		return;
	}
	const isLast = index === state.history.length - 1;
	const isLastUser = index === lastUserIndex;
	if (item.role === 'user') {
		widget.renderUserTurn(body, state, item, highlight, currentHit, index, isLastUser);
		if (state.mode === 'agent' && !isLastUser) {
			widget.renderActivityTimeline(body, state, index);
		} else if (state.mode !== 'agent' && shouldShineSentFrame(isLastUser, state.isStreaming, turnHasVisibleProgress(state.history, index))) {
			widget.renderTurnLoading(body, state, item);
		}
		return;
	}
	if (item.role === 'thinking') {
		widget.renderThinkingPeekBlock(body, state, item, index, isLast && state.isStreaming);
		return;
	}
	const isDuplicate = duplicateIds.has(item.id) || isDuplicateAssistantReply(state.history, index);
	if (item.role === 'assistant' && isDuplicate) {
		// HistoryItemRow.tsx: a duplicate reply never repeats its text (even on the last row), but a row with tool calls still
		// mounts Reasoning (`item.reasoning && !showAssistantReply`) and its tools. Without tool calls the row renders nothing.
		if (item.toolCalls?.length) {
			widget.renderReasoning(body, state, item, index);
			for (const tool of item.toolCalls) {
				widget.renderTool(body, state, tool);
			}
		}
		return;
	}
	if (item.role === 'assistant' && !assistantReplyText(item) && !(isLast && state.isStreaming) && !item.thinking && !item.toolCalls?.length && !item.error) {
		return;
	}
	widget.renderAssistantTurn(body, state, item, highlight, currentHit, index, isLast);
}
