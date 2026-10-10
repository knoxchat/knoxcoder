/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { runWithFakedTimers } from '../../../../base/test/common/timeTravelScheduler.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import assert from 'assert';
import { timeout } from '../../../../base/common/async.js';
import { Emitter } from '../../../../base/common/event.js';
import { mock } from '../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { renderMarkdown } from '../../../../base/browser/markdownRenderer.js';
import { IMarkdownString } from '../../../../base/common/htmlContent.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IMarkdownRendererService } from '../../../../platform/markdown/browser/markdownRenderer.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { InMemoryStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { DEFAULT_REASONING_EFFORT_ALLOWED, knoxGuiResetModelCatalogForTests, knoxGuiSeedModelCatalog } from '../common/knoxGuiCapabilities.js';
import { formatModelPricingPerMillion } from '../common/knoxGuiOverlays.js';
import { IKnoxGuiMessage, KNOX_GUI_HEARTBEAT_MS, KnoxGuiRoute } from '../common/knoxGuiProtocol.js';
import { DEFAULT_MENTION_PROVIDER_TITLES, inputDocFromPlainText, SLASH_BUILTINS } from '../common/knoxGuiInput.js';
import { DEFAULT_PERMISSION_MODE, IKnoxGuiModel } from '../common/knoxGuiState.js';
import { IKnoxService } from '../common/knoxService.js';
import { DRAFT_SESSION_KEY, UI_STATE_KEY } from './gui/controller/persistence.js';
import { KnoxGuiController } from './knoxGuiController.js';
import { KnoxGuiMessenger } from './knoxGuiMessenger.js';
import { KnoxGuiStore } from './knoxGuiStore.js';
import { KnoxGuiWidget } from './gui/knoxGuiWidget.js';

suite('Knox native GUI controller (GP-084)', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	function createHarness(options?: { listModels?: unknown; replies?: Record<string, unknown>; respond?: (message: IKnoxGuiMessage) => { content: unknown; chunks?: unknown[] } | { error: string } | undefined; lock?: KnoxGuiRoute; storage?: InMemoryStorageService; activeChatSessionId?: string; silent?: string[] }): { controller: KnoxGuiController; store: KnoxGuiStore; posted: IKnoxGuiMessage[] } {
		knoxGuiResetModelCatalogForTests();
		const incoming = disposables.add(new Emitter<IKnoxGuiMessage>());
		const posted: IKnoxGuiMessage[] = [];
		const knoxService = new class extends mock<IKnoxService>() {
			override onDidReceiveGuiMessage = incoming.event;
			override activeChatSessionId = options?.activeChatSessionId ?? null;
			override async guiPost(message: IKnoxGuiMessage): Promise<void> {
				posted.push(message);
				if (options?.silent?.includes(message.messageType)) {
					return; // host-reply types: the real host does not echo them back into the GUI
				}
				const custom = options?.respond?.(message);
				if (custom) {
					for (const chunk of 'chunks' in custom ? custom.chunks ?? [] : []) {
						incoming.fire({ messageType: message.messageType, messageId: message.messageId, data: { done: false, status: 'success', content: [chunk] } });
					}
					incoming.fire({
						messageType: message.messageType,
						messageId: message.messageId,
						data: 'error' in custom ? { done: true, status: 'error', error: custom.error } : { done: true, status: 'success', content: custom.content },
					});
					return;
				}
				if (options?.listModels !== undefined && message.messageType === 'knoxchat/listModels') {
					incoming.fire({
						messageType: message.messageType,
						messageId: message.messageId,
						data: { done: true, status: 'success', content: options.listModels },
					});
					return;
				}
				if (options?.replies && Object.prototype.hasOwnProperty.call(options.replies, message.messageType)) {
					incoming.fire({
						messageType: message.messageType,
						messageId: message.messageId,
						data: { done: true, status: 'success', content: options.replies[message.messageType] },
					});
					return;
				}
				incoming.fire({
					messageType: message.messageType,
					messageId: message.messageId,
					data: { done: true, status: 'error', error: 'unhandled' },
				});
			}
		};
		const store = disposables.add(new KnoxGuiStore());
		if (options?.lock) {
			store.lockView(options.lock);
		}
		const messenger = disposables.add(new KnoxGuiMessenger(knoxService));
		const storage = options?.storage ?? disposables.add(new InMemoryStorageService());
		const controller = disposables.add(new KnoxGuiController(store, messenger, storage));
		return { controller, store, posted };
	}

	const visionModel: IKnoxGuiModel = {
		title: 'GPT-4o',
		provider: 'knoxchat',
		model: 'openai/gpt-4o',
		capabilities: { uploadImage: true },
		supportedParameters: ['reasoning_effort'],
	};

	test('applyConfig sets imagesSupported from uploadImage and reasoning levels', async () => {
		const { controller, store } = createHarness();
		await timeout(0);
		controller.applyConfig({
			config: {
				models: [visionModel],
				selectedModelTitle: 'GPT-4o',
			},
		});
		assert.strictEqual(store.state.imagesSupported, true);
		assert.deepStrictEqual(store.state.reasoningEfforts, [...DEFAULT_REASONING_EFFORT_ALLOWED]);
		assert.strictEqual(store.state.webSearchSupported, false);
		assert.strictEqual(store.state.toolsSupported, true);
		assert.strictEqual(store.state.mode, 'agent');
		assert.strictEqual(store.state.showChatScrollbar, true);
	});

	test('applyConfig keeps the chat scrollbar on unless ui.showChatScrollbar is false', async () => {
		const { controller, store } = createHarness();
		await timeout(0);
		controller.applyConfig({ config: {} });
		assert.strictEqual(store.state.showChatScrollbar, true);
		controller.applyConfig({ config: { ui: { showChatScrollbar: false } } });
		assert.strictEqual(store.state.showChatScrollbar, false);
		controller.applyConfig({ config: { ui: { showChatScrollbar: true } } });
		assert.strictEqual(store.state.showChatScrollbar, true);
	});

	test('selectModel updates imagesSupported from uploadImage', async () => {
		const { controller, store } = createHarness();
		await timeout(0);
		store.patch({
			models: [visionModel, { title: 'Local', provider: 'ollama', model: 'llama3' }],
			modelsByRole: {
				chat: [visionModel, { title: 'Local', provider: 'ollama', model: 'llama3' }],
				edit: [],
				apply: [],
				viewRead: [],
				realTimeSearch: [],
			},
			modelTitle: 'Local',
			imagesSupported: false,
		});
		controller.selectModel('chat', 'GPT-4o');
		assert.strictEqual(store.state.imagesSupported, true);
		controller.selectModel('chat', 'Local');
		assert.strictEqual(store.state.imagesSupported, false);
	});

	test('heartbeat posts immediately, on an interval, and on focus/visibility', async () => {
		const { controller, posted } = createHarness();
		await timeout(0);
		const before = posted.filter(message => message.messageType === 'knox/heartbeat').length;
		controller.startHeartbeat();
		const immediate = posted.filter(message => message.messageType === 'knox/heartbeat');
		assert.ok(immediate.length > before);
		assert.strictEqual(typeof (immediate[immediate.length - 1]?.data as { t?: number }).t, 'number');
		assert.ok(controller.heartbeatTimer);
		assert.strictEqual(KNOX_GUI_HEARTBEAT_MS, 5000);
		window.dispatchEvent(new Event('focus'));
		const afterFocus = posted.filter(message => message.messageType === 'knox/heartbeat').length;
		assert.ok(afterFocus > immediate.length);
		document.dispatchEvent(new Event('visibilitychange'));
		const afterVisible = posted.filter(message => message.messageType === 'knox/heartbeat').length;
		if (document.visibilityState === 'visible') {
			assert.ok(afterVisible > afterFocus);
		}
	});

	test('checkpointRestored stores the restore notice and reloads the session', async () => {
		const { controller, store, posted } = createHarness();
		await timeout(0);
		store.patch({ sessionId: 's1' });
		await controller.handleInbound('checkpointRestored', {
			sessionId: 's1',
			checkpointId: 'cp-1',
			description: 'before edit',
			restoredFiles: ['a.ts'],
			memoryRewound: false,
		}, 'msg-1');
		assert.strictEqual(store.state.restoreNotice?.sessionId, 's1');
		assert.ok(store.state.restoreNotice?.content.includes('cp-1'));
		assert.ok(store.state.restoreNotice?.content.includes('a.ts'));
		await timeout(0);
		assert.ok(posted.some(message => message.messageType === 'history/load'));
	});

	test('deleteModel posts config/deleteModel', async () => {
		const { controller, posted } = createHarness();
		await timeout(0);
		controller.deleteModel('GPT-4o');
		const message = posted.find(entry => entry.messageType === 'config/deleteModel');
		assert.ok(message);
		assert.deepStrictEqual(message.data, { title: 'GPT-4o' });
	});

	test('Shift+Tab cycles permission mode from the composer', async () => {
		const { controller, store } = createHarness();
		await timeout(0);
		assert.strictEqual(store.state.permissionMode, DEFAULT_PERMISSION_MODE);
		const parent = document.createElement('div');
		document.body.appendChild(parent);
		disposables.add({ dispose: () => parent.remove() });
		const hoverService = new class extends mock<IHoverService>() {
			override setupDelayedHover() {
				return { dispose() { } };
			}
		};
		const openerService = new class extends mock<IOpenerService>() {
			override async open(): Promise<boolean> {
				return true;
			}
		};
		const languageService = new class extends mock<ILanguageService>() {
			override getLanguageIdByLanguageName(): string | null {
				return null;
			}
			override isRegisteredLanguageId(): boolean {
				return false;
			}
			override requestBasicLanguageFeatures(): void { }
			override guessLanguageIdByFilepathOrFirstLine(): string | null {
				return null;
			}
		};
		const markdownRendererService = new class extends mock<IMarkdownRendererService>() {
			override render(markdown: IMarkdownString, options?: import('../../../../base/browser/markdownRenderer.js').MarkdownRenderOptions, target?: HTMLElement) {
				return renderMarkdown(markdown, options, target);
			}
			override setDefaultCodeBlockRenderer(): void { }
		};
		const widget = disposables.add(new KnoxGuiWidget(parent, controller, openerService, hoverService, languageService, { getModel: () => null } as unknown as IModelService, markdownRendererService));
		const editor = widget.root.querySelector('[data-testid="knox-gui-input"]') as HTMLElement | null;
		assert.ok(editor);
		editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
		// The default is acceptEdits (K-005), so Shift+Tab moves on to fullAuto, then wraps to default.
		assert.strictEqual(store.state.permissionMode, 'fullAuto');
		store.cyclePermissionMode();
		assert.strictEqual(store.state.permissionMode, 'default');
		store.cyclePermissionMode();
		assert.strictEqual(store.state.permissionMode, 'acceptEdits');
	});

	test('openAddModel remembers the last provider tab and preloads both catalogs', async () => {
		const { controller, store, posted } = createHarness();
		await timeout(0);
		controller.openAddModel('edit');
		assert.strictEqual(store.state.addModelModal, true);
		assert.strictEqual(store.state.addModelRole, 'edit');
		assert.strictEqual(store.state.addModelModalProvider, 'knoxchat');
		assert.strictEqual(store.state.addModelBulk, false);
		assert.strictEqual(store.state.route, KnoxGuiRoute.Chat);
		assert.ok(posted.some(message => message.messageType === 'knoxchat/listModels'));
		assert.ok(posted.some(message => message.messageType === 'openrouter/listModels'));
		store.patch({ addModelModalProvider: 'openrouter' });
		controller.closeAddModelModal();
		assert.strictEqual(store.state.addModelModal, false);
		assert.strictEqual(store.state.addModelModalProvider, 'openrouter');
		controller.openAddModel();
		assert.strictEqual(store.state.addModelModal, true);
		assert.strictEqual(store.state.addModelModalProvider, 'openrouter');
		assert.strictEqual(store.state.addModelRole, 'chat');
		assert.strictEqual(store.state.route, KnoxGuiRoute.Chat);
		controller.openAddModel('chat', { bulk: true });
		assert.strictEqual(store.state.addModelBulk, true);
		assert.strictEqual(store.state.addModelModalProvider, 'openrouter');
	});

	test('openAddModel restores the persisted provider tab after reload', async () => {
		const storage = disposables.add(new InMemoryStorageService());
		storage.store(UI_STATE_KEY, JSON.stringify({ addModelModalProvider: 'openrouter' }), StorageScope.PROFILE, StorageTarget.USER);
		const { controller, store } = createHarness({ storage });
		await timeout(0);
		assert.strictEqual(store.state.addModelModalProvider, 'openrouter');
		controller.openAddModel();
		assert.strictEqual(store.state.addModelModal, true);
		assert.strictEqual(store.state.addModelModalProvider, 'openrouter');
	});

	test('Memory and Checkpoint Graph editors stay on their route and ignore chat inbound', async () => {
		const { controller, store, posted } = createHarness({
			lock: KnoxGuiRoute.Memory,
			replies: {
				'history/list': [{ id: 'sess-1', title: 'Old chat' }],
				'history/load': { sessionId: 'sess-1', title: 'Old chat', history: [{ role: 'user', content: 'hi' }] },
			},
		});
		await timeout(0);
		assert.strictEqual(store.state.route, KnoxGuiRoute.Memory);
		assert.strictEqual(store.state.lockedRoute, KnoxGuiRoute.Memory);
		assert.ok(!posted.some(message => message.messageType === 'history/list' || message.messageType === 'history/load' || message.messageType === 'setActiveChatSession'));
		await controller.handleInbound('newSession', undefined, 'ns-1');
		assert.strictEqual(store.state.route, KnoxGuiRoute.Memory);
		store.patch({ route: KnoxGuiRoute.Chat, sessionId: 'stolen' });
		assert.strictEqual(store.state.route, KnoxGuiRoute.Memory);
		store.navigate('/');
		assert.strictEqual(store.state.route, KnoxGuiRoute.Memory);
		await controller.handleInbound('activeChatSessionChanged', { sessionId: 'other' }, 'ac-1');
		assert.strictEqual(store.state.route, KnoxGuiRoute.Memory);
		assert.notStrictEqual(store.state.sessionId, 'other');
	});

	test('Checkpoint Graph editor lists "This session" checkpoints for the mirrored chat session', async () => {
		const { controller, store, posted } = createHarness({
			lock: KnoxGuiRoute.CheckpointGraph,
			activeChatSessionId: 'chat-1',
			replies: { listCheckpoints: { checkpoints: [], total: 0 } },
		});
		await timeout(0);
		assert.strictEqual(store.state.checkpointChatSessionId, 'chat-1');
		store.patch({ checkpointView: 'checkpoints' });
		await controller.loadCheckpointList();
		const lastList = () => posted.filter(message => message.messageType === 'listCheckpoints').at(-1)?.data as { sessionId?: string; thisSessionOnly?: boolean } | undefined;
		assert.deepStrictEqual({ sessionId: lastList()?.sessionId, thisSessionOnly: lastList()?.thisSessionOnly }, { sessionId: 'chat-1', thisSessionOnly: true });

		const sessionBefore = store.state.sessionId;
		await controller.handleInbound('activeChatSessionChanged', { sessionId: 'chat-2' }, 'ac-2');
		await timeout(0);
		assert.strictEqual(store.state.checkpointChatSessionId, 'chat-2');
		assert.strictEqual(lastList()?.sessionId, 'chat-2');
		assert.strictEqual(store.state.sessionId, sessionBefore, 'the editor does not load the chat session');
		assert.strictEqual(store.state.route, KnoxGuiRoute.CheckpointGraph);
		assert.ok(!posted.some(message => message.messageType === 'history/load'));

		await controller.handleInbound('activeChatSessionChanged', { sessionId: null }, 'ac-3');
		await timeout(0);
		assert.strictEqual(lastList()?.sessionId, undefined, 'no chat session lists every checkpoint, like the reference');
	});

	test('Memory and Checkpoint Graph editors follow a language switch made in another view', async () => {
		const storage = disposables.add(new InMemoryStorageService());
		const chat = createHarness({ storage });
		const memory = createHarness({ storage, lock: KnoxGuiRoute.Memory });
		const checkpoints = createHarness({ storage, lock: KnoxGuiRoute.CheckpointGraph });
		await timeout(0);
		await chat.controller.setLanguage('zh');
		assert.strictEqual(memory.store.state.language, 'zh');
		assert.strictEqual(checkpoints.store.state.language, 'zh');
		await checkpoints.controller.setLanguage('en');
		assert.strictEqual(chat.store.state.language, 'en');
		assert.strictEqual(memory.store.state.language, 'en');
		storage.store('knox.gui.language', 'fr', StorageScope.PROFILE, StorageTarget.USER);
		assert.strictEqual(memory.store.state.language, 'en', 'unsupported values are ignored');
	});

	test('stream response envelopes are not applied as host inbound', async () => {
		const { controller, store } = createHarness();
		await timeout(0);
		const history = store.state.history.length;
		await controller.handleInbound('llm/streamChat', { done: false, status: 'success', content: [{ content: 'Since' }] }, 'stream-1');
		await controller.handleInbound('newSession', { done: true, status: 'success', content: undefined }, 'ns-dup');
		assert.strictEqual(store.state.history.length, history);
	});

	for (const [name, route, tabBar] of [
		['Checkpoint Graph', KnoxGuiRoute.CheckpointGraph, '.knox-gui-checkpoint-tab-bar'],
		['Memory', KnoxGuiRoute.Memory, '.knox-gui-memory-tabbar'],
	] as const) {
		test(`${name} editor does not render a duplicate language toggle`, async () => {
			const { controller, store } = createHarness({ lock: route });
			await timeout(0);
			store.patch({ language: 'en', memoryTabHydrated: true });
			const parent = document.createElement('div');
			document.body.appendChild(parent);
			disposables.add({ dispose: () => parent.remove() });
			const hoverService = new class extends mock<IHoverService>() {
				override setupDelayedHover() {
					return { dispose() { } };
				}
			};
			const openerService = new class extends mock<IOpenerService>() {
				override async open(): Promise<boolean> {
					return true;
				}
			};
			const languageService = new class extends mock<ILanguageService>() {
				override getLanguageIdByLanguageName(): string | null {
					return null;
				}
				override isRegisteredLanguageId(): boolean {
					return false;
				}
				override requestBasicLanguageFeatures(): void { }
				override guessLanguageIdByFilepathOrFirstLine(): string | null {
					return null;
				}
			};
			const markdownRendererService = new class extends mock<IMarkdownRendererService>() {
				override render(markdown: IMarkdownString, options?: import('../../../../base/browser/markdownRenderer.js').MarkdownRenderOptions, target?: HTMLElement) {
					return renderMarkdown(markdown, options, target);
				}
				override setDefaultCodeBlockRenderer(): void { }
			};
			const widget = disposables.add(new KnoxGuiWidget(parent, controller, openerService, hoverService, languageService, { getModel: () => null } as unknown as IModelService, markdownRendererService));
			assert.ok(widget.root.querySelector(tabBar));
			assert.strictEqual(widget.root.querySelector(`${tabBar} [data-testid="knox-gui-language-toggle"]`), null);
		});
	}

	test('KN-346 focusEdit / addCodeToEdit / Esc exit the native composer', async () => {
		const { controller, store, posted } = createHarness();
		await timeout(0);
		store.patch({
			history: [{ id: 'u1', role: 'user', content: 'hello' }],
			sessionId: 'prev',
			mode: 'agent',
		});
		await controller.handleInbound('focusEdit', undefined, 'fe-1');
		assert.strictEqual(store.state.mode, 'edit');
		assert.strictEqual(store.state.inputFocused, true);
		assert.strictEqual(store.state.editStatus, 'not-started');
		assert.strictEqual(store.state.history.length, 0);
		assert.notStrictEqual(store.state.sessionId, 'prev');
		assert.ok(posted.some(message => message.messageType === 'history/save'));

		await controller.handleInbound('addCodeToEdit', {
			filepath: 'file:///src/a.ts',
			contents: 'const x = 1;',
			range: { start: { line: 0, character: 0 }, end: { line: 0, character: 12 } },
		}, 'add-1');
		assert.strictEqual(store.state.codeToEdit.length, 1);
		assert.strictEqual(store.state.codeToEdit[0].filepath, 'file:///src/a.ts');
		await controller.handleInbound('addCodeToEdit', {
			filepath: 'file:///src/a.ts',
			contents: 'const x = 1;',
			range: { start: { line: 0, character: 0 }, end: { line: 0, character: 12 } },
		}, 'add-2');
		assert.strictEqual(store.state.codeToEdit.length, 1);

		posted.length = 0;
		await controller.handleInbound('exitEditMode', undefined, 'ex-1');
		assert.strictEqual(store.state.mode, 'agent');
		assert.strictEqual(store.state.codeToEdit.length, 0);
		assert.ok(posted.some(message => message.messageType === 'edit/exit'));
		assert.ok(posted.some(message => message.messageType === 'rejectDiff'));

		store.patch({ mode: 'chat', history: [{ id: 'u2', role: 'user', content: 'ask' }], sessionId: 'chat-prev' });
		await controller.handleInbound('focusEdit', undefined, 'fe-2');
		assert.strictEqual(store.state.mode, 'edit');
		assert.strictEqual(store.state.editReturnMode, 'chat');
		await controller.handleInbound('exitEditMode', undefined, 'ex-2');
		assert.strictEqual(store.state.mode, 'agent');
	});

	test('NP-02 host newSession leaves edit mode: rejects diffs, posts edit/exit, keeps the fresh session', async () => {
		const { controller, store, posted } = createHarness({
			replies: {
				'history/list': [{ sessionId: 'last', title: 'Last', dateCreated: '1' }],
				'history/load': { sessionId: 'last', title: 'Last', history: [{ message: { role: 'user', content: 'hi' } }] },
			},
		});
		await timeout(0);
		store.patch({
			mode: 'chat',
			editReturnMode: 'chat',
			sessionId: 'edit-session',
			history: [{ id: 'e', role: 'user', content: 'edit this' }],
		});
		await controller.handleInbound('focusEdit', undefined, 'np02-fe');
		assert.strictEqual(store.state.mode, 'edit');
		store.patch({ codeToEdit: [{ filepath: 'file:///src/a.ts', contents: 'x', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } }] });
		posted.length = 0;
		await controller.handleInbound('newSession', undefined, 'np02-ns');
		assert.strictEqual(store.state.mode, 'agent');
		assert.strictEqual(store.state.codeToEdit.length, 0);
		assert.ok(posted.some(message => message.messageType === 'rejectDiff'));
		assert.ok(posted.some(message => message.messageType === 'edit/exit'));
		assert.notStrictEqual(store.state.sessionId, 'last', 'new session must not be replaced by the last saved session');
		assert.strictEqual(store.state.history.length, 0);
	});

	test('NP-06 highlightedCode keeps two ranges of one file but drops an exact duplicate', async () => {
		const { controller, store } = createHarness();
		await timeout(0);
		const rif = (start: number, end: number) => ({ rangeInFileWithContents: { filepath: 'file:///src/a.ts', contents: 'x', range: { start: { line: start, character: 0 }, end: { line: end, character: 1 } } } });
		await controller.handleInbound('highlightedCode', rif(0, 2), 'np06-a');
		await controller.handleInbound('highlightedCode', rif(5, 8), 'np06-b');
		await controller.handleInbound('highlightedCode', rif(5, 8), 'np06-c');
		const blocks = store.state.inputDoc.filter(block => block.type === 'codeBlock');
		assert.strictEqual(blocks.length, 2);
		assert.deepStrictEqual(blocks.map(block => block.type === 'codeBlock' ? block.itemName : ''), ['a.ts (1-3)', 'a.ts (6-9)']);
	});

	test('NP-12 host addApiKey opens Add Model and answers the request', async () => {
		const { controller, store, posted } = createHarness({ silent: ['addApiKey'] });
		await timeout(0);
		await controller.handleInbound('addApiKey', undefined, 'np12');
		assert.strictEqual(store.state.addModelModal, true);
		assert.ok(posted.some(message => message.messageId === 'np12'));
	});

	test('NP-07 isKnoxInputFocused only answers true on the chat page', async () => {
		const { controller, store, posted } = createHarness({ silent: ['isKnoxInputFocused'] });
		await timeout(0);
		const reply = (id: string) => posted.filter(message => message.messageId === id).at(-1)?.data;
		store.patch({ inputFocused: true });
		await controller.handleInbound('isKnoxInputFocused', undefined, 'np07-a');
		assert.strictEqual(reply('np07-a'), true);
		store.navigate('/config');
		store.patch({ inputFocused: true });
		await controller.handleInbound('isKnoxInputFocused', undefined, 'np07-b');
		assert.strictEqual(reply('np07-b'), false);
	});

	test('NP-22 focusEditWithoutClear enters edit mode now but focuses the composer after 2 s', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const { controller, store } = createHarness();
		await timeout(0);
		await controller.handleInbound('focusEditWithoutClear', undefined, 'np22');
		assert.strictEqual(store.state.mode, 'edit');
		assert.strictEqual(store.state.inputFocused, false, 'focus waits for the delay');
		await timeout(2100);
		assert.strictEqual(store.state.inputFocused, true);
	}));

	test('NP-28 the draft session is not written while streaming and is flushed once the stream ends (persistControl)', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const storage = disposables.add(new InMemoryStorageService());
		const { store } = createHarness({ storage });
		await timeout(0);
		store.patch({ setupComplete: true, sessionId: 'persist-1', isStreaming: true, history: [{ id: 'u', role: 'user', content: 'draft body' }] });
		await timeout(2500);
		assert.strictEqual(storage.get(DRAFT_SESSION_KEY, StorageScope.WORKSPACE), undefined, 'no write on stream tokens');
		store.patch({ isStreaming: false });
		await timeout(2500);
		assert.ok(storage.get(DRAFT_SESSION_KEY, StorageScope.WORKSPACE)?.includes('draft body'), 'the last state is flushed after streaming');
	}));

	test('K-042 typing while the agent runs queues the message, persists it, and restores it after a reload', async () => {
		const storage = disposables.add(new InMemoryStorageService());
		const { controller, store } = createHarness({ storage });
		await timeout(0);
		store.patch({ setupComplete: true, sessionId: 'q-1', isStreaming: true, history: [{ id: 'u', role: 'user', content: 'first' }] });
		store.setInput('and then fix the tests');
		await controller.submit();
		assert.deepStrictEqual(store.state.messageQueue.map(m => [m.sessionId, m.text]), [['q-1', 'and then fix the tests']]);
		assert.strictEqual(store.state.history.length, 1, 'nothing was sent yet');
		assert.strictEqual(store.state.inputDoc.length > 0 ? JSON.stringify(store.state.inputDoc).includes('fix the tests') : false, false, 'the composer is cleared');
		assert.ok(storage.get('knox.gui.messageQueue', StorageScope.WORKSPACE)?.includes('fix the tests'), 'written on every change');
		store.setInput('   ');
		await controller.submit();
		assert.strictEqual(store.state.messageQueue.length, 1, 'blank input is not queued');
		const reloaded = createHarness({ storage });
		await timeout(0);
		assert.deepStrictEqual(reloaded.store.state.messageQueue.map(m => m.text), ['and then fix the tests']);
		assert.strictEqual(reloaded.store.state.isStreaming, false, 'a restored queue is never sent by itself');
		reloaded.controller.removeQueuedMessage(reloaded.store.state.messageQueue[0].id);
		assert.strictEqual(storage.get('knox.gui.messageQueue', StorageScope.WORKSPACE), undefined, 'an empty queue clears the storage key');
	});

	test('K-043 pins persist, content search fills snippets, and fork saves a cut copy as a new session', async () => {
		const storage = disposables.add(new InMemoryStorageService());
		const { controller, store, posted } = createHarness({
			storage,
			replies: {
				'history/search': [{ sessionId: 'old', snippet: '…the needle…' }],
				'history/save': null,
				'history/load': { sessionId: 'fork-loaded', title: 'Chat (fork)', history: [{ message: { role: 'user', content: 'q1' } }] },
			},
		});
		await timeout(0);
		controller.togglePinnedSession('old');
		assert.deepStrictEqual(store.state.pinnedSessionIds, ['old']);
		const reloaded = createHarness({ storage });
		await timeout(0);
		assert.deepStrictEqual(reloaded.store.state.pinnedSessionIds, ['old']);

		controller.searchHistoryContent('n');
		await timeout(300);
		assert.ok(!posted.some(m => m.messageType === 'history/search'), 'one character is not searched');
		controller.searchHistoryContent('needle');
		await timeout(300);
		assert.deepStrictEqual(store.state.historyContentHits, { old: '…the needle…' });
		controller.searchHistoryContent('');
		assert.deepStrictEqual(store.state.historyContentHits, {});

		store.patch({
			sessionId: 'src', sessionTitle: 'Chat',
			history: [
				{ id: 'u1', role: 'user', content: 'q1' }, { id: 'a1', role: 'assistant', content: 'r1' },
				{ id: 'u2', role: 'user', content: 'q2' }, { id: 'a2', role: 'assistant', content: 'r2' },
			],
		});
		await controller.forkSession(2);
		const saves = posted.filter(m => m.messageType === 'history/save');
		const fork = saves[saves.length - 1].data as { sessionId: string; title: string; history: unknown[] };
		assert.notStrictEqual(fork.sessionId, 'src');
		assert.strictEqual(fork.history.length, 2, 'forking at a user message stops before it');
		assert.ok(fork.title.endsWith('(fork)'));
		assert.strictEqual(store.state.sessionId, 'fork-loaded');
		assert.ok(JSON.stringify(store.state.inputDoc).includes('q2'), 'the user message is offered for editing');
	});

	test('I-08 leaving edit mode reloads the newest workspace session, else opens a new chat', async () => {
		const { controller, store, posted } = createHarness({
			replies: {
				'history/list': [{ sessionId: 'last', title: 'Last', dateCreated: '1' }],
				'history/load': { sessionId: 'last', title: 'Last', history: [{ message: { role: 'user', content: 'hi' } }] },
			},
		});
		await timeout(0);
		controller.workspaceDirectory = '/repo';
		store.patch({ mode: 'edit', sessionId: 'edit-session', history: [{ id: 'e', role: 'user', content: 'edit this' }] });
		await controller.exitEditMode();
		assert.strictEqual(store.state.mode, 'agent');
		assert.strictEqual(store.state.sessionId, 'last');
		assert.ok(posted.some(message => message.messageType === 'history/list'));

		const bare = createHarness();
		await timeout(0);
		bare.store.patch({ mode: 'edit', sessionId: 'edit-session', history: [{ id: 'e', role: 'user', content: 'edit this' }] });
		await bare.controller.exitEditMode();
		assert.notStrictEqual(bare.store.state.sessionId, 'edit-session');
		assert.strictEqual(bare.store.state.history.length, 0);
	});

	test('KN-346 composer Escape exits edit mode', async () => {
		const { controller, store, posted } = createHarness();
		await timeout(0);
		store.patch({
			mode: 'edit',
			codeToEdit: [{ filepath: 'file:///src/a.ts', range: { start: { line: 0 }, end: { line: 1 } } }],
		});
		const parent = document.createElement('div');
		document.body.appendChild(parent);
		disposables.add({ dispose: () => parent.remove() });
		const hoverService = new class extends mock<IHoverService>() {
			override setupDelayedHover() {
				return { dispose() { } };
			}
		};
		const openerService = new class extends mock<IOpenerService>() {
			override async open(): Promise<boolean> {
				return true;
			}
		};
		const languageService = new class extends mock<ILanguageService>() {
			override getLanguageIdByLanguageName(): string | null {
				return null;
			}
			override isRegisteredLanguageId(): boolean {
				return false;
			}
			override requestBasicLanguageFeatures(): void { }
			override guessLanguageIdByFilepathOrFirstLine(): string | null {
				return null;
			}
		};
		const markdownRendererService = new class extends mock<IMarkdownRendererService>() {
			override render(markdown: IMarkdownString, options?: import('../../../../base/browser/markdownRenderer.js').MarkdownRenderOptions, target?: HTMLElement) {
				return renderMarkdown(markdown, options, target);
			}
			override setDefaultCodeBlockRenderer(): void { }
		};
		const widget = disposables.add(new KnoxGuiWidget(parent, controller, openerService, hoverService, languageService, { getModel: () => null } as unknown as IModelService, markdownRendererService));
		const editor = widget.root.querySelector('[data-testid="knox-gui-input"]') as HTMLElement | null;
		assert.ok(editor);
		editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
		await timeout(0);
		assert.strictEqual(store.state.mode, 'agent');
		assert.ok(posted.some(message => message.messageType === 'edit/exit'));
	});

	test('KN-346 single-range submit posts edit/sendPrompt', async () => {
		const { controller, store, posted } = createHarness();
		await timeout(0);
		store.patch({
			mode: 'edit',
			modelTitle: 'GPT-4o',
			codeToEdit: [{
				filepath: 'file:///src/a.ts',
				contents: 'const x = 1;',
				range: { start: { line: 0, character: 0 }, end: { line: 0, character: 12 } },
			}],
		});
		store.setInput('rename x to y');
		await controller.submit();
		await timeout(0);
		const send = posted.find(message => message.messageType === 'edit/sendPrompt');
		assert.ok(send);
		const data = send.data as { prompt?: string; range?: { filepath?: string }; selectedModelTitle?: string };
		assert.ok(String(data.prompt).includes('rename x to y'));
		assert.strictEqual(data.range?.filepath, 'file:///src/a.ts');
		assert.strictEqual(data.selectedModelTitle, 'GPT-4o');
		assert.strictEqual(store.state.editStatus, 'streaming');
		assert.ok(!posted.some(message => message.messageType === 'llm/streamChat'));
	});

	test('KN-350 setMode posts setAgentMode for the Chat/Agent switch', async () => {
		const { controller, store, posted } = createHarness();
		await timeout(0);
		assert.strictEqual(store.state.mode, 'agent');
		controller.setMode('chat');
		assert.strictEqual(store.state.mode, 'chat');
		assert.ok(posted.some(message => message.messageType === 'setAgentMode' && (message.data as { active?: boolean }).active === false));
		posted.length = 0;
		controller.setMode('agent');
		assert.strictEqual(store.state.mode, 'agent');
		assert.ok(posted.some(message => message.messageType === 'setAgentMode' && (message.data as { active?: boolean }).active === true));
		posted.length = 0;
		controller.setMode('agent');
		assert.ok(!posted.some(message => message.messageType === 'setAgentMode'));
	});

	test('KN-350 agentModeChanged can force Agent on; turning it off no longer switches to Chat', async () => {
		const { controller, store } = createHarness();
		await timeout(0);
		assert.strictEqual(store.state.mode, 'agent');
		await controller.handleInbound('agentModeChanged', { active: false }, 'am-off');
		assert.strictEqual(store.state.mode, 'agent');
		store.patch({ mode: 'chat' });
		await controller.handleInbound('agentModeChanged', { active: true }, 'am-on');
		assert.strictEqual(store.state.mode, 'agent');
		await controller.handleInbound('setAgentMode', {
			done: true,
			status: 'success',
			content: { success: true, active: true },
		}, 'am-reply');
		assert.strictEqual(store.state.mode, 'agent');
		store.patch({ mode: 'edit' });
		await controller.handleInbound('agentModeChanged', { active: false }, 'am-edit');
		assert.strictEqual(store.state.mode, 'edit');
	});

	test('KN-350 agent tab stays Agent until the model is known not to support tools', async () => {
		const { controller, store, posted } = createHarness();
		await timeout(0);
		assert.strictEqual(store.state.mode, 'agent');
		controller.applyConfig({
			config: {
				models: [{ title: 'Local', provider: 'ollama', model: 'llama3' }],
				selectedModelTitle: 'Local',
			},
		});
		assert.strictEqual(store.state.toolsSupported, true);
		assert.strictEqual(store.state.mode, 'agent');
		assert.ok(!posted.some(message => message.messageType === 'setAgentMode' && (message.data as { active?: boolean }).active === false));
		posted.length = 0;
		controller.applyConfig({
			config: {
				models: [{ title: 'Local', provider: 'ollama', model: 'llama3', capabilities: { tools: false } }],
				selectedModelTitle: 'Local',
			},
		});
		assert.strictEqual(store.state.toolsSupported, false);
		assert.strictEqual(store.state.mode, 'chat');
		assert.ok(posted.some(message => message.messageType === 'setAgentMode' && (message.data as { active?: boolean }).active === false));
		posted.length = 0;
		controller.applyConfig({
			config: {
				models: [{ title: 'Local', provider: 'ollama', model: 'llama3', capabilities: { tools: true } }],
				selectedModelTitle: 'Local',
			},
		});
		assert.strictEqual(store.state.toolsSupported, true);
		assert.strictEqual(store.state.mode, 'agent');
	});

	test('KN-371 toolsSupported follows /v1/models catalog instead of provider name', async () => {
		const grok = { title: 'Grok', provider: 'knoxchat', model: 'spacexai/grok-4.7' };
		const { controller, store } = createHarness();
		await timeout(0);
		controller.applyConfig({
			config: {
				models: [grok],
				selectedModelTitle: 'Grok',
			},
		});
		assert.strictEqual(store.state.toolsSupported, true);
		assert.strictEqual(store.state.mode, 'agent');
		knoxGuiSeedModelCatalog([{ id: 'spacexai/grok-4.7', supportedParameters: ['tools', 'tool_choice'] }]);
		controller.selectModel('chat', 'Grok');
		assert.strictEqual(store.state.toolsSupported, true);
		assert.strictEqual(store.state.mode, 'agent');

		const loaded = createHarness({
			listModels: [
				{ id: 'spacexai/grok-4.7', name: 'Grok', supported_parameters: ['tools'] },
				{ id: 'chat-only', name: 'Chat', supported_parameters: ['temperature'] },
			],
		});
		await loaded.controller.loadKnoxChatModels();
		loaded.controller.applyConfig({
			config: {
				models: [grok],
				selectedModelTitle: 'Grok',
			},
		});
		assert.strictEqual(loaded.store.state.toolsSupported, true);
		assert.ok(loaded.store.state.knoxChatModels.some(model => model.model === 'spacexai/grok-4.7' && model.supportsTools === true));
		assert.ok(loaded.store.state.knoxChatModels.some(model => model.model === 'chat-only' && model.supportsTools !== true));
	});

	test('KN-354 addImageAttachment appends composer images and focuses input', async () => {
		const { controller, store } = createHarness();
		await timeout(0);
		await controller.handleInbound('addImageAttachment', {
			imageUrl: 'data:image/png;base64,QQ==',
			name: 'screenshot.png',
		}, 'img-1');
		assert.strictEqual(store.state.images.length, 1);
		assert.strictEqual(store.state.images[0].name, 'screenshot.png');
		assert.strictEqual(store.state.images[0].imageUrl, 'data:image/png;base64,QQ==');
		assert.strictEqual(store.state.inputFocused, true);
		await controller.handleInbound('addImageAttachment', {
			imageUrl: 'data:image/png;base64,Qg==',
		}, 'img-2');
		assert.strictEqual(store.state.images.length, 2);
		assert.strictEqual(store.state.images[1].name, 'image');
		await controller.handleInbound('addImageAttachment', { name: 'no-url' }, 'img-skip');
		assert.strictEqual(store.state.images.length, 2);
	});

	test('KN-360 oauth/update patches connected handle and failed error kinds', async () => {
		const { controller, store } = createHarness();
		await timeout(0);
		await controller.handleInbound('knoxchat/oauth/update', {
			state: 'success',
			account: { userId: 9, username: 'knox', tokenId: 1, connectedAt: 0 },
		}, 'oauth-1');
		assert.strictEqual(store.state.oauthConnected, true);
		assert.strictEqual(store.state.oauthHandle, '@knox');
		assert.strictEqual(store.state.oauthStatus, 'success');
		assert.strictEqual(store.state.oauthError, undefined);
		await controller.handleInbound('knoxchat/oauth/update', {
			state: 'failed',
			error: 'denied',
		}, 'oauth-2');
		assert.strictEqual(store.state.oauthConnected, false);
		assert.strictEqual(store.state.oauthError, 'denied');
		assert.strictEqual(store.state.oauthStatus, 'failed');
		await controller.handleInbound('knoxchat/oauth/update', {
			state: 'waiting_for_consent',
		}, 'oauth-3');
		assert.strictEqual(store.state.oauthStatus, 'waiting_for_consent');
		assert.strictEqual(store.state.oauthError, undefined);
	});

	test('openrouter/oauth/update patches a parallel session without touching KnoxChat oauth', async () => {
		const { controller, store } = createHarness();
		await timeout(0);
		await controller.handleInbound('openrouter/oauth/update', {
			state: 'success',
			account: { label: 'KnoxCoder', creatorUserId: 'user_abc', keyHash: 'deadbeef', connectedAt: 0 },
		}, 'or-oauth-1');
		assert.strictEqual(store.state.openrouterOauthConnected, true);
		assert.strictEqual(store.state.openrouterOauthHandle, 'KnoxCoder');
		assert.strictEqual(store.state.openrouterOauthStatus, 'success');
		assert.strictEqual(store.state.openrouterOauthKeyHash, 'deadbeef');
		assert.strictEqual(store.state.oauthConnected, false);
		await controller.handleInbound('openrouter/oauth/update', {
			state: 'failed',
			error: 'denied',
		}, 'or-oauth-2');
		assert.strictEqual(store.state.openrouterOauthConnected, false);
		assert.strictEqual(store.state.openrouterOauthError, 'denied');
		assert.strictEqual(store.state.openrouterOauthStatus, 'failed');
		await controller.handleInbound('openrouter/oauth/update', {
			state: 'waiting_for_consent',
		}, 'or-oauth-3');
		assert.strictEqual(store.state.openrouterOauthStatus, 'waiting_for_consent');
		assert.strictEqual(store.state.openrouterOauthError, undefined);
	});

	test('openrouter/listModels fixture populates a searchable catalog', async () => {
		const { controller, store, posted } = createHarness({
			replies: {
				'openrouter/listModels': [
					{ id: 'anthropic/claude-sonnet-4.6', name: 'Claude Sonnet 4.6', supported_parameters: ['tools'] },
					{ id: 'openai/gpt-4o', name: 'GPT-4o', supported_parameters: ['temperature'] },
				],
			},
		});
		await timeout(0);
		posted.length = 0;
		await controller.loadOpenRouterModels();
		assert.ok(posted.some(message => message.messageType === 'openrouter/listModels'));
		assert.ok(store.state.openrouterModels.some(model => model.model === 'anthropic/claude-sonnet-4.6' && model.supportsTools === true));
		assert.ok(store.state.openrouterModels.some(model => model.model === 'openai/gpt-4o' && model.supportsTools !== true));
		assert.strictEqual(store.state.openrouterModelsLoading, false);
	});

	test('openrouter/listModels uses ~latest alias floor pricing from GET /api/v1/models', async () => {
		const { controller, store } = createHarness({
			replies: {
				'openrouter/listModels': [
					{
						id: 'z-ai/glm-5.3-flash',
						name: 'Z.ai: GLM 5.3 Flash',
						pricing: { prompt: '0.00000015', completion: '0.0000005' },
					},
					{
						id: '~z-ai/glm-flash-latest',
						name: 'Z.ai: GLM Flash Latest',
						alias_target: { name: 'Z.ai: GLM 5.3 Flash', slug: 'z-ai/glm-5.3-flash' },
						pricing: { prompt: '0.00000002', completion: '0.0000002475' },
					},
				],
			},
		});
		await timeout(0);
		await controller.loadOpenRouterModels();
		const flash = store.state.openrouterModels.find(model => model.model === 'z-ai/glm-5.3-flash');
		assert.ok(flash?.pricing);
		assert.deepStrictEqual(formatModelPricingPerMillion(flash.pricing), {
			badge: '$0.02/0.2475',
			title: '$0.02 / $0.2475 per 1M tokens',
		});
	});

	test('openrouter/listModels error leaves the catalog empty for cannotLoadModels', async () => {
		const { controller, store } = createHarness();
		await timeout(0);
		await controller.loadOpenRouterModels();
		assert.deepStrictEqual(store.state.openrouterModels, []);
		assert.strictEqual(store.state.openrouterModelsLoading, false);
	});

	test('navigating to /addModel/provider/openrouter requests openrouter/listModels', async () => {
		const { controller, posted } = createHarness({
			replies: {
				'openrouter/listModels': [{ id: 'openai/gpt-4o', name: 'GPT-4o' }],
			},
		});
		await timeout(0);
		posted.length = 0;
		controller.store.navigate('/addModel/provider/openrouter');
		await timeout(0);
		assert.ok(posted.some(message => message.messageType === 'openrouter/listModels'));
	});

	test('OpenRouter connect with OAuth omits apiKey; pasted key is stored on the model', async () => {
		const { controller, store, posted } = createHarness();
		await timeout(0);
		store.navigate('/addModel/provider/openrouter');
		store.patch({
			openrouterOauthConnected: true,
			openrouterSelectedModel: 'openai/gpt-4o',
			openrouterModels: [{ title: 'GPT-4o', model: 'openai/gpt-4o', category: 'OpenAI', contextLength: 128000 }],
			addModelDraft: {},
		});
		posted.length = 0;
		await controller.addConfiguredModel('openrouter', {
			title: 'GPT-4o',
			params: { title: 'GPT-4o', model: 'openai/gpt-4o', contextLength: 128000 },
		});
		const oauthAdd = posted.find(message => message.messageType === 'config/addModel');
		const oauthModel = (oauthAdd?.data as { model?: Record<string, unknown> } | undefined)?.model;
		assert.strictEqual(oauthModel?.provider, 'openrouter');
		assert.ok(!oauthModel?.apiKey);

		store.navigate('/addModel/provider/openrouter');
		store.patch({
			openrouterOauthConnected: false,
			addModelDraft: { apiKey: 'sk-or-v1-paste' },
		});
		posted.length = 0;
		await controller.addConfiguredModel('openrouter', {
			title: 'GPT-4o',
			params: { title: 'GPT-4o', model: 'openai/gpt-4o', contextLength: 128000 },
		});
		const pastedAdd = posted.find(message => message.messageType === 'config/addModel');
		const pastedModel = (pastedAdd?.data as { model?: Record<string, unknown> } | undefined)?.model;
		assert.strictEqual(pastedModel?.provider, 'openrouter');
		assert.strictEqual(pastedModel?.apiKey, 'sk-or-v1-paste');
	});

	test('KN-370 setTheme and setColors patch token colors and CSS vars', async () => {
		const { controller, store } = createHarness();
		await timeout(0);
		await controller.handleInbound('setTheme', {
			theme: {
				base: 'vs',
				rules: [{ token: 'keyword', foreground: '0000ff' }],
				colors: { 'editor.background': '#ffffff' },
			},
		}, 'theme-1');
		assert.strictEqual(store.state.vscTheme?.base, 'vs');
		assert.strictEqual(store.state.vscColors['--vscode-editor-background'], '#ffffff');
		assert.strictEqual(store.state.vscTokenColors['.hljs-keyword'], '#0000ff');
		await controller.handleInbound('setColors', {
			'--vscode-button-background': '#159994',
		}, 'colors-1');
		assert.strictEqual(store.state.vscColors['--vscode-button-background'], '#159994');
		assert.strictEqual(store.state.vscColors['--vscode-editor-background'], '#ffffff');
		await controller.handleInbound('setTheme', { unused: true }, 'theme-skip');
		assert.strictEqual(store.state.vscTheme?.base, 'vs');
	});

	test('S-14 /stats does not request local token tables', async () => {
		const { controller, posted } = createHarness();
		await timeout(0);
		await controller.onNavigated('/stats');
		assert.ok(!posted.some(message => message.messageType.startsWith('stats/')));
	});

	test('KN-373 answerAskUser writes the answers as tool output without tools/call', async () => {
		const { controller, store, posted } = createHarness();
		await timeout(0);
		const args = JSON.stringify({ questions: [{ id: 'q1', prompt: 'Pick?', options: ['a'] }] });
		store.patch({
			history: [{
				id: 'a',
				role: 'assistant',
				content: '',
				toolCalls: [{
					id: 'ask-1',
					name: 'builtin_ask_user',
					arguments: args,
					status: 'generated',
					parsedArgs: { questions: [{ id: 'q1', prompt: 'Pick?', options: ['a'] }] },
					questions: [{ id: 'q1', prompt: 'Pick?', options: ['a'] }],
				}],
			}],
		});
		controller.answerAskUser('ask-1', { q1: 'a' });
		const call = controller.findTool('ask-1');
		assert.strictEqual(call?.status, 'done');
		assert.strictEqual(call?.arguments, args);
		assert.deepStrictEqual(call?.answers, { q1: 'a' });
		assert.strictEqual(call?.output, 'Q: Pick?\nA: a');
		await timeout(0);
		assert.ok(!posted.some(message => message.messageType === 'tools/call'));
		assert.ok(posted.some(message => message.messageType === 'brain/store'));
	});

	test('invalid ask_user arguments settle with an error instead of blocking the turn', async () => {
		const { controller, store, posted } = createHarness();
		await timeout(0);
		store.patch({
			history: [{
				id: 'a',
				role: 'assistant',
				content: '',
				toolCalls: [{
					id: 'ask-empty',
					name: 'builtin_ask_user',
					arguments: '{}',
					status: 'generated',
					parsedArgs: {},
				}],
			}],
		});
		await controller.resolveTools([controller.findTool('ask-empty')!]);
		const empty = controller.findTool('ask-empty');
		assert.strictEqual(empty?.status, 'done');
		assert.ok(empty?.output?.includes('No valid questions were provided'));
		assert.ok(!posted.some(message => message.messageType === 'tools/call'));

		store.patch({
			history: [{
				id: 'a2',
				role: 'assistant',
				content: '',
				toolCalls: [{
					id: 'ask-cursor',
					name: 'AskQuestion',
					arguments: JSON.stringify({
						title: 'Which syscall to add?',
						questions: [{ id: 'syscall', options: [{ id: 'a', label: 'ENOSYS stub' }] }],
					}),
					status: 'generated',
					parsedArgs: {
						title: 'Which syscall to add?',
						questions: [{ id: 'syscall', options: [{ id: 'a', label: 'ENOSYS stub' }] }],
					},
				}],
			}],
		});
		await controller.resolveTools([controller.findTool('ask-cursor')!]);
		const recovered = controller.findTool('ask-cursor');
		assert.strictEqual(recovered?.status, 'generated');
		assert.strictEqual(recovered?.questions?.[0]?.prompt, 'Which syscall to add?');
		assert.deepStrictEqual(recovered?.questions?.[0]?.options, ['ENOSYS stub']);
	});

	test('denyTool writes the permission-denied output and continues the turn', async () => {
		const { controller, store, posted } = createHarness();
		await timeout(0);
		store.patch({
			toolsSupported: false, // the continuation is a plain stream here; shared-turn denial is covered below
			history: [
				{ id: 'u', role: 'user', content: 'go' },
				{
					id: 'a',
					role: 'assistant',
					content: '',
					toolCalls: [{ id: 'w-1', name: 'builtin_write_file', arguments: '{}', status: 'generated' }],
				},
			],
		});
		controller.denyTool('w-1');
		const call = controller.findTool('w-1');
		assert.strictEqual(call?.status, 'done');
		assert.ok(call?.output?.startsWith('Blocked: this tool was not approved.'));
		await timeout(0);
		const stream = posted.find(message => message.messageType === 'llm/streamChat');
		assert.ok(stream, 'denial continues with another model round');
		const messages = (stream.data as { messages: Array<{ role: string; toolCallId?: string; content: unknown }> }).messages;
		assert.ok(messages.some(message => message.role === 'tool' && message.toolCallId === 'w-1'));
	});

	test('A-09 a hard policy deny writes the denied output without running the tool', async () => {
		const { controller, store, posted } = createHarness({
			replies: { 'knox/evaluateToolPolicy': { hardDeny: true, autoApproved: false, reason: 'Path ~/.ssh/id_rsa is denied' } },
		});
		await timeout(0);
		const pending = { id: 'r-1', name: 'builtin_read_file', arguments: '{"filepath":"~/.ssh/id_rsa"}', status: 'generated' as const };
		store.patch({ history: [{ id: 'u', role: 'user', content: 'go' }, { id: 'a', role: 'assistant', content: '', toolCalls: [pending] }] });
		await controller.resolveTools([pending]);
		const call = controller.findTool('r-1');
		assert.strictEqual(call?.status, 'done');
		assert.ok(call?.output?.startsWith('Blocked: this tool was not approved.'));
		assert.ok(!posted.some(message => message.messageType === 'tools/call'));
		const soul = posted.find(message => message.messageType === 'brain/recordSoulEvent');
		assert.deepStrictEqual((soul?.data as { kind: string; summary: string }).kind, 'tool_denied');
		assert.strictEqual((soul?.data as { summary: string }).summary, 'Path ~/.ssh/id_rsa is denied');
		const policy = posted.find(message => message.messageType === 'knox/evaluateToolPolicy');
		assert.deepStrictEqual((policy?.data as { args: unknown }).args, { filepath: '~/.ssh/id_rsa' });
	});

	test('A-09 policy ask keeps a call pending even in fullAuto; the local fallback still guards checkpoint restore', async () => {
		const { controller, store, posted } = createHarness({
			replies: { 'knox/evaluateToolPolicy': { hardDeny: false, autoApproved: false } },
		});
		await timeout(0);
		const pending = { id: 'w-1', name: 'builtin_write_file', arguments: '{"filepath":"/etc/hosts"}', status: 'generated' as const };
		store.patch({ permissionMode: 'fullAuto', history: [{ id: 'u', role: 'user', content: 'go' }, { id: 'a', role: 'assistant', content: '', toolCalls: [pending] }] });
		await controller.resolveTools([pending]);
		assert.strictEqual(controller.findTool('w-1')?.status, 'generated');
		assert.ok(!posted.some(message => message.messageType === 'tools/call'));

		const fallback = createHarness();
		await timeout(0);
		const restore = { id: 'c-1', name: 'builtin_workspace_checkpoint', arguments: '{"action":"restore"}', status: 'generated' as const };
		fallback.store.patch({ permissionMode: 'fullAuto', history: [{ id: 'u', role: 'user', content: 'go' }, { id: 'a', role: 'assistant', content: '', toolCalls: [restore] }] });
		await fallback.controller.resolveTools([restore]);
		assert.strictEqual(fallback.controller.findTool('c-1')?.status, 'generated');
	});

	test('A-17 /autonomous runs the core loop, routes approvals to it and appends the final result', async () => {
		const { controller, store, posted } = createHarness({
			replies: { 'brain/runAutonomousLoop': { success: true, iterations: 2, final_result: 'Fixed the panic.', cancelled: false, checkpoints_created: 0 } },
		});
		await timeout(0);
		controller.applyConfig({ config: {} });
		store.patch({ permissionMode: 'acceptEdits', toolSettings: { builtin_run_terminal_command: 'allowedWithPermission' } });
		store.setInput('/autonomous fix boot panic');
		await controller.submit();
		const run = posted.find(message => message.messageType === 'brain/runAutonomousLoop');
		assert.ok(run, 'core loop started');
		assert.deepStrictEqual((run.data as { goal: string; permissionMode: string }).goal, 'fix boot panic');
		assert.strictEqual((run.data as { permissionMode: string }).permissionMode, 'acceptEdits');
		assert.ok(!posted.some(message => message.messageType === 'llm/streamChat'), 'no legacy slash stream');
		const last = store.state.history[store.state.history.length - 1];
		assert.strictEqual(last.role, 'assistant');
		assert.strictEqual(last.content, 'Fixed the panic.');

		store.patch({
			autonomous: { status: 'running', iteration: 1, max: 0 },
			history: [...store.state.history.slice(0, -1), { ...last, toolCalls: [{ id: 'auto-1', name: 'builtin_run_terminal_command', arguments: '{}', status: 'generated' }] }],
		});
		await controller.approveTool('auto-1', true);
		controller.denyTool('auto-1');
		const resolved = posted.filter(message => message.messageType === 'brain/resolveAutonomousTool').map(message => message.data as { callId: string; allow: boolean; always?: boolean });
		assert.deepStrictEqual(resolved.map(item => [item.callId, item.allow, item.always]), [['auto-1', true, true], ['auto-1', false, undefined]]);
		assert.ok(!posted.some(message => message.messageType === 'tools/call'));
	});

	test('A-17 /autonomous without a goal shows the usage error', async () => {
		const { controller, store, posted } = createHarness();
		await timeout(0);
		controller.applyConfig({ config: {} });
		store.setInput('/autonomous');
		await controller.submit();
		assert.ok(!posted.some(message => message.messageType === 'brain/runAutonomousLoop'));
		assert.ok(JSON.stringify(store.state.streamError).includes('Usage: /autonomous <goal description>'));
	});

	test('S-01 S-02 sessions are scoped to the workspace and the last active session reopens', async () => {
		const storage = disposables.add(new InMemoryStorageService());
		const replies = {
			'config/getSerializedProfileInfo': { config: {} },
			getWorkspaceDirs: ['file:///repo'],
			'history/list': [{ sessionId: 'newest', title: 'Newest' }, { sessionId: 'older', title: 'Older' }],
			'history/load': { sessionId: 'older', title: 'Older', history: [{ role: 'user', content: 'hi' }] },
		};
		const first = createHarness({ replies, storage });
		await timeout(0);
		const list = first.posted.find(message => message.messageType === 'history/list');
		assert.deepStrictEqual(list?.data, { workspaceDirectory: 'file:///repo' });
		assert.deepStrictEqual((first.posted.find(message => message.messageType === 'history/load')?.data as { id: string }).id, 'newest');
		await first.controller.loadSession('older');
		await first.controller.saveCurrentSession();
		const save = first.posted.find(message => message.messageType === 'history/save');
		assert.strictEqual((save?.data as { workspaceDirectory: string }).workspaceDirectory, 'file:///repo');
		first.store.patch({ permissionMode: 'default', toolSettings: { builtin_edit_file: 'disabled' } });

		const second = createHarness({ replies, storage });
		await timeout(0);
		const loads = second.posted.filter(message => message.messageType === 'history/load').map(message => (message.data as { id: string }).id);
		assert.deepStrictEqual(loads, ['older']);
		assert.strictEqual(second.store.state.permissionMode, 'default');
		assert.deepStrictEqual(second.store.state.toolSettings, { builtin_edit_file: 'disabled' });

		second.store.newSession();
		const third = createHarness({ replies, storage });
		await timeout(0);
		assert.ok(!third.posted.some(message => message.messageType === 'history/load'), 'an empty New Chat is kept');
	});

	test('S-09 deleting the current session loads the latest remaining one without re-saving it', async () => {
		const { controller, store, posted } = createHarness({
			replies: { 'history/load': { sessionId: 'b', title: 'B', history: [{ role: 'user', content: 'hi' }] } },
		});
		await timeout(0);
		store.patch({
			sessionId: 'a',
			history: [{ id: 'u', role: 'user', content: 'doomed' }],
			historySessions: [{ id: 'a', title: 'A', date: '' }, { id: 'b', title: 'B', date: '' }],
		});
		await controller.deleteSessions(['a']);
		assert.strictEqual(store.state.sessionId, 'b');
		assert.ok(!posted.some(message => message.messageType === 'history/save'));
	});

	test('S-09 bulk delete from the history overlay stays on the list', async () => {
		const { controller, store, posted } = createHarness();
		await timeout(0);
		store.patch({
			overlay: 'history',
			sessionId: 'a',
			history: [{ id: 'u', role: 'user', content: 'doomed' }],
			historySessions: [{ id: 'a', title: 'A', date: '' }, { id: 'b', title: 'B', date: '' }, { id: 'c', title: 'C', date: '' }],
			historySelectionMode: true,
			historySelected: ['a', 'c'],
		});
		await controller.deleteSessions(['a', 'c']);
		assert.strictEqual(store.state.overlay, 'history');
		assert.deepStrictEqual(store.state.historySessions.map(session => session.id), ['b']);
		assert.notStrictEqual(store.state.sessionId, 'a');
		assert.deepStrictEqual(store.state.history, []);
		assert.ok(posted.filter(message => message.messageType === 'history/delete').length >= 2);
		assert.ok(!posted.some(message => message.messageType === 'history/load'));
	});

	test('A-26 mode switch is ignored while streaming; entering edit saves and opens a new session', async () => {
		const { controller, store, posted } = createHarness({ replies: { 'history/save': {} } });
		await timeout(0);
		store.patch({ mode: 'chat', isStreaming: true });
		controller.setMode('agent');
		assert.strictEqual(store.state.mode, 'chat');
		store.patch({ isStreaming: false, sessionId: 'old', history: [{ id: 'u', role: 'user', content: 'hi' }] });
		controller.setMode('edit');
		await timeout(0);
		assert.strictEqual(store.state.mode, 'edit');
		assert.notStrictEqual(store.state.sessionId, 'old');
		assert.deepStrictEqual(store.state.history, []);
		assert.ok(posted.some(message => message.messageType === 'history/save' && (message.data as { sessionId?: string }).sessionId === 'old'));
		assert.ok(!posted.some(message => message.messageType === 'chatDescriber/describe'));
	});

	test('I-20 Shift+Tab cycle records a soul event and re-syncs pending tools', async () => {
		const { controller, store, posted } = createHarness();
		await timeout(0);
		store.patch({ mode: 'agent', permissionMode: 'default' });
		controller.cyclePermissionMode();
		assert.strictEqual(store.state.permissionMode, 'acceptEdits');
		const soul = posted.find(message => message.messageType === 'brain/recordSoulEvent');
		assert.strictEqual((soul?.data as { policy?: string; summary?: string }).policy, 'allow');
		assert.strictEqual((soul?.data as { summary?: string }).summary, 'Permission mode → acceptEdits');
	});

	test('I-01 input history persists per mode across controllers', async () => {
		const storage = disposables.add(new InMemoryStorageService());
		const first = createHarness({ storage });
		await timeout(0);
		first.controller.saveInputHistory('chat', [inputDocFromPlainText('remember me')]);
		const second = createHarness({ storage });
		await timeout(0);
		assert.deepStrictEqual(second.controller.loadInputHistory('chat').entries, [inputDocFromPlainText('remember me')]);
		assert.deepStrictEqual(second.controller.loadInputHistory('edit').entries, []);
	});

	function sharedLoopHarness(events: (sessionId: string) => unknown[], replies?: Record<string, unknown>, result: unknown = { stoppedReason: 'completed', steps: 1, summary: 'done' }) {
		const refs: { ctl?: KnoxGuiController } = {};
		const harness = createHarness({
			replies: { ...replies },
			respond: message => {
				if (message.messageType !== 'knox/runChatTurn') {
					return undefined;
				}
				const sessionId = (message.data as { sessionId: string }).sessionId;
				for (const event of events(sessionId)) {
					refs.ctl!.enqueueChatTurnEvent({ sessionId, event });
				}
				return { content: result };
			},
		});
		refs.ctl = harness.controller;
		return harness;
	}

	test('K-010 shared loop: events render streaming, tool cards and the next round; no llm/streamChat or tools/call', async () => {
		const call = { id: 'c1', name: 'builtin_read_file', args: { filepath: 'a.ts' }, rawArguments: '{"filepath":"a.ts"}' };
		const out = [{ name: 'f', description: 'ok', content: 'file body' }];
		const { controller, store, posted } = sharedLoopHarness(() => [
			{ type: 'chunk', chunk: { role: 'assistant', content: 'Reading a.ts', toolCalls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'builtin_read_file', arguments: '{"filepath":"a.ts"}' } }] } },
			{ type: 'assistant', assistant: { role: 'assistant', content: 'Reading a.ts' }, toolCalls: [call] },
			{ type: 'tool_start', callId: 'c1', name: 'builtin_read_file', args: call.args },
			{ type: 'tool_end', callId: 'c1', name: 'builtin_read_file', ok: true, output: out },
			{ type: 'step', step: { toolCalls: [call], results: [{ ok: true, output: out }] } },
			{ type: 'chunk', chunk: { role: 'assistant', content: 'It has a body.' } },
			{ type: 'assistant', assistant: { role: 'assistant', content: 'It has a body.' }, toolCalls: [] },
			{ type: 'done', stoppedReason: 'completed', steps: 1, summary: 'It has a body.' },
		]);
		await timeout(0);
		store.patch({ mode: 'agent', toolsSupported: true });
		store.setInput('read a.ts');
		await controller.submit();
		await timeout(0);

		const run = posted.find(message => message.messageType === 'knox/runChatTurn');
		assert.ok(run, 'the whole turn is one host request');
		assert.ok(!posted.some(message => message.messageType === 'llm/streamChat' || message.messageType === 'tools/call'));
		const tool = controller.findTool('c1');
		assert.strictEqual(tool?.status, 'done');
		assert.strictEqual(tool?.output, 'file body');
		const last = store.state.history[store.state.history.length - 1];
		assert.strictEqual(last.role, 'assistant');
		assert.strictEqual(last.content, 'It has a body.');
		assert.strictEqual(posted.filter(message => message.messageType === 'knox/finishTurn').length, 1);
		assert.strictEqual(store.state.isStreaming, false);
		assert.strictEqual(controller.sharedTurn, undefined);
		assert.strictEqual(store.state.toolLoopSteps, 1);
	});

	test('K-010 shared loop: a retry discards the failed attempt, a denied call settles from the step result', async () => {
		const call = { id: 'c2', name: 'builtin_run_terminal_command', args: { command: 'rm -rf x' }, rawArguments: '{"command":"rm -rf x"}' };
		const denied = [{ name: 'Agent', description: 'permission-denied', content: 'Blocked: this tool was not approved.' }];
		const { controller, store } = sharedLoopHarness(() => [
			{ type: 'chunk', chunk: { role: 'assistant', content: 'partial that will be dropped' } },
			{ type: 'retry', retry: { attempt: 2, maxAttempts: 4, delayMs: 1, error: 'overloaded', usingFallback: false, discardedPartial: true } },
			{ type: 'chunk', chunk: { role: 'assistant', content: 'Running it.', toolCalls: [{ index: 0, id: 'c2', type: 'function', function: { name: 'builtin_run_terminal_command', arguments: '{"command":"rm -rf x"}' } }] } },
			{ type: 'assistant', assistant: { role: 'assistant', content: 'Running it.' }, toolCalls: [call] },
			{ type: 'tool_ask', callId: 'c2', name: 'builtin_run_terminal_command', args: call.args },
			{ type: 'step', step: { toolCalls: [call], results: [{ ok: false, error: 'permission_denied', output: denied }] } },
			{ type: 'done', stoppedReason: 'completed', steps: 1, summary: '' },
		]);
		await timeout(0);
		store.patch({ mode: 'agent', toolsSupported: true });
		store.setInput('clean up');
		await controller.submit();
		await timeout(0);
		const text = store.state.history.filter(item => item.role === 'assistant').map(item => item.content).join('|');
		assert.ok(!text.includes('partial that will be dropped'));
		assert.strictEqual(controller.findTool('c2')?.status, 'done');
		assert.ok(controller.findTool('c2')?.output?.includes('not approved'));
	});

	test('K-010 shared loop: a stream retry shows "retrying (2/4)" until output resumes or the turn ends', async () => {
		const { controller, store } = sharedLoopHarness(() => [
			{ type: 'retry', retry: { attempt: 2, maxAttempts: 4, delayMs: 1, error: 'overloaded', usingFallback: true, discardedPartial: false } },
			{ type: 'chunk', chunk: { role: 'assistant', content: 'ok' } },
			{ type: 'assistant', assistant: { role: 'assistant', content: 'ok' }, toolCalls: [] },
			{ type: 'done', stoppedReason: 'completed', steps: 0, summary: '' },
		]);
		const seen: unknown[] = [];
		const patch = store.patch.bind(store);
		store.patch = (partial: Parameters<typeof patch>[0]) => {
			if ('streamRetry' in partial) {
				seen.push(partial.streamRetry);
			}
			return patch(partial);
		};
		await timeout(0);
		store.patch({ mode: 'agent', toolsSupported: true });
		store.setInput('hi');
		await controller.submit();
		await timeout(0);
		assert.deepStrictEqual(seen[0], { attempt: 2, maxAttempts: 4, usingFallback: true });
		assert.strictEqual(seen[1], undefined);
		assert.strictEqual(store.state.streamRetry, undefined);
	});

	test('K-010 shared loop: approve and deny answer the host wait instead of running the tool', async () => {
		const { controller, store, posted } = createHarness();
		await timeout(0);
		controller.sharedTurn = { sessionId: 's1', acc: { content: '', thinking: '', inThinkTag: false }, toolCalls: [], awaitingUser: false };
		store.patch({
			sessionId: 's1',
			history: [
				{ id: 'u', role: 'user', content: 'go' },
				{
					id: 'a', role: 'assistant', content: '', toolCalls: [
						{ id: 'p1', name: 'builtin_run_terminal_command', arguments: '{}', status: 'generated' },
						{ id: 'p2', name: 'builtin_run_terminal_command', arguments: '{}', status: 'generated' },
					]
				},
			],
		});
		await controller.approveTool('p1', true);
		controller.denyTool('p2');
		const resolved = posted.filter(message => message.messageType === 'brain/resolveAutonomousTool').map(message => message.data as { callId: string; allow: boolean; always?: boolean });
		assert.deepStrictEqual(resolved.map(item => [item.callId, item.allow, item.always]), [['p1', true, true], ['p2', false, undefined]]);
		assert.ok(!posted.some(message => message.messageType === 'tools/call'));
		assert.strictEqual(controller.findTool('p2')?.status, 'done');
		controller.cancel();
		assert.ok(posted.some(message => message.messageType === 'knox/cancelChatTurn'));
	});

	test('K-010 shared loop: a turn that stops at ask_user stays open for the answer', async () => {
		const call = { id: 'q1', name: 'builtin_ask_user', args: { questions: [{ id: 'which', prompt: 'Which file?', options: [{ id: 'a', label: 'a.ts' }] }] }, rawArguments: '{"questions":[{"id":"which","prompt":"Which file?","options":[{"id":"a","label":"a.ts"}]}]}' };
		const { controller, store, posted } = sharedLoopHarness(() => [
			{ type: 'assistant', assistant: { role: 'assistant', content: '' }, toolCalls: [call] },
			{ type: 'tool_ask', callId: 'q1', name: 'builtin_ask_user', args: call.args, awaitsUser: true },
			{ type: 'step', step: { toolCalls: [call], results: [{ ok: false, error: 'cancelled', output: [] }] } },
			{ type: 'done', stoppedReason: 'aborted', steps: 1, summary: 'Aborted mid-tool.' },
		], undefined, { stoppedReason: 'aborted', steps: 1, summary: 'Aborted mid-tool.' });
		await timeout(0);
		store.patch({ mode: 'agent', toolsSupported: true });
		store.setInput('do the thing');
		await controller.submit();
		await timeout(0);
		assert.strictEqual(controller.findTool('q1')?.status, 'generated', 'the question card waits for the user');
		assert.ok(!posted.some(message => message.messageType === 'knox/finishTurn'), 'the turn is not finished yet');
		assert.strictEqual(store.state.isStreaming, false);
	});

	test('plain rounds ask the host for messages and send no tools (tools run on the shared loop)', async () => {
		const { controller, store, posted } = createHarness({
			replies: {
				'knox/buildAgentRequest': { messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }], tools: [] },
			},
		});
		await timeout(0);
		store.patch({ mode: 'chat' });
		store.setInput('hi');
		await controller.submit();
		await timeout(0);
		const build = posted.find(message => message.messageType === 'knox/buildAgentRequest');
		assert.ok(build);
		assert.strictEqual((build.data as { includeTools: boolean }).includeTools, false);
		const stream = posted.find(message => message.messageType === 'llm/streamChat');
		const data = stream?.data as { messages: unknown[]; completionOptions: { tools?: unknown[] } };
		assert.deepStrictEqual(data.messages, [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }]);
		assert.strictEqual(data.completionOptions.tools, undefined);
	});

	test('KN-374 loadMentions always includes KN-300 default @ providers', async () => {
		const { controller, store } = createHarness();
		await timeout(0);
		await controller.loadMentions('');
		const titles = store.state.suggestItems.filter(item => item.itemType === 'contextProvider').map(item => item.id);
		assert.deepStrictEqual(titles, [...DEFAULT_MENTION_PROVIDER_TITLES]);
		assert.strictEqual(store.state.mentionOpen, true);
		store.patch({ mode: 'edit' });
		await controller.loadMentions('');
		const editTitles = store.state.suggestItems.filter(item => item.itemType === 'contextProvider').map(item => item.id);
		assert.ok(editTitles.includes('file'));
		assert.ok(editTitles.includes('problems'));
		assert.ok(editTitles.includes('terminal'));
		assert.ok(editTitles.includes('memory'));
		assert.ok(!editTitles.includes('diff'));
		assert.ok(!editTitles.includes('repo-map'));
	});

	test('KN-374 loadSlash lists KN-304 builtins plus YAML prompts', async () => {
		const { controller, store } = createHarness();
		await timeout(0);
		await controller.loadSlash('');
		assert.deepStrictEqual(
			store.state.suggestItems.filter(item => item.itemType === 'slashCommand').map(item => item.id.replace(/^\//, '')),
			SLASH_BUILTINS.map(cmd => cmd.name),
		);
		controller.applyConfig({
			config: {
				slashCommands: [{ name: 'ship', description: 'Ship it', prompt: 'Ship {{{ input }}}' }],
			},
		});
		await controller.loadSlash('');
		assert.ok(store.state.suggestItems.some(item => item.id === '/ship' && item.slashSource === 'prompt'));
		assert.ok(store.state.suggestItems.some(item => item.id === '/commit' && item.slashSource === 'builtin'));
		await controller.loadSlash('shi');
		assert.ok(store.state.suggestItems.some(item => item.id === '/ship' && item.slashSource === 'prompt'));
	});

	test('KN-374 submit sends KN-304 builtins as legacySlash and expands YAML prompts', async () => {
		const { controller, store, posted } = createHarness();
		await timeout(0);
		store.setInput('/commit');
		await controller.submit();
		await timeout(0);
		const commit = posted.find(message => message.messageType === 'llm/streamChat');
		assert.ok(commit);
		const legacy = (commit.data as { legacySlashCommandData?: { command?: { name: string }; input?: string; historyIndex?: number; contextItems?: unknown[]; selectedCode?: unknown[] } }).legacySlashCommandData;
		assert.strictEqual(legacy?.command?.name, 'commit');
		assert.strictEqual(legacy?.input, '/commit');
		assert.strictEqual(legacy?.historyIndex, 0);
		assert.deepStrictEqual(legacy?.contextItems, []);
		assert.deepStrictEqual(legacy?.selectedCode, []);

		posted.length = 0;
		controller.applyConfig({
			config: {
				slashCommands: [{ name: 'ship', description: 'Ship it', prompt: 'Ship {{{ input }}}' }],
			},
		});
		store.setInput('/ship the feature');
		await controller.submit();
		await timeout(0);
		const users = store.state.history.filter(item => item.role === 'user');
		assert.strictEqual(users.at(-1)?.content, 'Ship the feature');
		// A YAML prompt is an ordinary agent turn: it runs on the shared loop, not the legacy slash stream.
		assert.ok(posted.find(message => message.messageType === 'knox/runChatTurn'));
		assert.ok(!posted.some(message => message.messageType === 'llm/streamChat'));
	});

	test('KN-374 applyConfig hydrates KN-300 defaults and dropped files become mention chips', async () => {
		const { controller, store } = createHarness();
		await timeout(0);
		controller.applyConfig({
			config: {
				contextProviders: [{ title: 'clipboard', displayTitle: 'Clipboard' }],
				slashCommands: [{ name: 'ship', description: 'Ship', prompt: 'go' }],
			},
		});
		assert.deepStrictEqual(store.state.contextProviders.map(provider => provider.title), [
			'file', 'diff', 'problems', 'repo-map', 'terminal', 'memory', 'clipboard',
		]);
		assert.ok(store.state.slashCommands.some(cmd => cmd.name === 'ship'));
		assert.ok(store.state.slashCommands.some(cmd => cmd.name === 'autonomous'));
		controller.mentionDroppedFile('/tmp/app.ts');
		assert.strictEqual(store.state.inputDoc[0].type, 'paragraph');
		assert.ok(store.state.input.includes('@app.ts'));
	});

	test('KN-375 overlay calls KN-320–330 restore preview, dashboard, analysis, and branch messages', async () => {
		const { controller, store, posted } = createHarness({
			replies: {
				previewRestore: {
					success: true,
					preview: {
						checkpointId: 'cp-1',
						description: 'head',
						modified: 1,
						added: 0,
						deleted: 0,
						writePaths: ['a.ts'],
						extraPaths: [],
						skippedFiles: [],
						files: [{ relativePath: 'a.ts', action: 'overwrite', additions: 1, deletions: 1, hunkCount: 1 }],
					},
				},
				computeCheckpointDiff: {
					success: true,
					diff: {
						oldCheckpoint: { id: 'workspace', description: '', created: '' },
						newCheckpoint: { id: 'cp-1', description: 'head', created: '2026-09-26T00:00:00.000Z' },
						files: [{ relativePath: 'a.ts', oldContent: 'const foo = 1', newContent: 'const bar = 1' }],
					},
				},
				getPerformanceDashboard: {
					success: true,
					data: {
						summary: { totalCheckpointsCreated: 2, totalRestorations: 0, restorationSuccessRate: 0, avgCreationTimeMs: 8, totalAiSessions: 1, avgChangesPerSession: 2, totalRollbacks: 0 },
						currentStorage: { totalBytes: 1024, checkpointCount: 2 },
						storageHistory: [],
						creationFrequency: [],
						restorationEvents: [],
						aiSessionMetrics: [],
					},
				},
				analyzeCheckpoint: {
					success: true,
					analysis: {
						checkpointId: 'cp-1',
						generatedDescription: 'touched a.ts',
						riskAssessment: { level: 'Low', score: 1, factors: [], recommendations: [] },
						impactAnalysis: { affectedFeatures: [], affectedLayers: [], scope: 'Isolated' },
					},
				},
				suggestCheckpointGroups: {
					success: true,
					groups: [{ groupName: 'session s1', kind: 'session', rationale: 'same session', confidence: 0.9, checkpointIds: ['cp-1'] }],
				},
				createCheckpointBranch: { success: true, id: 'br-feat', branch: { id: 'br-feat' } },
				switchCheckpointBranch: { success: true },
			},
		});
		await timeout(0);
		store.patch({
			checkpoints: [{
				id: 'cp-1',
				description: 'head',
				created: '2026-09-26T00:00:00.000Z',
				kind: 'manual',
				tags: [],
				shortId: 'cp-1',
				pinned: false,
				changedPaths: ['a.ts'],
				parents: [],
				fileChanges: { added: 0, modified: 1, deleted: 0 },
			}],
		});

		await controller.openRestorePreview('cp-1');
		assert.strictEqual(store.state.checkpointDialog, 'restore');
		assert.deepStrictEqual(store.state.checkpointRestoreSelected, ['a.ts']);
		assert.ok(posted.some(message => message.messageType === 'previewRestore' && (message.data as { checkpointId?: string }).checkpointId === 'cp-1'));

		await controller.toggleRestoreDiff();
		assert.ok(store.state.checkpointRestoreShowDiff);
		assert.ok(store.state.checkpointRestoreDiff?.files.some(file => file.relativePath === 'a.ts'));
		assert.ok(posted.some(message => {
			const data = message.data as { checkpointId?: string; compareToWorkspace?: boolean };
			return message.messageType === 'computeCheckpointDiff' && data.checkpointId === 'cp-1' && data.compareToWorkspace === true;
		}));

		await controller.loadCheckpointDashboard();
		assert.strictEqual(store.state.checkpointDashboard?.summary.totalCheckpointsCreated, 2);
		assert.ok(posted.some(message => message.messageType === 'getPerformanceDashboard' && (message.data as { historyDays?: number }).historyDays === 30));

		controller.setCheckpointTab('analysis');
		for (let i = 0; i < 10 && !store.state.checkpointAnalysis; i++) {
			await timeout(0);
		}
		assert.strictEqual(store.state.checkpointView, 'analysis');
		assert.strictEqual(store.state.checkpointAnalysis?.generatedDescription, 'touched a.ts');
		assert.strictEqual(store.state.checkpointAnalysisGroups[0]?.groupName, 'session s1');
		assert.ok(posted.some(message => message.messageType === 'analyzeCheckpoint' && (message.data as { checkpointId?: string }).checkpointId === 'cp-1'));
		assert.ok(posted.some(message => message.messageType === 'suggestCheckpointGroups' && (message.data as { limit?: number }).limit === 50));

		const branchId = await controller.createCheckpointBranch('feat', 'cp-1');
		assert.strictEqual(branchId, 'br-feat');
		assert.ok(posted.some(message => {
			const data = message.data as { name?: string; baseCheckpointId?: string };
			return message.messageType === 'createCheckpointBranch' && data.name === 'feat' && data.baseCheckpointId === 'cp-1';
		}));

		await controller.switchCheckpointBranch('br-feat');
		assert.ok(posted.some(message => message.messageType === 'switchCheckpointBranch' && (message.data as { branchId?: string }).branchId === 'br-feat'));
	});

	test('KN-376 Memory panel calls KN-310–317 brain/* for all five tabs', async () => {
		const { controller, store, posted } = createHarness({
			replies: {
				'brain/dashboard': {
					stats: { total_semantic: 4, total_episodic: 2, total_tags: 5, total_collections: 1, total_entities: 3 },
					health: { status: 'healthy' },
					healthScore: { overall: 91, grade: 'A' },
				},
				'brain/getEffectiveContext': {
					total_effective: 80,
					memory_levels: [{ id: 'M1', name: 'Sensory', tokens: 4, ratio: 1, effective_tokens: 4 }],
				},
				'brain/getMetricsTrend': { avg_response_trend: 'stable', snapshots: [] },
				'brain/getPhaseStatus': { active_phase: 'working_memory', phase_counts: { working_memory: 2 }, cycle_invariant_met: true },
				'brain/getReviewDue': { items: [] },
				'brain/getEbbinghausStats': { review_due_count: 1, avg_retention: 0.8, config: { lambda: 0.05 } },
				'brain/searchMemories': { memories: [{ id: 7, title: 'auth cookie', category: 'insight', tier: 'hot', pinned: false, content: 'use httpOnly' }], total: 1 },
				'brain/listSessions': { sessions: [{ id: 's1', title: 'Ship', message_count: 3, updated_at: '2026-09-26T00:00:00.000Z' }] },
				'brain/getSessionHistory': { session_id: 's1', episodic: [{ role: 'user', content: 'hi' }], semantic: [], token_estimate: 12, message_count: 1 },
				'brain/searchBacklogs': { result: { episodic: [], semantic: [{ id: 9, title: 'cookie', content: 'httpOnly', source_session_id: 's1' }] } },
				'brain/graphStats': { total_entities: 2, total_edges: 1, entity_types: { concept: 1, library: 1 }, max_entities: 5000, max_depth: 3 },
				'brain/listEntities': { entities: [{ id: 1, name: 'Auth', entity_type: 'concept', mention_count: 2 }], total: 1 },
				'brain/exploreGraph': { center: { id: 1, name: 'Auth', entity_type: 'concept' }, entities: [{ id: 1, name: 'Auth' }, { id: 2, name: 'JWT' }], edges: [{ id: 10, source_entity_id: 1, target_entity_id: 2, relationship: 'uses', weight: 1 }], depth_reached: 1, entity_depths: { 1: 0, 2: 1 } },
				'brain/getConfig': { config: { retrieval_threshold: 0.6, retrieval_top_k: 20, ebbinghaus_lambda: 0.05 } },
				'brain/updateConfig': { ok: true },
				'brain/consolidate': { result: { promoted: 1, demoted: 0, pruned: 0, merged: 0 } },
				'brain/deleteMemory': { success: true },
				'brain/pinMemory': { success: true },
				'brain/optimize': { message: 'ok' },
				'brain/heal': { results: [] },
				'brain/export': { data: '{"version":"knox-brain-v1"}', encrypted: false },
				'brain/import': { result: 'Import complete' },
			},
		});
		await timeout(0);

		await controller.loadMemoryOverview();
		assert.strictEqual(store.state.memoryDashboard?.totalSemantic, 4);
		assert.strictEqual(store.state.memoryDashboard?.totalTags, 5);
		assert.strictEqual(store.state.memoryEffectiveContext?.levels[0].id, 'M1');
		assert.strictEqual(store.state.memoryEbbinghausStats?.lambda, 0.05);
		assert.ok(posted.some(message => message.messageType === 'brain/dashboard'));
		assert.ok(posted.some(message => message.messageType === 'brain/getEbbinghausStats'));

		await controller.loadMemories(false);
		assert.strictEqual(store.state.memories[0]?.title, 'auth cookie');
		assert.ok(posted.some(message => message.messageType === 'brain/searchMemories'));

		await controller.loadMemorySessions();
		assert.strictEqual(store.state.memorySessions[0]?.id, 's1');
		await controller.loadMemorySessionHistory('s1');
		assert.strictEqual(store.state.memorySessionHistory?.episodic[0]?.content, 'hi');
		await controller.searchMemoryBacklogs('cookie');
		assert.strictEqual(store.state.memoryBacklogMatches[0]?.title, 'cookie');

		await controller.loadMemoryGraph(false);
		assert.strictEqual(store.state.memoryGraphEntities[0]?.name, 'Auth');
		await controller.exploreMemoryEntity(1);
		assert.strictEqual(store.state.memoryExplore?.centerName, 'Auth');
		assert.strictEqual(store.state.memoryExplore?.entityDepths?.['2'], 1);

		await controller.loadMemoryConfig();
		assert.strictEqual(store.state.memoryConfig.retrieval_threshold, 0.6);
		assert.strictEqual(store.state.memoryConfig.post_turn_min_chars, 80, 'DEFAULT_CONFIG fills fields the host omits');
		assert.strictEqual(store.state.memoryConfigLoading, false);
		controller.updateMemoryConfig('retrieval_top_k', 20);
		assert.ok(posted.some(message => message.messageType === 'brain/updateConfig' && (message.data as { key?: string }).key === 'retrieval_top_k'));
		await timeout(0);
		assert.strictEqual(store.state.memorySavedKey, 'retrieval_top_k');

		await controller.pinMemories(['7'], true);
		await controller.deleteMemories(['7']);
		await controller.consolidateMemory();
		assert.strictEqual(store.state.memoryActionMessage, 'memoryConsolidateResult');
		await controller.runMemoryMaintenance('consolidate');
		assert.deepStrictEqual(store.state.memorySettingsResult, { type: 'success', message: 'Consolidation complete: 1 promoted' });
		await controller.runMemoryMaintenance('optimize');
		assert.strictEqual(store.state.memorySettingsResult?.message, 'ok');
		await controller.runMemoryMaintenance('heal');
		assert.strictEqual(store.state.memorySettingsResult?.type, 'success');
		assert.strictEqual(await controller.exportMemory(), true);
		assert.ok(posted.some(message => message.messageType === 'copyText'));
		assert.match(store.state.memorySettingsResult?.message ?? '', /\(0\.0 KB\) · /);
		assert.strictEqual(store.state.memorySettingsAction, undefined);
		assert.strictEqual(await controller.importMemoryData('not json'), false);
		assert.strictEqual(store.state.memorySettingsResult?.type, 'error');
		assert.strictEqual(await controller.importMemoryData('{"version":"knox-brain-encrypted-v1"}'), false, 'encrypted backups need a password');
		assert.strictEqual(await controller.importMemoryData('{"version":"knox-brain-v1"}'), true);
		assert.strictEqual(store.state.memorySettingsResult?.message, 'Import complete');
	});

	test('KN-377 find, session tabs, fatal config, and accept-all exits edit mode', async () => {
		const { controller, store, posted } = createHarness({
			replies: {
				'history/load': { sessionId: 'prev', title: 'Prev', history: [] },
			},
		});
		await timeout(0);

		store.patch({
			history: [
				{ id: 'u1', role: 'user', content: 'ship auth' },
				{ id: 'a1', role: 'assistant', content: 'ok', contextItems: [{ name: 'auth.ts', content: 'httpOnly cookie' }] },
			],
		});
		controller.openFind();
		assert.strictEqual(store.state.find.open, true);
		controller.updateFind({ query: 'httpOnly' });
		assert.deepStrictEqual(store.state.find.matchIndexes, [1]);
		assert.strictEqual(store.state.find.total, 1);
		controller.stepFind(1);
		assert.strictEqual(store.state.find.current, 0);
		controller.closeFind();
		assert.strictEqual(store.state.find.open, false);

		store.patch({
			showSessionTabs: true,
			tabs: [{ id: 'tab-a', title: 'Chat 1', sessionId: 's1' }, { id: 'tab-b', title: 'Chat 2', sessionId: 's2' }],
			activeTabId: 'tab-a',
			sessionId: 's1',
		});
		await controller.activateTab('tab-b');
		assert.ok(posted.some(message => message.messageType === 'history/load'));

		controller.applyConfig({
			config: {},
			configError: [{ fatal: true, message: 'bad yaml' }],
		});
		assert.strictEqual(store.state.fatalConfig, true);

		store.patch({
			mode: 'edit',
			sessionId: 'edit-sess',
			historySessions: [{ id: 'prev', title: 'Prev', date: '2026-09-27' }],
			codeToEdit: [{ filepath: 'src/a.ts', range: { start: { line: 0 }, end: { line: 1 } } }],
			applyStates: [{ streamId: 'diff-1', filepath: 'src/a.ts', status: 'done' }, { streamId: 'diff-2', filepath: 'src/b.ts', status: 'streaming' }],
		});
		controller.acceptAllApplies();
		assert.ok(posted.some(message => message.messageType === 'acceptDiff' && (message.data as { streamId?: string }).streamId === 'diff-1'));
		assert.ok(!posted.some(message => message.messageType === 'acceptDiff' && (message.data as { streamId?: string }).streamId === 'diff-2'));
		assert.strictEqual(store.state.mode, 'agent');
		assert.ok(posted.some(message => message.messageType === 'edit/exit'));
	});

	test('openHistorySession hydrates ChatHistoryItem.message and leftover empty sessionId', async () => {
		const { controller, store, posted } = createHarness({
			replies: {
				'history/load': {
					session: {
						sessionId: '',
						title: 'leftover',
						history: [
							{ message: { role: 'user', content: [{ type: 'text', text: 'leftover transcript' }] } },
							{ message: { role: 'assistant', content: 'Reply' } },
						],
					},
				},
			},
		});
		await timeout(0);
		store.patch({ sessionId: '', history: [], overlay: 'history' });
		posted.length = 0;
		await controller.openHistorySession('');
		assert.strictEqual(store.state.overlay, null);
		assert.strictEqual(store.state.route, KnoxGuiRoute.Chat);
		assert.strictEqual(store.state.history[0]?.content, 'leftover transcript');
		assert.strictEqual(store.state.history[1]?.content, 'Reply');
		assert.ok(posted.some(message => message.messageType === 'history/load' && (message.data as { id: string }).id === ''));

		store.patch({ sessionId: 's1', history: [{ id: 'u', role: 'user', content: 'already' }], overlay: 'history' });
		posted.length = 0;
		await controller.openHistorySession('s1');
		assert.strictEqual(store.state.overlay, null);
		assert.strictEqual(store.state.history[0]?.content, 'already');
		assert.ok(!posted.some(message => message.messageType === 'history/load'));
	});

	test('KP leftover: historical resubmit cancels a pending generated tool', async () => {
		const { controller, store, posted } = createHarness();
		await timeout(0);
		store.patch({
			mode: 'chat',
			modelTitle: 'GPT-4o',
			isStreaming: false,
			history: [
				{ id: 'u0', role: 'user', content: 'old' },
				{ id: 'a0', role: 'assistant', content: 'working', toolCalls: [{ id: 't1', name: 'builtin_edit_file', arguments: '{}', status: 'generated' }] },
			],
		});
		await controller.submitEditedUser(0, inputDocFromPlainText('new'));
		await timeout(0);
		assert.ok(posted.some(message => message.messageType === 'abort' || message.messageType === 'tools/cancel'));
		assert.strictEqual(store.state.history[0]?.content, 'new');
		assert.ok(!store.state.history.some(item => item.toolCalls?.some(call => call.status === 'generated')));
	});

	test('KP leftover: git-diff fallback, calling cancel, alias session allowlist', async () => {
		const { controller, store, posted } = createHarness();
		await timeout(0);

		posted.length = 0;
		controller.openGitFile({
			filename: 'a.ts',
			filepath: 'src/a.ts',
			displayPath: 'src/a.ts',
			uri: 'file:///ws/a.ts',
			additions: 1,
			deletions: 0,
			fileType: 'TS',
			isBinary: false,
			status: 'modified',
		});
		await timeout(0);
		assert.ok(posted.some(message => message.messageType === 'showFile'));
		assert.ok(posted.some(message => message.messageType === 'openGitChange' && (message.data as { uri: string }).uri === 'file:///ws/a.ts'));

		posted.length = 0;
		controller.openGitFile({
			filename: 'gone.ts',
			filepath: 'src/gone.ts',
			displayPath: 'src/gone.ts',
			uri: 'file:///ws/gone.ts',
			additions: 0,
			deletions: 1,
			fileType: 'TS',
			isBinary: false,
			status: 'deleted',
		});
		await timeout(0);
		assert.ok(posted.some(message => message.messageType === 'openGitChange'));
		assert.ok(!posted.some(message => message.messageType === 'showFile'));

		store.patch({
			tools: [{ name: 'builtin_edit_file', group: 'Built-In' }],
			toolSettings: { builtin_edit_file: 'allowedWithPermission' },
			sessionToolAllowlist: ['edit'],
		});
		controller.cycleToolPermission('builtin_edit_file');
		assert.deepStrictEqual(store.state.sessionToolAllowlist, []);

		posted.length = 0;
		store.patch({
			isStreaming: true,
			history: [{
				id: 'a1',
				role: 'assistant',
				content: 'working',
				toolCalls: [{ id: 't1', name: 'builtin_run_terminal_command', arguments: '{}', status: 'calling' }],
			}],
		});
		controller.cancel();
		await timeout(0);
		assert.ok(posted.some(message => message.messageType === 'abort'));
		assert.ok(posted.some(message => message.messageType === 'tools/cancel'));
		assert.ok(posted.some(message => message.messageType === 'agent/jobs'));
		assert.strictEqual(store.state.isStreaming, false);
	});
});
