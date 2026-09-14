/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { getDefaultHoverDelegate } from '../../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { findCurrentToolCall } from '../../common/knoxChatHistory.js';
import { IKnoxChatService } from '../../common/knoxChatService.js';
import { IKnoxTool, KnoxExternalDirectoryMode } from '../../common/knoxChatTypes.js';
import {
	knoxCategorizedToolName,
	knoxDuplicateToolNames,
	knoxGetToolPermissionDisplay,
	knoxIsSamePermissionTool,
	knoxIsToolAutoApproved,
	knoxPolicyEditorState,
	knoxResolvePermissionToolName,
	knoxToolsByGroup,
	KnoxToolPermissionDisplay,
} from '../../common/knoxToolPermissions.js';
import { KnoxBuiltInToolName } from '../../common/knoxToolNames.js';
import { renderKnoxPermissionActionButtons } from '../tools/knoxPermissionButtons.js';

export class KnoxLumpToolsSection extends Disposable {

	readonly element: HTMLElement;

	private readonly _presets: HTMLElement;
	private readonly _policy: HTMLElement;
	private readonly _groups: HTMLElement;
	private readonly _itemStore = this._register(new DisposableStore());
	private readonly _paths: HTMLTextAreaElement;
	private readonly _commands: HTMLTextAreaElement;
	private readonly _external: HTMLSelectElement;
	private readonly _sandbox: HTMLInputElement;

	constructor(
		parent: HTMLElement,
		@IKnoxChatService private readonly _chatService: IKnoxChatService,
		@IHoverService private readonly _hoverService: IHoverService,
	) {
		super();
		this.element = append(parent, $('.knox-lump-tools'));
		this._presets = append(this.element, $('.knox-lump-tool-presets'));
		this._policy = append(this.element, $('.knox-lump-policy'));
		append(this._policy, $('div.knox-lump-policy-title')).textContent = localize('knox.policyTitle', "Path & command policy");
		append(this._policy, $('p.knox-lump-policy-help')).textContent = localize(
			'knox.policyHelp',
			"One rule per line: allow|ask|deny pattern. Deny always wins. Project always/ask/never blocks in AGENTS.md are also applied.",
		);
		append(this._policy, $('label.knox-lump-field-label')).textContent = localize('knox.policyPaths', "Paths");
		this._paths = append(this._policy, $<HTMLTextAreaElement>('textarea.knox-lump-textarea'));
		this._paths.spellcheck = false;
		append(this._policy, $('label.knox-lump-field-label')).textContent = localize('knox.policyCommands', "Commands");
		this._commands = append(this._policy, $<HTMLTextAreaElement>('textarea.knox-lump-textarea'));
		this._commands.spellcheck = false;
		const extras = append(this._policy, $('.knox-lump-policy-extras'));
		append(extras, $('label.knox-lump-field-label')).textContent = localize('knox.policyOutsideWorkspace', "Outside workspace");
		this._external = append(extras, $<HTMLSelectElement>('select.knox-lump-select'));
		const askOpt = append(this._external, $<HTMLOptionElement>('option'));
		askOpt.value = 'ask';
		askOpt.textContent = localize('knox.permissionModeAsk', "Ask");
		const denyOpt = append(this._external, $<HTMLOptionElement>('option'));
		denyOpt.value = 'deny';
		denyOpt.textContent = localize('knox.deny', "Deny");
		const allowOpt = append(this._external, $<HTMLOptionElement>('option'));
		allowOpt.value = 'allow';
		allowOpt.textContent = localize('knox.policyAllow', "Allow");
		const sandboxLabel = append(extras, $('label.knox-lump-sandbox'));
		this._sandbox = append(sandboxLabel, $<HTMLInputElement>('input'));
		this._sandbox.type = 'checkbox';
		append(sandboxLabel, $('span')).textContent = localize('knox.policyBlockDestructive', "Block destructive commands");

		this._register(addDisposableListener(this._paths, 'blur', () => this._savePolicy({ paths: this._paths.value })));
		this._register(addDisposableListener(this._commands, 'blur', () => this._savePolicy({ commands: this._commands.value })));
		this._register(addDisposableListener(this._external, 'change', () => {
			this._savePolicy({ externalDirectory: this._external.value as KnoxExternalDirectoryMode });
		}));
		this._register(addDisposableListener(this._sandbox, 'change', () => {
			this._savePolicy({ sandboxDestructive: this._sandbox.checked });
		}));

		this._groups = append(this.element, $('.knox-lump-tool-groups'));
		this._syncPolicyFromConfig();
		this.refresh();
	}

	refresh(): void {
		this._itemStore.clear();
		clearNode(this._presets);
		clearNode(this._groups);
		this._renderPresets();
		if (!this._policyFieldFocused()) {
			this._syncPolicyFromConfig();
		}
		this._renderGroups();
	}

	private _renderPresets(): void {
		const ask = append(this._presets, $<HTMLButtonElement>('button.knox-lump-preset'));
		ask.type = 'button';
		ask.textContent = localize('knox.askOnWrite', "Ask on write");
		ask.title = localize('knox.askOnWriteHint', "Reads auto-run; writes, terminal, and web ask first");
		this._itemStore.add(addDisposableListener(ask, 'click', () => this._chatService.applyToolPermissionPreset('safe')));
		const yolo = append(this._presets, $<HTMLButtonElement>('button.knox-lump-preset'));
		yolo.type = 'button';
		yolo.textContent = localize('knox.yoloPreset', "YOLO");
		yolo.title = localize('knox.yoloPresetHint', "Auto-approve every tool (previous Knox default)");
		this._itemStore.add(addDisposableListener(yolo, 'click', () => this._chatService.applyToolPermissionPreset('yolo')));
	}

	private _renderGroups(): void {
		const tools = this._chatService.config?.tools ?? [];
		const duplicates = knoxDuplicateToolNames(tools);
		const pending = findCurrentToolCall(this._chatService.history);
		const pendingName = knoxResolvePermissionToolName(pending?.toolCall.function.name);
		for (const [groupName, groupTools] of knoxToolsByGroup(tools)) {
			const excluded = this._chatService.toolGroupSettings[groupName] === 'exclude';
			const group = append(this._groups, $('.knox-lump-tool-group'));
			group.classList.toggle('excluded', excluded);
			const header = append(group, $('.knox-lump-tool-group-header'));
			const left = append(header, $('.knox-lump-tool-group-left'));
			append(left, $('span.knox-lump-tool-dot'));
			append(left, $('span.knox-lump-tool-group-name')).textContent = groupName;
			append(left, $('span.knox-lump-tool-count')).textContent = String(groupTools.length);
			const toggle = append(header, $<HTMLInputElement>('input.knox-lump-group-toggle'));
			toggle.type = 'checkbox';
			toggle.checked = !excluded;
			toggle.title = groupName;
			this._itemStore.add(addDisposableListener(toggle, 'change', () => this._chatService.toggleToolGroupSetting(groupName)));

			const body = append(group, $('.knox-lump-tool-group-body'));
			for (const tool of groupTools) {
				this._renderTool(body, tool, excluded, duplicates[tool.function.name] === true, pending, pendingName);
			}
			if (excluded) {
				const overlay = append(body, $('.knox-lump-group-disabled'));
				overlay.textContent = localize('knox.groupDisabled', "Group disabled");
			}
		}
	}

	private _renderTool(
		parent: HTMLElement,
		tool: IKnoxTool,
		excluded: boolean,
		duplicate: boolean,
		pending: ReturnType<typeof findCurrentToolCall>,
		pendingName: string,
	): void {
		const name = knoxResolvePermissionToolName(tool.function.name);
		const isPending = pending?.status === 'generated' && knoxIsSamePermissionTool(pendingName, name);
		const row = append(parent, $('.knox-lump-tool-row'));
		row.classList.toggle('pending', isPending);
		row.classList.toggle('excluded', excluded);
		row.setAttribute('data-testid', `tool-permission-row-${name}`);

		const main = append(row, $('.knox-lump-tool-main'));
		const label = append(main, $('span.knox-lump-tool-name'));
		if (duplicate) {
			label.title = localize('knox.duplicateToolWarning', "Duplicate tool name detected. Permissions will conflict, and usage may be unpredictable");
			label.classList.add('duplicate');
		}
		label.textContent = knoxCategorizedToolName(tool);
		const display = knoxGetToolPermissionDisplay({
			toolName: name,
			toolSettings: this._chatService.toolSettings,
			sessionAllowlist: this._chatService.sessionToolAllowlist,
		});
		if (excluded) {
			append(main, $('span.knox-lump-tool-badge')).textContent = localize('knox.toolDisabled', "Disabled");
		} else {
			this._renderBadge(main, display, name, isPending);
		}

		if (!excluded && !isPending) {
			this._itemStore.add(addDisposableListener(main, 'click', () => this._chatService.cycleToolPermission(name)));
		}

		const autoApproved = knoxIsToolAutoApproved({
			toolName: name,
			toolSettings: this._chatService.toolSettings,
			permissionMode: this._chatService.permissionMode,
			sessionAllowlist: this._chatService.sessionToolAllowlist,
		});
		if (isPending && !excluded && !autoApproved && pending && name !== KnoxBuiltInToolName.AskUser) {
			this._renderPendingActions(row, pending.toolCallId, name);
		}
	}

	private _renderBadge(
		parent: HTMLElement,
		display: KnoxToolPermissionDisplay,
		toolName: string,
		isPending: boolean,
	): void {
		if (display === 'sessionAlways' && !isPending) {
			const button = append(parent, $<HTMLButtonElement>('button.knox-lump-tool-badge session'));
			button.type = 'button';
			button.textContent = localize('knox.toolAlwaysThisSession', "Always (this chat)");
			const sessionHint = localize('knox.toolAlwaysThisSessionHint', "Auto-approve this tool until the chat ends. Click to undo.");
			button.setAttribute('aria-label', sessionHint);
			this._itemStore.add(this._hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), button, sessionHint));
			this._itemStore.add(addDisposableListener(button, 'click', e => {
				e.stopPropagation();
				this._chatService.cycleToolPermission(toolName);
			}));
			return;
		}
		const badge = append(parent, $('span.knox-lump-tool-badge'));
		badge.classList.add(display);
		badge.textContent = permissionLabel(display);
	}

	private _renderPendingActions(parent: HTMLElement, toolCallId: string, toolName: string): void {
		renderKnoxPermissionActionButtons(
			parent,
			{ toolCallId, toolName, compact: true },
			this._chatService,
			this._itemStore,
			this._hoverService,
		);
	}

	private _syncPolicyFromConfig(): void {
		const state = knoxPolicyEditorState(this._chatService.config?.experimental?.agentPolicy);
		this._paths.value = state.paths;
		this._commands.value = state.commands;
		this._external.value = state.externalDirectory;
		this._sandbox.checked = state.sandboxDestructive;
	}

	private _policyFieldFocused(): boolean {
		const active = this.element.ownerDocument.activeElement;
		return active === this._paths || active === this._commands || active === this._external || active === this._sandbox;
	}

	private _savePolicy(update: {
		paths?: string;
		commands?: string;
		externalDirectory?: KnoxExternalDirectoryMode;
		sandboxDestructive?: boolean;
	}): void {
		this._chatService.setAgentPolicy({
			paths: update.paths ?? this._paths.value,
			commands: update.commands ?? this._commands.value,
			externalDirectory: update.externalDirectory ?? this._external.value as KnoxExternalDirectoryMode,
			sandboxDestructive: update.sandboxDestructive ?? this._sandbox.checked,
		});
	}
}

function permissionLabel(display: KnoxToolPermissionDisplay): string {
	switch (display) {
		case 'disabled': return localize('knox.toolDisabled', "Disabled");
		case 'autoApprove': return localize('knox.toolAutoApprove', "Auto-Approve");
		case 'sessionAlways': return localize('knox.toolAlwaysThisSession', "Always (this chat)");
		case 'requiresApproval': return localize('knox.toolRequiresApproval', "Requires Approval");
	}
}
