/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode, getWindow } from '../../../../../base/browser/dom.js';
import { AriaRole } from '../../../../../base/browser/ui/aria/aria.js';
import { IListRenderer, IListVirtualDelegate } from '../../../../../base/browser/ui/list/list.js';
import { IListAccessibilityProvider } from '../../../../../base/browser/ui/list/listWidget.js';
import { getDefaultHoverDelegate } from '../../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { knoxGuiIconClass } from '../knoxGuiIcons.js';
import { IClipboardService } from '../../../../../platform/clipboard/common/clipboardService.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { WorkbenchList } from '../../../../../platform/list/browser/listService.js';
import { IMarkdownRendererService } from '../../../../../platform/markdown/browser/markdownRenderer.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { URI } from '../../../../../base/common/uri.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { ITerminalService } from '../../../terminal/browser/terminal.js';
import {
	IKnoxAgentActivityStep,
	knoxActivityAnchorId,
} from '../../common/knoxAgentActivity.js';
import { IKnoxChatService } from '../../common/knoxChatService.js';
import {
	IKnoxChatHistoryItem,
	knoxAssistantReplyText,
	knoxHistoryItemPreview,
	knoxMessageImageUrls,
	renderKnoxChatMessage,
} from '../../common/knoxChatTypes.js';
import { IKnoxGuiBridge } from '../../common/knoxGuiProtocol.js';
import {
	IKnoxThreadScrollState,
	knoxResetScrollState,
	knoxScrollStateFromMetrics,
} from '../../common/knoxThreadScroll.js';
import {
	buildKnoxThreadRows,
	IKnoxThreadRow,
	knoxAssistantIsTruncated,
	knoxThreadRowHeight,
	KnoxThreadRowKind,
} from '../../common/knoxThreadModel.js';
import { IKnoxFindHit } from '../../common/knoxFind.js';
import { knoxHistoricalSegments, knoxExtractHistoricalChips } from '../../common/knoxHistoricalChips.js';
import { getMentionOpenUri } from '../../common/knoxMentions.js';
import { renderKnoxActivityTimeline } from './knoxAgentChrome.js';
import { renderKnoxCheckpointButton } from './knoxCheckpoint.js';
import { renderKnoxLoadingState } from './knoxLoadingState.js';
import { renderKnoxMarkdown } from './knoxMarkdown.js';
import { renderKnoxReasoning } from './knoxReasoning.js';
import { knoxToolStatusMessage } from '../../common/knoxToolCard.js';
import { renderKnoxAssistantMarkdown } from '../markdown/knoxMarkdownRenderer.js';
import { IKnoxToolUiState } from '../tools/knoxToolCard.js';
import { renderKnoxToolCard } from '../tools/knoxToolBody.js';
import { renderKnoxToolOutput } from '../tools/knoxToolOutput.js';

const USER_TEMPLATE = 'knox-thread-user';
const ASSISTANT_TEMPLATE = 'knox-thread-assistant';
const THINKING_TEMPLATE = 'knox-thread-thinking';
const TOOL_TEMPLATE = 'knox-thread-tool';
const TIMELINE_TEMPLATE = 'knox-thread-timeline';
const LOADING_TEMPLATE = 'knox-thread-loading';
const SPACER_TEMPLATE = 'knox-thread-spacer';
const SPACER_ID = 'knox-thread-spacer';

interface IKnoxThreadTemplate {
	readonly container: HTMLElement;
	readonly elementDisposables: DisposableStore;
}

interface IKnoxThreadRenderContext {
	probeHeight(rowId: string): void;
	timelineExpanded: Set<number>;
	reasoningCollapsed: Map<string, boolean>;
	codeBlockExpanded: Map<string, boolean>;
	toolUi: IKnoxToolUiState;
	refresh(): void;
	revealStep(step: IKnoxAgentActivityStep): void;
	restartSession(): void;
}

function roleLabel(kind: KnoxThreadRowKind): string {
	switch (kind) {
		case 'user': return localize('knox.role.user', "User");
		case 'assistant': return localize('knox.role.assistant', "Knox");
		case 'tool': return localize('knox.role.tool', "Tool");
		case 'thinking': return localize('knox.role.thinking', "Thinking");
		case 'timeline': return localize('knox.activity.timeline', "Agent activity");
		case 'loading': return localize('knox.activity.loading', "Working");
		case 'spacer': return '';
	}
}

function renderImages(parent: HTMLElement, urls: readonly string[]): void {
	if (!urls.length) {
		return;
	}
	const grid = append(parent, $('.knox-message-images'));
	for (const url of urls) {
		const img = append(grid, $<HTMLImageElement>('img.knox-message-image'));
		img.src = url;
		img.alt = localize('knox.uploadedImage', "Uploaded image");
	}
}

function renderHistoricalChips(
	parent: HTMLElement,
	item: IKnoxChatHistoryItem,
	editorService: IEditorService,
	store: DisposableStore,
): boolean {
	const extracted = knoxExtractHistoricalChips(item.editorState);
	if (!extracted.hasChips) {
		return false;
	}
	const body = append(parent, $('div.knox-message-body.knox-user-chips'));
	body.setAttribute('aria-readonly', 'true');
	const text = renderKnoxChatMessage(item.message);
	for (const segment of knoxHistoricalSegments(item.editorState, text)) {
		if (segment.kind === 'text') {
			append(body, $('span.knox-user-chip-text')).textContent = segment.text;
			continue;
		}
		const chip = append(body, $('span.knox-historical-chip'));
		chip.textContent = segment.chip.label;
		chip.classList.add(segment.chip.kind === 'slash' ? 'knox-slash-chip' : 'knox-mention-chip');
		const uri = segment.chip.kind === 'mention'
			? getMentionOpenUri({
				itemType: segment.chip.itemType ?? 'file',
				icon: segment.chip.icon,
				query: segment.chip.query,
				id: segment.chip.id,
			})
			: null;
		if (uri) {
			chip.classList.add('knox-historical-chip-openable');
			chip.title = uri;
			chip.setAttribute('role', 'link');
			chip.tabIndex = 0;
			const open = () => {
				void editorService.openEditor({ resource: URI.parse(uri) });
			};
			store.add(addDisposableListener(chip, 'click', e => {
				e.preventDefault();
				e.stopPropagation();
				open();
			}));
			store.add(addDisposableListener(chip, 'keydown', (e: KeyboardEvent) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					e.stopPropagation();
					open();
				}
			}));
		}
	}
	return true;
}

function renderContextChips(parent: HTMLElement, names: readonly string[]): void {
	if (!names.length) {
		return;
	}
	const row = append(parent, $('.knox-context-chips'));
	for (const name of names) {
		append(row, $('span.knox-context-chip')).textContent = name;
	}
}

class KnoxThreadDelegate implements IListVirtualDelegate<IKnoxThreadRow> {
	getHeight(element: IKnoxThreadRow): number {
		return knoxThreadRowHeight(element);
	}

	getTemplateId(element: IKnoxThreadRow): string {
		switch (element.kind) {
			case 'user': return USER_TEMPLATE;
			case 'assistant': return ASSISTANT_TEMPLATE;
			case 'thinking': return THINKING_TEMPLATE;
			case 'tool': return TOOL_TEMPLATE;
			case 'timeline': return TIMELINE_TEMPLATE;
			case 'loading': return LOADING_TEMPLATE;
			case 'spacer': return SPACER_TEMPLATE;
		}
	}

	hasDynamicHeight(): boolean {
		return true;
	}

	getDynamicHeight(element: IKnoxThreadRow): number | null {
		return element.measuredHeight ?? null;
	}

	setDynamicHeight(element: IKnoxThreadRow, height: number): void {
		element.measuredHeight = height;
	}
}

class KnoxThreadAccessibilityProvider implements IListAccessibilityProvider<IKnoxThreadRow> {
	getWidgetAriaLabel(): string {
		return localize('knox.thread', "Knox conversation");
	}

	getWidgetRole(): AriaRole {
		return 'log';
	}

	getRole(element: IKnoxThreadRow): AriaRole {
		return element.kind === 'spacer' ? 'none' : 'article';
	}

	getAriaLabel(element: IKnoxThreadRow): string {
		if (element.kind === 'timeline') {
			return localize('knox.activity.timeline', "Agent activity");
		}
		if (element.kind === 'loading') {
			return localize('knox.streaming', "Knox is responding.");
		}
		if (element.kind === 'spacer') {
			return '';
		}
		if (element.kind === 'tool' && element.toolState) {
			return knoxToolStatusMessage(element.toolState, undefined).text;
		}
		if (element.item) {
			const preview = knoxHistoryItemPreview(element.item);
			return `${roleLabel(element.kind)}: ${preview.text}`;
		}
		return roleLabel(element.kind);
	}
}

abstract class KnoxRowRenderer implements IListRenderer<IKnoxThreadRow, IKnoxThreadTemplate> {
	abstract readonly templateId: string;

	constructor(protected readonly ctx: IKnoxThreadRenderContext) { }

	renderTemplate(container: HTMLElement): IKnoxThreadTemplate {
		container.classList.add('knox-thread-row');
		return { container, elementDisposables: new DisposableStore() };
	}

	renderElement(element: IKnoxThreadRow, index: number, templateData: IKnoxThreadTemplate): void {
		templateData.elementDisposables.clear();
		clearNode(templateData.container);
		try {
			this.renderRow(element, index, templateData);
		} catch (error) {
			this.renderError(templateData, error);
		}
		this.probe(element.id);
	}

	protected abstract renderRow(element: IKnoxThreadRow, index: number, template: IKnoxThreadTemplate): void;

	private renderError(template: IKnoxThreadTemplate, error: unknown): void {
		template.container.className = 'knox-thread-row knox-row-error';
		append(template.container, $('p.knox-row-error-title')).textContent = localize('knox.somethingWentWrong', "Something went wrong:");
		append(template.container, $('pre.knox-row-error-message')).textContent = error instanceof Error ? error.message : String(error);
		const restart = append(template.container, $<HTMLButtonElement>('button.knox-overlay-back'));
		restart.type = 'button';
		restart.textContent = localize('knox.restart', "Restart");
		template.elementDisposables.add(addDisposableListener(restart, 'click', e => {
			e.preventDefault();
			e.stopPropagation();
			this.ctx.restartSession();
		}));
	}

	disposeElement(_element: IKnoxThreadRow, _index: number, templateData: IKnoxThreadTemplate): void {
		templateData.elementDisposables.clear();
		clearNode(templateData.container);
	}

	disposeTemplate(templateData: IKnoxThreadTemplate): void {
		templateData.elementDisposables.dispose();
		clearNode(templateData.container);
	}

	protected probe(rowId: string): void {
		this.ctx.probeHeight(rowId);
	}
}

class UserRenderer extends KnoxRowRenderer {
	readonly templateId = USER_TEMPLATE;

	constructor(
		ctx: IKnoxThreadRenderContext,
		@IMarkdownRendererService private readonly _markdown: IMarkdownRendererService,
		@IKnoxGuiBridge private readonly _bridge: IKnoxGuiBridge,
		@IDialogService private readonly _dialog: IDialogService,
		@INotificationService private readonly _notification: INotificationService,
		@IHoverService private readonly _hover: IHoverService,
		@IEditorService private readonly _editor: IEditorService,
	) {
		super(ctx);
	}

	protected renderRow(element: IKnoxThreadRow, index: number, template: IKnoxThreadTemplate): void {
		const item = element.item;
		if (!item) {
			return;
		}
		template.container.className = 'knox-thread-row knox-message knox-message-user';
		const header = append(template.container, $('.knox-message-header'));
		append(header, $('span.knox-message-role')).textContent = roleLabel('user');
		renderKnoxCheckpointButton(
			header, item, element.historyIndex, { createIfMissing: false },
			this._bridge, this._dialog, this._notification, this._hover, template.elementDisposables,
		);
		renderContextChips(template.container, item.contextItems.filter(c => !c.hidden).map(c => c.name));
		renderImages(template.container, knoxMessageImageUrls(item.message.content));
		if (!renderHistoricalChips(template.container, item, this._editor, template.elementDisposables)) {
			const body = append(template.container, $('div.knox-message-body.knox-markdown'));
			renderKnoxMarkdown(body, renderKnoxChatMessage(item.message), this._markdown, template.elementDisposables);
		}
	}
}

class AssistantRenderer extends KnoxRowRenderer {
	readonly templateId = ASSISTANT_TEMPLATE;

	constructor(
		ctx: IKnoxThreadRenderContext,
		@IMarkdownRendererService private readonly _markdown: IMarkdownRendererService,
		@IKnoxChatService private readonly _chat: IKnoxChatService,
		@IClipboardService private readonly _clipboard: IClipboardService,
		@IKnoxGuiBridge private readonly _bridge: IKnoxGuiBridge,
		@IDialogService private readonly _dialog: IDialogService,
		@INotificationService private readonly _notification: INotificationService,
		@IHoverService private readonly _hover: IHoverService,
		@ILanguageService private readonly _language: ILanguageService,
		@IWorkspaceContextService private readonly _workspace: IWorkspaceContextService,
	) {
		super(ctx);
	}

	protected renderRow(element: IKnoxThreadRow, _index: number, template: IKnoxThreadTemplate): void {
		const item = element.item;
		if (!item) {
			return;
		}
		const messageId = item.message.id ?? item.messageId ?? String(element.historyIndex);
		template.container.className = 'knox-thread-row knox-message knox-message-assistant';
		template.container.id = knoxActivityAnchorId(`reply:${messageId}`);

		const reasoningHost = append(template.container, $('.knox-reasoning'));
		reasoningHost.id = knoxActivityAnchorId(`reasoning:${messageId}`);
		const collapsed = { value: this.ctx.reasoningCollapsed.get(element.id) === true };
		renderKnoxReasoning(reasoningHost, item.reasoning, this._markdown, template.elementDisposables, collapsed, () => {
			this.ctx.reasoningCollapsed.set(element.id, collapsed.value);
			this.ctx.refresh();
		});

		const reply = knoxAssistantReplyText(item);
		if (reply) {
			const body = append(template.container, $('div.knox-message-body.knox-markdown'));
			const streamingLast = this._chat.isStreaming && element.isLast === true;
			renderKnoxAssistantMarkdown(body, {
				source: reply,
				isStreaming: streamingLast,
				inStepContainer: true,
				historyIndex: element.historyIndex,
				history: this._chat.history,
				expanded: this.ctx.codeBlockExpanded,
				onDidChangeHeight: () => this.probe(element.id),
			}, {
				markdown: this._markdown,
				language: this._language,
				clipboard: this._clipboard,
				hover: this._hover,
				chat: this._chat,
				bridge: this._bridge,
				workspace: this._workspace,
			}, template.elementDisposables);
		}

		const streamingLast = this._chat.isStreaming && element.isLast === true;
		const hasReasoning = !!item.reasoning?.text?.trim();
		if (streamingLast && !reply && !hasReasoning && !item.isGatheringContext) {
			const thinking = append(template.container, $('div.knox-thinking-indicator'));
			thinking.textContent = localize('knox.thinkingDots', "Thinking.");
		}

		const hideActions = streamingLast
			|| this._chat.history[element.historyIndex + 1]?.message.role === 'assistant'
			|| this._chat.history[element.historyIndex + 1]?.message.role === 'thinking';
		if (!hideActions) {
			this._renderActions(template, element, item, reply);
		}
	}

	private _renderActions(
		template: IKnoxThreadTemplate,
		element: IKnoxThreadRow,
		item: NonNullable<IKnoxThreadRow['item']>,
		reply: string,
	): void {
		const actions = append(template.container, $('.knox-message-actions'));
		renderKnoxCheckpointButton(
			actions, item, element.historyIndex, { createIfMissing: true },
			this._bridge, this._dialog, this._notification, this._hover, template.elementDisposables,
		);

		if (knoxAssistantIsTruncated(item, this._chat.isStreaming, element.isLast === true)) {
			const cont = append(actions, $<HTMLButtonElement>('button.knox-icon-button'));
			cont.type = 'button';
			cont.tabIndex = -1;
			append(cont, $('span')).className = knoxGuiIconClass('play');
			const continueHint = localize('knox.knoxGeneration', "Knox Generation");
			cont.setAttribute('aria-label', continueHint);
			template.elementDisposables.add(this._hover.setupManagedHover(getDefaultHoverDelegate('mouse'), cont, continueHint));
			template.elementDisposables.add(addDisposableListener(cont, 'click', e => {
				e.preventDefault();
				e.stopPropagation();
				void this._chat.streamResponse({
					content: localize('knox.continueFromWhereYouLeftOff', "Continue from where you left off:"),
				}).catch(() => { /* Stream error dialog is shown via onDidStreamError. */ });
			}));
		}

		const del = append(actions, $<HTMLButtonElement>('button.knox-icon-button'));
		del.type = 'button';
		del.tabIndex = -1;
		append(del, $('span')).className = knoxGuiIconClass('trash-2');
		const deleteHint = localize('knox.delete', "Delete");
		del.setAttribute('aria-label', deleteHint);
		template.elementDisposables.add(this._hover.setupManagedHover(getDefaultHoverDelegate('mouse'), del, deleteHint));
		template.elementDisposables.add(addDisposableListener(del, 'click', e => {
			e.preventDefault();
			e.stopPropagation();
			const next = this._chat.history.slice();
			next.splice(element.historyIndex, 1);
			this._chat.replaceHistory(next);
		}));

		const copy = append(actions, $<HTMLButtonElement>('button.knox-icon-button'));
		copy.type = 'button';
		copy.tabIndex = -1;
		append(copy, $('span')).className = knoxGuiIconClass('copy');
		const copyHint = localize('knox.copy', "Copy");
		copy.setAttribute('aria-label', copyHint);
		template.elementDisposables.add(this._hover.setupManagedHover(getDefaultHoverDelegate('mouse'), copy, copyHint));
		template.elementDisposables.add(addDisposableListener(copy, 'click', e => {
			e.preventDefault();
			e.stopPropagation();
			void this._clipboard.writeText(reply || renderKnoxChatMessage(item.message));
		}));
	}
}

class ThinkingRenderer extends KnoxRowRenderer {
	readonly templateId = THINKING_TEMPLATE;

	constructor(
		ctx: IKnoxThreadRenderContext,
		@IMarkdownRendererService private readonly _markdown: IMarkdownRendererService,
		@IKnoxChatService private readonly _chat: IKnoxChatService,
	) {
		super(ctx);
	}

	protected renderRow(element: IKnoxThreadRow, _index: number, template: IKnoxThreadTemplate): void {
		const item = element.item;
		if (!item) {
			return;
		}
		const messageId = item.message.id ?? item.messageId ?? String(element.historyIndex);
		template.container.className = 'knox-thread-row knox-reasoning';
		template.container.id = knoxActivityAnchorId(`thinking:${messageId}`);
		const collapsed = { value: this.ctx.reasoningCollapsed.get(element.id) === true };
		const inProgress = this._chat.isStreaming && element.isLast === true;
		renderKnoxReasoning(template.container, {
			active: inProgress,
			text: renderKnoxChatMessage(item.message) || item.message.redactedThinking || '',
			startAt: item.reasoning?.startAt ?? 0,
			endAt: item.reasoning?.endAt,
		}, this._markdown, template.elementDisposables, collapsed, () => {
			this.ctx.reasoningCollapsed.set(element.id, collapsed.value);
			this.ctx.refresh();
		});
	}
}

class ToolRenderer extends KnoxRowRenderer {
	readonly templateId = TOOL_TEMPLATE;

	constructor(
		ctx: IKnoxThreadRenderContext,
		@IKnoxChatService private readonly _chat: IKnoxChatService,
		@IMarkdownRendererService private readonly _markdown: IMarkdownRendererService,
		@IClipboardService private readonly _clipboard: IClipboardService,
		@IKnoxGuiBridge private readonly _bridge: IKnoxGuiBridge,
		@IHoverService private readonly _hover: IHoverService,
		@ILanguageService private readonly _language: ILanguageService,
		@IWorkspaceContextService private readonly _workspace: IWorkspaceContextService,
		@ITerminalService private readonly _terminal: ITerminalService,
	) {
		super(ctx);
	}

	protected renderRow(element: IKnoxThreadRow, index: number, template: IKnoxThreadTemplate): void {
		template.container.className = 'knox-thread-row knox-message knox-message-tool';
		const state = element.toolState;
		if (state && element.item) {
			template.container.id = knoxActivityAnchorId(`tool:${state.toolCallId || state.toolCall.id}`);
			renderKnoxToolCard(template.container, {
				state,
				item: element.item,
				historyIndex: element.historyIndex,
				ui: this.ctx.toolUi,
				codeBlockExpanded: this.ctx.codeBlockExpanded,
				onDidChangeHeight: () => this.probe(element.id),
			}, {
				markdown: this._markdown,
				language: this._language,
				clipboard: this._clipboard,
				hover: this._hover,
				chat: this._chat,
				bridge: this._bridge,
				workspace: this._workspace,
				terminal: this._terminal,
			}, template.elementDisposables);
			return;
		}
		if (element.item) {
			renderKnoxToolOutput(
				template.container,
				element.item,
				this.ctx.toolUi,
				this._bridge,
				this._workspace,
				template.elementDisposables,
				() => this.probe(element.id),
			);
			return;
		}
		append(template.container, $('span.knox-tool-name')).textContent = localize('knox.role.tool', "Tool");
	}
}

class TimelineRenderer extends KnoxRowRenderer {
	readonly templateId = TIMELINE_TEMPLATE;

	constructor(
		ctx: IKnoxThreadRenderContext,
		@IKnoxGuiBridge private readonly _bridge: IKnoxGuiBridge,
		@IHoverService private readonly _hover: IHoverService,
		@INotificationService private readonly _notification: INotificationService,
	) {
		super(ctx);
	}

	protected renderRow(element: IKnoxThreadRow, _index: number, template: IKnoxThreadTemplate): void {
		template.container.className = 'knox-thread-row knox-timeline-row';
		const steps = element.steps ?? [];
		const userIndex = element.userIndex ?? element.historyIndex;
		const expanded = this.ctx.timelineExpanded.has(userIndex);
		renderKnoxActivityTimeline(
			template.container,
			steps,
			expanded,
			next => {
				if (next) {
					this.ctx.timelineExpanded.add(userIndex);
				} else {
					this.ctx.timelineExpanded.delete(userIndex);
				}
				this.ctx.refresh();
			},
			step => this.ctx.revealStep(step),
			this._bridge,
			this._hover,
			this._notification,
			template.elementDisposables,
		);
	}
}

class LoadingRenderer extends KnoxRowRenderer {
	readonly templateId = LOADING_TEMPLATE;

	protected renderRow(element: IKnoxThreadRow, _index: number, template: IKnoxThreadTemplate): void {
		template.container.className = 'knox-thread-row knox-loading-row';
		renderKnoxLoadingState(template.container, {
			label: localize('knox.activity.loading', "Working"),
			startedAt: element.startedAt,
		}, template.elementDisposables);
	}
}

class SpacerRenderer implements IListRenderer<IKnoxThreadRow, IKnoxThreadTemplate> {
	readonly templateId = SPACER_TEMPLATE;

	renderTemplate(container: HTMLElement): IKnoxThreadTemplate {
		container.classList.add('knox-thread-row', 'knox-thread-spacer');
		container.setAttribute('aria-hidden', 'true');
		return { container, elementDisposables: new DisposableStore() };
	}

	renderElement(_element: IKnoxThreadRow, _index: number, _template: IKnoxThreadTemplate): void { }

	disposeElement(_element: IKnoxThreadRow, _index: number, template: IKnoxThreadTemplate): void {
		template.elementDisposables.clear();
	}

	disposeTemplate(template: IKnoxThreadTemplate): void {
		template.elementDisposables.dispose();
	}
}

export class KnoxThreadList extends Disposable {

	readonly element: HTMLElement;

	private readonly _list: WorkbenchList<IKnoxThreadRow>;
	private _rows: IKnoxThreadRow[] = [];
	private _scroll = knoxResetScrollState();
	private _programmaticScroll = false;
	private _programmaticToken = 0;
	private readonly _timelineExpanded = new Set<number>();
	private readonly _reasoningCollapsed = new Map<string, boolean>();
	private readonly _codeBlockExpanded = new Map<string, boolean>();
	private readonly _toolUi: IKnoxToolUiState = {
		argsExpanded: new Set<string>(),
		treeCollapsed: new Set<string>(),
		treeTab: new Map(),
		askAnswers: new Map(),
		askIndex: new Map(),
		searchCollapsed: new Set<string>(),
		peekExpanded: new Set<string>(),
	};

	private readonly _onDidChangeScroll = this._register(new Emitter<IKnoxThreadScrollState>());
	readonly onDidChangeScroll = this._onDidChangeScroll.event;

	private readonly _onDidCrash = this._register(new Emitter<unknown>());
	readonly onDidCrash = this._onDidCrash.event;

	constructor(
		parent: HTMLElement,
		@IKnoxChatService private readonly _chatService: IKnoxChatService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();

		this.element = append(parent, $('.knox-thread'));

		const ctx: IKnoxThreadRenderContext = {
			probeHeight: rowId => this._probeHeight(rowId),
			timelineExpanded: this._timelineExpanded,
			reasoningCollapsed: this._reasoningCollapsed,
			codeBlockExpanded: this._codeBlockExpanded,
			toolUi: this._toolUi,
			refresh: () => this.refresh(),
			revealStep: step => this.revealStep(step),
			restartSession: () => this._chatService.newSession(),
		};

		this._list = this._register(instantiationService.createInstance(
			WorkbenchList<IKnoxThreadRow>,
			'KnoxThread',
			this.element,
			new KnoxThreadDelegate(),
			[
				instantiationService.createInstance(UserRenderer, ctx),
				instantiationService.createInstance(AssistantRenderer, ctx),
				instantiationService.createInstance(ThinkingRenderer, ctx),
				instantiationService.createInstance(ToolRenderer, ctx),
				instantiationService.createInstance(TimelineRenderer, ctx),
				new LoadingRenderer(ctx),
				new SpacerRenderer(),
			],
			{
				identityProvider: { getId: (row: IKnoxThreadRow) => row.id },
				multipleSelectionSupport: false,
				setRowLineHeight: false,
				horizontalScrolling: false,
				supportDynamicHeights: true,
				alwaysConsumeMouseWheel: false,
				mouseSupport: true,
				keyboardSupport: true,
				accessibilityProvider: new KnoxThreadAccessibilityProvider(),
			},
		));

		this._register(this._list.onDidScroll(e => {
			const next = knoxScrollStateFromMetrics(
				{ scrollTop: e.scrollTop, scrollHeight: e.scrollHeight, clientHeight: e.height },
				this._scroll,
				this._programmaticScroll,
			);
			if (
				next.stickToBottom !== this._scroll.stickToBottom
				|| next.isAtTop !== this._scroll.isAtTop
				|| next.isAtBottom !== this._scroll.isAtBottom
				|| next.showScrollButtons !== this._scroll.showScrollButtons
			) {
				this._scroll = next;
				this._onDidChangeScroll.fire(next);
			} else {
				this._scroll = next;
			}
		}));
		this._register(this._chatService.onDidChange(() => this.refresh()));
		this.refresh();
	}

	get stickToBottom(): boolean {
		return this._scroll.stickToBottom;
	}

	get scrollState(): IKnoxThreadScrollState {
		return this._scroll;
	}

	setStickToBottom(value: boolean): void {
		this._scroll = { ...this._scroll, stickToBottom: value };
		if (value) {
			this.scrollToBottom(true);
		}
		this._onDidChangeScroll.fire(this._scroll);
	}

	scrollToTop(): void {
		this._withProgrammaticScroll(() => {
			this._list.scrollTop = 0;
			if (this._rows.length) {
				this._list.reveal(0);
			}
		});
		this._scroll = { ...this._scroll, stickToBottom: false, isAtTop: true, isAtBottom: false };
		this._onDidChangeScroll.fire(this._scroll);
	}

	scrollToBottom(force = false): void {
		if (!force && !this._scroll.stickToBottom) {
			return;
		}
		this._scroll = { ...this._scroll, stickToBottom: true, isAtBottom: true };
		if (this._rows.length) {
			this._withProgrammaticScroll(() => {
				this._list.reveal(this._rows.length - 1);
				this._list.scrollTop = Math.max(0, this._list.scrollHeight - this._list.renderHeight);
			});
		}
		this._onDidChangeScroll.fire(this._scroll);
	}

	layout(height: number, width: number): void {
		this._list.layout(height, width);
		this._syncSpacer();
		if (this._scroll.stickToBottom && this._rows.length) {
			this._withProgrammaticScroll(() => this._list.reveal(this._rows.length - 1));
		}
	}

	focus(): void {
		this._list.domFocus();
	}

	getHTMLElement(): HTMLElement {
		return this._list.getHTMLElement();
	}

	getRows(): readonly IKnoxThreadRow[] {
		return this._rows;
	}

	isStreaming(): boolean {
		return this._chatService.isStreaming;
	}

	revealFindHit(hit: IKnoxFindHit): void {
		if (hit.rowIndex < 0 || hit.rowIndex >= this._rows.length) {
			return;
		}
		this.element.classList.add('find-active');
		this._withProgrammaticScroll(() => {
			this._list.reveal(hit.rowIndex, 0.5);
			this._list.setFocus([hit.rowIndex]);
			this._list.setSelection([hit.rowIndex]);
		});
	}

	clearFindHighlight(): void {
		this.element.classList.remove('find-active');
		this._list.setSelection([]);
	}

	revealStep(step: IKnoxAgentActivityStep): void {
		const id = knoxActivityAnchorId(step.id);
		const el = this.element.ownerDocument.getElementById(id);
		if (el) {
			this._withProgrammaticScroll(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
			return;
		}
		const index = this._rows.findIndex(row =>
			row.id.includes(step.id) || row.historyIndex === step.historyIndex,
		);
		if (index >= 0) {
			this._withProgrammaticScroll(() => this._list.reveal(index));
		}
	}

	refresh(): void {
		try {
			const previousHeights = new Map(this._rows.map(row => [row.id, row.measuredHeight] as const));
			this._rows = buildKnoxThreadRows(this._chatService.history, {
				mode: this._chatService.mode,
				isStreaming: this._chatService.isStreaming,
				timelineExpanded: this._timelineExpanded,
			});
			for (const row of this._rows) {
				const height = previousHeights.get(row.id);
				if (typeof height === 'number') {
					row.measuredHeight = height;
				}
			}
			this._rows = this._withSpacer(this._rows);
			if (!this._rows.length) {
				this._scroll = knoxResetScrollState();
				this._onDidChangeScroll.fire(this._scroll);
			}
			this._list.splice(0, this._list.length, this._rows);
			this._syncSpacer();
			if (this._scroll.stickToBottom && this._rows.length) {
				this._withProgrammaticScroll(() => this._list.reveal(this._rows.length - 1));
			}
		} catch (error) {
			this._onDidCrash.fire(error);
		}
	}

	private _withProgrammaticScroll(run: () => void): void {
		this._programmaticScroll = true;
		const token = ++this._programmaticToken;
		run();
		const win = getWindow(this.element);
		win.setTimeout(() => {
			if (token === this._programmaticToken) {
				this._programmaticScroll = false;
			}
		}, 50);
	}

	private _probeHeight(rowId: string): void {
		const win = getWindow(this.element);
		win.queueMicrotask(() => {
			if (this._store.isDisposed) {
				return;
			}
			const index = this._rows.findIndex(row => row.id === rowId);
			if (index < 0 || index >= this._list.length) {
				return;
			}
			this._list.updateElementHeight(index, undefined);
			this._syncSpacer();
			if (this._scroll.stickToBottom && this._rows.length) {
				this._withProgrammaticScroll(() => this._list.reveal(this._rows.length - 1));
			}
		});
	}

	private _withSpacer(rows: IKnoxThreadRow[]): IKnoxThreadRow[] {
		const content = rows.filter(row => row.kind !== 'spacer');
		const viewport = this._list.renderHeight;
		if (viewport <= 0 || !content.length) {
			return content;
		}
		const contentHeight = content.reduce((sum, row) => sum + knoxThreadRowHeight(row), 0);
		const pad = Math.max(0, viewport - contentHeight);
		if (pad === 0) {
			return content;
		}
		return [{
			id: SPACER_ID,
			kind: 'spacer',
			historyIndex: -1,
			measuredHeight: pad,
		}, ...content];
	}

	/**
	 * GUI Chat.tsx uses a flex `grow` spacer so short threads sit just above
	 * the input and streaming flows upward. Mirror that with a leading list row.
	 */
	private _syncSpacer(): void {
		const viewport = this._list.renderHeight;
		if (viewport <= 0) {
			return;
		}
		const hasSpacer = this._rows[0]?.kind === 'spacer';
		const contentRows = hasSpacer ? this._rows.slice(1) : this._rows;
		if (!contentRows.length) {
			if (hasSpacer) {
				this._rows = [];
				this._list.splice(0, this._list.length, []);
			}
			return;
		}
		const contentHeight = contentRows.reduce((sum, row) => sum + knoxThreadRowHeight(row), 0);
		const pad = Math.max(0, viewport - contentHeight);
		if (pad === 0) {
			if (hasSpacer) {
				this._rows = contentRows;
				this._list.splice(0, 1, []);
			}
			return;
		}
		if (hasSpacer) {
			const spacer = this._rows[0];
			if (spacer.measuredHeight !== pad) {
				spacer.measuredHeight = pad;
				this._list.updateElementHeight(0, pad);
			}
			return;
		}
		const spacer: IKnoxThreadRow = {
			id: SPACER_ID,
			kind: 'spacer',
			historyIndex: -1,
			measuredHeight: pad,
		};
		this._rows = [spacer, ...contentRows];
		this._list.splice(0, 0, [spacer]);
	}
}
