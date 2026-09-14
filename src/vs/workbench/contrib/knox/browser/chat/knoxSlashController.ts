/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MarkdownString } from '../../../../../base/common/htmlContent.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';
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
import { localize } from '../../../../../nls.js';
import { knoxGuiIconClasses, knoxNamedIconOr } from '../knoxGuiIcons.js';
import { CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IKnoxChatService } from '../../common/knoxChatService.js';
import { KNOX_INPUT_SCHEME } from '../../common/knoxInput.js';
import {
	IKnoxSlashChip,
	IKnoxSlashItem,
	KNOX_RECENT_SLASH_STORAGE_KEY,
	KNOX_SLASH_ACCEPT_CHIP_COMMAND_ID,
	KnoxSlashSectionId,
	knoxParseRecentSlashCommands,
	knoxRecentSlashStorageKey,
	knoxRecordRecentSlash,
	knoxSlashChipFromItem,
	knoxSlashChipLabel,
	knoxSlashInsertText,
	knoxSlashTriggerAt,
	knoxSuggestSlashItems,
} from '../../common/knoxSlash.js';

const controllers = new Map<string, KnoxSlashController>();
let commandsRegistered = false;

function registerSlashCommands(): void {
	if (commandsRegistered) {
		return;
	}
	commandsRegistered = true;
	CommandsRegistry.registerCommand(KNOX_SLASH_ACCEPT_CHIP_COMMAND_ID, (_accessor, uri: string, chip: IKnoxSlashChip) => {
		controllers.get(uri)?.acceptChip(chip);
	});
}

function slashKind(item: IKnoxSlashItem): CompletionItemKind {
	if (item.metadata.bookmarked) {
		return CompletionItemKind.Event;
	}
	if (item.metadata.recent) {
		return CompletionItemKind.Reference;
	}
	return item.metadata.slashSource === 'prompt' ? CompletionItemKind.Snippet : CompletionItemKind.Method;
}

function slashSectionLabel(id: KnoxSlashSectionId): string {
	switch (id) {
		case 'bookmarked':
			return localize('knox.slash.bookmarked', "Bookmarked");
		case 'recent':
			return localize('knox.slash.recent', "Recent");
		case 'prompts':
			return localize('knox.slash.prompts', "Prompts");
		case 'commands':
		default:
			return localize('knox.slash.commands', "Commands");
	}
}

/**
 * Monaco completion provider for `/` slash commands in the native Knox input.
 * Ranking / grouping / bookmarks / recents stay in `knoxSlash.ts` (T4.4).
 */
export class KnoxSlashController extends Disposable {

	private readonly _editorId: string;
	private readonly _decorations: IEditorDecorationsCollection;
	private _chips: IKnoxSlashChip[] = [];

	constructor(
		private readonly _editor: ICodeEditor,
		@IKnoxChatService private readonly _chatService: IKnoxChatService,
		@ILanguageFeaturesService languageFeaturesService: ILanguageFeaturesService,
		@IStorageService private readonly _storageService: IStorageService,
	) {
		super();
		registerSlashCommands();

		const model = this._editor.getModel();
		this._editorId = model?.uri.toString() ?? '';
		if (this._editorId) {
			controllers.set(this._editorId, this);
		}
		this._decorations = this._editor.createDecorationsCollection();

		this._register(languageFeaturesService.completionProvider.register(
			{ scheme: KNOX_INPUT_SCHEME, hasAccessToAllModels: true },
			{
				_debugDisplayName: 'knoxSlash',
				triggerCharacters: ['/'],
				provideCompletionItems: (textModel, position, _context, _token) => this._provide(textModel, position),
			},
		));
		this._register(this._editor.onDidChangeModelContent(() => this._refreshChipDecorations()));
	}

	getSlashCommands(): IKnoxSlashChip[] {
		const text = this._editor.getModel()?.getValue() ?? '';
		return this._chips.filter(chip => text.includes(knoxSlashChipLabel(chip)));
	}

	clearSlashCommands(): void {
		this._chips = [];
		this._decorations.clear();
	}

	acceptChip(chip: IKnoxSlashChip): void {
		this._chips.push(chip);
		const recents = knoxRecordRecentSlash(
			knoxParseRecentSlashCommands(this._storageService.get(knoxRecentSlashStorageKey(this._chatService.profileId), StorageScope.PROFILE)
				?? this._storageService.get(KNOX_RECENT_SLASH_STORAGE_KEY, StorageScope.PROFILE)),
			chip.id,
		);
		this._storageService.store(
			knoxRecentSlashStorageKey(this._chatService.profileId),
			JSON.stringify(recents),
			StorageScope.PROFILE,
			StorageTarget.MACHINE,
		);
		this._refreshChipDecorations();
	}

	override dispose(): void {
		controllers.delete(this._editorId);
		super.dispose();
	}

	private _provide(model: ITextModel, position: Position): CompletionList {
		if (model.uri.scheme !== KNOX_INPUT_SCHEME || this._chatService.mode === 'edit') {
			return { suggestions: [] };
		}

		const offset = model.getOffsetAt(position);
		const trigger = knoxSlashTriggerAt(model.getValue(), offset);
		if (!trigger) {
			return { suggestions: [] };
		}

		const commands = this._chatService.config?.slashCommands ?? [];
		const suggested = knoxSuggestSlashItems({
			commands,
			bookmarks: this._bookmarks(),
			recents: knoxParseRecentSlashCommands(
				this._storageService.get(knoxRecentSlashStorageKey(this._chatService.profileId), StorageScope.PROFILE)
				?? this._storageService.get(KNOX_RECENT_SLASH_STORAGE_KEY, StorageScope.PROFILE),
			),
			query: trigger.query,
		});
		const atPosition = model.getPositionAt(trigger.at);
		const suggestions = suggested.items.map((item, index) => {
			const section = suggested.showHeaders
				? suggested.sections.find(row => row.items.includes(item))
				: undefined;
			return this._toCompletion(item, index, atPosition, position, trigger.query, suggested.items.length, section?.id);
		});
		return {
			suggestions,
			incomplete: true,
		};
	}

	private _toCompletion(
		item: IKnoxSlashItem,
		index: number,
		atPosition: Position,
		position: Position,
		query: string,
		total: number,
		sectionId?: KnoxSlashSectionId,
	): CompletionItem {
		const range = Range.fromPositions(atPosition, position);
		const replaceText = this._editor.getModel()?.getValueInRange(range) ?? `/${query}`;
		return {
			label: {
				label: item.title,
				description: item.description || undefined,
			},
			kind: slashKind(item),
			detail: sectionId ? slashSectionLabel(sectionId) : undefined,
			insertText: knoxSlashInsertText(item),
			filterText: replaceText || '/',
			sortText: index.toString().padStart(4, '0'),
			range,
			preselect: index === 0,
			commitCharacters: total === 1 ? [' '] : undefined,
			command: {
				id: KNOX_SLASH_ACCEPT_CHIP_COMMAND_ID,
				title: item.title,
				arguments: [this._editorId, knoxSlashChipFromItem(item)],
			},
			extraIconClasses: knoxGuiIconClasses(knoxNamedIconOr(item.icon || item.id, 'message-square')),
		};
	}

	private _bookmarks(): string[] {
		return this._chatService.slashBookmarks();
	}

	private _refreshChipDecorations(): void {
		const model = this._editor.getModel();
		if (!model) {
			return;
		}
		const text = model.getValue();
		this._chips = this._chips.filter(chip => text.includes(knoxSlashChipLabel(chip)));
		const decorations: IModelDeltaDecoration[] = [];
		let from = 0;
		for (const chip of this._chips) {
			const label = knoxSlashChipLabel(chip);
			const idx = text.indexOf(label, from);
			if (idx < 0) {
				continue;
			}
			from = idx + label.length;
			decorations.push({
				range: Range.fromPositions(model.getPositionAt(idx), model.getPositionAt(idx + label.length)),
				options: {
					description: 'knox-slash-chip',
					inlineClassName: 'knox-mention-chip knox-slash-chip',
					stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
					hoverMessage: chip.description ? new MarkdownString().appendText(chip.description) : undefined,
				},
			});
		}
		this._decorations.set(decorations);
	}
}
