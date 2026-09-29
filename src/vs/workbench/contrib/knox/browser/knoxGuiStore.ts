/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { applyNavigateTo, applySessionTabChange, createInitialKnoxGuiState, IKnoxGuiHistoryItem, IKnoxGuiState, IKnoxGuiToolCall, KnoxChatMode, KnoxGuiLanguage, KnoxPermissionMode, knoxGuiIsDedicatedEditor, nextPermissionMode, withLockedEditorRoute } from '../common/knoxGuiState.js';
import { emptyInputDoc, IKnoxGuiInputBlock, inputDocFromPlainText, inputDocToPlainText } from '../common/knoxGuiInput.js';
import { KnoxGuiOverlay, KnoxGuiRoute } from '../common/knoxGuiProtocol.js';

export class KnoxGuiStore extends Disposable {
	private _state: IKnoxGuiState = createInitialKnoxGuiState();
	private readonly _onDidChange = this._register(new Emitter<IKnoxGuiState>());
	readonly onDidChange: Event<IKnoxGuiState> = this._onDidChange.event;

	get state(): IKnoxGuiState {
		return this._state;
	}

	patch(partial: Partial<IKnoxGuiState>): void {
		this._state = withLockedEditorRoute({ ...this._state, ...partial });
		this._onDidChange.fire(this._state);
	}

	lockView(route: KnoxGuiRoute): void {
		this._state = withLockedEditorRoute({ ...this._state, route, lockedRoute: route, overlay: null });
		this._onDidChange.fire(this._state);
	}

	navigate(path: string, toggle?: boolean): void {
		if (knoxGuiIsDedicatedEditor(this._state)) {
			return;
		}
		this._state = applyNavigateTo(this._state, path, toggle);
		this._onDidChange.fire(this._state);
	}

	setOverlay(overlay: KnoxGuiOverlay): void {
		if (knoxGuiIsDedicatedEditor(this._state)) {
			return;
		}
		this.patch({ overlay: this._state.overlay === overlay ? null : overlay, route: KnoxGuiRoute.Chat });
	}

	setLanguage(language: KnoxGuiLanguage): void {
		this.patch({ language });
	}

	setInput(input: string): void {
		this.patch({ input, inputDoc: inputDocFromPlainText(input) });
	}

	setInputDoc(inputDoc: IKnoxGuiInputBlock[]): void {
		this.patch({ input: inputDocToPlainText(inputDoc), inputDoc });
	}

	setMode(mode: KnoxChatMode): void {
		this.patch({ mode });
	}

	cyclePermissionMode(): void {
		this.patch({ permissionMode: nextPermissionMode(this._state.permissionMode) });
	}

	setPermissionMode(permissionMode: KnoxPermissionMode): void {
		this.patch({ permissionMode });
	}

	newSession(): void {
		const sessionId = generateUuid();
		this.patch({
			sessionId,
			sessionTitle: '',
			history: [],
			input: '',
			inputDoc: emptyInputDoc(),
			isStreaming: false,
			overlay: null,
			route: KnoxGuiRoute.Chat,
			taskPlan: [],
			injectedMemories: [],
			compaction: undefined,
			autonomous: undefined,
			contextItems: [],
			codeToEdit: [],
			editStatus: 'not-started',
			editPreviousInputs: [],
			editFileAfterEdit: undefined,
			images: [],
			historicalImages: [],
			editingUserIndex: undefined,
			isGatheringContext: false,
			addFileOpen: false,
			mentionOpen: false,
			slashOpen: false,
			suggestItems: [],
			suggestQuery: '',
			suggestSelected: 0,
			suggestSubmenu: undefined,
			suggestSubmenuTitle: undefined,
			suggestLoading: false,
			applyStates: [],
			sessionToolAllowlist: [],
			autoScroll: true,
			historyHydrateNotice: null,
			streamError: undefined,
			toolLoopSteps: 0,
			fileSymbols: {},
			find: { ...this._state.find, open: false, query: '', matchIndexes: [], total: 0, current: 0 },
		});
	}

	syncSessionTab(sessionId: string, title: string, newTabId: string = generateUuid()): void {
		const next = applySessionTabChange(this._state.tabs, this._state.activeTabId, sessionId, title, newTabId);
		this.patch({ tabs: next.tabs, activeTabId: next.activeTabId });
	}

	appendHistory(item: IKnoxGuiHistoryItem): void {
		this.patch({ history: [...this._state.history, item] });
	}

	updateLastAssistant(content: string, toolCalls?: IKnoxGuiToolCall[]): void {
		const history = this._state.history.slice();
		for (let i = history.length - 1; i >= 0; i--) {
			if (history[i].role === 'assistant') {
				history[i] = { ...history[i], content, toolCalls: toolCalls ?? history[i].toolCalls };
				this.patch({ history });
				return;
			}
		}
		this.appendHistory({ id: generateUuid(), role: 'assistant', content, toolCalls });
	}

	setStreaming(isStreaming: boolean): void {
		this.patch({ isStreaming });
	}
}
