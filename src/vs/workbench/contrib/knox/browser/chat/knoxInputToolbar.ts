/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append } from '../../../../../base/browser/dom.js';
import { getDefaultHoverDelegate } from '../../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { KNOX_NATIVE_ADD_MODEL_COMMAND_ID } from '../../common/knoxChat.js';
import { IKnoxChatService } from '../../common/knoxChatService.js';
import { knoxModelSupportsImages } from '../../common/knoxImages.js';
import { knoxSubmitNoContext, knoxUseActiveFile } from '../../common/knoxInputKeys.js';
import { knoxChatModelOptions, knoxModelSelectTitle } from '../../common/knoxModels.js';
import { knoxGetReasoningEffortConfig } from '../../common/knoxReasoningEffort.js';
import { IKnoxInputModifiers } from '../../common/knoxChatTypes.js';
import { knoxToolbarPrimaryState, KnoxToolbarPrimaryKind } from '../../common/knoxToolbar.js';
import { knoxModelSupportsWebSearch } from '../../common/knoxWebSearch.js';
import { appendKnoxGuiIcon, KnoxGuiIconName, setKnoxGuiIcon } from '../knoxGuiIcons.js';
import { IKnoxAnchoredListboxItem, KnoxAnchoredListbox } from './knoxAnchoredListbox.js';

export interface IKnoxInputToolbarScrollState {
	showScrollButtons: boolean;
	isAtTop: boolean;
	isAtBottom: boolean;
}

/**
 * Native InputToolbar: image, `@`, model, reasoning effort, web search,
 * scroll, exit-edit, send/cancel (T5.1).
 */
export class KnoxInputToolbar extends Disposable {

	readonly element: HTMLElement;

	private readonly _left: HTMLElement;
	private readonly _right: HTMLElement;
	private readonly _image: HTMLButtonElement;
	private readonly _mention: HTMLButtonElement;
	private readonly _model: HTMLButtonElement;
	private readonly _modelLabel: HTMLElement;
	private readonly _reasoning: HTMLButtonElement;
	private readonly _reasoningLabel: HTMLElement;
	private readonly _webSearch: HTMLButtonElement;
	private readonly _scroll: HTMLElement;
	private readonly _scrollUp: HTMLButtonElement;
	private readonly _scrollDown: HTMLButtonElement;
	private readonly _exitEdit: HTMLButtonElement;
	private readonly _send: HTMLButtonElement;
	private readonly _sendIcon: HTMLElement;
	private readonly _sendLabel: HTMLElement;
	private readonly _hoverStore = this._register(new DisposableStore());
	private readonly _modelList = this._register(new KnoxAnchoredListbox());
	private readonly _reasoningList = this._register(new KnoxAnchoredListbox());

	private _scrollState: IKnoxInputToolbarScrollState = {
		showScrollButtons: false,
		isAtTop: true,
		isAtBottom: true,
	};

	private readonly _onDidSubmit = this._register(new Emitter<IKnoxInputModifiers>());
	readonly onDidSubmit = this._onDidSubmit.event;

	private readonly _onDidCancel = this._register(new Emitter<void>());
	readonly onDidCancel = this._onDidCancel.event;

	private readonly _onDidAddContext = this._register(new Emitter<void>());
	readonly onDidAddContext = this._onDidAddContext.event;

	private readonly _onDidPickImages = this._register(new Emitter<void>());
	readonly onDidPickImages = this._onDidPickImages.event;

	private readonly _onDidScrollToTop = this._register(new Emitter<void>());
	readonly onDidScrollToTop = this._onDidScrollToTop.event;

	private readonly _onDidScrollToBottom = this._register(new Emitter<void>());
	readonly onDidScrollToBottom = this._onDidScrollToBottom.event;

	private readonly _onDidChangeHeight = this._register(new Emitter<void>());
	readonly onDidChangeHeight = this._onDidChangeHeight.event;

	constructor(
		parent: HTMLElement,
		@IKnoxChatService private readonly _chatService: IKnoxChatService,
		@IHoverService private readonly _hoverService: IHoverService,
		@ICommandService private readonly _commandService: ICommandService,
	) {
		super();
		this.element = append(parent, $('.knox-input-toolbar'));
		this.element.setAttribute('role', 'toolbar');
		this.element.setAttribute('aria-label', localize('knox.inputToolbar', "Knox input toolbar"));

		this._left = append(this.element, $('.knox-input-toolbar-left'));
		this._right = append(this.element, $('.knox-input-toolbar-right'));

		this._image = this._iconButton(this._left, 'image', localize('knox.attachImage', "Attach image"));
		this._mention = this._iconButton(this._left, 'mention', localize('knox.addContext', "Add context"));
		this._model = append(this._left, $<HTMLButtonElement>('button.knox-toolbar-model'));
		this._model.type = 'button';
		this._model.setAttribute('data-testid', 'model-select-button');
		this._model.setAttribute('aria-haspopup', 'listbox');
		this._model.setAttribute('aria-expanded', 'false');
		this._modelLabel = append(this._model, $('span.knox-toolbar-model-label'));
		appendKnoxGuiIcon(this._model, 'lucide-chevron-down');
		this._reasoning = append(this._left, $<HTMLButtonElement>('button.knox-toolbar-reasoning.hidden'));
		this._reasoning.type = 'button';
		appendKnoxGuiIcon(this._reasoning, 'lucide-brain');
		this._reasoningLabel = append(this._reasoning, $('span.knox-toolbar-reasoning-label'));
		this._webSearch = this._iconButton(this._left, 'lucide-globe', localize('knox.webSearchTooltipInactive', "Enable web search for this model"));

		this._scroll = append(this._right, $('.knox-scroll-buttons.hidden'));
		this._scrollUp = this._iconButton(this._scroll, 'chevron-up', localize('knox.scrollToTop', "Scroll to top"));
		this._scrollDown = this._iconButton(this._scroll, 'chevron-down', localize('knox.scrollToBottom', "Scroll to bottom"));

		this._exitEdit = append(this._right, $<HTMLButtonElement>('button.knox-exit-edit.hidden'));
		this._exitEdit.type = 'button';
		this._exitEdit.textContent = localize('knox.exitEdit', "Esc Exit Edit");
		this._exitEdit.setAttribute('aria-label', localize('knox.exitEdit', "Esc Exit Edit"));

		this._send = append(this._right, $<HTMLButtonElement>('button.knox-send'));
		this._send.type = 'button';
		this._send.setAttribute('data-testid', 'submit-input-button');
		this._sendIcon = appendKnoxGuiIcon(this._send, 'send');
		this._sendLabel = append(this._send, $('span.knox-send-label'));

		this._register(addDisposableListener(this._image, 'click', () => this._onDidPickImages.fire()));
		this._register(addDisposableListener(this._mention, 'click', () => this._onDidAddContext.fire()));
		this._register(addDisposableListener(this._model, 'click', e => {
			e.preventDefault();
			e.stopPropagation();
			this._pickModel();
		}));
		this._register(addDisposableListener(this._reasoning, 'click', e => {
			e.preventDefault();
			e.stopPropagation();
			this._pickReasoning();
		}));
		this._register(addDisposableListener(this._webSearch, 'click', () => this._chatService.toggleWebSearch()));
		this._register(addDisposableListener(this._scrollUp, 'click', () => this._onDidScrollToTop.fire()));
		this._register(addDisposableListener(this._scrollDown, 'click', () => this._onDidScrollToBottom.fire()));
		this._register(addDisposableListener(this._exitEdit, 'click', () => void this._chatService.exitEditMode()));
		this._register(addDisposableListener(this._send, 'click', e => this._onSendClick(e)));
		this._register(this._chatService.onDidChange(() => this._render()));
		this._render();
	}

	setScrollState(state: IKnoxInputToolbarScrollState): void {
		this._scrollState = state;
		this._render();
	}

	private _onSendClick(e: MouseEvent): void {
		const state = knoxToolbarPrimaryState(this._toolbarInput());
		if (state.canCancel) {
			this._onDidCancel.fire();
			return;
		}
		if (!state.enabled) {
			return;
		}
		this._onDidSubmit.fire({
			noContext: knoxSubmitNoContext(knoxUseActiveFile(this._chatService.config?.experimental), e.altKey),
		});
	}

	private _pickModel(): void {
		const options = knoxChatModelOptions(this._chatService.config?.models);
		const current = this._chatService.defaultModelTitle;
		const items: IKnoxAnchoredListboxItem[] = options.map(option => ({
			id: option.value,
			label: option.title,
			selected: option.value === current,
			disabled: option.missingApiKey,
			description: option.missingApiKey ? localize('knox.missingApiKey', "Missing API key") : undefined,
		}));
		if (this._chatService.profileId === 'local') {
			items.push({
				id: 'addModel',
				label: localize('knox.addModel', "Add Model"),
				kind: 'add',
			});
		}
		this._modelList.toggle(this._model, items, {
			onSelect: id => {
				if (id === 'addModel') {
					void this._commandService.executeCommand(KNOX_NATIVE_ADD_MODEL_COMMAND_ID, { modelRole: 'chat', bulkAdd: true });
					return;
				}
				this._chatService.setDefaultModel(id);
			},
			onDelete: id => {
				if (id !== 'addModel') {
					this._chatService.deleteModel(id);
				}
			},
			onConfigure: id => {
				if (id !== 'addModel') {
					this._chatService.openConfigProfile();
				}
			},
			deleteTitle: localize('knox.deleteModel', "Delete model"),
			configureTitle: localize('knox.configureModel', "Configure model"),
		});
	}

	private _pickReasoning(): void {
		if (this._chatService.isStreaming) {
			return;
		}
		const config = knoxGetReasoningEffortConfig(this._chatService.defaultModel);
		if (!config) {
			return;
		}
		const current = this._chatService.reasoningEffort;
		this._reasoningList.toggle(this._reasoning, config.allowed.map(level => ({
			id: level,
			label: reasoningEffortLabel(level),
			selected: level === current,
		})), {
			onSelect: id => this._chatService.setReasoningEffort(id),
		});
	}

	private _toolbarInput() {
		return {
			mode: this._chatService.mode,
			isStreaming: this._chatService.isStreaming,
			history: this._chatService.history,
			codeToEdit: this._chatService.codeToEdit,
			editStatus: this._chatService.editStatus,
			runningJobs: this._chatService.runningJobCount,
			disabled: this._chatService.isStreaming,
		};
	}

	private _render(): void {
		this._hoverStore.clear();
		const model = this._chatService.defaultModel;
		const streaming = this._chatService.isStreaming;
		const supportsImages = knoxModelSupportsImages(model);
		const supportsWebSearch = knoxModelSupportsWebSearch(model);
		const reasoning = knoxGetReasoningEffortConfig(model);
		const primary = knoxToolbarPrimaryState(this._toolbarInput());

		this._image.classList.toggle('hidden', !supportsImages);
		this._hover(this._image, localize('knox.attachImage', "Attach image"));

		this._hover(this._mention, localize('knox.addContext', "Add context"));

		const modelTitle = knoxModelSelectTitle(model) || localize('knox.selectModel', "Select Model");
		this._modelLabel.textContent = modelTitle;
		this._model.setAttribute('aria-label', modelTitle);
		this._hover(this._model, modelTitle);

		this._reasoning.classList.toggle('hidden', !reasoning);
		this._reasoning.disabled = streaming;
		if (reasoning) {
			const effort = this._chatService.reasoningEffort ?? reasoning.default;
			this._reasoningLabel.textContent = reasoningEffortLabel(effort);
			const tooltip = localize('knox.reasoningEffortTooltip', "Reasoning effort");
			this._reasoning.setAttribute('aria-label', tooltip);
			this._hover(this._reasoning, tooltip);
		}

		this._webSearch.classList.toggle('hidden', !supportsWebSearch);
		this._webSearch.disabled = streaming || !supportsWebSearch;
		this._webSearch.classList.toggle('active', this._chatService.webSearchEnabled);
		this._webSearch.setAttribute('aria-pressed', String(this._chatService.webSearchEnabled));
		const webSearchHint = this._chatService.webSearchEnabled
			? localize('knox.webSearchTooltipActive', "Click to disable web search")
			: localize('knox.webSearchTooltipInactive', "Enable web search for this model");
		this._webSearch.setAttribute('aria-label', webSearchHint);
		this._hover(this._webSearch, webSearchHint);

		this._scroll.classList.toggle('hidden', !this._scrollState.showScrollButtons);
		this._scrollUp.disabled = this._scrollState.isAtTop;
		this._scrollDown.disabled = this._scrollState.isAtBottom;
		this._hover(this._scrollUp, localize('knox.scrollToTop', "Scroll to top"));
		this._hover(this._scrollDown, localize('knox.scrollToBottom', "Scroll to bottom"));

		const editing = this._chatService.mode === 'edit';
		this._exitEdit.classList.toggle('hidden', !editing);
		this._hover(this._exitEdit, localize('knox.exitEdit', "Esc Exit Edit"));

		this._send.classList.toggle('cancel', primary.canCancel);
		this._send.disabled = !primary.enabled;
		setKnoxGuiIcon(this._sendIcon, primary.canCancel ? 'cancel' : 'send');
		this._sendLabel.textContent = primaryLabel(primary.kind);
		const sendHint = primary.canCancel
			? localize('knox.cancelGeneration', "Cancel current generation")
			: localize('knox.sendMessage', "Send message");
		this._send.setAttribute('aria-label', sendHint);
		this._hover(this._send, sendHint);
		this._onDidChangeHeight.fire();
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

function primaryLabel(kind: KnoxToolbarPrimaryKind): string {
	switch (kind) {
		case 'cancel': return '';
		case 'edit': return localize('knox.edit', "Edit");
		case 'retry': return localize('knox.retry', "Retry");
		default: return localize('knox.send', "Send");
	}
}

function reasoningEffortLabel(level: string): string {
	switch (level) {
		case 'none': return localize('knox.reasoningEffortLevelNone', "None");
		case 'minimal': return localize('knox.reasoningEffortLevelMinimal', "Minimal");
		case 'low': return localize('knox.reasoningEffortLevelLow', "Low");
		case 'medium': return localize('knox.reasoningEffortLevelMedium', "Medium");
		case 'high': return localize('knox.reasoningEffortLevelHigh', "High");
		case 'xhigh': return localize('knox.reasoningEffortLevelXHigh', "X-High");
		case 'max': return localize('knox.reasoningEffortLevelMax', "Max");
		default: return level;
	}
}
