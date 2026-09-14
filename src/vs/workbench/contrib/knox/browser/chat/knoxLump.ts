/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { getDefaultHoverDelegate } from '../../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { KnoxLumpSection, KNOX_NATIVE_ADD_MODEL_COMMAND_ID } from '../../common/knoxChat.js';
import { IKnoxChatService } from '../../common/knoxChatService.js';
import { IKnoxModelDescription, KnoxModelRole } from '../../common/knoxChatTypes.js';
import { IKnoxGuiBridge } from '../../common/knoxGuiProtocol.js';
import { KNOX_LUMP_SECTIONS, knoxLumpSectionContentVisible } from '../../common/knoxLump.js';
import {
	KNOX_MODEL_ROLES,
	knoxModelRoleUsesChatFallback,
	knoxModelsForRole,
	knoxModelSelectTitle,
	knoxSelectedModelForRole,
} from '../../common/knoxModels.js';
import { appendKnoxGuiIcon, KnoxGuiIconName } from '../knoxGuiIcons.js';
import { KnoxModeSelect } from './knoxModeSelect.js';
import { KnoxAnchoredListbox } from './knoxAnchoredListbox.js';
import { KnoxLumpPromptsSection } from './knoxLumpPrompts.js';
import { KnoxLumpRulesSection } from './knoxLumpRules.js';
import { KnoxLumpToolsSection } from './knoxLumpTools.js';
import { KnoxHistoryList } from '../history/knoxHistoryList.js';
import { KnoxCheckpointsPanel } from '../checkpoints/knoxCheckpointsPanel.js';

const SECTION_ICON: Record<KnoxLumpSection, KnoxGuiIconName> = {
	models: 'models',
	rules: 'rules',
	prompts: 'prompts',
	tools: 'tools',
	history: 'history',
	checkpoints: 'checkpoints',
};

/**
 * Native Lump toolbar: New chat, section chips, ModeSelect, Models (T5.4),
 * Rules (T5.5), Prompts (T5.6), Tools (T5.7), History (T7.2), and
 * Checkpoints (T7.11).
 */
export class KnoxLump extends Disposable {

	readonly element: HTMLElement;

	private readonly _toolbar: HTMLElement;
	private readonly _content: HTMLElement;
	private readonly _newChat: HTMLButtonElement;
	private readonly _chips = new Map<KnoxLumpSection, { button: HTMLButtonElement; label: HTMLElement }>();
	private readonly _modeSelect: KnoxModeSelect;
	private readonly _hoverStore = this._register(new DisposableStore());
	private readonly _contentStore = this._register(new DisposableStore());
	private readonly _roleList = this._register(new KnoxAnchoredListbox());
	private _sectionWidget: { section: KnoxLumpSection; refresh(): void } | undefined;

	private readonly _onDidChangeHeight = this._register(new Emitter<void>());
	readonly onDidChangeHeight = this._onDidChangeHeight.event;

	/** Visible Lump section height, or 0 when collapsed. */
	get contentHeight(): number {
		if (this._content.classList.contains('hidden')) {
			return 0;
		}
		return this._content.offsetHeight;
	}

	/**
	 * Cap an open section at leftover pane height (GUI `max-h-[70vh]`).
	 * Content keeps its intrinsic height; does not fire `onDidChangeHeight`.
	 */
	layoutExpandedContent(availableHeight: number): void {
		this._content.style.height = '';
		if (this._content.classList.contains('hidden')) {
			this._content.style.maxHeight = '';
			return;
		}
		this._content.style.maxHeight = `${Math.max(0, Math.floor(availableHeight))}px`;
	}

	constructor(
		parent: HTMLElement,
		@IKnoxChatService private readonly _chatService: IKnoxChatService,
		@IKnoxGuiBridge private readonly _bridge: IKnoxGuiBridge,
		@IHoverService private readonly _hoverService: IHoverService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ICommandService private readonly _commandService: ICommandService,
	) {
		super();
		this.element = append(parent, $('.knox-lump'));
		this.element.setAttribute('role', 'region');
		this.element.setAttribute('aria-label', localize('knox.lump', "Knox toolbar"));

		this._toolbar = append(this.element, $('.knox-lump-toolbar'));
		this._toolbar.setAttribute('role', 'toolbar');
		this._toolbar.setAttribute('aria-label', localize('knox.lumpToolbar', "Lump toolbar"));

		const left = append(this._toolbar, $('.knox-lump-left'));
		this._newChat = this._iconButton(left, 'new-chat', localize('knox.newChat', "New Chat"));
		this._newChat.setAttribute('data-testid', 'lump-new-chat');

		const sections = append(left, $('.knox-lump-sections'));
		for (const id of KNOX_LUMP_SECTIONS) {
			const button = append(sections, $<HTMLButtonElement>('button.knox-lump-chip'));
			button.type = 'button';
			button.setAttribute('data-testid', `lump-section-${id}`);
			appendKnoxGuiIcon(button, SECTION_ICON[id]);
			const label = append(button, $('span.knox-lump-chip-label'));
			label.textContent = sectionLabel(id);
			this._chips.set(id, { button, label });
			this._register(addDisposableListener(button, 'click', () => this._chatService.toggleLumpSection(id)));
		}

		this._modeSelect = this._register(this._instantiationService.createInstance(KnoxModeSelect, this._toolbar));
		this._register(this._modeSelect.onDidChangeHeight(() => this._onDidChangeHeight.fire()));

		this._content = append(this.element, $('.knox-lump-content.hidden'));
		this._content.setAttribute('role', 'region');

		this._register(addDisposableListener(this._newChat, 'click', () => void this._chatService.startNewChat()));
		this._register(this._chatService.onDidChange(() => this._render()));
		this._render();
	}

	private _render(): void {
		this._hoverStore.clear();
		this._hover(this._newChat, localize('knox.newChat', "New Chat"));

		const selected = this._chatService.lumpSection;
		for (const id of KNOX_LUMP_SECTIONS) {
			const chip = this._chips.get(id);
			if (!chip) {
				continue;
			}
			const active = selected === id;
			chip.button.classList.toggle('selected', active);
			chip.button.setAttribute('aria-pressed', String(active));
			chip.label.classList.toggle('hidden', !active);
			const name = sectionLabel(id);
			chip.button.setAttribute('aria-label', name);
			this._hover(chip.button, name);
		}

		const showContent = knoxLumpSectionContentVisible({
			section: selected,
			isStreaming: this._chatService.isStreaming,
			history: this._chatService.history,
		});
		this._content.classList.toggle('hidden', !showContent);
		this._content.setAttribute('aria-label', selected ? sectionLabel(selected) : localize('knox.lump', "Knox toolbar"));
		if (!showContent || !selected) {
			this._sectionWidget = undefined;
			this._contentStore.clear();
			clearNode(this._content);
		} else if (selected === 'models') {
			this._sectionWidget = undefined;
			this._contentStore.clear();
			clearNode(this._content);
			this._renderModels();
		} else if (this._sectionWidget?.section === selected) {
			this._sectionWidget.refresh();
		} else {
			this._contentStore.clear();
			clearNode(this._content);
			this._sectionWidget = this._createSection(selected);
		}
		this._onDidChangeHeight.fire();
	}

	private _createSection(section: KnoxLumpSection): { section: KnoxLumpSection; refresh(): void } | undefined {
		if (section === 'rules') {
			const widget = this._contentStore.add(this._instantiationService.createInstance(KnoxLumpRulesSection, this._content));
			return { section, refresh: () => widget.refresh() };
		}
		if (section === 'prompts') {
			const widget = this._contentStore.add(this._instantiationService.createInstance(KnoxLumpPromptsSection, this._content));
			return { section, refresh: () => widget.refresh() };
		}
		if (section === 'tools') {
			const widget = this._contentStore.add(this._instantiationService.createInstance(KnoxLumpToolsSection, this._content));
			return { section, refresh: () => widget.refresh() };
		}
		if (section === 'history') {
			const widget = this._contentStore.add(this._instantiationService.createInstance(KnoxHistoryList, this._content, { compact: true }));
			this._contentStore.add(widget.onDidOpenSession(() => this._chatService.setLumpSection(undefined)));
			this._contentStore.add(widget.onDidChangeHeight(() => this._onDidChangeHeight.fire()));
			return { section, refresh: () => void widget.refresh() };
		}
		if (section === 'checkpoints') {
			const widget = this._contentStore.add(this._instantiationService.createInstance(KnoxCheckpointsPanel, this._content));
			this._contentStore.add(widget.onDidChangeHeight(() => this._onDidChangeHeight.fire()));
			return { section, refresh: () => widget.refresh() };
		}
		return undefined;
	}

	private _renderModels(): void {
		this._roleList.hide();
		const grid = append(this._content, $('.knox-lump-models'));
		for (const role of KNOX_MODEL_ROLES) {
			const label = append(grid, $('span.knox-lump-role-label'));
			label.textContent = modelRoleLabel(role);
			this._hover(label, modelRoleDescription(role));

			const row = append(grid, $('.knox-lump-role-row'));
			const models = knoxModelsForRole(this._chatService.config, role);
			const selected = knoxSelectedModelForRole(this._chatService.config, role, this._chatService.defaultModelTitle);
			const select = append(row, $<HTMLButtonElement>('button.knox-lump-role-select'));
			select.type = 'button';
			select.setAttribute('data-testid', `lump-model-role-${role}`);
			select.disabled = models.length === 0;
			const selectLabel = append(select, $('span.knox-lump-role-select-label'));
			selectLabel.textContent = models.length
				? (knoxModelSelectTitle(selected) || localize('knox.selectRoleModel', "Select {0} model", modelRoleLabel(role)))
				: emptyRoleLabel(role);
			if (models.length) {
				appendKnoxGuiIcon(select, 'lucide-chevron-down');
			}
			this._hover(select, modelRoleDescription(role));
			select.setAttribute('aria-haspopup', 'listbox');
			select.setAttribute('aria-expanded', 'false');
			this._contentStore.add(addDisposableListener(select, 'click', e => {
				e.preventDefault();
				e.stopPropagation();
				this._pickRoleModel(role, models, selected, select);
			}));

			const gear = append(row, $<HTMLButtonElement>('button.knox-lump-role-gear'));
			gear.type = 'button';
			const gearHint = localize('knox.addUpdateRoleModel', "Add/Update {0} model", modelRoleLabel(role));
			gear.setAttribute('aria-label', gearHint);
			appendKnoxGuiIcon(gear, 'settings');
			this._hover(gear, gearHint);
			this._contentStore.add(addDisposableListener(gear, 'click', () => void this._commandService.executeCommand(KNOX_NATIVE_ADD_MODEL_COMMAND_ID, { modelRole: role })));
		}

		if (this._chatService.profileId === 'local') {
			const open = append(this._content, $<HTMLButtonElement>('button.knox-lump-open-config'));
			open.type = 'button';
			appendKnoxGuiIcon(open, 'settings');
			append(open, $('span')).textContent = localize('knox.openConfigFile', "Open Config File (Optional)");
			this._hover(open, localize('knox.openConfigFile', "Open Config File (Optional)"));
			this._contentStore.add(addDisposableListener(open, 'click', () => this._openProfile()));
		}
	}

	private _pickRoleModel(
		role: KnoxModelRole,
		models: readonly IKnoxModelDescription[],
		selected: IKnoxModelDescription | undefined,
		anchor: HTMLElement,
	): void {
		if (!models.length) {
			return;
		}
		this._roleList.toggle(anchor, models.map(model => ({
			id: model.title,
			label: knoxModelSelectTitle(model) || model.title,
			selected: model.title === selected?.title,
		})), {
			onSelect: id => this._chatService.setSelectedModelByRole(role, id),
		});
	}

	private _openProfile(): void {
		void this._bridge.post('config/openProfile', { profileId: this._chatService.profileId }).catch(() => { });
	}

	private _iconButton(parent: HTMLElement, icon: KnoxGuiIconName, label: string): HTMLButtonElement {
		const button = append(parent, $<HTMLButtonElement>('button.knox-icon-button'));
		button.type = 'button';
		button.setAttribute('aria-label', label);
		appendKnoxGuiIcon(button, icon);
		return button;
	}

	private _hover(element: HTMLElement, label: string): void {
		this._hoverStore.add(this._hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), element, label));
	}
}

function sectionLabel(section: KnoxLumpSection): string {
	switch (section) {
		case 'models': return localize('knox.lump.models', "Models");
		case 'rules': return localize('knox.lump.rules', "Rules");
		case 'prompts': return localize('knox.lump.prompts', "Prompts");
		case 'tools': return localize('knox.lump.tools', "Tools");
		case 'history': return localize('knox.lump.history', "History");
		case 'checkpoints': return localize('knox.lump.checkpoints', "Checkpoints");
	}
}

function modelRoleLabel(role: KnoxModelRole): string {
	switch (role) {
		case 'chat': return localize('knox.chatRole', "Chat");
		case 'edit': return localize('knox.editRole', "Edit");
		case 'apply': return localize('knox.applyRole', "Apply");
		case 'summarize': return localize('knox.summarizeRole', "Summarize");
		case 'viewRead': return localize('knox.viewReadRole', "View/Read");
		case 'realTimeSearch': return localize('knox.realTimeSearchRole', "RealTime Search");
	}
}

function modelRoleDescription(role: KnoxModelRole): string {
	switch (role) {
		case 'chat': return localize('knox.usedForChat', "Used for chat interface");
		case 'edit': return localize('knox.usedForEdit', "Used for editing code based on instructions");
		case 'apply': return localize('knox.usedForApply', "Used for applying code changes from chat responses");
		case 'summarize': return localize('knox.usedForSummarize', "Used for summarizing conversations");
		case 'viewRead': return localize('knox.usedForViewRead', "Used for read-only operations like Read File, View Subdirectory...");
		case 'realTimeSearch': return localize('knox.usedForRealTimeSearch', "Used for web search operations, ideal for models like Sonar Pro that excel at real-time web searches");
	}
}

function emptyRoleLabel(role: KnoxModelRole): string {
	const name = modelRoleLabel(role);
	const empty = localize('knox.noModelsForRole', "No {0} models", name);
	return knoxModelRoleUsesChatFallback(role)
		? `${empty}. ${localize('knox.usingChatModel', "Using chat model")}`
		: empty;
}
