/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { getDefaultHoverDelegate } from '../../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { knoxGuiIconClass, KnoxGuiIconName } from '../knoxGuiIcons.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IKnoxChatService } from '../../common/knoxChatService.js';
import { IKnoxSlashCommand } from '../../common/knoxChatTypes.js';
import { IKnoxPromptDraft, knoxIsCommandBookmarked, knoxPromptFormIsValid, knoxSortSlashCommandsByBookmark } from '../../common/knoxPrompts.js';

export class KnoxLumpPromptsSection extends Disposable {

	readonly element: HTMLElement;

	private readonly _list: HTMLElement;
	private readonly _form: HTMLElement;
	private readonly _add: HTMLButtonElement;
	private readonly _itemStore = this._register(new DisposableStore());
	private readonly _formStore = this._register(new DisposableStore());
	private _editing: IKnoxPromptDraft | undefined;

	constructor(
		parent: HTMLElement,
		@IKnoxChatService private readonly _chatService: IKnoxChatService,
		@IHoverService private readonly _hoverService: IHoverService,
	) {
		super();
		this.element = append(parent, $('.knox-lump-prompts'));
		this._form = append(this.element, $('.knox-lump-prompt-form.hidden'));
		this._list = append(this.element, $('.knox-lump-prompt-list'));
		this._add = append(this.element, $<HTMLButtonElement>('button.knox-lump-open-config'));
		this._add.type = 'button';
		append(this._add, $('span')).className = knoxGuiIconClass('add');
		append(this._add, $('span')).textContent = localize('knox.addPrompt', "Add Prompt");
		this._register(addDisposableListener(this._add, 'click', () => this._openForm()));
		this.refresh();
	}

	refresh(): void {
		if (this._editing) {
			return;
		}
		this._itemStore.clear();
		clearNode(this._list);
		const commands = this._chatService.config?.slashCommands ?? [];
		const bookmarks = this._chatService.slashBookmarks();
		for (const command of knoxSortSlashCommandsByBookmark(commands, bookmarks)) {
			this._renderRow(command, knoxIsCommandBookmarked(bookmarks, command.name));
		}
	}

	private _renderRow(command: IKnoxSlashCommand, bookmarked: boolean): void {
		const row = append(this._list, $('.knox-lump-prompt-row'));
		const text = append(row, $('.knox-lump-prompt-text'));
		append(text, $('span.knox-lump-prompt-name')).textContent = command.name;
		if (command.description) {
			append(text, $('span.knox-lump-prompt-description')).textContent = command.description;
		}
		const actions = append(row, $('.knox-lump-prompt-actions'));
		const edit = iconButton(actions, 'pencil-square', localize('knox.edit', "Edit"));
		this._itemStore.add(this._hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), edit, localize('knox.edit', "Edit")));
		this._itemStore.add(addDisposableListener(edit, 'click', () => this._openForm({
			name: command.name,
			description: command.description ?? '',
			prompt: command.prompt ?? '',
		})));
		const bookmark = iconButton(
			actions,
			bookmarked ? 'bookmark' : 'bookmark',
			localize('knox.bookmark', "Bookmark"),
		);
		bookmark.classList.toggle('knox-lump-bookmarked', bookmarked);
		this._itemStore.add(this._hoverService.setupManagedHover(
			getDefaultHoverDelegate('mouse'),
			bookmark,
			localize('knox.bookmark', "Bookmark"),
		));
		this._itemStore.add(addDisposableListener(bookmark, 'click', () => this._chatService.toggleSlashBookmark(command.name)));
	}

	private _openForm(existing?: IKnoxPromptDraft): void {
		this._editing = existing ?? { name: '', description: '', prompt: '' };
		this._add.classList.add('hidden');
		this._list.classList.add('hidden');
		this._form.classList.remove('hidden');
		this._renderForm(this._editing, !!existing);
	}

	private _closeForm(): void {
		this._editing = undefined;
		this._formStore.clear();
		this._form.classList.add('hidden');
		this._add.classList.remove('hidden');
		this._list.classList.remove('hidden');
		clearNode(this._form);
		this.refresh();
	}

	private _renderForm(draft: IKnoxPromptDraft, editing: boolean): void {
		this._formStore.clear();
		clearNode(this._form);
		append(this._form, $('div.knox-lump-policy-title')).textContent = editing
			? localize('knox.editPrompt', "Edit Prompt")
			: localize('knox.addPrompt', "Add Prompt");
		append(this._form, $('p.knox-lump-policy-help')).textContent = localize(
			'knox.promptsCanBeUsed',
			"Prompts can be quickly used by entering slash commands in the chat input box.",
		);

		const name = labeledInput(this._form, localize('knox.commandName', "Command Name"), '/command-name', draft.name);
		const description = labeledInput(this._form, localize('knox.description', "Description"), localize('knox.description', "Description"), draft.description);
		const promptLabel = append(this._form, $('label.knox-lump-field-label'));
		promptLabel.textContent = localize('knox.promptContent', "Prompt Content");
		const prompt = append(this._form, $<HTMLTextAreaElement>('textarea.knox-lump-textarea.knox-lump-prompt-body'));
		prompt.value = draft.prompt;
		prompt.placeholder = localize('knox.promptPlaceholder', "Please read the highlighted code and check for any errors.");
		prompt.spellcheck = false;

		const actions = append(this._form, $('.knox-lump-form-actions'));
		const cancel = append(actions, $<HTMLButtonElement>('button.knox-lump-form-button'));
		cancel.type = 'button';
		cancel.textContent = localize('knox.cancel', "Cancel");
		this._formStore.add(addDisposableListener(cancel, 'click', () => this._closeForm()));
		const submit = append(actions, $<HTMLButtonElement>('button.knox-lump-form-button.primary'));
		submit.type = 'button';
		submit.textContent = editing ? localize('knox.update', "Update") : localize('knox.add', "Add");
		const syncEnabled = () => {
			submit.disabled = !knoxPromptFormIsValid({
				name: name.value,
				description: description.value,
				prompt: prompt.value,
			});
		};
		syncEnabled();
		this._formStore.add(addDisposableListener(name, 'input', syncEnabled));
		this._formStore.add(addDisposableListener(description, 'input', syncEnabled));
		this._formStore.add(addDisposableListener(prompt, 'input', syncEnabled));
		this._formStore.add(addDisposableListener(submit, 'click', () => {
			this._chatService.addPrompt({
				name: name.value,
				description: description.value,
				prompt: prompt.value,
			});
			this._closeForm();
		}));
		setTimeout(() => name.focus(), 0);
	}
}

function labeledInput(parent: HTMLElement, label: string, placeholder: string, value: string): HTMLInputElement {
	append(parent, $('label.knox-lump-field-label')).textContent = label;
	const input = append(parent, $<HTMLInputElement>('input.knox-lump-input'));
	input.type = 'text';
	input.placeholder = placeholder;
	input.value = value;
	return input;
}

function iconButton(parent: HTMLElement, icon: KnoxGuiIconName, label: string): HTMLButtonElement {
	const button = append(parent, $<HTMLButtonElement>('button.knox-icon-button'));
	button.type = 'button';
	button.setAttribute('aria-label', label);
	append(button, $('span')).className = knoxGuiIconClass(icon);
	return button;
}
