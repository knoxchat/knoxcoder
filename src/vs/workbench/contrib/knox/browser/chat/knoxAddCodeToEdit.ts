/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';
import { EditOperation } from '../../../../../editor/common/core/editOperation.js';
import { Position } from '../../../../../editor/common/core/position.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { CompletionItem, CompletionItemKind, CompletionList } from '../../../../../editor/common/languages.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { ILanguageFeaturesService } from '../../../../../editor/common/services/languageFeatures.js';
import { localize } from '../../../../../nls.js';
import { CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IKnoxChatService } from '../../common/knoxChatService.js';
import { KNOX_ADD_CODE_TO_EDIT_COMMAND_ID, knoxCodeToEditResource, knoxHashTriggerAt } from '../../common/knoxEditMode.js';
import { IKnoxGuiBridge } from '../../common/knoxGuiProtocol.js';
import { KNOX_INPUT_SCHEME } from '../../common/knoxInput.js';

const controllers = new Map<string, KnoxAddCodeToEditController>();
let commandsRegistered = false;

function registerAddCodeToEditCommand(): void {
	if (commandsRegistered) {
		return;
	}
	commandsRegistered = true;
	CommandsRegistry.registerCommand(KNOX_ADD_CODE_TO_EDIT_COMMAND_ID, (_accessor, uri: string, filepath: string) => {
		void controllers.get(uri)?.accept(filepath);
	});
}

function protocolArray(result: unknown): unknown[] {
	const content = result && typeof result === 'object' && 'content' in result
		? (result as { content?: unknown }).content
		: result;
	return Array.isArray(content) ? content : [];
}

interface IFileHit {
	id: string;
	title: string;
	description: string;
}

function isFileHit(value: unknown): value is IFileHit {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const row = value as { id?: unknown; title?: unknown; description?: unknown };
	return typeof row.id === 'string' && typeof row.title === 'string';
}

/**
 * `#` file picker while `mode === 'edit'`. Replaces the `#query` and adds
 * the file to `codeToEdit` (GUI AddCodeToEdit).
 */
export class KnoxAddCodeToEditController extends Disposable {

	private readonly _editorId: string;

	constructor(
		private readonly _editor: ICodeEditor,
		@IKnoxChatService private readonly _chatService: IKnoxChatService,
		@IKnoxGuiBridge private readonly _bridge: IKnoxGuiBridge,
		@IFileService private readonly _fileService: IFileService,
		@ILanguageFeaturesService languageFeaturesService: ILanguageFeaturesService,
	) {
		super();
		registerAddCodeToEditCommand();
		const model = this._editor.getModel();
		this._editorId = model?.uri.toString() ?? '';
		if (this._editorId) {
			controllers.set(this._editorId, this);
		}
		this._register(languageFeaturesService.completionProvider.register(
			{ scheme: KNOX_INPUT_SCHEME, hasAccessToAllModels: true },
			{
				_debugDisplayName: 'knoxAddCodeToEdit',
				triggerCharacters: ['#'],
				provideCompletionItems: (textModel, position) => this._provide(textModel, position),
			},
		));
	}

	override dispose(): void {
		controllers.delete(this._editorId);
		super.dispose();
	}

	async accept(filepath: string): Promise<void> {
		const model = this._editor.getModel();
		const position = this._editor.getPosition();
		if (model && position) {
			const trigger = knoxHashTriggerAt(model.getValue(), model.getOffsetAt(position));
			if (trigger) {
				const from = model.getPositionAt(trigger.at);
				this._editor.executeEdits('knox.addCodeToEdit', [EditOperation.replace(Range.fromPositions(from, position), '')]);
			}
		}
		try {
			const resource = knoxCodeToEditResource(filepath);
			const contents = (await this._fileService.readFile(resource)).value.toString();
			this._chatService.addCodeToEdit({ filepath, contents });
		} catch {
			this._chatService.addCodeToEdit({ filepath, contents: '' });
		}
		this._editor.focus();
	}

	private async _provide(model: ITextModel, position: Position): Promise<CompletionList> {
		if (model.uri.scheme !== KNOX_INPUT_SCHEME || this._chatService.mode !== 'edit') {
			return { suggestions: [] };
		}
		const trigger = knoxHashTriggerAt(model.getValue(), model.getOffsetAt(position));
		if (!trigger) {
			return { suggestions: [] };
		}
		const attached = new Set(this._chatService.codeToEdit.map(code => code.filepath));
		const result = await this._bridge.request('context/searchFiles', {
			query: trigger.query,
			limit: 40,
		});
		const hits = protocolArray(result).filter(isFileHit).filter(hit => !attached.has(hit.id));
		const atPosition = model.getPositionAt(trigger.at);
		const suggestions: CompletionItem[] = hits.map((hit, index) => ({
			label: hit.title,
			kind: CompletionItemKind.File,
			detail: hit.description,
			insertText: '',
			filterText: `${hit.title} ${hit.description ?? ''}`,
			range: Range.fromPositions(atPosition, position),
			sortText: String(index).padStart(4, '0'),
			command: {
				id: KNOX_ADD_CODE_TO_EDIT_COMMAND_ID,
				title: localize('knox.addFileToEdit', "Add File to Edit"),
				arguments: [model.uri.toString(), hit.id],
			},
		}));
		if (!suggestions.length && !trigger.query) {
			suggestions.push({
				label: localize('knox.addFileToEdit', "Add File to Edit"),
				kind: CompletionItemKind.Text,
				insertText: '',
				range: Range.fromPositions(atPosition, position),
				detail: localize('knox.editHashHint', "Type a file name"),
			});
		}
		return { suggestions };
	}
}
