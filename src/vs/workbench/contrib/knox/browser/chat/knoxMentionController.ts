/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from '../../../../../base/common/async.js';
import { MarkdownString } from '../../../../../base/common/htmlContent.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { basename, relativePath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';
import { EditOperation } from '../../../../../editor/common/core/editOperation.js';
import { Position } from '../../../../../editor/common/core/position.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { IEditorDecorationsCollection } from '../../../../../editor/common/editorCommon.js';
import {
	CompletionItem,
	CompletionItemKind,
	CompletionList,
} from '../../../../../editor/common/languages.js';
import { IModelDeltaDecoration, ITextModel, TrackedRangeStickiness } from '../../../../../editor/common/model.js';
import { ILanguageFeaturesService } from '../../../../../editor/common/services/languageFeatures.js';
import { SuggestController } from '../../../../../editor/contrib/suggest/browser/suggestController.js';
import { localize } from '../../../../../nls.js';
import { CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { EditorResourceAccessor, EditorsOrder, SideBySideEditor } from '../../../../common/editor.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IKnoxChatService } from '../../common/knoxChatService.js';
import { IKnoxContextProviderDescription } from '../../common/knoxChatTypes.js';
import { IKnoxGuiBridge } from '../../common/knoxGuiProtocol.js';
import { KNOX_INPUT_SCHEME } from '../../common/knoxInput.js';
import {
	KNOX_MENTION_ACCEPT_CHIP_COMMAND_ID,
	KNOX_MENTION_ENTER_SUBMENU_COMMAND_ID,
	KNOX_MENTION_NEW_PROMPT_FILE_COMMAND_ID,
	KNOX_MENTION_QUERY_PROVIDER_COMMAND_ID,
	IKnoxMentionChip,
	IKnoxMentionItem,
	attachMentionSubActions,
	buildTopLevelMentionItems,
	createKnoxDebouncedLiveFileSearch,
	getMentionOpenUri,
	groupMentionItems,
	isOpenableMentionRow,
	knoxFlattenMentionSections,
	knoxLoadingMentionItem,
	knoxMentionChipFromItem,
	knoxMentionInsertText,
	knoxMentionTriggerAt,
	knoxNewPromptFileItem,
	knoxSelectableMentionItems,
	knoxSubmenuHits,
	liveSubmenuItemToMention,
	mentionChipLabel,
	mentionChipTooltip,
	mergeMatchingLiveMentionItems,
	shouldLiveSearchMentions,
	shouldOfferNewPromptFile,
	submenuItemToMention,
} from '../../common/knoxMentions.js';
import { knoxEditContextProviders } from '../../common/knoxEditMode.js';
import { knoxGuiIconClasses, knoxNamedIconOr } from '../knoxGuiIcons.js';

const controllers = new Map<string, KnoxMentionController>();
let commandsRegistered = false;

function registerMentionCommands(): void {
	if (commandsRegistered) {
		return;
	}
	commandsRegistered = true;

	CommandsRegistry.registerCommand(KNOX_MENTION_ENTER_SUBMENU_COMMAND_ID, (_accessor, uri: string, providerId: string, title?: string) => {
		controllers.get(uri)?.enterSubmenu(providerId, title);
	});
	CommandsRegistry.registerCommand(KNOX_MENTION_NEW_PROMPT_FILE_COMMAND_ID, (_accessor, uri: string) => {
		void controllers.get(uri)?.createPromptFile();
	});
	CommandsRegistry.registerCommand(KNOX_MENTION_ACCEPT_CHIP_COMMAND_ID, (_accessor, uri: string, chip: IKnoxMentionChip) => {
		controllers.get(uri)?.acceptChip(chip);
	});
	CommandsRegistry.registerCommand(KNOX_MENTION_QUERY_PROVIDER_COMMAND_ID, (_accessor, uri: string, item: IKnoxMentionItem) => {
		void controllers.get(uri)?.promptForQuery(item);
	});
}

function protocolContent(result: unknown): unknown {
	if (result && typeof result === 'object' && 'content' in result) {
		return (result as { content?: unknown }).content;
	}
	return result;
}

function protocolArray(result: unknown): unknown[] {
	const content = protocolContent(result);
	return Array.isArray(content) ? content : [];
}

function isSubmenuRow(value: unknown): value is { id: string; title: string; description: string; icon?: string; metadata?: { truncated?: boolean } } {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const row = value as { id?: unknown; title?: unknown; description?: unknown };
	return typeof row.id === 'string' && typeof row.title === 'string' && typeof row.description === 'string';
}

function mentionKind(item: IKnoxMentionItem): CompletionItemKind {
	if (item.type === 'folder' || item.icon === 'folder') {
		return CompletionItemKind.Folder;
	}
	if (item.type === 'file' || item.icon === 'file') {
		return CompletionItemKind.File;
	}
	if (item.type === 'contextProvider') {
		return CompletionItemKind.Color;
	}
	if (item.type === 'action') {
		return CompletionItemKind.Event;
	}
	return CompletionItemKind.Text;
}

/**
 * Monaco completion provider for `@` mentions in the native Knox input.
 * Ranking / grouping / live search stay in `knoxMentions.ts` (T4.3).
 */
export class KnoxMentionController extends Disposable {

	private readonly _editorId: string;
	private readonly _decorations: IEditorDecorationsCollection;
	private readonly _search: (query: string) => Promise<IKnoxMentionItem[]>;
	private readonly _reloadScheduler: RunOnceScheduler;

	private _providers: IKnoxContextProviderDescription[] = [];
	private _itemsByProvider: Record<string, IKnoxMentionItem[]> = {};
	private _openFiles: IKnoxMentionItem[] = [];
	private _fileIndexTruncated = false;
	private _loading = false;
	private _submenu: string | undefined;
	private _submenuTitle: string | undefined;
	private _retriggering = false;
	private _liveHits = new Map<string, IKnoxMentionItem[]>();
	private _liveQuery: string | undefined;
	private _chips: IKnoxMentionChip[] = [];

	constructor(
		private readonly _editor: ICodeEditor,
		@IKnoxChatService private readonly _chatService: IKnoxChatService,
		@IKnoxGuiBridge private readonly _bridge: IKnoxGuiBridge,
		@ILanguageFeaturesService languageFeaturesService: ILanguageFeaturesService,
		@IEditorService private readonly _editorService: IEditorService,
		@IWorkspaceContextService private readonly _workspaceService: IWorkspaceContextService,
		@IQuickInputService private readonly _quickInputService: IQuickInputService,
	) {
		super();
		registerMentionCommands();

		const model = this._editor.getModel();
		this._editorId = model?.uri.toString() ?? '';
		if (this._editorId) {
			controllers.set(this._editorId, this);
		}
		this._decorations = this._editor.createDecorationsCollection();
		this._search = createKnoxDebouncedLiveFileSearch(async (query, limit) => {
			const result = await this._bridge.request('context/searchFiles', { query, limit });
			return protocolArray(result).filter(isSubmenuRow).map(liveSubmenuItemToMention);
		});
		this._reloadScheduler = this._register(new RunOnceScheduler(() => void this._loadSubmenuItems(), 200));

		this._register(languageFeaturesService.completionProvider.register(
			{ scheme: KNOX_INPUT_SCHEME, hasAccessToAllModels: true },
			{
				_debugDisplayName: 'knoxMentions',
				triggerCharacters: ['@'],
				provideCompletionItems: (textModel, position, _context, _token) => this._provide(textModel, position),
			},
		));

		this._register(this._chatService.onDidChange(() => {
			const next = this._chatService.config?.contextProviders ?? [];
			if (this._providersChanged(next)) {
				this._providers = next;
				this._reloadScheduler.schedule();
			}
		}));
		this._register(this._bridge.onDidReceivePush(message => {
			if (message.messageType === 'refreshSubmenuItems') {
				this._reloadScheduler.schedule();
			}
		}));
		this._register(this._editorService.onDidEditorsChange(() => this._refreshOpenFiles()));
		this._register(this._editor.onDidChangeModelContent(() => this._refreshChipDecorations()));
		this._register(this._editor.onMouseDown(e => {
			if (this._openChipAt(e.target.range ?? null)) {
				e.event.preventDefault();
			}
		}));
		const suggest = SuggestController.get(this._editor);
		if (suggest) {
			this._register(suggest.model.onDidCancel(e => {
				if (!e.retrigger && !this._retriggering) {
					this._submenu = undefined;
					this._submenuTitle = undefined;
				}
			}));
		}

		this._providers = this._chatService.config?.contextProviders ?? [];
		this._refreshOpenFiles();
		if (this._providers.length) {
			void this._loadSubmenuItems();
		}
	}

	insertFileChip(filepath: string): void {
		const name = filepath.split(/[\\/]/).pop() || filepath;
		this._insertChipAtStart({
			title: name,
			description: filepath,
			id: filepath,
			type: 'file',
			label: name,
		});
	}

	getMentions(): IKnoxMentionChip[] {
		const text = this._editor.getModel()?.getValue() ?? '';
		return this._chips.filter(chip => text.includes(mentionChipLabel(chip)));
	}

	clearMentions(): void {
		this._chips = [];
		this._decorations.clear();
	}

	enterSubmenu(providerId: string, title?: string): void {
		this._submenu = providerId;
		this._submenuTitle = title ?? providerId;
		this._retrigger();
	}

	acceptChip(chip: IKnoxMentionChip): void {
		this._chips.push(chip);
		this._refreshChipDecorations();
	}

	async createPromptFile(): Promise<void> {
		this._submenu = undefined;
		this._submenuTitle = undefined;
		await this._bridge.post('config/newPromptFile', undefined);
	}

	async promptForQuery(item: IKnoxMentionItem): Promise<void> {
		const query = await this._quickInputService.input({
			title: item.title,
			prompt: item.title,
			placeHolder: item.description,
		});
		if (query === undefined) {
			return;
		}
		this._insertChip(item, query);
	}

	override dispose(): void {
		controllers.delete(this._editorId);
		super.dispose();
	}

	private async _provide(model: ITextModel, position: Position): Promise<CompletionList> {
		if (model.uri.scheme !== KNOX_INPUT_SCHEME) {
			return { suggestions: [] };
		}

		const offset = model.getOffsetAt(position);
		const trigger = knoxMentionTriggerAt(model.getValue(), offset);
		if (!trigger) {
			this._submenu = undefined;
			this._submenuTitle = undefined;
			return { suggestions: [] };
		}

		const query = trigger.query;
		const items = this._itemsForQuery(query);
		const liveKey = `${this._submenu ?? ''}::${query}`;
		let merged = items;
		const cachedLive = this._liveHits.get(liveKey);
		if (cachedLive) {
			merged = mergeMatchingLiveMentionItems(items, cachedLive, query);
		} else if (shouldLiveSearchMentions(query, items) && !this._submenu) {
			this._queueLiveSearch(query, liveKey);
		}

		const grouped = groupMentionItems(merged, { query, inSubmenu: this._submenu });
		const selectable = knoxSelectableMentionItems(knoxFlattenMentionSections(grouped));
		if (shouldOfferNewPromptFile(this._submenuTitle, this._submenu)) {
			selectable.push(knoxNewPromptFileItem());
		}

		if (!selectable.length && this._loading) {
			selectable.push(knoxLoadingMentionItem());
		}

		const atPosition = model.getPositionAt(trigger.at);
		const suggestions = selectable.map((item, index) => this._toCompletion(item, index, atPosition, position, query, selectable.length));
		return {
			suggestions,
			incomplete: true,
		};
	}

	private _itemsForQuery(query: string): IKnoxMentionItem[] {
		if (this._submenu) {
			return attachMentionSubActions(knoxSubmenuHits({
				query,
				submenu: this._submenu,
				itemsByProvider: this._itemsByProvider,
				openFiles: this._openFiles,
				truncated: this._fileIndexTruncated,
			}));
		}

		const submenuItems = knoxSubmenuHits({
			query,
			submenu: query.trim() ? undefined : 'file',
			itemsByProvider: this._itemsByProvider,
			openFiles: this._openFiles,
			truncated: this._fileIndexTruncated,
		});
		const providers = this._chatService.mode === 'edit'
			? knoxEditContextProviders(this._providers)
			: this._providers;
		return attachMentionSubActions(buildTopLevelMentionItems({
			query,
			providers,
			submenuItems,
		}));
	}

	private _toCompletion(
		item: IKnoxMentionItem,
		index: number,
		atPosition: Position,
		position: Position,
		query: string,
		total: number,
	): CompletionItem {
		const commandArgs = this._commandArgs(item);
		const keepsAt = item.actionId === 'enterSubmenu' || item.actionId === 'queryProvider' || item.type === 'action';
		const range = keepsAt
			? Range.fromPositions(new Position(atPosition.lineNumber, atPosition.column + 1), position)
			: Range.fromPositions(atPosition, position);
		const replaceText = this._editor.getModel()?.getValueInRange(range) ?? query;
		const label = item.description && isOpenableMentionRow(item)
			? { label: item.title, description: item.description }
			: item.title;

		const extraIcon = item.type === 'file' || item.type === 'folder' || item.icon === 'file' || item.icon === 'folder'
			? undefined
			: knoxGuiIconClasses(knoxNamedIconOr(
				item.icon || item.id,
				item.type === 'action' ? 'add' : item.type === 'slashCommand' ? 'message-square' : 'at',
			));
		return {
			label,
			kind: mentionKind(item),
			detail: item.description,
			insertText: knoxMentionInsertText(item),
			filterText: replaceText || '@',
			sortText: index.toString().padStart(4, '0'),
			range,
			preselect: index === 0,
			commitCharacters: total === 1 ? [' '] : undefined,
			command: commandArgs,
			extraIconClasses: extraIcon,
		};
	}

	private _commandArgs(item: IKnoxMentionItem): CompletionItem['command'] {
		if (item.actionId === 'enterSubmenu' && item.id) {
			const title = item.id === 'file' ? localize('knox.mention.files', "Files") : item.title;
			return {
				id: KNOX_MENTION_ENTER_SUBMENU_COMMAND_ID,
				title,
				arguments: [this._editorId, item.id, title],
			};
		}
		if (item.actionId === 'newPromptFile') {
			return {
				id: KNOX_MENTION_NEW_PROMPT_FILE_COMMAND_ID,
				title: item.title,
				arguments: [this._editorId],
			};
		}
		if (item.actionId === 'queryProvider') {
			return {
				id: KNOX_MENTION_QUERY_PROVIDER_COMMAND_ID,
				title: item.title,
				arguments: [this._editorId, item],
			};
		}
		if (item.type !== 'action') {
			return {
				id: KNOX_MENTION_ACCEPT_CHIP_COMMAND_ID,
				title: item.title,
				arguments: [this._editorId, knoxMentionChipFromItem(item)],
			};
		}
		return undefined;
	}

	private _queueLiveSearch(query: string, liveKey: string): void {
		if (this._liveQuery === liveKey) {
			return;
		}
		this._liveQuery = liveKey;
		void this._search(query).then(hits => {
			this._liveHits.set(liveKey, hits);
			if (this._liveQuery === liveKey) {
				this._retrigger();
			}
		}).catch(() => {
			this._liveHits.set(liveKey, []);
		});
	}

	private _retrigger(): void {
		this._retriggering = true;
		SuggestController.get(this._editor)?.triggerSuggest(undefined, true, true);
		this._retriggering = false;
	}

	private _insertChipAtStart(item: IKnoxMentionItem): void {
		const model = this._editor.getModel();
		if (!model) {
			return;
		}
		const text = knoxMentionInsertText(item);
		if (!text) {
			return;
		}
		this._editor.executeEdits('knox.mention.file', [EditOperation.insert(new Position(1, 1), text)]);
		this.acceptChip(knoxMentionChipFromItem(item));
		this._editor.focus();
	}

	private _insertChip(item: IKnoxMentionItem, query?: string): void {
		const model = this._editor.getModel();
		const position = this._editor.getPosition();
		if (!model || !position) {
			return;
		}
		const trigger = knoxMentionTriggerAt(model.getValue(), model.getOffsetAt(position));
		if (!trigger) {
			return;
		}
		const from = model.getPositionAt(trigger.at);
		const text = knoxMentionInsertText(item, query);
		this._editor.executeEdits('knox.mention.query', [EditOperation.replace(Range.fromPositions(from, position), text)]);
		this.acceptChip(knoxMentionChipFromItem(item, query));
		this._editor.focus();
	}

	private _refreshChipDecorations(): void {
		const model = this._editor.getModel();
		if (!model) {
			return;
		}
		const text = model.getValue();
		this._chips = this._chips.filter(chip => text.includes(mentionChipLabel(chip)));
		const decorations: IModelDeltaDecoration[] = [];
		let from = 0;
		for (const chip of this._chips) {
			const label = mentionChipLabel(chip);
			const idx = text.indexOf(label, from);
			if (idx < 0) {
				continue;
			}
			from = idx + label.length;
			const tooltip = mentionChipTooltip(chip);
			decorations.push({
				range: Range.fromPositions(model.getPositionAt(idx), model.getPositionAt(idx + label.length)),
				options: {
					description: 'knox-mention-chip',
					inlineClassName: 'knox-mention-chip',
					stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
					hoverMessage: tooltip ? new MarkdownString().appendText(tooltip) : undefined,
				},
			});
		}
		this._decorations.set(decorations);
	}

	private _openChipAt(range: Range | null): boolean {
		if (!range || !this._editor.getModel()) {
			return false;
		}
		const model = this._editor.getModel()!;
		const offset = model.getOffsetAt(range.getStartPosition());
		const text = model.getValue();
		let from = 0;
		for (const chip of this._chips) {
			const label = mentionChipLabel(chip);
			const idx = text.indexOf(label, from);
			if (idx < 0) {
				continue;
			}
			from = idx + label.length;
			if (offset >= idx && offset < idx + label.length) {
				const uri = getMentionOpenUri(chip);
				if (uri) {
					void this._editorService.openEditor({ resource: URI.parse(uri) });
					return true;
				}
				return false;
			}
		}
		return false;
	}

	private _refreshOpenFiles(): void {
		const seen = new Set<string>();
		const items: IKnoxMentionItem[] = [];
		for (const identifier of this._editorService.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE)) {
			const resource = EditorResourceAccessor.getOriginalUri(identifier.editor, { supportSideBySide: SideBySideEditor.PRIMARY });
			if (!resource || resource.scheme === KNOX_INPUT_SCHEME || seen.has(resource.toString())) {
				continue;
			}
			seen.add(resource.toString());
			const folder = this._workspaceService.getWorkspaceFolder(resource);
			const relative = (folder && relativePath(folder.uri, resource)) || basename(resource);
			items.push(submenuItemToMention({
				id: resource.toString(),
				title: basename(resource),
				description: relative,
				icon: 'file',
				providerTitle: 'file',
			}));
		}
		this._openFiles = items;
	}

	private _providersChanged(next: IKnoxContextProviderDescription[]): boolean {
		if (next.length !== this._providers.length) {
			return true;
		}
		return next.some((provider, index) => provider.title !== this._providers[index]?.title || provider.type !== this._providers[index]?.type);
	}

	private async _loadSubmenuItems(): Promise<void> {
		const submenuProviders = this._providers.filter(provider => provider.type === 'submenu');
		if (!submenuProviders.length) {
			this._loading = false;
			return;
		}
		this._loading = true;
		try {
			await Promise.all(submenuProviders.map(async provider => {
				const result = await this._bridge.request('context/loadSubmenuItems', { title: provider.title });
				const rows = protocolArray(result).filter(isSubmenuRow);
				this._itemsByProvider[provider.title] = rows.map(row => submenuItemToMention({
					...row,
					providerTitle: provider.title,
				}));
				if (provider.title === 'file') {
					this._fileIndexTruncated = rows.some(row => row.metadata?.truncated === true);
				}
			}));
		} finally {
			this._loading = false;
		}
	}
}
