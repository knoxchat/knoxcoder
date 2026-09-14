/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append } from '../../../../../base/browser/dom.js';
import { getDefaultHoverDelegate } from '../../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { Separator, toAction } from '../../../../../base/common/actions.js';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { IKnoxChatService } from '../../common/knoxChatService.js';
import { KNOX_PERMISSION_MODES, KnoxPermissionMode } from '../../common/knoxChat.js';
import { knoxAgentModeSupported } from '../../common/knoxModeSelect.js';
import { knoxGuiIconClass } from '../knoxGuiIcons.js';

/**
 * Chat vs Agent tabs, permission overlay, worktree, and jobs entry (T5.2).
 */
export class KnoxModeSelect extends Disposable {

	readonly element: HTMLElement;

	private readonly _chat: HTMLButtonElement;
	private readonly _agent: HTMLButtonElement;
	private readonly _jobsBadge: HTMLElement;
	private readonly _chevron: HTMLElement;
	private readonly _hoverStore = this._register(new DisposableStore());

	private readonly _onDidChangeHeight = this._register(new Emitter<void>());
	readonly onDidChangeHeight = this._onDidChangeHeight.event;

	constructor(
		parent: HTMLElement,
		@IKnoxChatService private readonly _chatService: IKnoxChatService,
		@IContextMenuService private readonly _contextMenuService: IContextMenuService,
		@IHoverService private readonly _hoverService: IHoverService,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
	) {
		super();
		this.element = append(parent, $('.knox-mode-select'));
		this.element.setAttribute('role', 'tablist');
		this.element.setAttribute('aria-label', localize('knox.modeSelect', "Chat mode"));

		this._chat = this._tab(localize('knox.chat', "Chat"));
		this._agent = this._tab(localize('knox.agent', "Agent"));
		this._agent.setAttribute('data-testid', 'agent-options-trigger');
		this._jobsBadge = append(this._agent, $('span.knox-mode-jobs-badge.hidden'));
		this._chevron = append(this._agent, $('span.knox-mode-chevron.hidden'));
		this._chevron.className = `knox-mode-chevron hidden ${knoxGuiIconClass('lucide-chevron-down')}`;

		this._register(addDisposableListener(this._chat, 'click', () => void this._chatService.setSessionMode('chat')));
		this._register(addDisposableListener(this._agent, 'click', e => this._onAgentClick(e)));
		this._register(this._chatService.onDidChange(() => this._render()));
		this._render();
	}

	private _tab(label: string): HTMLButtonElement {
		const button = append(this.element, $<HTMLButtonElement>('button.knox-mode-tab'));
		button.type = 'button';
		button.setAttribute('role', 'tab');
		append(button, $('span.knox-mode-tab-label')).textContent = label;
		return button;
	}

	private _onAgentClick(e: MouseEvent): void {
		e.preventDefault();
		e.stopPropagation();
		if (this._chatService.isStreaming) {
			return;
		}
		if (this._chatService.mode === 'agent' && knoxAgentModeSupported(this._chatService.defaultModel)) {
			this._openAgentMenu();
			return;
		}
		void this._chatService.setSessionMode('agent');
	}

	private _openAgentMenu(): void {
		const streaming = this._chatService.isStreaming;
		const permission = this._chatService.permissionMode;
		const worktree = this._chatService.worktree;
		const running = this._chatService.runningJobCount;
		const jobsOpen = this._chatService.jobsPanelOpen;
		const shiftTab = this._keybindingService.lookupKeybinding('knox.native.cyclePermissionMode')?.getLabel()
			?? localize('knox.shiftTab', "Shift+Tab");

		const permissionActions = KNOX_PERMISSION_MODES.map(mode => toAction({
			id: `knox.permission.${mode}`,
			label: permissionLabel(mode),
			tooltip: `${permissionTitle(mode)} (${shiftTab})`,
			checked: mode === permission,
			enabled: !streaming,
			class: mode === 'fullAuto' && mode === permission ? 'knox-permission-auto' : undefined,
			run: () => this._chatService.setPermissionMode(mode),
		}));

		this._contextMenuService.showContextMenu({
			getAnchor: () => this._agent,
			getActions: () => [
				toAction({
					id: 'knox.permission.group',
					label: localize('knox.permissionModeGroup', "Permission"),
					enabled: false,
					run: () => { },
				}),
				...permissionActions,
				new Separator(),
				toAction({
					id: 'knox.worktree',
					label: localize('knox.worktreeChip', "Worktree"),
					tooltip: worktree.enabled
						? localize('knox.worktreeLeaveHint', "Discard the isolated worktree (does not apply files)")
						: localize('knox.worktreeEnterHint', "Run agent edits in an isolated git worktree"),
					checked: worktree.enabled,
					enabled: !streaming && !worktree.busy,
					run: () => void this._chatService.runAgentWorktree(worktree.enabled ? 'discard' : 'enter'),
				}),
				toAction({
					id: 'knox.jobs',
					label: running > 0
						? localize('knox.jobsChipCount', "Jobs · {0}", running)
						: localize('knox.jobsChip', "Jobs"),
					tooltip: jobsOpen
						? localize('knox.jobsChipHintOpen', "Hide the background jobs list")
						: localize('knox.jobsChipHint', "Show or hide the background jobs list"),
					checked: jobsOpen,
					run: () => this._chatService.toggleJobsPanel(),
				}),
			],
		});
	}

	private _render(): void {
		this._hoverStore.clear();
		const mode = this._chatService.mode;
		const streaming = this._chatService.isStreaming;
		const agentSupported = knoxAgentModeSupported(this._chatService.defaultModel);
		const agentActive = mode === 'agent' && agentSupported;
		const running = this._chatService.runningJobCount;

		this._chat.classList.toggle('active', mode === 'chat');
		this._chat.disabled = streaming;
		this._chat.setAttribute('aria-selected', String(mode === 'chat'));
		const chatHint = localize('knox.chatMode', "Chat Mode");
		this._chat.setAttribute('aria-label', chatHint);
		this._hoverStore.add(this._hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), this._chat, chatHint));

		this._agent.classList.toggle('active', agentActive);
		this._agent.classList.toggle('unsupported', !agentSupported);
		this._agent.disabled = streaming || !agentSupported;
		this._agent.setAttribute('aria-selected', String(agentActive));
		this._agent.setAttribute('aria-haspopup', agentActive ? 'menu' : 'false');
		this._chevron.classList.toggle('hidden', !agentActive);
		this._jobsBadge.classList.toggle('hidden', !(agentActive && running > 0));
		this._jobsBadge.textContent = running > 0 ? String(running) : '';

		const agentTitle = !agentSupported
			? localize('knox.agentModeNotSupported', "Agent mode not supported with current model")
			: agentActive
				? localize('knox.agentOptions', "Agent options")
				: localize('knox.agentMode', "Agent Mode");
		this._agent.setAttribute('aria-label', agentTitle);
		this._hoverStore.add(this._hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), this._agent, agentTitle));
		this._onDidChangeHeight.fire();
	}
}

function permissionLabel(mode: KnoxPermissionMode): string {
	switch (mode) {
		case 'default': return localize('knox.permissionModeAsk', "Ask");
		case 'acceptEdits': return localize('knox.permissionModeEdits', "Edits");
		case 'fullAuto': return localize('knox.permissionModeAuto', "Auto");
	}
}

function permissionTitle(mode: KnoxPermissionMode): string {
	switch (mode) {
		case 'default': return localize('knox.permissionModeAskHint', "Ask before writes and terminal");
		case 'acceptEdits': return localize('knox.permissionModeEditsHint', "Auto-approve file edits; ask for terminal");
		case 'fullAuto': return localize('knox.permissionModeAutoHint', "Auto-approve every enabled tool (YOLO, default)");
	}
}
