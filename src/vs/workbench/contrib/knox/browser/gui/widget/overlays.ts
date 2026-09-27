/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../knoxGuiWidget.js';
import { t } from './t.js';
import * as DOM from '../../../../../../base/browser/dom.js';
import { isMacintosh } from '../../../../../../base/common/platform.js';
import { URI } from '../../../../../../base/common/uri.js';
import { appendKnoxGuiSvg } from '../knoxGuiIcons.js';
import { toolDisplayKind } from '../../../common/knoxGuiChat.js';
import { knoxGuiMetaKeyLabel } from '../../../common/knoxGuiChrome.js';
import { getCategorizedToolName, toolPermissionDisplay } from '../../../common/knoxGuiTools.js';
import {
	contextProviderInsertId,
	DEFAULT_AGENT_TOOL_POLICY_TEXT,
	duplicateToolNames,
	filterHistorySessions,
	formatSessionDate,
	groupHistoryByDate,
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
	promptSlashName,
	ruleCardOpensProfile,
	ruleCardTitleKey,
	sortPromptsBookmarkedFirst,
	toggleHistorySelection,
	toolPermissionBadgeKey,
	workspaceBasename,
} from '../../../common/knoxGuiOverlays.js';
import { KnoxGuiOverlay } from '../../../common/knoxGuiProtocol.js';
import { IKnoxGuiState } from '../../../common/knoxGuiState.js';

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
		DOM.append(grid, DOM.$('span.knox-gui-model-role-label', undefined, label));
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
		onClick: () => widget.controller.messenger.post('config/openProfile', { profileId: state.profileId }),
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
		DOM.append(main, DOM.$('span.knox-gui-prompt-name', undefined, promptSlashName(cmd.name)));
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
		const bookmarked = state.bookmarkedSlash.includes(cmd.name);
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
			const isPending = pending === tool.name;
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
			const display = toolPermissionDisplay({ toolName: tool.name, toolSettings: state.toolSettings, sessionAllowlist: state.sessionToolAllowlist });
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
						onClick: () => widget.controller.cycleToolPermission(tool.name),
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
			if (isPending && !excluded) {
				const pendingCall = state.history.flatMap(item => item.toolCalls ?? []).find(call => call.status === 'generated' && call.name === tool.name);
				if (pendingCall) {
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

export function renderHistoryPage(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState, compact?: boolean): void {
	if (!compact) {
		widget.back(body, state);
		const tab = DOM.append(body, DOM.$('.knox-gui-page-tab'));
		appendKnoxGuiSvg(tab, 'history', 14);
		DOM.append(tab, DOM.$('span', undefined, t(state, 'conversationHistory')));
	}
	const header = DOM.append(body, DOM.$('.knox-gui-history-header'));
	const sessions = filterHistorySessions(state.historySessions, state.historyQuery);
	DOM.append(header, DOM.$('h3', undefined, t(state, 'conversationHistory')));
	DOM.append(header, DOM.$('span.knox-gui-badge', undefined, `${sessions.length} ${sessions.length === 1 ? t(state, 'conversation') : t(state, 'conversations')}`));
	const search = DOM.append(body, DOM.$('.knox-gui-history-search'));
	const searchIcon = DOM.append(search, DOM.$('span.knox-gui-history-search-icon'));
	appendKnoxGuiSvg(searchIcon, 'search', 12);
	const input = DOM.append(search, DOM.$('input')) as HTMLInputElement;
	input.placeholder = t(state, 'searchConversations');
	input.value = state.historyQuery;
	widget.renderStore.add(DOM.addDisposableListener(input, 'input', () => widget.controller.store.patch({ historyQuery: input.value })));
	if (state.historyQuery) {
		widget.chromeButton(search, { svg: 'x', svgSize: 12, title: t(state, 'clear'), extraClass: 'knox-gui-history-search-clear', onClick: () => widget.controller.store.patch({ historyQuery: '' }) });
	}
	if (!sessions.length) {
		const empty = DOM.append(body, DOM.$('.knox-gui-empty.knox-gui-history-empty'));
		const iconWrap = DOM.append(empty, DOM.$('.knox-gui-history-empty-icon'));
		appendKnoxGuiSvg(iconWrap, 'search', 24);
		DOM.append(empty, DOM.$('h3', undefined, t(state, 'noConversationsFound')));
		const hint = DOM.append(empty, DOM.$('p.knox-gui-muted'));
		hint.append(`${t(state, 'noConversationsMessage')} `);
		const shortcut = DOM.append(hint, DOM.$('kbd.knox-gui-shortcut'));
		shortcut.textContent = `${knoxGuiMetaKeyLabel(isMacintosh)}L`;
		return;
	}
	const bar = DOM.append(body, DOM.$('.knox-gui-history-actions'));
	if (state.historySelected.length) {
		const count = DOM.append(bar, DOM.$('span.knox-gui-badge.knox-gui-history-selected-count'));
		appendKnoxGuiSvg(count, 'check', 12);
		count.append(` ${state.historySelected.length}`);
	}
	const actions = DOM.append(bar, DOM.$('.knox-gui-row'));
	if (!state.historySelectionMode) {
		widget.chromeButton(actions, { svg: 'check-square', svgSize: 12, label: t(state, 'select'), title: t(state, 'selectMultipleConversations'), onClick: () => widget.controller.store.patch({ historySelectionMode: true }) });
	} else {
		widget.chromeButton(actions, { svg: 'check-square', svgSize: 12, label: t(state, 'selectAll'), title: t(state, 'selectAllConversations'), onClick: () => widget.controller.store.patch({ historySelected: sessions.map(session => session.id) }) });
		widget.chromeButton(actions, { svg: 'square', svgSize: 12, label: t(state, 'clear'), onClick: () => widget.controller.store.patch({ historySelected: [] }) });
		widget.chromeButton(actions, {
			svg: 'trash',
			svgSize: 12,
			label: `${t(state, 'delete')} (${state.historySelected.length})`,
			disabled: state.historySelected.length === 0,
			extraClass: 'knox-gui-danger',
			onClick: () => widget.controller.store.patch({ historyConfirmDelete: true }),
		});
		widget.chromeButton(actions, { svg: 'x', svgSize: 12, label: t(state, 'exit'), title: t(state, 'exitSelectionMode'), onClick: () => widget.controller.store.patch({ historySelectionMode: false, historySelected: [], historyConfirmDelete: false }) });
	}
	for (const group of groupHistoryByDate(sessions)) {
		const section = DOM.append(body, DOM.$('.knox-gui-history-group'));
		const head = DOM.append(section, DOM.$('.knox-gui-row'));
		DOM.append(head, DOM.$('h4', undefined, t(state, group.header)));
		DOM.append(head, DOM.$('span.knox-gui-badge', undefined, `${group.sessions.length} ${group.sessions.length === 1 ? t(state, 'item') : t(state, 'items')}`));
		group.sessions.forEach((session, idx) => {
			widget.renderHistorySessionRow(section, state, session, idx);
		});
	}
	const footer = DOM.append(body, DOM.$('.knox-gui-muted.knox-gui-history-footer'));
	appendKnoxGuiSvg(footer, 'info', 12);
	footer.append(` ${t(state, 'conversationsDataStoredAt')}`);
	if (state.historyConfirmDelete) {
		widget.renderHistoryDeleteDialog(body, state);
	}
}

export function renderHistorySessionRow(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, session: IKnoxGuiState['historySessions'][number], index: number): void {
	const selected = state.historySelected.includes(session.id);
	const row = DOM.append(parent, DOM.$(selected ? '.knox-gui-history-row.selected' : '.knox-gui-history-row'));
	row.setAttribute('data-testid', `history-row-${index}`);
	if (state.historySelectionMode) {
		const box = DOM.append(row, DOM.$('input')) as HTMLInputElement;
		box.type = 'checkbox';
		box.checked = selected;
		widget.renderStore.add(DOM.addDisposableListener(box, 'click', e => e.stopPropagation()));
		widget.renderStore.add(DOM.addDisposableListener(box, 'change', () => widget.controller.store.patch({ historySelected: toggleHistorySelection(state.historySelected, session.id, box.checked) })));
	}
	const main = DOM.append(row, DOM.$('.knox-gui-history-main'));
	if (widget.editingHistoryId === session.id) {
		const title = DOM.append(main, DOM.$('input')) as HTMLInputElement;
		title.value = session.title;
		title.focus();
		widget.renderStore.add(DOM.addDisposableListener(title, 'keydown', e => {
			if (e.key === 'Enter') {
				void widget.controller.renameSession(session.id, title.value);
				widget.editingHistoryId = null;
			} else if (e.key === 'Escape') {
				widget.editingHistoryId = null;
				widget.controller.store.patch({});
			}
		}));
		widget.renderStore.add(DOM.addDisposableListener(title, 'blur', () => {
			widget.editingHistoryId = null;
			widget.controller.store.patch({});
		}));
	} else {
		DOM.append(main, DOM.$('span.knox-gui-history-title', undefined, session.title));
	}
	const meta = DOM.append(main, DOM.$('.knox-gui-history-meta'));
	const workspace = workspaceBasename(session.workspaceDirectory);
	if (workspace) {
		DOM.append(meta, DOM.$('span', undefined, workspace));
	}
	const date = formatSessionDate(new Date(session.date));
	DOM.append(meta, DOM.$('time', undefined, date));
	if (!state.historySelectionMode && widget.editingHistoryId !== session.id) {
		const hover = DOM.append(row, DOM.$('.knox-gui-history-hover'));
		widget.chromeButton(hover, { svg: 'download', svgSize: 16, title: t(state, 'download'), onClick: () => void widget.controller.exportSession(session.id) });
		widget.chromeButton(hover, { svg: 'square-pen', svgSize: 16, title: t(state, 'edit'), onClick: () => { widget.editingHistoryId = session.id; widget.controller.store.patch({}); } });
		widget.chromeButton(hover, { svg: 'trash', svgSize: 16, title: t(state, 'delete'), extraClass: 'knox-gui-danger', onClick: () => void widget.controller.deleteSessions([session.id]) });
	}
	widget.renderStore.add(DOM.addDisposableListener(row, 'click', () => {
		if (state.historySelectionMode) {
			widget.controller.store.patch({ historySelected: toggleHistorySelection(state.historySelected, session.id, !selected) });
			return;
		}
		void widget.controller.loadSession(session.id).then(() => widget.controller.store.navigate('/'));
	}));
}

export function renderHistoryDeleteDialog(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
	const overlay = DOM.append(widget.root, DOM.$('.knox-gui-text-dialog.knox-gui-history-delete'));
	overlay.setAttribute('role', 'presentation');
	overlay.setAttribute('data-testid', 'knox-gui-history-delete');
	widget.renderStore.add(DOM.addDisposableListener(overlay, 'click', () => widget.controller.store.patch({ historyConfirmDelete: false })));
	const panel = DOM.append(overlay, DOM.$('.knox-gui-text-dialog-panel'));
	widget.renderStore.add(DOM.addDisposableListener(panel, 'click', e => e.stopPropagation()));
	const dialog = DOM.append(panel, DOM.$('.knox-gui-text-dialog-body'));
	dialog.setAttribute('role', 'dialog');
	dialog.setAttribute('aria-modal', 'true');
	DOM.append(dialog, DOM.$('h3.knox-gui-danger-text', undefined, t(state, 'deleteConversations')));
	DOM.append(dialog, DOM.$('p', undefined, `${t(state, 'confirmDeleteConversations', { count: state.historySelected.length })} ${state.historySelected.length === 1 ? t(state, 'conversation') : t(state, 'conversations')}?`));
	DOM.append(dialog, DOM.$('p.knox-gui-muted', undefined, t(state, 'actionCannotBeUndone')));
	const actions = DOM.append(dialog, DOM.$('.knox-gui-row'));
	widget.chromeButton(actions, { label: t(state, 'cancel'), onClick: () => widget.controller.store.patch({ historyConfirmDelete: false }) });
	widget.chromeButton(actions, {
		label: t(state, 'delete'),
		extraClass: 'knox-gui-danger',
		onClick: () => {
			void widget.controller.deleteSessions(state.historySelected);
			widget.controller.store.patch({ historyConfirmDelete: false, historySelectionMode: false, historySelected: [] });
		},
	});
	void body;
}

export function renderSettings(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState, compact: boolean): void {
	if (!compact) {
		widget.back(body, state);
		const tab = DOM.append(body, DOM.$('.knox-gui-page-tab'));
		appendKnoxGuiSvg(tab, 'settings', 14);
		DOM.append(tab, DOM.$('span', undefined, t(state, 'settings')));
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
		const promptRow = DOM.append(el, DOM.$('.knox-gui-row.knox-gui-settings-stack'));
		const promptLabels = DOM.append(promptRow, DOM.$('div'));
		DOM.append(promptLabels, DOM.$('div', undefined, t(state, 'promptPath')));
		DOM.append(promptLabels, DOM.$('span.knox-gui-muted', undefined, t(state, 'promptPathHint')));
		const prompt = DOM.append(promptRow, DOM.$('input')) as HTMLInputElement;
		prompt.value = state.promptPath;
		widget.renderStore.add(DOM.addDisposableListener(prompt, 'change', () => {
			widget.controller.store.patch({ promptPath: prompt.value });
			void widget.controller.updateSharedConfig({ promptPath: prompt.value });
		}));
		DOM.append(el, DOM.$('p.knox-gui-muted', undefined, t(state, 'agentPolicyHint')));
	});
	const help = DOM.append(body, DOM.$('button.knox-gui-help-row')) as HTMLButtonElement;
	help.type = 'button';
	const helpText = DOM.append(help, DOM.$('div'));
	DOM.append(helpText, DOM.$('h3', undefined, t(state, 'viewDocs')));
	DOM.append(helpText, DOM.$('span.knox-gui-muted', undefined, t(state, 'visitSetupDocs')));
	appendKnoxGuiSvg(help, 'external-link', 16);
	widget.renderStore.add(DOM.addDisposableListener(help, 'click', () => void widget.openerService.open(URI.parse('https://docs.knox.chat'))));
}
