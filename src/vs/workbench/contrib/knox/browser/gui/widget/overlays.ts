/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../knoxGuiWidget.js';
import { t } from './t.js';
import { appendShortcut } from './controls.js';
import * as DOM from '../../../../../../base/browser/dom.js';
import { appendKnoxGuiSvg } from '../knoxGuiIcons.js';
import { parseToolArgs, toolDisplayKind } from '../../../common/knoxGuiChat.js';
import { knoxGuiLocalAutoApprove } from '../../../common/knoxGuiAgentRequest.js';
import { getCategorizedToolName, isSamePermissionTool, toolPermissionDisplay } from '../../../common/knoxGuiTools.js';
import {
	contextProviderInsertId,
	DEFAULT_AGENT_TOOL_POLICY_TEXT,
	duplicateToolNames,
	applyHistoryRowSelection,
	filterHistorySessions,
	formatSessionDate,
	groupHistoryByDate,
	parseHistoryDate,
	selectHistoryIdRange,
	groupToolsByGroup,
	MODEL_OVERLAY_ROLES,
	MODEL_ROLE_LABEL_KEY,
	MODEL_ROLE_USED_FOR_KEY,
	modelUsesChatFallback,
	pendingGeneratedToolName,
	emptyPromptDraft,
	exploreBlocksButton,
	mergeRuleCards,
	policyEditorText,
	promptDraftFromCommand,
	promptDraftIsEditing,
	promptDraftIsValid,
	ruleCardOpensProfile,
	ruleCardTitleKey,
	sortPromptsBookmarkedFirst,
	toolPermissionBadgeKey,
	workspaceBasename,
} from '../../../common/knoxGuiOverlays.js';
import { KnoxGuiOverlay, KnoxGuiRoute } from '../../../common/knoxGuiProtocol.js';
import { isSlashBookmarked, knoxGuiIsMetaEquivalent } from '../../../common/knoxGuiInput.js';
import { IKnoxGuiHistorySession, IKnoxGuiState } from '../../../common/knoxGuiState.js';

export function renderOverlay(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState, overlay: Exclude<KnoxGuiOverlay, null>): void {
	switch (overlay) {
		case 'settings':
			widget.renderSettings(body, state, true);
			return;
		case 'history':
			widget.renderHistoryPage(body, state, true);
			return;
		case 'models':
			widget.renderModels(body, state);
			return;
		case 'rules':
			widget.renderRules(body, state);
			return;
		case 'prompts':
			widget.renderPrompts(body, state);
			return;
		case 'context':
			widget.renderContext(body, state);
			return;
		case 'tools':
			widget.renderTools(body, state);
			return;
	}
}

export function renderModels(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
	const grid = DOM.append(body, DOM.$('.knox-gui-model-roles'));
	for (const role of MODEL_OVERLAY_ROLES) {
		const label = t(state, MODEL_ROLE_LABEL_KEY[role]);
		const labelWrap = DOM.append(grid, DOM.$('span.knox-gui-model-role-label', undefined, label));
		labelWrap.title = t(state, MODEL_ROLE_USED_FOR_KEY[role]);
		const row = DOM.append(grid, DOM.$('.knox-gui-model-role'));
		const models = state.modelsByRole[role];
		const selected = state.selectedModelByRole[role] ?? (role === 'chat' ? state.modelTitle : undefined);
		const wrap = DOM.append(row, DOM.$('.knox-gui-listbox'));
		const trigger = widget.chromeButton(wrap, {
			label: models.length
				? (selected || t(state, 'selectRoleModel', { role: label }))
				: `${t(state, 'noModelsForRole', { role: label })}${modelUsesChatFallback(role, models) ? `. ${t(state, 'usingChatModel')}` : ''}`,
			svg: models.length ? 'chevrons-up-down' : undefined,
			svgSize: 12,
			svgAfter: true,
			title: t(state, MODEL_ROLE_USED_FOR_KEY[role]),
			disabled: models.length === 0,
			extraClass: 'knox-gui-listbox-btn',
			menuTrigger: true,
			testId: `knox-gui-role-${role}`,
			onClick: () => {
				widget.openRoleMenu = widget.openRoleMenu === role ? null : role;
				widget.render();
			},
		});
		trigger.setAttribute('aria-haspopup', 'listbox');
		trigger.setAttribute('aria-label', label);
		if (models.length === 0) {
			trigger.classList.add('knox-gui-listbox-empty');
		}
		if (widget.openRoleMenu === role && models.length) {
			const menu = DOM.append(wrap, DOM.$('.knox-gui-popover.knox-gui-role-menu'));
			menu.setAttribute('role', 'listbox');
			for (const model of models) {
				const option = DOM.append(menu, DOM.$('button.knox-gui-popover-item')) as HTMLButtonElement;
				option.type = 'button';
				option.setAttribute('role', 'option');
				DOM.append(option, DOM.$('span.knox-gui-listbox-option', undefined, model.title));
				if (model.title === selected) {
					appendKnoxGuiSvg(option, 'check', 12);
				}
				widget.renderStore.add(DOM.addDisposableListener(option, 'click', e => {
					e.stopPropagation();
					widget.openRoleMenu = null;
					widget.controller.selectModel(role, model.title);
				}));
			}
		}
		const gear = widget.chromeButton(row, {
			svg: 'settings',
			svgSize: 16,
			title: t(state, 'addUpdateRoleModel', { role: label }),
			extraClass: 'knox-gui-role-gear knox-gui-role-gear-hidden',
			onClick: () => widget.controller.openAddModel(role),
		});
		widget.renderStore.add(DOM.addDisposableListener(row, 'mouseenter', () => gear.classList.remove('knox-gui-role-gear-hidden')));
		widget.renderStore.add(DOM.addDisposableListener(row, 'mouseleave', () => gear.classList.add('knox-gui-role-gear-hidden')));
	}
	widget.chromeButton(body, {
		svg: 'settings',
		svgSize: 12,
		label: t(state, 'openConfigFile'),
		extraClass: 'knox-gui-ghost knox-gui-open-config',
		testId: 'knox-gui-open-config',
		onClick: () => {
			if (state.profileType === 'local') {
				widget.controller.messenger.post('config/openProfile', { profileId: state.profileId });
			}
		},
	});
}

export function renderRules(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
	const cards = mergeRuleCards(state.rules, state.yamlRules);
	const list = DOM.append(body, DOM.$('.knox-gui-rule-list'));
	cards.forEach((rule, index) => {
		const card = DOM.append(list, DOM.$('.knox-gui-card.knox-gui-rule-card'));
		card.setAttribute('data-testid', `knox-gui-rule-card-${index}`);
		const inner = DOM.append(card, DOM.$('.knox-gui-rule-card-inner'));
		const main = DOM.append(inner, DOM.$('.knox-gui-rule-card-main'));
		const title = ruleCardTitleKey(rule);
		DOM.append(main, DOM.$('div.knox-gui-rule-title', undefined, title.title ?? t(state, title.key)));
		DOM.append(main, DOM.$('div.knox-gui-rule-preview.knox-gui-cyan', undefined, rule.body));
		const actions = DOM.append(inner, DOM.$('.knox-gui-rule-card-actions'));
		widget.chromeButton(actions, {
			svg: 'maximize-2',
			svgSize: 12,
			title: t(state, 'expand'),
			extraClass: 'knox-gui-rule-action knox-gui-rule-expand',
			testId: `knox-gui-rule-expand-${index}`,
			onClick: () => widget.openRuleDialog(index),
		});
		widget.chromeButton(actions, {
			svg: 'square-pen',
			svgSize: 12,
			title: t(state, 'edit'),
			extraClass: 'knox-gui-rule-action knox-gui-rule-edit',
			testId: `knox-gui-rule-edit-${index}`,
			onClick: () => {
				if (ruleCardOpensProfile(rule)) {
					widget.controller.messenger.post('config/openProfile', { profileId: undefined });
				}
			},
		});
	});
	renderExploreBlocksButton(widget, body, state, 'rules');
}

export function renderExploreBlocksButton(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState, blockType: string): void {
	const spec = exploreBlocksButton(state.profileType, blockType);
	widget.chromeButton(body, {
		svg: spec.icon,
		svgSize: 12,
		label: `${t(state, spec.actionKey)} ${t(state, spec.blockKey)}`,
		extraClass: 'knox-gui-ghost knox-gui-explore-blocks',
		testId: 'knox-gui-explore-blocks',
		onClick: () => {
			if (spec.isLocal) {
				widget.controller.messenger.post('config/openProfile', { profileId: state.profileId });
			}
		},
	});
}

export function renderRuleExpandDialog(widget: KnoxGuiWidget, state: IKnoxGuiState): void {
	const cards = mergeRuleCards(state.rules, state.yamlRules);
	const index = widget.expandedRuleIndex;
	if (index === null) {
		return;
	}
	const rule = cards[index];
	if (!rule) {
		widget.expandedRuleIndex = null;
		return;
	}
	const title = ruleCardTitleKey(rule);
	const overlay = DOM.append(widget.root, DOM.$('.knox-gui-text-dialog'));
	overlay.setAttribute('data-testid', 'knox-gui-rule-dialog');
	overlay.setAttribute('role', 'presentation');
	widget.renderStore.add(DOM.addDisposableListener(overlay, 'click', () => widget.closeRuleDialog()));
	const panel = DOM.append(overlay, DOM.$('.knox-gui-text-dialog-panel'));
	widget.renderStore.add(DOM.addDisposableListener(panel, 'click', e => e.stopPropagation()));
	const box = DOM.append(panel, DOM.$('.knox-gui-text-dialog-body'));
	box.setAttribute('role', 'dialog');
	box.setAttribute('aria-modal', 'true');
	widget.chromeButton(box, {
		svg: 'x',
		svgSize: 20,
		title: t(state, 'close'),
		extraClass: 'knox-gui-text-dialog-close',
		testId: 'knox-gui-rule-dialog-close',
		onClick: () => widget.closeRuleDialog(),
	});
	const content = DOM.append(box, DOM.$('.knox-gui-rule-dialog-content'));
	DOM.append(content, DOM.$('h3', undefined, title.title ?? t(state, title.key)));
	DOM.append(content, DOM.$('pre.knox-gui-rule-dialog-pre', undefined, rule.body));
}

export function renderPrompts(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
	const list = DOM.append(body, DOM.$('.knox-gui-prompt-list'));
	sortPromptsBookmarkedFirst(state.slashCommands, state.bookmarkedSlash).forEach((cmd, index) => {
		const row = DOM.append(list, DOM.$('.knox-gui-prompt-row'));
		row.setAttribute('data-testid', `knox-gui-prompt-row-${index}`);
		const main = DOM.append(row, DOM.$('.knox-gui-prompt-row-main'));
		DOM.append(main, DOM.$('span.knox-gui-prompt-name', undefined, cmd.name));
		DOM.append(main, DOM.$('span.knox-gui-prompt-desc', undefined, cmd.description));
		const actions = DOM.append(row, DOM.$('.knox-gui-prompt-row-actions'));
		widget.chromeButton(actions, {
			svg: 'square-pen',
			svgSize: 12,
			title: t(state, 'edit'),
			extraClass: 'knox-gui-prompt-edit',
			testId: `knox-gui-prompt-edit-${index}`,
			onClick: () => widget.controller.store.patch({ promptDraft: promptDraftFromCommand(cmd) }),
		});
		const bookmarked = isSlashBookmarked(state.bookmarkedSlash, cmd.name);
		widget.chromeButton(actions, {
			svg: 'bookmark',
			svgSize: 12,
			title: t(state, bookmarked ? 'slashUnbookmark' : 'slashBookmark'),
			extraClass: bookmarked ? 'knox-gui-prompt-bookmark is-bookmarked' : 'knox-gui-prompt-bookmark',
			testId: `knox-gui-prompt-bookmark-${index}`,
			onClick: () => widget.controller.toggleBookmark(cmd.name),
		});
	});
	widget.chromeButton(body, {
		svg: 'plus',
		svgSize: 12,
		label: t(state, 'addPrompt'),
		extraClass: 'knox-gui-ghost knox-gui-add-prompt',
		testId: 'knox-gui-add-prompt',
		onClick: () => widget.controller.store.patch({ promptDraft: emptyPromptDraft() }),
	});
}

export function renderPromptEditor(widget: KnoxGuiWidget, state: IKnoxGuiState): void {
	const draft = state.promptDraft;
	if (!draft) {
		return;
	}
	const editing = promptDraftIsEditing(draft);
	const overlay = DOM.append(widget.root, DOM.$('.knox-gui-text-dialog'));
	overlay.setAttribute('data-testid', 'knox-gui-prompt-dialog');
	overlay.setAttribute('role', 'presentation');
	widget.renderStore.add(DOM.addDisposableListener(overlay, 'click', () => widget.closePromptDialog()));
	const panel = DOM.append(overlay, DOM.$('.knox-gui-text-dialog-panel'));
	widget.renderStore.add(DOM.addDisposableListener(panel, 'click', e => e.stopPropagation()));
	const box = DOM.append(panel, DOM.$('.knox-gui-text-dialog-body'));
	box.setAttribute('role', 'dialog');
	box.setAttribute('aria-modal', 'true');
	box.setAttribute('aria-labelledby', 'knox-gui-prompt-dialog-title');
	widget.chromeButton(box, {
		svg: 'x',
		svgSize: 20,
		title: t(state, 'close'),
		extraClass: 'knox-gui-text-dialog-close',
		testId: 'knox-gui-prompt-dialog-close',
		onClick: () => widget.closePromptDialog(),
	});
	const form = DOM.append(box, DOM.$('form.knox-gui-prompt-dialog-form')) as HTMLFormElement;
	DOM.append(form, DOM.$('h3#knox-gui-prompt-dialog-title', undefined, t(state, editing ? 'editPrompt' : 'addPrompt')));
	DOM.append(form, DOM.$('p.knox-gui-muted.knox-gui-prompt-dialog-help', undefined, t(state, 'promptsCanBeUsed')));
	const name = promptDialogField(widget, form, state, {
		labelKey: 'commandName',
		tooltipKey: 'commandNameTooltip',
		value: draft.name,
		placeholder: '/command-name',
		testId: 'knox-gui-prompt-name',
	}) as HTMLInputElement;
	widget.promptNameInput = name;
	const desc = promptDialogField(widget, form, state, {
		labelKey: 'description',
		tooltipKey: 'descriptionTooltip',
		value: draft.description,
		placeholder: t(state, 'description'),
		testId: 'knox-gui-prompt-description',
	});
	const content = promptDialogField(widget, form, state, {
		labelKey: 'promptContent',
		tooltipKey: 'promptContentTooltip',
		value: draft.prompt,
		placeholder: t(state, 'promptPlaceholder'),
		testId: 'knox-gui-prompt-content',
		multiline: true,
	}) as HTMLTextAreaElement;
	const actions = DOM.append(form, DOM.$('.knox-gui-prompt-dialog-actions'));
	widget.chromeButton(actions, {
		label: t(state, 'cancel'),
		extraClass: 'knox-gui-prompt-dialog-btn',
		testId: 'knox-gui-prompt-dialog-cancel',
		onClick: () => widget.closePromptDialog(),
	});
	const save = widget.chromeButton(actions, {
		label: t(state, editing ? 'update' : 'add'),
		extraClass: 'knox-gui-prompt-dialog-btn knox-gui-prompt-dialog-save',
		testId: 'knox-gui-prompt-dialog-save',
		disabled: !promptDraftIsValid({ name: name.value, description: desc.value, prompt: content.value }),
		onClick: () => widget.controller.savePrompt({ name: name.value, description: desc.value, prompt: content.value }),
	});
	const syncSave = () => {
		save.disabled = !promptDraftIsValid({ name: name.value, description: desc.value, prompt: content.value });
	};
	widget.renderStore.add(DOM.addDisposableListener(form, 'input', syncSave));
	const submit = () => {
		if (!save.disabled) {
			widget.controller.savePrompt({ name: name.value, description: desc.value, prompt: content.value });
		}
	};
	widget.renderStore.add(DOM.addDisposableListener(form, 'submit', e => {
		e.preventDefault();
		submit();
	}));
	for (const field of [name, desc]) {
		widget.renderStore.add(DOM.addDisposableListener(field, 'keydown', e => {
			if (e.key === 'Enter') {
				e.preventDefault();
				submit();
			}
		}));
	}
}

function promptDialogField(
	widget: KnoxGuiWidget,
	parent: HTMLElement,
	state: IKnoxGuiState,
	options: { labelKey: string; tooltipKey: string; value: string; placeholder: string; testId: string; multiline?: boolean },
): HTMLInputElement | HTMLTextAreaElement {
	const wrap = DOM.append(parent, DOM.$('label.knox-gui-prompt-dialog-field'));
	const head = DOM.append(wrap, DOM.$('.knox-gui-prompt-dialog-label'));
	DOM.append(head, DOM.$('span', undefined, t(state, options.labelKey)));
	const info = DOM.append(head, DOM.$('span.knox-gui-prompt-dialog-info'));
	info.setAttribute('aria-label', t(state, options.tooltipKey));
	widget.hover(info, t(state, options.tooltipKey));
	appendKnoxGuiSvg(info, 'info', 14);
	if (options.multiline) {
		const frame = DOM.append(wrap, DOM.$('.knox-gui-prompt-dialog-textarea-wrap'));
		const area = DOM.append(frame, DOM.$('textarea.knox-gui-prompt-dialog-textarea')) as HTMLTextAreaElement;
		area.value = options.value;
		area.placeholder = options.placeholder;
		area.setAttribute('data-testid', options.testId);
		return area;
	}
	const input = DOM.append(wrap, DOM.$('input.knox-gui-prompt-dialog-input')) as HTMLInputElement;
	input.type = 'text';
	input.value = options.value;
	input.placeholder = options.placeholder;
	input.setAttribute('data-testid', options.testId);
	return input;
}

export function renderContext(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
	DOM.append(body, DOM.$('p.knox-gui-muted', undefined, t(state, 'contextContent')));
	if (!state.contextProviders.length) {
		DOM.append(body, DOM.$('.knox-gui-empty', undefined, t(state, 'noResources')));
		return;
	}
	for (const provider of state.contextProviders) {
		const row = DOM.append(body, DOM.$('button.knox-gui-context-provider')) as HTMLButtonElement;
		row.type = 'button';
		row.setAttribute('data-testid', `knox-gui-context-${provider.title}`);
		DOM.append(row, DOM.$('span', undefined, provider.displayTitle ?? provider.title));
		if (provider.description) {
			DOM.append(row, DOM.$('span.knox-gui-muted', undefined, provider.description));
		}
		widget.hover(row, `@${contextProviderInsertId(provider)}`);
		widget.renderStore.add(DOM.addDisposableListener(row, 'click', () => widget.controller.insertContextProvider(provider.title)));
	}
}

export function renderTools(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
	const stack = DOM.append(body, DOM.$('.knox-gui-tools'));
	const presets = DOM.append(stack, DOM.$('.knox-gui-chips.knox-gui-tool-presets'));
	widget.chromeButton(presets, {
		label: t(state, 'askOnWrite'),
		title: t(state, 'askOnWriteHint'),
		extraClass: 'knox-gui-preset',
		testId: 'knox-gui-preset-safe',
		onClick: () => widget.controller.applyToolPreset('safe'),
	});
	widget.chromeButton(presets, {
		label: t(state, 'yoloPreset'),
		title: t(state, 'yoloPresetHint'),
		extraClass: 'knox-gui-preset',
		testId: 'knox-gui-preset-yolo',
		onClick: () => widget.controller.applyToolPreset('yolo'),
	});
	renderPolicyRulesEditor(widget, stack, state);
	const duplicates = duplicateToolNames(state.tools);
	const pending = pendingGeneratedToolName(state.history);
	for (const [group, tools] of groupToolsByGroup(state.tools)) {
		const excluded = state.toolGroupExcluded.includes(group);
		const card = DOM.append(stack, DOM.$('.knox-gui-tool-group'));
		if (excluded) {
			card.classList.add('knox-gui-tool-group-disabled');
		}
		const head = DOM.append(card, DOM.$('.knox-gui-tool-group-head'));
		const title = DOM.append(head, DOM.$('.knox-gui-tool-group-title'));
		DOM.append(title, DOM.$(`span.knox-gui-dot${excluded ? '.knox-gui-dot-error' : ''}`));
		DOM.append(title, DOM.$('h3.knox-gui-tool-group-name', undefined, group));
		DOM.append(title, DOM.$('span.knox-gui-badge.knox-gui-tool-count', undefined, String(tools.length)));
		widget.customSwitch(head, !excluded, () => widget.controller.toggleToolGroup(group), 12);
		const list = DOM.append(card, DOM.$('.knox-gui-tool-group-body'));
		for (const tool of tools) {
			const isPending = isSamePermissionTool(pending, tool.name, state.tools);
			const row = DOM.append(list, DOM.$('.knox-gui-tool-perm-row'));
			row.setAttribute('data-testid', `tool-permission-row-${tool.name}`);
			row.setAttribute('data-tool-permission', tool.name);
			row.setAttribute('data-pending', isPending ? 'true' : 'false');
			if (isPending) {
				row.classList.add('knox-gui-tool-pending');
			}
			if (excluded) {
				row.classList.add('knox-gui-tool-excluded');
			}
			const main = DOM.append(row, DOM.$('.knox-gui-tool-perm-main'));
			const left = DOM.append(main, DOM.$('.knox-gui-tool-perm-left'));
			if (duplicates[tool.name]) {
				const warn = DOM.append(left, DOM.$('span.knox-gui-warn.knox-gui-tool-dup'));
				appendKnoxGuiSvg(warn, 'info', 12);
				widget.hover(warn, `${t(state, 'duplicateToolName')} ${tool.name} ${t(state, 'duplicateToolWarning')}`);
			}
			if (tool.faviconUrl) {
				const img = DOM.append(left, DOM.$('img.knox-gui-tool-favicon')) as HTMLImageElement;
				img.src = tool.faviconUrl;
				img.alt = tool.displayTitle ?? tool.name;
			}
			DOM.append(left, DOM.$('span.knox-gui-tool-perm-name', undefined, getCategorizedToolName(tool.name, tool.displayTitle)));
			const idHint = DOM.append(left, DOM.$('span.knox-gui-muted.knox-gui-tool-id', undefined, `(${t(state, 'toolId')})`));
			widget.hover(idHint, tool.name);
			const display = toolPermissionDisplay({ toolName: tool.name, toolSettings: state.toolSettings, sessionAllowlist: state.sessionToolAllowlist, tools: state.tools });
			if (excluded) {
				DOM.append(main, DOM.$('span.knox-gui-perm-badge', undefined, t(state, 'toolDisabled')));
			} else {
				const badgeKey = toolPermissionBadgeKey(display);
				if (display === 'sessionAlways') {
					const badge = widget.chromeButton(main, {
						label: t(state, badgeKey),
						title: t(state, 'toolAlwaysThisSessionHint'),
						extraClass: `knox-gui-perm-badge knox-gui-perm-${display}`,
						testId: 'tool-permission-badge',
						disabled: isPending,
						onClick: () => {
							if (!isPending) {
								widget.controller.cycleToolPermission(tool.name);
							}
						},
					});
					void badge;
				} else {
					const badge = DOM.append(main, DOM.$('span.knox-gui-perm-badge'));
					badge.classList.add(`knox-gui-perm-${display}`);
					badge.setAttribute('data-testid', 'tool-permission-badge');
					badge.textContent = t(state, badgeKey);
				}
			}
			if (!excluded && !isPending) {
				widget.renderStore.add(DOM.addDisposableListener(main, 'click', e => {
					if ((e.target as HTMLElement).closest('button')) {
						return;
					}
					widget.controller.cycleToolPermission(tool.name);
				}));
			}
			if (isPending) {
				const pendingCall = state.history.flatMap(item => item.toolCalls ?? []).find(call => call.status === 'generated' && isSamePermissionTool(call.name, tool.name, state.tools));
				if (pendingCall && widget.toolPermScrolledFor !== pendingCall.id) {
					widget.toolPermScrolledFor = pendingCall.id;
					DOM.getWindow(row).requestAnimationFrame(() => row.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
				}
				const autoApproved = pendingCall !== undefined && knoxGuiLocalAutoApprove({
					name: pendingCall.name,
					args: pendingCall.parsedArgs ?? parseToolArgs(pendingCall.arguments),
					toolSettings: state.toolSettings,
					permissionMode: state.permissionMode,
					sessionAllowlist: state.sessionToolAllowlist,
				});
				if (pendingCall && !excluded && !autoApproved) {
					widget.renderToolActions(row, state, pendingCall, toolDisplayKind(pendingCall.name), { placement: 'overlay' });
				}
			}
		}
		if (excluded) {
			const veil = DOM.append(list, DOM.$('.knox-gui-group-veil'));
			DOM.append(veil, DOM.$('span.knox-gui-group-veil-label', undefined, t(state, 'groupDisabled')));
		}
	}
}

function renderPolicyRulesEditor(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
	const box = DOM.append(parent, DOM.$('.knox-gui-policy'));
	DOM.append(box, DOM.$('div.knox-gui-policy-title', undefined, t(state, 'policyTitle')));
	DOM.append(box, DOM.$('p.knox-gui-muted.knox-gui-policy-help', undefined, t(state, 'policyHelp')));
	const paths = policyEditorText(state.policy.paths, DEFAULT_AGENT_TOOL_POLICY_TEXT.paths);
	const commands = policyEditorText(state.policy.commands, DEFAULT_AGENT_TOOL_POLICY_TEXT.commands);
	policyTextArea(widget, box, t(state, 'policyPaths'), paths, value => widget.savePolicy({ paths: value }));
	policyTextArea(widget, box, t(state, 'policyCommands'), commands, value => widget.savePolicy({ commands: value }));
	const row = DOM.append(box, DOM.$('.knox-gui-policy-row'));
	DOM.append(row, DOM.$('label.knox-gui-policy-label', undefined, t(state, 'policyOutsideWorkspace')));
	const external = DOM.append(row, DOM.$('select.knox-gui-select.knox-gui-policy-select')) as HTMLSelectElement;
	for (const value of ['ask', 'deny', 'allow'] as const) {
		const option = DOM.append(external, DOM.$('option')) as HTMLOptionElement;
		option.value = value;
		option.textContent = value === 'ask' ? t(state, 'permissionModeAsk') : value === 'deny' ? t(state, 'deny') : t(state, 'policyAllow');
		if (state.policy.externalDirectory === value) {
			option.selected = true;
		}
	}
	widget.renderStore.add(DOM.addDisposableListener(external, 'change', () => widget.savePolicy({ externalDirectory: external.value as IKnoxGuiState['policy']['externalDirectory'] })));
	const sandbox = DOM.append(row, DOM.$('label.knox-gui-policy-sandbox'));
	const check = DOM.append(sandbox, DOM.$('input')) as HTMLInputElement;
	check.type = 'checkbox';
	check.checked = state.policy.sandboxDestructive;
	widget.renderStore.add(DOM.addDisposableListener(check, 'change', () => widget.savePolicy({ sandboxDestructive: check.checked })));
	sandbox.append(t(state, 'policyBlockDestructive'));
}

function policyTextArea(widget: KnoxGuiWidget, parent: HTMLElement, label: string, value: string, onChange: (value: string) => void): void {
	DOM.append(parent, DOM.$('label.knox-gui-policy-label', undefined, label));
	const area = DOM.append(parent, DOM.$('textarea.knox-gui-policy-textarea')) as HTMLTextAreaElement;
	area.value = value;
	area.spellcheck = false;
	widget.renderStore.add(DOM.addDisposableListener(area, 'blur', () => onChange(area.value)));
}

export function savePolicy(widget: KnoxGuiWidget, partial: Partial<IKnoxGuiState['policy']>): void {
	const policy = { ...widget.controller.store.state.policy, ...partial };
	widget.controller.store.patch({ policy });
	void widget.controller.updateSharedConfig({
		agentPolicyPaths: policy.paths,
		agentPolicyCommands: policy.commands,
		agentPolicyExternalDirectory: policy.externalDirectory,
		agentPolicySandboxDestructive: policy.sandboxDestructive,
	});
}

function isHistoryView(state: IKnoxGuiState): boolean {
	return state.overlay === 'history' || state.route === KnoxGuiRoute.History;
}

function visibleHistorySessions(state: IKnoxGuiState): IKnoxGuiHistorySession[] {
	return filterHistorySessions(state.historySessions, state.historyQuery);
}

function exitHistorySelection(widget: KnoxGuiWidget): void {
	widget.historyListAnchorId = null;
	widget.historyListFocusedId = null;
	widget.controller.store.patch({ historySelectionMode: false, historySelected: [], historyConfirmDelete: false });
}

function patchHistorySelection(widget: KnoxGuiWidget, selected: string[], options?: { mode?: boolean; anchorId?: string; focusedId?: string }): void {
	if (options?.anchorId !== undefined) {
		widget.historyListAnchorId = options.anchorId;
	}
	if (options?.focusedId !== undefined) {
		widget.historyListFocusedId = options.focusedId;
	}
	widget.controller.store.patch({
		historySelectionMode: options?.mode ?? true,
		historySelected: selected,
	});
}

function selectHistoryRow(widget: KnoxGuiWidget, sessions: IKnoxGuiHistorySession[], sessionId: string, shift: boolean): void {
	const ordered = sessions.map(session => session.id);
	const next = applyHistoryRowSelection(widget.controller.store.state.historySelected, ordered, sessionId, shift, widget.historyListAnchorId);
	patchHistorySelection(widget, next.selected, { anchorId: next.anchorId, focusedId: sessionId });
}

export function renderHistoryPage(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState, compact?: boolean): void {
	if (!compact) {
		widget.back(body, state);
		const tab = DOM.append(body, DOM.$('.knox-gui-page-tab'));
		const cell = DOM.append(tab, DOM.$('.knox-gui-page-tab-cell'));
		appendKnoxGuiSvg(cell, 'history', 14);
		DOM.append(cell, DOM.$('span', undefined, t(state, 'conversationHistory')));
	}
	const header = DOM.append(body, DOM.$('.knox-gui-history-header'));
	const sessions = visibleHistorySessions(state);
	DOM.append(header, DOM.$('h3', undefined, t(state, 'conversationHistory')));
	const countBadge = DOM.append(header, DOM.$('span.knox-gui-badge', undefined, `${sessions.length} ${sessions.length === 1 ? t(state, 'conversation') : t(state, 'conversations')}`));
	countBadge.setAttribute('data-testid', 'history-count');
	const search = DOM.append(body, DOM.$('.knox-gui-history-search'));
	const searchIcon = DOM.append(search, DOM.$('span.knox-gui-history-search-icon'));
	appendKnoxGuiSvg(searchIcon, 'search', 12);
	const input = DOM.append(search, DOM.$('input')) as HTMLInputElement;
	input.placeholder = t(state, 'searchConversations');
	input.value = state.historyQuery;
	input.setAttribute('data-testid', 'history-search');
	input.setAttribute('aria-label', t(state, 'searchConversations'));
	widget.historyListSearchInput = input;
	widget.renderStore.add(DOM.addDisposableListener(input, 'input', () => {
		widget.historySearchFocus = true;
		widget.historySearchCaret = input.selectionStart;
		widget.controller.store.patch({ historyQuery: input.value });
	}));
	if (state.historyQuery) {
		widget.chromeButton(search, {
			svg: 'x',
			svgSize: 12,
			title: t(state, 'clear'),
			extraClass: 'knox-gui-history-search-clear',
			onClick: () => {
				widget.historySearchFocus = true;
				widget.historySearchCaret = 0;
				widget.controller.store.patch({ historyQuery: '' });
			},
		});
	}
	if (widget.historySearchFocus) {
		input.focus();
		const caret = widget.historySearchCaret ?? input.value.length;
		input.setSelectionRange(caret, caret);
		widget.historySearchFocus = false;
	}
	if (!sessions.length) {
		const empty = DOM.append(body, DOM.$('.knox-gui-empty.knox-gui-history-empty'));
		empty.setAttribute('data-testid', 'history-empty');
		const iconWrap = DOM.append(empty, DOM.$('.knox-gui-history-empty-icon'));
		appendKnoxGuiSvg(iconWrap, 'search', 24);
		DOM.append(empty, DOM.$('h3', undefined, state.historyQuery.trim() ? t(state, 'noMatchingConversations') : t(state, 'noConversationsFound')));
		if (!state.historyQuery.trim()) {
			const hint = DOM.append(empty, DOM.$('p.knox-gui-muted'));
			hint.append(`${t(state, 'noConversationsMessage')} `);
			appendShortcut(hint, 'meta L');
		}
		renderHistoryFooter(body, state);
		return;
	}
	const bar = DOM.append(body, DOM.$('.knox-gui-history-actions'));
	if (state.historySelectionMode && state.historySelected.length) {
		const count = DOM.append(bar, DOM.$('span.knox-gui-badge.knox-gui-history-selected-count'));
		count.setAttribute('data-testid', 'history-selected-count');
		appendKnoxGuiSvg(count, 'check', 12);
		count.append(` ${state.historySelected.length}`);
	} else {
		DOM.append(bar, DOM.$('span'));
	}
	const actions = DOM.append(bar, DOM.$('.knox-gui-row'));
	if (!state.historySelectionMode) {
		widget.chromeButton(actions, { svg: 'check-square', svgSize: 12, label: t(state, 'select'), title: t(state, 'selectMultipleConversations'), extraClass: 'knox-gui-history-label-select', testId: 'history-select', onClick: () => widget.controller.store.patch({ historySelectionMode: true }) });
	} else {
		widget.chromeButton(actions, { svg: 'check-square', svgSize: 12, label: t(state, 'selectAll'), title: t(state, 'selectAllConversations'), extraClass: 'knox-gui-history-label-wide', testId: 'history-select-all', onClick: () => patchHistorySelection(widget, sessions.map(session => session.id), { anchorId: sessions[0]?.id ?? null }) });
		widget.chromeButton(actions, { svg: 'square', svgSize: 12, label: t(state, 'clear'), title: t(state, 'clearAllSelections'), extraClass: 'knox-gui-history-label-wide', testId: 'history-clear', onClick: () => patchHistorySelection(widget, []) });
		const del = widget.chromeButton(actions, {
			svg: 'trash',
			svgSize: 12,
			label: t(state, 'deleteCount', { count: state.historySelected.length }),
			title: t(state, 'deleteSelectedConversations', { count: state.historySelected.length }),
			disabled: state.historySelected.length === 0,
			extraClass: 'knox-gui-danger knox-gui-history-delete-btn',
			testId: 'history-delete',
			onClick: () => widget.controller.store.patch({ historyConfirmDelete: true }),
		});
		del.title = t(state, 'deleteSelectedConversations', { count: state.historySelected.length });
		widget.chromeButton(actions, { svg: 'x', svgSize: 12, label: t(state, 'exit'), title: t(state, 'exitSelectionMode'), extraClass: 'knox-gui-history-label-select', testId: 'history-exit', onClick: () => exitHistorySelection(widget) });
	}
	const list = DOM.append(body, DOM.$('.knox-gui-history-list'));
	list.setAttribute('role', 'listbox');
	list.setAttribute('aria-multiselectable', 'true');
	list.setAttribute('aria-label', t(state, 'conversationHistory'));
	let rowIndex = 0;
	for (const group of groupHistoryByDate(sessions)) {
		const section = DOM.append(list, DOM.$('.knox-gui-history-group'));
		const head = DOM.append(section, DOM.$('.knox-gui-row.knox-gui-history-group-head'));
		DOM.append(head, DOM.$('h4', undefined, t(state, group.header)));
		DOM.append(head, DOM.$('span.knox-gui-badge', undefined, group.sessions.length === 1 ? t(state, 'itemCount', { count: 1 }) : t(state, 'itemsCount', { count: group.sessions.length })));
		for (const session of group.sessions) {
			widget.renderHistorySessionRow(section, state, session, rowIndex, sessions);
			rowIndex += 1;
		}
	}
	renderHistoryFooter(body, state);
	if (state.historyConfirmDelete) {
		widget.renderHistoryDeleteDialog(body, state);
	}
}

function renderHistoryFooter(body: HTMLElement, state: IKnoxGuiState): void {
	const footer = DOM.append(body, DOM.$('.knox-gui-muted.knox-gui-history-footer'));
	const icon = DOM.append(footer, DOM.$('span.knox-gui-history-footer-icon'));
	appendKnoxGuiSvg(icon, 'info', 12);
	DOM.append(footer, DOM.$('span', undefined, t(state, 'conversationsDataStoredAt')));
}

export function renderHistorySessionRow(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, session: IKnoxGuiState['historySessions'][number], index: number, sessions?: IKnoxGuiHistorySession[]): void {
	const ordered = sessions ?? visibleHistorySessions(state);
	const selected = state.historySelected.includes(session.id);
	const current = session.id === state.sessionId;
	const focused = widget.historyListFocusedId === session.id;
	const classes = ['.knox-gui-history-row'];
	if (selected) {
		classes.push('.selected');
	}
	if (current) {
		classes.push('.current');
	}
	if (focused) {
		classes.push('.focused');
	}
	const row = DOM.append(parent, DOM.$(classes.join('')));
	row.setAttribute('data-testid', `history-row-${index}`);
	row.setAttribute('role', 'option');
	row.setAttribute('aria-selected', String(selected));
	if (current) {
		row.setAttribute('aria-current', 'true');
	}
	if (state.historySelectionMode) {
		const box = DOM.append(row, DOM.$('button.knox-gui-check')) as HTMLButtonElement;
		box.type = 'button';
		box.setAttribute('role', 'checkbox');
		box.setAttribute('aria-checked', String(selected));
		box.setAttribute('aria-label', t(state, selected ? 'deselectAll' : 'select'));
		if (selected) {
			box.classList.add('selected');
			appendKnoxGuiSvg(box, 'check', 12);
		}
		widget.renderStore.add(DOM.addDisposableListener(box, 'click', e => {
			e.stopPropagation();
			selectHistoryRow(widget, ordered, session.id, e.shiftKey);
		}));
	}
	const main = DOM.append(row, DOM.$('.knox-gui-history-main'));
	if (widget.editingHistoryId === session.id) {
		const title = DOM.append(main, DOM.$('input.knox-gui-history-title-input')) as HTMLInputElement;
		title.value = session.title;
		title.setAttribute('data-testid', 'history-rename');
		title.focus();
		title.select();
		const commit = () => {
			if (widget.editingHistoryId !== session.id) {
				return;
			}
			const next = title.value.trim();
			if (next && next !== session.title) {
				void widget.controller.renameSession(session.id, next);
			}
			widget.editingHistoryId = null;
			widget.controller.store.patch({});
		};
		const cancel = () => {
			if (widget.editingHistoryId !== session.id) {
				return;
			}
			widget.editingHistoryId = null;
			widget.controller.store.patch({});
		};
		widget.renderStore.add(DOM.addDisposableListener(title, 'keydown', e => {
			if (e.key === 'Enter') {
				e.preventDefault();
				commit();
			} else if (e.key === 'Escape') {
				e.preventDefault();
				e.stopPropagation();
				cancel();
			}
		}));
		widget.renderStore.add(DOM.addDisposableListener(title, 'blur', () => commit()));
		widget.renderStore.add(DOM.addDisposableListener(title, 'click', e => e.stopPropagation()));
	} else {
		const headingRow = DOM.append(main, DOM.$('.knox-gui-history-heading'));
		const heading = DOM.append(headingRow, DOM.$('span.knox-gui-history-title', undefined, session.title));
		heading.title = session.title;
		if (current) {
			DOM.append(headingRow, DOM.$('span.knox-gui-history-current', undefined, t(state, 'currentConversation')));
		}
	}
	const meta = DOM.append(main, DOM.$('.knox-gui-history-meta'));
	const workspace = workspaceBasename(session.workspaceDirectory);
	if (workspace) {
		const name = DOM.append(meta, DOM.$('span.knox-gui-history-workspace', undefined, workspace));
		name.title = workspace;
	}
	const parsed = parseHistoryDate(session.date);
	const fullDate = formatSessionDate(parsed);
	const time = DOM.append(meta, DOM.$('time')) as HTMLTimeElement;
	time.title = fullDate;
	if (!isNaN(parsed.getTime())) {
		time.dateTime = parsed.toISOString();
	}
	DOM.append(time, DOM.$('span.knox-gui-history-date-compact', undefined, formatSessionDate(parsed, true)));
	DOM.append(time, DOM.$('span.knox-gui-history-date-full', undefined, fullDate));
	if (!state.historySelectionMode && widget.editingHistoryId !== session.id) {
		const hover = DOM.append(row, DOM.$('.knox-gui-history-hover'));
		widget.chromeButton(hover, { svg: 'download', svgSize: 16, title: t(state, 'download'), onClick: () => void widget.controller.exportSession(session.id) });
		widget.chromeButton(hover, { svg: 'square-pen', svgSize: 16, title: t(state, 'edit'), onClick: () => { widget.editingHistoryId = session.id; widget.controller.store.patch({}); } });
		widget.chromeButton(hover, {
			svg: 'trash',
			svgSize: 16,
			title: t(state, 'delete'),
			extraClass: 'knox-gui-danger',
			onClick: () => widget.controller.store.patch({ historySelected: [session.id], historyConfirmDelete: true }),
		});
	}
	row.tabIndex = 0;
	row.setAttribute('data-session-id', session.id);
	row.setAttribute('aria-label', session.title);
	const openSession = (shift: boolean) => {
		if (state.historySelectionMode || shift) {
			selectHistoryRow(widget, ordered, session.id, shift);
			return;
		}
		widget.historyListFocusedId = session.id;
		void widget.controller.openHistorySession(session.id);
	};
	widget.renderStore.add(DOM.addDisposableListener(row, 'click', e => {
		if ((e.target as HTMLElement).closest('button, input')) {
			return;
		}
		openSession(e.shiftKey);
	}));
	widget.renderStore.add(DOM.addDisposableListener(row, 'keydown', (e: KeyboardEvent) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			e.stopPropagation();
			widget.historyListFocusedId = session.id;
			openSession(e.shiftKey);
		}
	}));
}

/** shadcn `ui/button.tsx` outline / destructive, used by History.tsx AlertDialog. */
function historyAlertButton(widget: KnoxGuiWidget, parent: HTMLElement, options: { label: string; variant: 'cancel' | 'destructive'; testId: string; onClick: () => void }): HTMLButtonElement {
	const button = DOM.append(parent, DOM.$(`button.knox-gui-alert-dialog-btn.is-${options.variant}`)) as HTMLButtonElement;
	button.type = 'button';
	button.textContent = options.label;
	button.setAttribute('data-testid', options.testId);
	widget.renderStore.add(DOM.addDisposableListener(button, 'click', e => {
		e.stopPropagation();
		options.onClick();
	}));
	return button;
}

/**
 * History.tsx AlertDialog: red title, confirm copy, muted undo line, outline Cancel and
 * `bg-red-500` Delete, footer aligned end. Backdrop click and Escape dismiss.
 */
export function renderHistoryDeleteDialog(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
	const overlay = DOM.append(widget.root, DOM.$('.knox-gui-text-dialog.knox-gui-history-delete'));
	overlay.setAttribute('role', 'presentation');
	overlay.setAttribute('data-testid', 'knox-gui-history-delete');
	const close = () => widget.controller.store.patch({ historyConfirmDelete: false });
	widget.renderStore.add(DOM.addDisposableListener(overlay, 'mousedown', e => {
		if (e.target === overlay) {
			close();
		}
	}));
	const dialog = DOM.append(overlay, DOM.$('.knox-gui-alert-dialog'));
	dialog.setAttribute('role', 'alertdialog');
	dialog.setAttribute('aria-modal', 'true');
	dialog.setAttribute('aria-labelledby', 'knox-gui-history-delete-title');
	dialog.setAttribute('aria-describedby', 'knox-gui-history-delete-desc');
	dialog.tabIndex = -1;
	widget.renderStore.add(DOM.addDisposableListener(dialog, 'mousedown', e => e.stopPropagation()));
	const header = DOM.append(dialog, DOM.$('.knox-gui-alert-dialog-header'));
	const title = DOM.append(header, DOM.$('h2.knox-gui-alert-dialog-title.is-destructive', undefined, t(state, 'deleteConversations')));
	title.id = 'knox-gui-history-delete-title';
	const count = state.historySelected.length;
	const noun = count === 1 ? t(state, 'conversation') : t(state, 'conversations');
	const desc = DOM.append(header, DOM.$('div.knox-gui-alert-dialog-desc'));
	desc.id = 'knox-gui-history-delete-desc';
	DOM.append(desc, DOM.$('p.knox-gui-alert-dialog-lead', undefined, `${t(state, 'confirmDeleteConversations', { count })} ${noun}?`));
	DOM.append(desc, DOM.$('p.knox-gui-alert-dialog-muted', undefined, t(state, 'actionCannotBeUndone')));
	const footer = DOM.append(dialog, DOM.$('.knox-gui-alert-dialog-footer'));
	const cancel = historyAlertButton(widget, footer, { label: t(state, 'cancel'), variant: 'cancel', testId: 'history-delete-cancel', onClick: close });
	historyAlertButton(widget, footer, {
		label: t(state, 'delete'),
		variant: 'destructive',
		testId: 'history-delete-confirm',
		onClick: () => {
			void widget.controller.deleteSessions(state.historySelected);
			exitHistorySelection(widget);
		},
	});
	queueMicrotask(() => cancel.focus());
	void body;
}

export function onHistoryKeyDown(widget: KnoxGuiWidget, e: KeyboardEvent, state: IKnoxGuiState): boolean {
	if (!isHistoryView(state)) {
		return false;
	}
	const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target instanceof HTMLElement && e.target.isContentEditable);
	if (e.key === 'Escape') {
		return false;
	}
	if (typing || state.historyConfirmDelete || widget.editingHistoryId) {
		return false;
	}
	const meta = knoxGuiIsMetaEquivalent(e);
	const sessions = visibleHistorySessions(state);
	const ordered = sessions.map(session => session.id);
	if (meta && e.key.toLowerCase() === 'a' && sessions.length) {
		e.preventDefault();
		patchHistorySelection(widget, ordered, { anchorId: ordered[0] ?? null, focusedId: widget.historyListFocusedId ?? ordered[0] ?? null });
		return true;
	}
	if ((e.key === 'Delete' || e.key === 'Backspace') && (state.historySelected.length || widget.historyListFocusedId)) {
		e.preventDefault();
		const ids = state.historySelected.length ? state.historySelected : widget.historyListFocusedId ? [widget.historyListFocusedId] : [];
		if (!ids.length) {
			return true;
		}
		widget.controller.store.patch({ historySelectionMode: true, historySelected: ids, historyConfirmDelete: true });
		return true;
	}
	if (e.key === '/' && !meta) {
		e.preventDefault();
		widget.historyListSearchInput?.focus();
		return true;
	}
	if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
		e.preventDefault();
		const current = widget.historyListFocusedId ? ordered.indexOf(widget.historyListFocusedId) : -1;
		const nextIndex = current < 0 ? (e.key === 'ArrowDown' ? 0 : ordered.length - 1) : Math.max(0, Math.min(ordered.length - 1, current + (e.key === 'ArrowDown' ? 1 : -1)));
		const nextId = ordered[nextIndex];
		if (!nextId) {
			return true;
		}
		widget.historyListFocusedId = nextId;
		if (e.shiftKey) {
			const anchor = widget.historyListAnchorId ?? (current >= 0 ? ordered[current] : nextId);
			patchHistorySelection(widget, selectHistoryIdRange(ordered, anchor, nextId), { anchorId: anchor, focusedId: nextId });
		} else {
			widget.controller.store.patch({});
		}
		queueMicrotask(() => widget.root.querySelector<HTMLElement>(`[data-session-id="${nextId.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`)?.scrollIntoView({ block: 'nearest' }));
		return true;
	}
	if (e.key === 'Enter' && widget.historyListFocusedId && !state.historySelectionMode) {
		e.preventDefault();
		void widget.controller.openHistorySession(widget.historyListFocusedId);
		return true;
	}
	if (e.key === ' ' && widget.historyListFocusedId) {
		e.preventDefault();
		selectHistoryRow(widget, sessions, widget.historyListFocusedId, e.shiftKey);
		return true;
	}
	return false;
}

export function renderSettings(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState, compact: boolean): void {
	if (!compact) {
		widget.back(body, state);
		const tab = DOM.append(body, DOM.$('.knox-gui-page-tab'));
		const cell = DOM.append(tab, DOM.$('.knox-gui-page-tab-cell'));
		appendKnoxGuiSvg(cell, 'settings', 14);
		DOM.append(cell, DOM.$('span', undefined, t(state, 'settings')));
	}
	const card = (title: string, render: (el: HTMLElement) => void) => {
		const wrap = DOM.append(body, DOM.$(compact ? '.knox-gui-settings-card.compact' : '.knox-gui-settings-card'));
		DOM.append(wrap, DOM.$('h3.knox-gui-cyan', undefined, title));
		render(wrap);
	};
	card(t(state, 'language'), el => {
		const row = DOM.append(el, DOM.$('label.knox-gui-row'));
		DOM.append(row, DOM.$('span', undefined, t(state, 'language')));
		const lang = DOM.append(row, DOM.$('select.knox-gui-select')) as HTMLSelectElement;
		for (const [value, label] of [['en', t(state, 'english')], ['zh', t(state, 'chinese')]] as const) {
			const option = DOM.append(lang, DOM.$('option')) as HTMLOptionElement;
			option.value = value;
			option.textContent = label;
			if (state.language === value) {
				option.selected = true;
			}
		}
		widget.renderStore.add(DOM.addDisposableListener(lang, 'change', () => void widget.controller.setLanguage(lang.value as 'en' | 'zh')));
	});
	card(t(state, 'interfaceSettings'), el => {
		widget.toggle(el, t(state, 'showSessionTabs'), state.showSessionTabs, value => {
			widget.controller.store.patch({ showSessionTabs: value });
			void widget.controller.updateSharedConfig({ showSessionTabs: value });
		});
		widget.toggle(el, t(state, 'codeBlockAutoWrap'), state.codeWrap, value => {
			widget.controller.store.patch({ codeWrap: value });
			void widget.controller.updateSharedConfig({ codeWrap: value });
		});
		widget.toggle(el, t(state, 'showChatScrollbar'), state.showChatScrollbar, value => {
			widget.controller.store.patch({ showChatScrollbar: value });
			void widget.controller.updateSharedConfig({ showChatScrollbar: value });
		});
		widget.toggle(el, t(state, 'autoNameSessionTitles'), state.autoNameSessionTitles, value => {
			widget.controller.store.patch({ autoNameSessionTitles: value });
			void widget.controller.updateSharedConfig({ disableSessionTitles: !value });
		});
		widget.toggle(el, t(state, 'markdownFormatting'), state.markdownFormatting, value => {
			widget.controller.store.patch({ markdownFormatting: value });
			void widget.controller.updateSharedConfig({ displayRawMarkdown: !value });
		});
	});
	card(t(state, 'accessibilityDisplay'), el => {
		widget.numberField(el, t(state, 'fontSize'), state.fontSize, 7, 50, value => {
			widget.controller.store.patch({ fontSize: value });
			void widget.controller.updateSharedConfig({ fontSize: value });
		});
	});
	card(t(state, 'agentSettings'), el => {
		const profileRow = DOM.append(el, DOM.$('.knox-gui-row.knox-gui-settings-stack'));
		const labels = DOM.append(profileRow, DOM.$('div'));
		DOM.append(labels, DOM.$('div', undefined, t(state, 'agentProfile')));
		DOM.append(labels, DOM.$('span.knox-gui-muted', undefined, t(state, 'agentProfileHint')));
		const profile = DOM.append(profileRow, DOM.$('select.knox-gui-select')) as HTMLSelectElement;
		for (const value of ['default', 'rust', 'systems', 'auto']) {
			const option = DOM.append(profile, DOM.$('option')) as HTMLOptionElement;
			option.value = value;
			option.textContent = t(state, `agentProfile${value[0].toUpperCase()}${value.slice(1)}`) || value;
			if (state.agentProfile === value) {
				option.selected = true;
			}
		}
		widget.renderStore.add(DOM.addDisposableListener(profile, 'change', () => widget.controller.applyAgentProfile(profile.value)));
		widget.hintedNumber(el, t(state, 'agentMaxSteps'), t(state, 'agentMaxStepsHint'), state.agentMaxSteps, 0, 1000, value => {
			widget.controller.store.patch({ agentMaxSteps: value });
			void widget.controller.updateSharedConfig({ agentMaxSteps: value });
		});
		widget.hintedNumber(el, t(state, 'agentDoomLoopThreshold'), t(state, 'agentDoomLoopThresholdHint'), state.agentDoomLoopThreshold, 0, 20, value => {
			widget.controller.store.patch({ agentDoomLoopThreshold: value });
			void widget.controller.updateSharedConfig({ agentDoomLoopThreshold: value });
		});
		widget.hintedNumber(el, t(state, 'agentViewSubdirectoryMaxFiles'), t(state, 'agentViewSubdirectoryMaxFilesHint'), state.agentViewSubdirectoryMaxFiles, 50, 20000, value => {
			widget.controller.store.patch({ agentViewSubdirectoryMaxFiles: value });
			void widget.controller.updateSharedConfig({ agentViewSubdirectoryMaxFiles: value });
		});
		const jev = DOM.append(el, DOM.$('.knox-gui-row.knox-gui-settings-stack'));
		const jevLabels = DOM.append(jev, DOM.$('div'));
		DOM.append(jevLabels, DOM.$('div', undefined, t(state, 'jevEnabled')));
		DOM.append(jevLabels, DOM.$('span.knox-gui-muted', undefined, t(state, 'jevEnabledHint')));
		widget.toggle(jev, '', state.jevEnabled, value => {
			widget.controller.store.patch({ jevEnabled: value });
			void widget.controller.updateSharedConfig({ jevEnabled: value });
		});
		DOM.append(el, DOM.$('p.knox-gui-muted', undefined, t(state, 'agentPolicyHint')));
	});
}
