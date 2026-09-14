/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { knoxGuiIconClass, KnoxGuiIconName } from '../knoxGuiIcons.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { IMarkdownRendererService } from '../../../../../platform/markdown/browser/markdownRenderer.js';
import { EditorResourceAccessor, EditorsOrder, SideBySideEditor } from '../../../../common/editor.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IKnoxChatService } from '../../common/knoxChatService.js';
import {
	IKnoxCodeToEdit,
	knoxCodeToEditCardTitle,
	knoxCodeToEditHasRange,
	knoxCodeToEditItemLabel,
	knoxCodeToEditResource,
	knoxIsInEditMode,
	knoxRelativeEditPath,
} from '../../common/knoxEditMode.js';
import { IKnoxGuiBridge } from '../../common/knoxGuiProtocol.js';
import { KNOX_INPUT_SCHEME } from '../../common/knoxInput.js';
import { renderKnoxMarkdown } from './knoxMarkdown.js';

function protocolArray(result: unknown): unknown[] {
	const content = result && typeof result === 'object' && 'content' in result
		? (result as { content?: unknown }).content
		: result;
	return Array.isArray(content) ? content : [];
}

interface IFileHit {
	id: string;
	title: string;
	description?: string;
}

function isFileHit(value: unknown): value is IFileHit {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const row = value as { id?: unknown; title?: unknown };
	return typeof row.id === 'string' && typeof row.title === 'string';
}

/**
 * Native `CodeToEditCard`: file list, add/search, open, remove, snippet peek.
 */
export class KnoxCodeToEditCard extends Disposable {

	readonly element: HTMLElement;

	private readonly _title: HTMLElement;
	private readonly _list: HTMLElement;
	private readonly _empty: HTMLButtonElement;
	private readonly _itemStore = this._register(new DisposableStore());
	private readonly _expanded = new Set<string>();

	private readonly _onDidChangeHeight = this._register(new Emitter<void>());
	readonly onDidChangeHeight = this._onDidChangeHeight.event;

	constructor(
		parent: HTMLElement,
		@IKnoxChatService private readonly _chatService: IKnoxChatService,
		@IKnoxGuiBridge private readonly _bridge: IKnoxGuiBridge,
		@IQuickInputService private readonly _quickInput: IQuickInputService,
		@IFileService private readonly _fileService: IFileService,
		@IEditorService private readonly _editorService: IEditorService,
		@IWorkspaceContextService private readonly _workspaceService: IWorkspaceContextService,
		@IMarkdownRendererService private readonly _markdown: IMarkdownRendererService,
	) {
		super();
		this.element = append(parent, $('.knox-code-to-edit.hidden'));
		this.element.setAttribute('role', 'region');
		this.element.setAttribute('aria-label', localize('knox.editCode', "Edit Code"));

		const header = append(this.element, $('.knox-code-to-edit-header'));
		this._title = append(header, $('span.knox-code-to-edit-title'));
		const actions = append(header, $('.knox-code-to-edit-actions'));
		const add = this._headerButton(actions, 'add', localize('knox.addFile', "Add file"), () => void this.promptAddFiles());
		add.classList.add('knox-code-to-edit-add');
		this._headerButton(actions, 'lucide-chevron-down', localize('knox.addAllOpenFiles', "Add all open files"), () => void this._addOpenFiles());

		this._list = append(this.element, $('ul.knox-code-to-edit-list'));
		this._empty = append(this.element, $<HTMLButtonElement>('button.knox-code-to-edit-empty'));
		this._empty.type = 'button';
		this._empty.textContent = localize('knox.addFileToEdit', "Add File to Edit");

		this._register(addDisposableListener(this._empty, 'click', () => void this.promptAddFiles()));
		this._register(this._chatService.onDidChange(() => this.render()));
		this.render();
	}

	render(): void {
		const editing = knoxIsInEditMode(this._chatService.mode);
		this.element.classList.toggle('hidden', !editing);
		if (!editing) {
			this._onDidChangeHeight.fire();
			return;
		}
		const items = this._chatService.codeToEdit;
		this._title.textContent = knoxCodeToEditCardTitle(items.length);
		this._empty.classList.toggle('hidden', items.length > 0);
		this._list.classList.toggle('hidden', items.length === 0);
		this._itemStore.clear();
		clearNode(this._list);
		for (const code of items) {
			this._renderItem(code);
		}
		this._onDidChangeHeight.fire();
	}

	async promptAddFiles(): Promise<void> {
		const pick = this._quickInput.createQuickPick<IFileHit & { label: string }>();
		const store = new DisposableStore();
		store.add(pick);
		pick.placeholder = localize('knox.enterSearchFile', "Search files to edit");
		pick.matchOnDescription = true;
		pick.canSelectMany = true;
		pick.busy = true;
		const attached = new Set(this._chatService.codeToEdit.map(code => code.filepath));
		const load = async (query: string) => {
			pick.busy = true;
			const result = await this._bridge.request('context/searchFiles', { query, limit: 40 });
			pick.items = protocolArray(result).filter(isFileHit)
				.filter(hit => !attached.has(hit.id))
				.map(hit => ({ ...hit, label: hit.title, description: hit.description }));
			pick.busy = false;
		};
		await load('');
		store.add(pick.onDidChangeValue(() => void load(pick.value)));
		store.add(pick.onDidAccept(() => {
			const selected = pick.selectedItems.length ? pick.selectedItems : pick.activeItems;
			void this._addFilepaths(selected.map(item => item.id));
			pick.hide();
		}));
		store.add(pick.onDidHide(() => store.dispose()));
		pick.show();
	}

	private async _addOpenFiles(): Promise<void> {
		const paths: string[] = [];
		for (const identifier of this._editorService.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE)) {
			const resource = EditorResourceAccessor.getOriginalUri(identifier.editor, { supportSideBySide: SideBySideEditor.PRIMARY });
			if (!resource || resource.scheme === KNOX_INPUT_SCHEME) {
				continue;
			}
			paths.push(resource.toString());
		}
		await this._addFilepaths(paths);
	}

	private async _addFilepaths(filepaths: string[]): Promise<void> {
		const added: IKnoxCodeToEdit[] = [];
		for (const filepath of filepaths) {
			let contents = '';
			try {
				contents = (await this._fileService.readFile(knoxCodeToEditResource(filepath))).value.toString();
			} catch {
				// Empty contents still lets the user edit a new/unreadable path.
			}
			added.push({ filepath, contents });
		}
		if (added.length) {
			this._chatService.addCodeToEdit(added);
		}
	}

	private _renderItem(code: IKnoxCodeToEdit): void {
		const key = `${code.filepath}:${knoxCodeToEditHasRange(code) ? `${code.range.start.line}-${code.range.end.line}` : 'file'}`;
		const item = append(this._list, $('li.knox-code-to-edit-item'));
		const row = append(item, $('.knox-code-to-edit-row'));
		const label = knoxCodeToEditItemLabel(code);
		const name = append(row, $<HTMLButtonElement>('button.knox-code-to-edit-name'));
		name.type = 'button';
		name.textContent = label.title;
		const pathHint = append(row, $('span.knox-code-to-edit-path'));
		const dirs = this._workspaceDirs();
		pathHint.textContent = knoxRelativeEditPath(code.filepath, dirs);

		if (!label.isInsertion) {
			const expand = this._iconButton(
				row,
				this._expanded.has(key) ? 'lucide-chevron-down' : 'lucide-chevron-right',
				localize('knox.toggleCodeSnippet', "Toggle code"),
				() => {
					if (this._expanded.has(key)) {
						this._expanded.delete(key);
					} else {
						this._expanded.add(key);
					}
					this.render();
				},
			);
			expand.classList.add('knox-code-to-edit-expand');
		}
		this._iconButton(row, 'x', localize('knox.removeFile', "Remove"), () => this._chatService.removeCodeToEdit(code));

		this._itemStore.add(addDisposableListener(name, 'click', e => {
			e.preventDefault();
			e.stopPropagation();
			void this._open(code);
		}));

		if (this._expanded.has(key) && !label.isInsertion) {
			const preview = append(item, $('.knox-code-to-edit-preview.knox-markdown'));
			const lang = languageFromPath(code.filepath);
			renderKnoxMarkdown(preview, '```' + lang + '\n' + code.contents + '\n```', this._markdown, this._itemStore);
		}
	}

	private async _open(code: IKnoxCodeToEdit): Promise<void> {
		const resource = knoxCodeToEditResource(code.filepath);
		if (knoxCodeToEditHasRange(code)) {
			await this._editorService.openEditor({
				resource,
				options: {
					selection: {
						startLineNumber: code.range.start.line + 1,
						startColumn: Math.max(1, code.range.start.character + 1),
						endLineNumber: code.range.end.line + 1,
						endColumn: Math.max(1, code.range.end.character + 1),
					},
				},
			});
			return;
		}
		await this._editorService.openEditor({ resource });
	}

	private _workspaceDirs(): string[] {
		return this._workspaceService.getWorkspace().folders.map(folder => folder.uri.fsPath);
	}

	private _headerButton(parent: HTMLElement, icon: KnoxGuiIconName, label: string, onClick: () => void): HTMLButtonElement {
		const button = append(parent, $<HTMLButtonElement>('button.knox-icon-button'));
		button.type = 'button';
		button.title = label;
		button.setAttribute('aria-label', label);
		append(button, $('span')).className = knoxGuiIconClass(icon);
		this._register(addDisposableListener(button, 'click', e => {
			e.preventDefault();
			e.stopPropagation();
			onClick();
		}));
		return button;
	}

	private _iconButton(parent: HTMLElement, icon: KnoxGuiIconName, label: string, onClick: () => void): HTMLButtonElement {
		const button = append(parent, $<HTMLButtonElement>('button.knox-icon-button'));
		button.type = 'button';
		button.title = label;
		button.setAttribute('aria-label', label);
		append(button, $('span')).className = knoxGuiIconClass(icon);
		this._itemStore.add(addDisposableListener(button, 'click', e => {
			e.preventDefault();
			e.stopPropagation();
			onClick();
		}));
		return button;
	}
}

function languageFromPath(filepath: string): string {
	const match = filepath.toLowerCase().match(/\.([a-z0-9]+)$/);
	const ext = match?.[1];
	if (!ext || ext === 'md' || ext === 'markdown') {
		return 'text';
	}
	if (ext === 'ts' || ext === 'tsx') {
		return 'typescript';
	}
	if (ext === 'js' || ext === 'jsx' || ext === 'mjs' || ext === 'cjs') {
		return 'javascript';
	}
	if (ext === 'py') {
		return 'python';
	}
	return ext;
}
