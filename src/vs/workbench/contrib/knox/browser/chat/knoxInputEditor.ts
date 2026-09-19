/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append } from '../../../../../base/browser/dom.js';
import { IKeyboardEvent } from '../../../../../base/browser/keyboardEvent.js';
import { DEFAULT_FONT_FAMILY } from '../../../../../base/browser/fonts.js';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { IEditorConstructionOptions } from '../../../../../editor/browser/config/editorConfiguration.js';
import { EditorExtensionsRegistry } from '../../../../../editor/browser/editorExtensions.js';
import { CodeEditorWidget, ICodeEditorWidgetOptions } from '../../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { IEditorOptions } from '../../../../../editor/common/config/editorOptions.js';
import { EditOperation } from '../../../../../editor/common/core/editOperation.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { ContextMenuController } from '../../../../../editor/contrib/contextmenu/browser/contextmenu.js';
import { PlaceholderTextContribution } from '../../../../../editor/contrib/placeholderText/browser/placeholderTextContribution.js';
import { SnippetController2 } from '../../../../../editor/contrib/snippet/browser/snippetController2.js';
import { SuggestController } from '../../../../../editor/contrib/suggest/browser/suggestController.js';
import { localize } from '../../../../../nls.js';
import { IConfigurationService, ConfigurationTarget } from '../../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../../../platform/instantiation/common/serviceCollection.js';
import { MenuPreventer } from '../../../codeEditor/browser/menuPreventer.js';
import { SelectionClipboardContributionID } from '../../../codeEditor/browser/selectionClipboard.js';
import { getSimpleEditorOptions, setupSimpleEditorSelectionStyling } from '../../../codeEditor/browser/simpleEditorOptions.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IKnoxChatService } from '../../common/knoxChatService.js';
import { IKnoxGuiBridge } from '../../common/knoxGuiProtocol.js';
import { IKnoxImageAttachment } from '../../common/knoxImages.js';
import { IKnoxInputModifiers } from '../../common/knoxChatTypes.js';
import {
	KNOX_INPUT_LANGUAGE_ID,
	KNOX_INPUT_SCHEME,
	KNOX_INPUT_VERTICAL_PADDING,
	knoxInputContentHeight,
	knoxInputEditorFontOptions,
	knoxInputFontSize,
	knoxInputPlaceholder,
} from '../../common/knoxInput.js';
import {
	IKnoxInputHistoryState,
	KNOX_INPUT_HISTORY_STORAGE_KEY,
	knoxCreateInputHistory,
	knoxInputHistoryAdd,
	knoxInputHistoryNext,
	knoxInputHistoryPrev,
	knoxParseInputHistory,
	knoxSerializeInputHistory,
} from '../../common/knoxInputHistory.js';
import { knoxInputKeyAction, knoxUseActiveFile } from '../../common/knoxInputKeys.js';
import { knoxMentionTriggerInsert } from '../../common/knoxToolbar.js';
import { IKnoxMentionChip } from '../../common/knoxMentions.js';
import { IKnoxSlashChip } from '../../common/knoxSlash.js';
import { IKnoxCodeBlockContextItem } from '../../common/knoxResolveInput.js';
import { KnoxMentionController } from './knoxMentionController.js';
import { KnoxSlashController } from './knoxSlashController.js';
import { KnoxImageAttachments } from './knoxImageAttachments.js';
import { KnoxAddCodeToEditController } from './knoxAddCodeToEdit.js';

setupSimpleEditorSelectionStyling('.knox-input-editor');

/**
 * Native Knox chat input: monaco `CodeEditorWidget` (markdown, word wrap)
 * with T4.2 keys, `@` mentions (T4.3), `/` slash commands (T4.4), and image
 * paste / drop / picker (T4.5).
 */
export class KnoxInputEditor extends Disposable {

	readonly element: HTMLElement;
	readonly editor: CodeEditorWidget;

	private readonly _editorHost: HTMLElement;
	private readonly _model: ITextModel;
	private readonly _scopedContextKeyService: IContextKeyService;
	private _fontSize: number;
	private _placeholder = '';
	private _lastLayoutHeight = 0;
	private _lastLayoutWidth = 0;
	private _history: IKnoxInputHistoryState;

	private readonly _onDidChangeHeight = this._register(new Emitter<void>());
	readonly onDidChangeHeight = this._onDidChangeHeight.event;

	private readonly _onDidFocus = this._register(new Emitter<void>());
	readonly onDidFocus = this._onDidFocus.event;

	private readonly _onDidBlur = this._register(new Emitter<void>());
	readonly onDidBlur = this._onDidBlur.event;

	private readonly _onDidSubmit = this._register(new Emitter<IKnoxInputModifiers>());
	readonly onDidSubmit = this._onDidSubmit.event;

	private readonly _onDidCancelStream = this._register(new Emitter<void>());
	readonly onDidCancelStream = this._onDidCancelStream.event;

	private readonly _onDidEscape = this._register(new Emitter<void>());
	readonly onDidEscape = this._onDidEscape.event;

	private readonly _mentions: KnoxMentionController;
	private readonly _slash: KnoxSlashController;
	private readonly _images: KnoxImageAttachments;
	private _codeBlocks: IKnoxCodeBlockContextItem[] = [];

	constructor(
		parent: HTMLElement,
		overflowWidgetsDomNode: HTMLElement,
		@IKnoxChatService private readonly _chatService: IKnoxChatService,
		@IKnoxGuiBridge private readonly _bridge: IKnoxGuiBridge,
		@IInstantiationService instantiationService: IInstantiationService,
		@IModelService modelService: IModelService,
		@ILanguageService languageService: ILanguageService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IStorageService private readonly _storageService: IStorageService,
	) {
		super();

		this.element = append(parent, $('.knox-input-stack'));
		this._images = this._register(instantiationService.createInstance(KnoxImageAttachments, this.element));
		this._editorHost = append(this.element, $('.knox-input-editor'));
		this._fontSize = knoxInputFontSize(this._chatService.config?.ui);
		this._history = knoxCreateInputHistory(knoxParseInputHistory(
			this._storageService.get(KNOX_INPUT_HISTORY_STORAGE_KEY, StorageScope.PROFILE),
		));

		this._scopedContextKeyService = this._register(contextKeyService.createScoped(this._editorHost));
		const childServices = this._register(new DisposableStore());
		const childInstantiationService = instantiationService.createChild(
			new ServiceCollection([IContextKeyService, this._scopedContextKeyService]),
			childServices,
		);

		const uri = URI.from({ scheme: KNOX_INPUT_SCHEME, path: `/${generateUuid()}.md` });
		this._model = this._register(modelService.createModel(
			'',
			languageService.createById(KNOX_INPUT_LANGUAGE_ID),
			uri,
			true,
		));
		if (this._configurationService.getValue('editor.wordBasedSuggestions', { resource: uri }) !== 'off') {
			void this._configurationService.updateValue('editor.wordBasedSuggestions', 'off', { resource: uri }, ConfigurationTarget.MEMORY);
		}

		this.editor = this._register(childInstantiationService.createInstance(
			CodeEditorWidget,
			this._editorHost,
			this._constructionOptions(overflowWidgetsDomNode),
			this._widgetOptions(),
		));
		this.editor.setModel(this._model);
		this._mentions = this._register(childInstantiationService.createInstance(KnoxMentionController, this.editor));
		this._slash = this._register(childInstantiationService.createInstance(KnoxSlashController, this.editor));
		this._register(childInstantiationService.createInstance(KnoxAddCodeToEditController, this.editor));

		this._register(this.editor.onDidFocusEditorText(() => {
			this._editorHost.classList.add('synthetic-focus');
			this._onDidFocus.fire();
		}));
		this._register(this.editor.onDidBlurEditorText(() => {
			this._editorHost.classList.remove('synthetic-focus');
			this._onDidBlur.fire();
		}));
		this._register(this.editor.onDidContentSizeChange(e => {
			if (e.contentHeightChanged) {
				this._relayoutIfHeightChanged();
			}
		}));
		this._register(this.editor.onKeyDown(e => this._onKeyDown(e)));
		this._register(addDisposableListener(this.element, 'paste', e => void this._images.handlePaste(e), true));
		this._register(addDisposableListener(this.element, 'dragover', e => this._images.handleDragOver(e)));
		this._register(addDisposableListener(this.element, 'dragleave', () => this._images.handleDragLeave()));
		this._register(addDisposableListener(this.element, 'drop', e => void this._images.handleDrop(e)));
		this._register(this._images.onDidChange(() => this._onDidChangeHeight.fire()));
		this._register(this._bridge.onDidReceivePush(message => {
			if (message.messageType === 'addImageAttachment') {
				this._images.addFromProtocol(message.data);
				this.focus();
			}
		}));
		this._register(this._chatService.onDidChange(() => this._syncFromChat()));
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('editor.accessibilitySupport') || e.affectsConfiguration('editor.cursorBlinking')) {
				this.editor.updateOptions(this._runtimeOptions());
			}
		}));

		this._syncFromChat();
	}

	getValue(): string {
		return this._model.getValue();
	}

	setValue(value: string, cursor: 'start' | 'end' = 'end'): void {
		if (this._model.getValue() !== value) {
			this._mentions.clearMentions();
			this._slash.clearSlashCommands();
			this._model.setValue(value);
		}
		if (cursor === 'start') {
			this.editor.setPosition({ lineNumber: 1, column: 1 });
		} else {
			this._moveCursorToEnd();
		}
	}

	clear(): void {
		this._mentions.clearMentions();
		this._slash.clearSlashCommands();
		this._images.clear();
		this._codeBlocks = [];
		this.setValue('');
	}

	getMentions(): IKnoxMentionChip[] {
		return this._mentions.getMentions();
	}

	getCodeBlocks(): readonly IKnoxCodeBlockContextItem[] {
		return this._codeBlocks;
	}

	/**
	 * Attach a highlighted-code block to the input. Duplicates by filepath +
	 * contents are ignored, mirroring GUI `useWebviewListeners.ts` (prevent
	 * exact duplicate code blocks).
	 */
	insertCodeBlock(block: IKnoxCodeBlockContextItem): boolean {
		if (this._codeBlocks.some(existing =>
			existing.filepath === block.filepath && existing.content === block.content)) {
			return false;
		}
		this._codeBlocks = [...this._codeBlocks, block];
		this.focus();
		return true;
	}

	getSlashCommands(): IKnoxSlashChip[] {
		return this._slash.getSlashCommands();
	}

	getImages(): readonly IKnoxImageAttachment[] {
		return this._images.images;
	}

	pickImages(): Promise<void> {
		return this._images.pick();
	}

	insertMentionTrigger(): void {
		this.focus();
		const position = this.editor.getPosition();
		if (!position) {
			return;
		}
		const before = this._model.getValue().slice(0, this._model.getOffsetAt(position));
		const text = knoxMentionTriggerInsert(before);
		if (!text) {
			SuggestController.get(this.editor)?.triggerSuggest(undefined, true, true);
			return;
		}
		this.editor.executeEdits('knox.mention.trigger', [EditOperation.insert(position, text)]);
		SuggestController.get(this.editor)?.triggerSuggest(undefined, true, true);
	}

	appendText(text: string): void {
		if (!text) {
			return;
		}
		const current = this.getValue();
		const prefix = current && !current.endsWith('\n') && !current.endsWith(' ') ? ' ' : '';
		this.setValue(`${current}${prefix}${text}`);
		this.focus();
	}

	submit(modifiers?: IKnoxInputModifiers): void {
		this._onDidSubmit.fire(modifiers ?? {});
	}

	rememberHistory(value: string): void {
		this._history = knoxInputHistoryAdd(this._history, value);
		this._storageService.store(
			KNOX_INPUT_HISTORY_STORAGE_KEY,
			knoxSerializeInputHistory(this._history.entries),
			StorageScope.PROFILE,
			StorageTarget.MACHINE,
		);
	}

	focus(): void {
		this.editor.focus();
		this._editorHost.classList.add('synthetic-focus');
	}

	hasFocus(): boolean {
		return this.editor.hasTextFocus();
	}

	layout(): void {
		const width = this._editorHost.clientWidth;
		if (width <= 0) {
			return;
		}
		const height = knoxInputContentHeight(this.editor.getContentHeight(), this._fontSize);
		this._lastLayoutWidth = width;
		this._lastLayoutHeight = height;
		this._editorHost.style.height = `${height}px`;
		this.editor.layout({ width, height });
	}

	private _relayoutIfHeightChanged(): void {
		const height = knoxInputContentHeight(this.editor.getContentHeight(), this._fontSize);
		if (height === this._lastLayoutHeight && this._lastLayoutWidth === this._editorHost.clientWidth) {
			return;
		}
		this.layout();
		this._onDidChangeHeight.fire();
	}

	private _onKeyDown(e: IKeyboardEvent): void {
		const action = knoxInputKeyAction(e, {
			atStart: this._isAtStart(),
			atEnd: this._isAtEnd(),
			streaming: this._chatService.isStreaming,
			useActiveFile: knoxUseActiveFile(this._chatService.config?.experimental),
			suggestVisible: this._scopedContextKeyService.getContextKeyValue<boolean>('suggestWidgetVisible') === true,
		});
		switch (action.kind) {
			case 'submit':
				e.preventDefault();
				e.stopPropagation();
				this._onDidSubmit.fire({ noContext: action.noContext });
				return;
			case 'ignore':
				if (action.consume) {
					e.preventDefault();
					e.stopPropagation();
				}
				return;
			case 'newline':
				return;
			case 'cancelStream':
				this._onDidCancelStream.fire();
				if (action.consume) {
					e.preventDefault();
					e.stopPropagation();
				}
				return;
			case 'historyPrev': {
				const prev = knoxInputHistoryPrev(this._history, this.getValue());
				this._history = prev.state;
				if (prev.value !== undefined) {
					e.preventDefault();
					e.stopPropagation();
					this.setValue(prev.value, 'start');
				}
				return;
			}
			case 'historyNext': {
				const next = knoxInputHistoryNext(this._history);
				this._history = next.state;
				if (next.value !== undefined) {
					e.preventDefault();
					e.stopPropagation();
					this.setValue(next.value, 'end');
				}
				return;
			}
			case 'escape':
				e.preventDefault();
				e.stopPropagation();
				this._onDidEscape.fire();
				return;
		}
	}

	private _isAtStart(): boolean {
		const position = this.editor.getPosition();
		return !!position && position.lineNumber === 1 && position.column === 1;
	}

	private _isAtEnd(): boolean {
		const position = this.editor.getPosition();
		if (!position) {
			return false;
		}
		return position.lineNumber === this._model.getLineCount()
			&& position.column === this._model.getLineMaxColumn(position.lineNumber);
	}

	private _syncFromChat(): void {
		const font = knoxInputEditorFontOptions(this._chatService.config?.ui);
		const placeholder = knoxInputPlaceholder(this._chatService.history.length, this._chatService.mode);
		const fontChanged = font.fontSize !== this._fontSize;
		const placeholderChanged = placeholder !== this._placeholder;
		this._fontSize = font.fontSize;
		this._placeholder = placeholder;
		if (fontChanged || placeholderChanged) {
			this.editor.updateOptions({
				...font,
				placeholder,
				ariaLabel: localize('knox.input', "Knox chat input"),
			});
		}
		if (fontChanged) {
			this._relayoutIfHeightChanged();
		}
	}

	private _moveCursorToEnd(): void {
		const lineNumber = this._model.getLineCount();
		this.editor.setPosition({ lineNumber, column: this._model.getLineMaxColumn(lineNumber) });
	}

	private _constructionOptions(overflowWidgetsDomNode: HTMLElement): IEditorConstructionOptions {
		return {
			...getSimpleEditorOptions(this._configurationService),
			...this._runtimeOptions(),
			overflowWidgetsDomNode,
			padding: { top: KNOX_INPUT_VERTICAL_PADDING, bottom: KNOX_INPUT_VERTICAL_PADDING },
			acceptSuggestionOnEnter: 'on',
			quickSuggestions: false,
			renderWhitespace: 'none',
			scrollbar: {
				horizontal: 'hidden',
				vertical: 'hidden',
				alwaysConsumeMouseWheel: false,
			},
			wrappingIndent: 'none',
			wrappingStrategy: 'advanced',
			tabFocusMode: true,
			dragAndDrop: false,
			dropIntoEditor: { enabled: false },
			ariaLabel: localize('knox.input', "Knox chat input"),
		};
	}

	private _runtimeOptions(): IEditorOptions {
		const font = knoxInputEditorFontOptions(this._chatService.config?.ui);
		return {
			...font,
			fontFamily: DEFAULT_FONT_FAMILY,
			placeholder: knoxInputPlaceholder(this._chatService.history.length, this._chatService.mode),
			accessibilitySupport: this._configurationService.getValue<'auto' | 'off' | 'on'>('editor.accessibilitySupport'),
			cursorBlinking: this._configurationService.getValue<'blink' | 'smooth' | 'phase' | 'expand' | 'solid'>('editor.cursorBlinking'),
		};
	}

	private _widgetOptions(): ICodeEditorWidgetOptions {
		return {
			isSimpleWidget: true,
			contributions: EditorExtensionsRegistry.getSomeEditorContributions([
				MenuPreventer.ID,
				SelectionClipboardContributionID,
				ContextMenuController.ID,
				SuggestController.ID,
				SnippetController2.ID,
				PlaceholderTextContribution.ID,
			]),
		};
	}
}
