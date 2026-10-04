/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IModelService } from '../../../../editor/common/services/model.js';
import assert from 'assert';
import { timeout } from '../../../../base/common/async.js';
import { isMacintosh } from '../../../../base/common/platform.js';
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
import { KNOX_GUI_LUMP_TOOLBAR, KNOX_GUI_MAIN_TEXT_ENTRY_KEY, KNOX_GUI_MAIN_TEXT_ENTRY_SHOWN_KEY } from '../common/knoxGuiChrome.js';
import { IKnoxGuiMessage, KnoxGuiRoute } from '../common/knoxGuiProtocol.js';
import { IKnoxGuiCheckpointDiffFile, IKnoxGuiCheckpointNode, IKnoxGuiGitDiffFile, IKnoxGuiHistoryItem, IKnoxGuiToolCall } from '../common/knoxGuiState.js';
import { CHAT_DISPLAY_WINDOW, CHAT_LOAD_MORE_COUNT } from '../common/knoxGuiChat.js';
import { composerInputHistoryAdd, createComposerInputHistory, DEFAULT_MENTION_PROVIDER_TITLES, inputDocFromPlainText, SLASH_BUILTINS } from '../common/knoxGuiInput.js';
import { knoxGuiT } from './gui/knoxGuiI18n.js';
import { MEMORY_TAB_IDS } from '../common/knoxGuiMemory.js';
import { IKnoxService } from '../common/knoxService.js';
import { KnoxGuiController } from './knoxGuiController.js';
import { KnoxGuiMessenger } from './knoxGuiMessenger.js';
import { KnoxGuiStore } from './knoxGuiStore.js';
import { KnoxGuiWidget } from './gui/knoxGuiWidget.js';
import { DEFAULT_CHECKPOINT_CONFIG } from '../common/knoxGuiCheckpoints.js';
import { checkpointTimelineEscape } from './gui/widget/checkpoints.js';
import { runKnoxEditCommand } from './gui/widget/editCommands.js';
import { SelectAllCommand } from '../../../../editor/browser/editorExtensions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import './knoxGuiEditCommands.js';
import { onCheckpointGraphKeyDown } from './gui/widget/checkpointGraph.js';

suite('Knox native GUI widget chrome (GP-083)', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	async function mount(respond?: (message: IKnoxGuiMessage) => unknown): Promise<{ widget: KnoxGuiWidget; store: KnoxGuiStore }> {
		const incoming = disposables.add(new Emitter<IKnoxGuiMessage>());
		const knoxService = new class extends mock<IKnoxService>() {
			override onDidReceiveGuiMessage = incoming.event;
			override async guiPost(message: IKnoxGuiMessage): Promise<void> {
				const content = respond?.(message);
				incoming.fire({
					messageType: message.messageType,
					messageId: message.messageId,
					data: content === undefined ? { done: true, status: 'error', error: 'unhandled' } : { done: true, status: 'success', content },
				});
			}
		};
		const store = disposables.add(new KnoxGuiStore());
		const messenger = disposables.add(new KnoxGuiMessenger(knoxService));
		const storage = disposables.add(new InMemoryStorageService());
		const controller = disposables.add(new KnoxGuiController(store, messenger, storage));
		await timeout(0);
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
		return { widget, store };
	}

	test('lump icons follow BlockSettingsTopToolbar order and omit Context', async () => {
		const { widget } = await mount();
		const lump = widget.root.querySelector('[data-testid="knox-gui-lump"]');
		assert.ok(lump);
		const ids = Array.from(lump.querySelectorAll('[data-testid^="knox-gui-lump-"]')).map(el => el.getAttribute('data-testid'));
		assert.deepStrictEqual(ids, KNOX_GUI_LUMP_TOOLBAR.map(entry => `knox-gui-lump-${entry.id}`));
		assert.strictEqual(widget.root.querySelector('[data-testid="knox-gui-lump-context"]'), null);
		assert.strictEqual(widget.root.querySelector('.knox-gui-starters'), null);
	});

	test('Ask/Edits/Auto is the mode dropdown; Chat vs Agent is not a user tab', async () => {
		const { widget, store } = await mount();
		const trigger = widget.root.querySelector('[data-testid="knox-gui-mode-select"]') as HTMLButtonElement | null;
		assert.ok(trigger);
		assert.strictEqual(widget.root.querySelector('[data-testid="knox-gui-mode-chat"]'), null);
		assert.strictEqual(widget.root.querySelector('[data-testid="knox-gui-mode-agent"]'), null);
		assert.ok(trigger.classList.contains('selected'));
		assert.ok(trigger.classList.contains('knox-gui-mode-nomodel'));
		assert.ok(trigger.textContent?.includes('Edits')); // default is acceptEdits (K-005)
		assert.ok(trigger.querySelector('svg.knox-gui-svg'));
		assert.strictEqual(trigger.getAttribute('data-menu-trigger'), 'true');
		trigger.click();
		const menu = widget.root.querySelector('[data-testid="knox-gui-agent-menu"]') as HTMLElement;
		assert.ok(menu);
		assert.ok(menu.classList.contains('knox-gui-popover-anchored'));
		assert.strictEqual(menu.parentElement, widget.root);
		const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('.knox-gui-popover-item'));
		assert.ok(items.length >= 5);
		items[2].click();
		assert.strictEqual(store.state.permissionMode, 'fullAuto');
		assert.strictEqual(widget.root.querySelector('[data-testid="knox-gui-agent-menu"]'), null);
		store.patch({ mode: 'edit' });
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-mode-edit"]'));
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-mode-select"]'));
	});

	test('files-changed row shows green +N and red -N', async () => {
		const { widget, store } = await mount();
		const file: IKnoxGuiGitDiffFile = {
			filename: 'a.ts',
			filepath: 'src/a.ts',
			displayPath: 'src/a.ts',
			uri: 'src/a.ts',
			additions: 4,
			deletions: 2,
			fileType: 'TS',
			isBinary: false,
			status: 'modified',
		};
		store.patch({ gitDiffFiles: [file] });
		const panel = widget.root.querySelector('[data-testid="git-diff-status-panel"]');
		assert.ok(panel);
		assert.ok(panel.textContent?.includes('4'));
		assert.strictEqual(panel.querySelector('.knox-gui-diff-add')?.textContent, '+4');
		assert.strictEqual(panel.querySelector('.knox-gui-diff-del')?.textContent, '-2');
	});

	test('composer always shows a model trigger and paper-plane Send', async () => {
		const { widget } = await mount();
		const model = widget.root.querySelector('[data-testid="knox-gui-model-select"]') as HTMLButtonElement | null;
		const send = widget.root.querySelector('[data-testid="knox-gui-send"]') as HTMLButtonElement | null;
		assert.ok(model);
		assert.ok(send);
		assert.ok(send.textContent?.includes('Send'));
		assert.ok(send.querySelector('svg.knox-gui-svg'));
		assert.ok(send.classList.contains('knox-gui-send'));
	});

	test('attach-image button appears only when imagesSupported', async () => {
		const { widget, store } = await mount();
		assert.strictEqual(widget.root.querySelector('[data-testid="knox-gui-attach-image"]'), null);
		store.patch({ imagesSupported: true });
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-attach-image"]'));
		store.patch({ imagesSupported: false });
		assert.strictEqual(widget.root.querySelector('[data-testid="knox-gui-attach-image"]'), null);
	});

	test('models overlay uses listbox roles and gear opens add-model modal', async () => {
		const { widget, store } = await mount();
		store.patch({
			overlay: 'models',
			modelsByRole: {
				chat: [{ title: 'GPT-4o', provider: 'knoxchat', model: 'openai/gpt-4o' }],
				edit: [],
				apply: [],
				viewRead: [],
				realTimeSearch: [],
			},
			selectedModelByRole: { chat: 'GPT-4o' },
			modelTitle: 'GPT-4o',
		});
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-role-chat"]'));
		assert.strictEqual(widget.root.querySelector('.knox-gui-model-roles select'), null);
		const gear = widget.root.querySelector('.knox-gui-role-gear') as HTMLButtonElement | null;
		assert.ok(gear);
		gear.click();
		assert.strictEqual(store.state.addModelModal, true);
		assert.strictEqual(store.state.addModelRole, 'chat');
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-add-model-modal"]'));
		assert.strictEqual(store.state.route, 'chat');
	});

	test('locked Memory editor renders the panel, not the chat composer', async () => {
		const { widget, store } = await mount();
		store.lockView(KnoxGuiRoute.Memory);
		assert.strictEqual(store.state.route, KnoxGuiRoute.Memory);
		assert.ok(widget.root.classList.contains('knox-gui-dedicated'));
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-memory"]'));
		assert.strictEqual(widget.root.querySelector('.knox-gui-input'), null);
		assert.strictEqual(widget.root.querySelector('[data-testid="knox-gui-lump"]'), null);
		store.patch({ route: KnoxGuiRoute.Chat, showSessionTabs: true, tabs: [{ id: 'a', title: '1' }, { id: 'b', title: '2' }] });
		assert.strictEqual(store.state.route, KnoxGuiRoute.Memory);
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-memory"]'));
		assert.strictEqual(widget.root.querySelector('.knox-gui-input'), null);
	});

	test('add-model provider cards show KnoxStudio, OpenRouter, OpenAI, and Anthropic logos', async () => {
		const posted: Array<{ type: string; data: unknown }> = [];
		const { widget, store } = await mount(message => {
			posted.push({ type: message.messageType, data: message.data });
			return {};
		});
		store.navigate('/addModel');
		assert.ok(widget.root.textContent?.includes('KnoxStudio'));
		const logos = widget.root.querySelectorAll('img.knox-gui-provider-icon');
		assert.strictEqual(logos.length, 4);
		const srcs = Array.from(logos).map(img => (img as HTMLImageElement).src);
		assert.ok(srcs.some(src => src.includes('knoxchat.png')));
		assert.ok(srcs.some(src => src.includes('openrouter.svg')));
		assert.ok(srcs.some(src => src.includes('openai.svg')));
		assert.ok(srcs.some(src => src.includes('anthropic.svg')));
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-provider-openrouter"]'));
		assert.strictEqual(widget.root.querySelectorAll('.knox-gui-add-model-options li').length, 2);
		(widget.root.querySelector('[data-testid="knox-gui-add-model-by-model"]') as HTMLButtonElement).click();
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-model-pack-openai-gpt-4-turbo"]'));
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-model-pack-openai-gpt-4o"]'));
		assert.ok(!widget.root.querySelector('[data-testid="knox-gui-model-pack-openai-AUTODETECT"]'));
		assert.ok(widget.root.querySelector('.knox-gui-page-intro h2')?.textContent);
		assert.ok(widget.root.querySelector('.knox-gui-rule'));
		(widget.root.querySelector('[data-testid="knox-gui-model-pack-openai-gpt-4o"]') as HTMLButtonElement).click();
		assert.ok(posted.some(item => item.type === 'config/addModel'));
	});

	test('checkpoint graph SVG stays mounted across tab switches', async () => {
		const { widget, store } = await mount();
		const node: IKnoxGuiCheckpointNode = {
			id: 'cp1',
			description: 'head',
			created: new Date().toISOString(),
			kind: 'manual',
			tags: [],
			shortId: 'cp1',
			pinned: false,
			changedPaths: [],
			parents: [],
			fileChanges: { added: 0, modified: 0, deleted: 0 },
		};
		store.navigate('/checkpoint-graph');
		store.patch({
			checkpointShell: { state: 'ready', checkpointCount: 1 },
			checkpoints: [node],
			checkpointView: 'graph',
		});
		assert.strictEqual(store.state.route, KnoxGuiRoute.CheckpointGraph);
		const svg = widget.root.querySelector('[data-testid="checkpoint-graph-svg"]');
		assert.ok(svg);
		store.patch({ checkpointView: 'analysis' });
		assert.strictEqual(widget.root.querySelector('[data-testid="checkpoint-graph-svg"]'), svg);
		assert.ok(widget.root.querySelector('[data-testid="checkpoint-graph-mount"]')?.classList.contains('hidden'));
		store.patch({ checkpointView: 'graph' });
		assert.strictEqual(widget.root.querySelector('[data-testid="checkpoint-graph-svg"]'), svg);
		assert.ok(!widget.root.querySelector('[data-testid="checkpoint-graph-mount"]')?.classList.contains('hidden'));
	});

	test('KN-370 setTheme applies theme kind and CSS vars on the widget root', async () => {
		const { widget, store } = await mount();
		store.patch({
			vscTheme: { base: 'vs-dark', colors: { 'editor.background': '#1e1e1e' } },
			vscColors: { '--vscode-editor-background': '#1e1e1e' },
			vscTokenColors: { '.hljs-comment': '#6A9955' },
		});
		assert.strictEqual(widget.root.getAttribute('data-knox-theme-base'), 'vs-dark');
		assert.strictEqual(widget.root.getAttribute('data-knox-theme-kind'), 'dark');
		assert.strictEqual(widget.root.style.getPropertyValue('--vscode-editor-background'), '#1e1e1e');
		assert.ok(widget.themeStyleEl.textContent?.includes('.hljs-comment'));
		assert.strictEqual(widget.isLightTheme(), false);
		store.patch({
			vscTheme: { base: 'vs', colors: { 'editor.background': '#ffffff' } },
			vscColors: { '--vscode-editor-background': '#ffffff' },
			vscTokenColors: { '.hljs-keyword': '#0000ff' },
		});
		assert.strictEqual(widget.root.getAttribute('data-knox-theme-kind'), 'light');
		assert.strictEqual(widget.isLightTheme(), true);
	});

	test('KP-001 history load shows the 3x3 drive loader and keeps the elapsed origin', async () => {
		const { widget, store } = await mount();
		store.patch({ isLoadingHistory: true });
		const wrap = widget.root.querySelector('[data-testid="chat-history-loading"]');
		const state = wrap?.querySelector('[data-testid="sent-message-loading-state"]');
		assert.ok(wrap);
		assert.ok(state);
		assert.strictEqual(wrap.querySelectorAll('.knox-gui-loading-pixel').length, 9);
		assert.ok(!wrap.querySelector('.knox-gui-loading-pixel.round'));
		assert.ok(state.querySelector('.knox-gui-loading-label')?.textContent?.includes('Loading'));
		assert.ok(/\d+\.\d+s$/.test(state.querySelector('.knox-gui-loading-elapsed')?.textContent ?? ''));
		assert.ok(state.getAttribute('aria-label')?.includes('Loading'));
		const origin = widget.historyLoadingStartedAt;
		assert.ok(typeof origin === 'number');
		store.patch({ sessionTitle: 'still loading' });
		assert.strictEqual(widget.historyLoadingStartedAt, origin);
		const elapsed = widget.root.querySelector('.knox-gui-loading-elapsed');
		assert.ok(elapsed);
		const first = elapsed.textContent;
		await timeout(150);
		assert.notStrictEqual(widget.root.querySelector('.knox-gui-loading-elapsed')?.textContent, first);
		store.patch({ isLoadingHistory: false });
		assert.strictEqual(widget.root.querySelector('[data-testid="chat-history-loading"]'), null);
		assert.strictEqual(widget.historyLoadingStartedAt, undefined);
	});

	test('S-14 stats page shows only the KnoxChat billing note', async () => {
		const { widget, store } = await mount();
		store.patch({ route: KnoxGuiRoute.Stats });
		const page = widget.root.querySelector('[data-testid="knox-gui-stats"]');
		assert.ok(page?.querySelector('.knox-gui-stats-billing'));
		assert.ok(!page?.querySelector('table'));
	});

	test('composer IME composition is not rewritten into Latin pinyin', async () => {
		const { widget, store } = await mount();
		store.setInputDoc(inputDocFromPlainText('文化'));
		const editor = widget.root.querySelector<HTMLElement>('[data-testid="knox-gui-input"]')!;
		const paragraph = editor.querySelector('p') ?? editor;
		const composing = document.createTextNode('wenhua');
		paragraph.append(composing);
		editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: 'wenhua' }));
		editor.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, data: 'wenhua', inputType: 'insertCompositionText' }));
		assert.strictEqual(widget.composerImeDepth > 0, true);
		assert.strictEqual(composing.parentNode, paragraph);
		store.setInputDoc(inputDocFromPlainText('stale'));
		assert.strictEqual(composing.parentNode, paragraph, 'paintInputDoc must not replaceChildren during composition');
		assert.strictEqual(widget.editorEl, editor);
		store.patch({ sessionTitle: 'during-ime' });
		assert.strictEqual(widget.editorEl, editor, 'full render must wait until compositionend');
		composing.textContent = '文化';
		editor.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '文化' }));
		assert.strictEqual(widget.composerImeDepth, 0);
		assert.ok(store.state.input.includes('文化'));
		assert.ok(!store.state.input.includes('wenhua'));
	});

	test('I-05 composer code block: newest expanded, header toggles, name opens lines, X deletes', async () => {
		const posted: string[] = [];
		const { widget, store } = await mount(message => { posted.push(message.messageType); return undefined; });
		store.setInputDoc([
			{ type: 'codeBlock', code: 'const a = 1;', language: 'typescript', filepath: '/w/a.ts', range: { start: 0, end: 1 } },
			{ type: 'codeBlock', code: 'const b = 2;', language: 'typescript', filepath: '/w/b.ts' },
			{ type: 'paragraph', content: [] },
		]);
		const chips = () => Array.from(widget.root.querySelectorAll<HTMLElement>('[data-testid="knox-gui-input-code-block"]'));
		const bodyOf = (chip: HTMLElement) => chip.querySelector<HTMLElement>('.knox-gui-input-code-body')!;
		assert.strictEqual(chips().length, 2);
		assert.strictEqual(bodyOf(chips()[0]).hidden, true);
		assert.strictEqual(bodyOf(chips()[1]).hidden, false);
		assert.ok(chips()[0].textContent?.includes('a.ts (1-2)'));
		chips()[0].querySelector<HTMLElement>('.knox-gui-input-code-head')!.click();
		assert.strictEqual(bodyOf(chips()[0]).hidden, false);
		const editor = widget.root.querySelector<HTMLElement>('.knox-gui-input')!;
		const read = widget.readInputDoc(editor);
		assert.deepStrictEqual(read[0], { type: 'codeBlock', code: 'const a = 1;', language: 'typescript', filepath: '/w/a.ts', range: { start: 0, end: 1 } });
		chips()[0].querySelector<HTMLElement>('[data-testid="knox-gui-input-code-open"]')!.click();
		await timeout(0);
		assert.ok(posted.includes('showLines'));
		assert.strictEqual(bodyOf(chips()[0]).hidden, false);
		chips()[0].querySelector<HTMLElement>('.knox-gui-input-code-remove')!.click();
		assert.deepStrictEqual(store.state.inputDoc.filter(block => block.type === 'codeBlock').map(block => block.type === 'codeBlock' && block.filepath), ['/w/b.ts']);
	});

	test('I-22 pending tool row: session badge disabled, actions hidden when auto-approved', async () => {
		const { widget, store } = await mount();
		const pending: IKnoxGuiToolCall = { id: 'p', name: 'builtin_read_file', arguments: '{}', status: 'generated' };
		store.patch({
			tools: [{ name: 'builtin_read_file', group: 'Built-In' }],
			toolSettings: { builtin_read_file: 'allowedWithPermission' },
			sessionToolAllowlist: ['builtin_read_file'],
			history: historyWithTool(pending),
			overlay: 'tools',
		});
		const row = () => widget.root.querySelector<HTMLElement>('[data-testid="tool-permission-row-builtin_read_file"]')!;
		assert.strictEqual(row().getAttribute('data-pending'), 'true');
		assert.strictEqual((row().querySelector('[data-testid="tool-permission-badge"]') as HTMLButtonElement).disabled, true);
		assert.ok(!row().querySelector('[data-testid="permission-action-buttons"]'));
		store.patch({ sessionToolAllowlist: [], permissionMode: 'fullAuto' });
		assert.ok(!row().querySelector('[data-testid="permission-action-buttons"]'));
		store.patch({ permissionMode: 'default' });
		assert.ok(row().querySelector('[data-testid="permission-action-buttons"]'));

		store.patch({
			tools: [{ name: 'builtin_edit_file', group: 'Built-In' }],
			toolSettings: { builtin_edit_file: 'allowedWithPermission' },
			sessionToolAllowlist: [],
			history: historyWithTool({ id: 'p2', name: 'edit', arguments: '{}', status: 'generated' }),
			overlay: 'tools',
		});
		assert.strictEqual(widget.root.querySelector('[data-testid="tool-permission-row-builtin_edit_file"]')?.getAttribute('data-pending'), 'true');
	});

	test('I-23 lump section fades out for 300ms after it closes', async () => {
		const { widget, store } = await mount();
		store.patch({ overlay: 'rules' });
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-overlay-rules"].knox-gui-overlay-enter'));
		store.patch({ overlay: 'prompts' });
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-overlay-prompts"]'));
		store.patch({ overlay: null });
		assert.ok(!widget.root.querySelector('[data-testid="knox-gui-overlay-prompts"]'));
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-overlay-leaving"].knox-gui-overlay-leave'));
		await timeout(350);
		assert.ok(!widget.root.querySelector('[data-testid="knox-gui-overlay-leaving"]'));
	});

	test('C-13 streaming keeps finished blocks, heals the live one, and reasoning fences get a toolbar', async () => {
		const { widget, store } = await mount();
		const user: IKnoxGuiHistoryItem = { id: 'u', role: 'user', content: 'hi' };
		store.patch({ isStreaming: true, history: [user, { id: 'a', role: 'assistant', content: 'para one\n\npara **two' }] });
		const body = () => widget.root.querySelector<HTMLElement>('.knox-gui-stream-body')!;
		const first = body().firstElementChild;
		assert.ok(body().querySelector('strong')?.textContent?.includes('two'));
		store.patch({ history: [user, { id: 'a', role: 'assistant', content: 'para one\n\npara **two** and more' }] });
		assert.strictEqual(body().firstElementChild, first);
		assert.ok(body().textContent?.includes('and more'));
		store.patch({ isStreaming: false, history: [user, { id: 'a', role: 'assistant', content: 'done', thinking: 'plan\n```ts\nconst x = 1;\n```', thinkingCollapsed: false, thinkingActive: true }] });
		const reasoning = widget.root.querySelector<HTMLElement>('.knox-gui-reasoning-body')!;
		assert.ok(reasoning.querySelector('.knox-gui-code-actions'));
		assert.ok(reasoning.classList.contains('no-scroll'));
		assert.ok(widget.root.querySelector('.knox-gui-reasoning-header.thinking')?.textContent?.includes('Thinking'));
		assert.ok(!widget.root.querySelector('.knox-gui-reasoning-header.thinking')?.textContent?.includes('Thinking...'));
	});

	test('streaming patches live reasoning, closed fences drop the generating bar, and tools sit beside the reply', async () => {
		const { widget, store } = await mount();
		const user: IKnoxGuiHistoryItem = { id: 'u', role: 'user', content: 'go' };
		store.patch({
			isStreaming: true,
			history: [user, { id: 'a', role: 'assistant', content: '', thinking: 'first', thinkingCollapsed: false, thinkingActive: true }],
		});
		assert.ok(widget.root.querySelector('.knox-gui-reasoning-body')?.textContent?.includes('first'));
		const reasoning = widget.root.querySelector('.knox-gui-reasoning');
		const anchor = widget.root.querySelector('[data-testid="stream-anchor"]');
		store.patch({
			history: [user, { id: 'a', role: 'assistant', content: '', thinking: 'first then more', thinkingCollapsed: false, thinkingActive: true }],
		});
		assert.ok(widget.root.querySelector('.knox-gui-reasoning-body')?.textContent?.includes('first then more'));
		assert.strictEqual(widget.root.querySelector('.knox-gui-reasoning'), reasoning);
		assert.strictEqual(widget.root.querySelector('[data-testid="stream-anchor"]'), anchor);

		store.patch({
			isStreaming: true,
			history: [user, { id: 'a', role: 'assistant', content: '```ts app.ts\nconst x = 1' }],
		});
		const codeScroll = widget.root.querySelector('.knox-gui-code-scroll');
		assert.ok(codeScroll?.classList.contains('generating'));
		store.patch({
			history: [user, { id: 'a', role: 'assistant', content: '```ts app.ts\nconst x = 12' }],
		});
		assert.strictEqual(widget.root.querySelector('.knox-gui-code-scroll'), codeScroll);
		assert.ok(codeScroll?.textContent?.includes('const x = 12'));

		store.patch({
			isStreaming: true,
			history: [user, { id: 'a', role: 'assistant', content: '```ts app.ts\nconst x = 1;\n```\nmore' }],
		});
		assert.strictEqual(widget.root.querySelector('.knox-gui-code-scroll'), codeScroll);
		assert.ok(!widget.root.querySelector('.knox-gui-code-scroll.generating'));

		store.patch({
			isStreaming: true,
			history: [user, {
				id: 'a',
				role: 'assistant',
				content: '',
				thinking: 'still thinking',
				thinkingCollapsed: false,
				thinkingActive: true,
				toolCalls: [{ id: 't', name: 'builtin_read_file', arguments: '{}', status: 'calling' as const }],
			}],
		});
		const liveStep = widget.root.querySelector('.knox-gui-step');
		const liveTool = widget.root.querySelector('[data-testid="knox-gui-tool"]');
		assert.ok(liveStep);
		assert.ok(liveTool);
		store.patch({
			history: [user, {
				id: 'a',
				role: 'assistant',
				content: '',
				thinking: 'still thinking harder',
				thinkingCollapsed: false,
				thinkingActive: true,
				toolCalls: [{ id: 't', name: 'builtin_read_file', arguments: '{}', status: 'calling' as const, output: 'file body' }],
			}],
		});
		assert.strictEqual(widget.root.querySelector('.knox-gui-step'), liveStep);
		assert.ok(widget.root.querySelector('.knox-gui-reasoning-body')?.textContent?.includes('still thinking harder'));

		store.patch({
			isStreaming: false,
			history: [user, {
				id: 'a',
				role: 'assistant',
				content: 'done',
				toolCalls: [{ id: 't', name: 'builtin_read_file', arguments: '{}', status: 'done' as const }],
			}],
		});
		const step = widget.root.querySelector('.knox-gui-step');
		const tool = widget.root.querySelector('[data-testid="knox-gui-tool"]');
		assert.ok(step);
		assert.ok(tool);
		assert.ok(step && tool && !step.contains(tool));
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-main-sent-frame"]'));
		assert.ok(widget.root.querySelector('.knox-gui-body-chat'));
	});

	test('streaming patches live reasoning, closed fences drop the generating bar, and tools sit beside the reply', async () => {
		const { widget, store } = await mount();
		const user: IKnoxGuiHistoryItem = { id: 'u', role: 'user', content: 'run it' };
		store.patch({
			isStreaming: true,
			history: [user, {
				id: 'a',
				role: 'assistant',
				content: 'para one',
				toolCalls: [{ id: 'term', name: 'builtin_run_terminal_command', arguments: '{"command":"ls"}', status: 'calling', parsedArgs: { command: 'ls' } }],
			}],
		});
		const reply = widget.root.querySelector('.knox-gui-stream-body')!;
		const firstMd = reply.querySelector('.rendered-markdown');
		const term = widget.root.querySelector('[data-testid="knox-gui-term"]');
		assert.ok(firstMd);
		assert.ok(term);
		store.patch({
			history: [user, {
				id: 'a',
				role: 'assistant',
				content: 'para one\n\npara two **still',
				toolCalls: [{
					id: 'term',
					name: 'builtin_run_terminal_command',
					arguments: '{"command":"ls"}',
					status: 'calling',
					parsedArgs: { command: 'ls' },
					output: 'file-a\n',
				}],
			}],
		});
		assert.strictEqual(reply.querySelector('.rendered-markdown'), firstMd);
		assert.strictEqual(widget.root.querySelector('[data-testid="knox-gui-term"]'), term);
		assert.ok(widget.root.querySelector('[data-testid="xterm-output"]')?.textContent?.includes('file-a'));
		store.patch({
			history: [user, {
				id: 'a',
				role: 'assistant',
				content: 'para one\n\npara two **still growing**',
				toolCalls: [{
					id: 'term',
					name: 'builtin_run_terminal_command',
					arguments: '{"command":"ls"}',
					status: 'calling',
					parsedArgs: { command: 'ls' },
					output: 'file-a\nfile-b\n',
				}],
			}],
		});
		assert.strictEqual(widget.root.querySelector('[data-testid="knox-gui-term"]'), term);
		assert.ok(widget.root.querySelector('[data-testid="xterm-output"]')?.textContent?.includes('file-b'));
		assert.ok(reply.textContent?.includes('growing'));
		const chevron = widget.root.querySelector('[data-testid="xterm-collapse"]') as HTMLElement;
		assert.ok(chevron);
		chevron.click();
		assert.strictEqual(widget.root.querySelector('[data-testid="knox-gui-term"]'), term);
		assert.strictEqual(widget.root.querySelector('.knox-gui-term-body'), null);
		chevron.click();
		assert.strictEqual(widget.root.querySelector('[data-testid="knox-gui-term"]'), term);
		assert.ok(widget.root.querySelector('.knox-gui-term-body'));
	});

	test('main sent frame matches KnoxInputBox GradientBorder + TipTapEditor layout', async () => {
		const { widget, store } = await mount();
		const frame = widget.root.querySelector('[data-testid="knox-gui-main-sent-frame"]') as HTMLElement | null;
		assert.ok(frame);
		assert.ok(frame.classList.contains('knox-sent-frame'));
		assert.strictEqual(frame.classList.contains('knox-sent-frame--live'), false);
		assert.strictEqual(frame.getAttribute('data-live'), 'false');
		const inner = frame.querySelector(':scope > .knox-sent-frame-inner') as HTMLElement | null;
		assert.ok(inner);
		const wrap = inner.querySelector(':scope > .knox-gui-input-wrap.knox-gui-editor') as HTMLElement | null;
		assert.ok(wrap);
		const editor = wrap.querySelector(':scope > [data-testid="knox-gui-input"]') as HTMLElement | null;
		const bar = wrap.querySelector(':scope > .knox-gui-input-bar') as HTMLElement | null;
		assert.ok(editor);
		assert.ok(bar);
		assert.ok(editor.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING);
		const left = bar.querySelector('.knox-gui-input-bar-left') as HTMLElement | null;
		const right = bar.querySelector('.knox-gui-input-bar-right') as HTMLElement | null;
		assert.ok(left);
		assert.ok(right);
		assert.ok(left.querySelector('.knox-gui-input-bar-icons'));
		assert.ok(left.querySelector('[data-testid="knox-gui-add-context"]'));
		assert.ok(left.querySelector('[data-testid="knox-gui-model-select"]'));
		assert.ok(right.querySelector('[data-testid="knox-gui-send"]'));
		assert.ok(bar.style.fontSize);
		const modelWrap = left.querySelector('.knox-gui-model-wrap');
		assert.ok(modelWrap);
		assert.ok(modelWrap.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING);

		store.patch({
			mode: 'agent',
			reasoningEfforts: ['minimal', 'low', 'high'],
			reasoningEffort: 'minimal',
			history: [{ id: 'u', role: 'user', content: 'hi' }],
		});
		const liveBar = widget.root.querySelector('.knox-gui-composer .knox-gui-input-bar') as HTMLElement | null;
		assert.ok(liveBar);
		const liveLeft = liveBar.querySelector('.knox-gui-input-bar-left') as HTMLElement;
		const liveRight = liveBar.querySelector('.knox-gui-input-bar-right') as HTMLElement;
		assert.ok(liveLeft.querySelector('[data-testid="knox-gui-reasoning-select"]'));
		assert.ok(liveLeft.querySelector('.knox-gui-effort-wrap'));
		assert.ok(liveRight.querySelector('[data-testid="knox-gui-scroll-top"]')?.querySelector('svg.knox-gui-svg'));
		assert.ok(liveRight.querySelector('[data-testid="knox-gui-scroll-bottom"]')?.querySelector('svg.knox-gui-svg'));
		assert.ok(liveRight.querySelector('[data-testid="knox-gui-send"]'));
	});

	test('composer toolbar model, effort, mention, and image follow original InputToolbar', async () => {
		const posted: Array<{ type: string; data: unknown }> = [];
		const { widget, store } = await mount(message => {
			posted.push({ type: message.messageType, data: message.data });
			if (message.messageType === 'context/loadSubmenuItems' || message.messageType === 'context/getContextItems') {
				return [];
			}
			return {};
		});
		store.patch({
			models: [
				{ title: 'Z.ai: GLM 5.3 Flash', provider: 'knoxchat', model: 'z-ai/glm-5.3-flash', supportedParameters: ['reasoning_effort'] },
				{ title: 'Missing Key', provider: 'knoxchat', model: 'missing', apiKey: '' },
			],
			modelsByRole: {
				chat: [
					{ title: 'Z.ai: GLM 5.3 Flash', provider: 'knoxchat', model: 'z-ai/glm-5.3-flash', supportedParameters: ['reasoning_effort'] },
					{ title: 'Missing Key', provider: 'knoxchat', model: 'missing', apiKey: '' },
				],
				edit: [],
				apply: [],
				viewRead: [],
				realTimeSearch: [],
			},
			modelTitle: 'Z.ai: GLM 5.3 Flash',
			profileType: 'local',
			reasoningEfforts: ['minimal', 'low', 'high'],
			reasoningEffort: 'minimal',
			imagesSupported: true,
		});
		const model = widget.root.querySelector('[data-testid="knox-gui-model-select"]') as HTMLButtonElement;
		assert.ok(model.textContent?.includes('GLM 5.3 Flash'));
		model.click();
		const menu = widget.root.querySelector('[data-testid="knox-gui-model-menu"]') as HTMLElement;
		assert.ok(menu);
		assert.ok(menu.classList.contains('knox-gui-popover-anchored'));
		assert.strictEqual(menu.parentElement, widget.root);
		const missing = Array.from(menu.querySelectorAll('[role="option"]')).find(el => el.textContent?.includes('Missing Key')) as HTMLElement;
		assert.ok(missing);
		assert.strictEqual(missing.getAttribute('aria-disabled'), 'true');
		missing.click();
		assert.strictEqual(store.state.modelTitle, 'Z.ai: GLM 5.3 Flash');
		assert.ok(menu.querySelector('.knox-gui-model-add'));
		assert.ok(menu.querySelector('.knox-gui-model-delete'));
		assert.ok(menu.querySelector('.knox-gui-model-config'));

		const effort = widget.root.querySelector('[data-testid="knox-gui-reasoning-select"]') as HTMLButtonElement;
		assert.ok(effort.textContent?.includes('Minimal'));
		effort.click();
		const effortMenu = widget.root.querySelector('[data-testid="knox-gui-effort-menu"]') as HTMLElement;
		assert.ok(effortMenu);
		assert.ok(effortMenu.classList.contains('knox-gui-popover-anchored'));
		assert.strictEqual(effortMenu.parentElement, widget.root);
		const high = Array.from(effortMenu.querySelectorAll('button')).find(el => (el.textContent ?? '').includes('High')) as HTMLButtonElement;
		assert.ok(high);
		high.click();
		assert.strictEqual(store.state.reasoningEffort, 'high');
		assert.ok(posted.some(entry => entry.type === 'ui/updateReasoningEffortPrefs'));

		assert.ok(widget.root.querySelector('[data-testid="knox-gui-attach-image"]'));
		const file = widget.root.querySelector('.knox-gui-file') as HTMLInputElement;
		assert.ok(file);
		assert.strictEqual(file.multiple, true);
		assert.ok(file.accept.includes('.png'));
		assert.ok(file.closest('.knox-gui-attach-wrap'));

		(widget.root.querySelector('[data-testid="knox-gui-add-context"]') as HTMLButtonElement).click();
		assert.strictEqual(store.state.mentionOpen, true);
		assert.ok(JSON.stringify(store.state.inputDoc).includes('@'));
	});

	test('empty model picker opens Add Model modal instead of the Add Model dropdown', async () => {
		const { widget, store } = await mount();
		store.patch({ profileType: 'local', models: [], modelsByRole: { chat: [], edit: [], apply: [], viewRead: [], realTimeSearch: [] } });
		const model = widget.root.querySelector('[data-testid="knox-gui-model-select"]') as HTMLButtonElement;
		assert.ok(model);
		assert.ok(model.textContent?.includes('Select Model'));
		assert.strictEqual(model.getAttribute('aria-haspopup'), 'dialog');
		model.click();
		assert.strictEqual(widget.root.querySelector('[data-testid="knox-gui-model-menu"]'), null);
		assert.strictEqual(store.state.addModelModal, true);
		assert.strictEqual(store.state.addModelBulk, true);
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-add-model-modal"]'));
		assert.strictEqual(widget.root.querySelector('.knox-gui-add-model-form-title')?.textContent, 'Add Model');
		assert.ok(!widget.root.querySelector('.knox-gui-add-model-form-title')?.textContent?.includes('Chat'));
	});

	test('custom config.yaml models still open the model dropdown instead of the Add Model modal', async () => {
		const { widget, store } = await mount();
		store.patch({
			profileType: 'local',
			models: [{ title: 'Local Llama', provider: 'ollama', model: 'llama3' }],
			modelsByRole: { chat: [], edit: [], apply: [], viewRead: [], realTimeSearch: [] },
		});
		const model = widget.root.querySelector('[data-testid="knox-gui-model-select"]') as HTMLButtonElement;
		assert.ok(model.textContent?.includes('Local Llama'));
		assert.strictEqual(model.getAttribute('aria-haspopup'), 'listbox');
		model.click();
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-model-menu"]'));
		assert.strictEqual(store.state.addModelModal, false);
		assert.ok(widget.root.querySelector('.knox-gui-model-add'));
	});

	test('composer section toggles hidden/shown, keeps the draft, and reveals itself for @ mentions', async () => {
		const { widget, store } = await mount();
		const collapsible = () => widget.root.querySelector('[data-testid="knox-gui-composer-collapsible"]') as HTMLElement;
		assert.strictEqual(collapsible().dataset.collapsed, 'false');
		assert.strictEqual(widget.root.querySelector('[data-testid="knox-gui-composer-dock"]'), null);
		assert.strictEqual(widget.root.querySelector('[data-testid="knox-gui-composer-collapse"]')?.getAttribute('aria-expanded'), 'true');

		store.setInputDoc(inputDocFromPlainText('keep me'));
		// The composer may re-render on input; always grab the live button.
		(widget.root.querySelector('[data-testid="knox-gui-composer-collapse"]') as HTMLButtonElement).click();
		assert.strictEqual(widget.composerCollapsed, true);
		assert.strictEqual(collapsible().dataset.collapsed, 'true');
		assert.strictEqual(collapsible().querySelector<HTMLElement>('.knox-gui-composer-collapsible-inner')?.inert, true);
		assert.ok(collapsible().classList.contains('is-collapsing'));
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-composer-dock"]'));
		assert.ok(widget.root.querySelector('.knox-gui-composer-dock-badge'));
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-composer-expand"] svg.knox-gui-svg'));
		assert.ok(store.state.input.includes('keep me'));

		// Folded and settled, the composer floats over the transcript so only the dock remains.
		const composerEl = widget.root.querySelector('[data-testid="full-composer"]') as HTMLElement;
		assert.strictEqual(composerEl.classList.contains('is-floating'), false);
		await timeout(450);
		assert.strictEqual(composerEl.classList.contains('is-floating'), true);

		(widget.root.querySelector('[data-testid="knox-gui-composer-expand"]') as HTMLButtonElement).click();
		assert.strictEqual((widget.root.querySelector('[data-testid="full-composer"]') as HTMLElement).classList.contains('is-floating'), false);
		assert.strictEqual(widget.composerCollapsed, false);
		assert.strictEqual(collapsible().dataset.collapsed, 'false');
		assert.ok(collapsible().classList.contains('is-expanding'));
		assert.ok(store.state.input.includes('keep me'));

		widget.setComposerCollapsed(true);
		assert.strictEqual(widget.composerCollapsed, true);
		store.patch({ mentionOpen: true, inputFocused: true });
		assert.strictEqual(widget.composerCollapsed, false);
	});

	test('collapsed composer dock shows dynamic scroll-to-top/bottom buttons', async () => {
		const { widget, store } = await mount();
		store.patch({ history: [{ id: 'u', role: 'user', content: 'hi' }] });
		assert.ok(widget.root.querySelector('.knox-gui-input-bar [data-testid="knox-gui-scroll-top"]'));
		assert.ok(widget.root.querySelector('.knox-gui-input-bar [data-testid="knox-gui-scroll-bottom"]'));
		assert.strictEqual(widget.root.querySelector('[data-testid="knox-gui-composer-dock"]'), null);

		widget.setComposerCollapsed(true);
		const dock = widget.root.querySelector('[data-testid="knox-gui-composer-dock"]') as HTMLElement;
		assert.ok(dock);
		assert.ok(dock.querySelector('[data-testid="knox-gui-scroll-top"]')?.querySelector('svg.knox-gui-svg'));
		assert.ok(dock.querySelector('[data-testid="knox-gui-scroll-bottom"]')?.querySelector('svg.knox-gui-svg'));
		assert.ok(dock.querySelector('[data-testid="knox-gui-scroll-top"]')?.classList.contains('knox-gui-composer-orb'));
		assert.ok(dock.querySelector('[data-testid="knox-gui-scroll-bottom"]')?.classList.contains('knox-gui-composer-orb'));
		assert.ok(dock.querySelector('.knox-gui-composer-dock-end'));
		assert.strictEqual(widget.root.querySelector('.knox-gui-input-bar [data-testid="knox-gui-scroll-top"]'), null);
		assert.strictEqual(widget.scrollTopBtn, dock.querySelector('[data-testid="knox-gui-scroll-top"]'));
		assert.strictEqual(widget.scrollBottomBtn, dock.querySelector('[data-testid="knox-gui-scroll-bottom"]'));

		// A short "hi" transcript sits at the top, so the dock button is disabled and
		// `.click()` would not fire. Drive the same handlers the buttons are wired to.
		widget.scrollTranscript('top');
		assert.strictEqual(widget.autoScrollEnabled, false);
		widget.scrollTranscript('bottom');
		assert.strictEqual(widget.autoScrollEnabled, true);

		widget.setComposerCollapsed(false);
		assert.ok(widget.root.querySelector('.knox-gui-input-bar [data-testid="knox-gui-scroll-top"]'));
		assert.ok(widget.root.querySelector('.knox-gui-input-bar [data-testid="knox-gui-scroll-bottom"]'));
		assert.strictEqual(widget.root.querySelector('[data-testid="knox-gui-composer-dock"] [data-testid="knox-gui-scroll-top"]'), null);

		widget.setComposerCollapsed(true);
		store.patch({ history: [] });
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-composer-dock"]'));
		assert.strictEqual(widget.root.querySelector('[data-testid="knox-gui-composer-dock"] [data-testid="knox-gui-scroll-top"]'), null);
		assert.strictEqual(widget.root.querySelector('[data-testid="knox-gui-composer-dock"] [data-testid="knox-gui-scroll-bottom"]'), null);
	});

	test('mention ArrowUp/Down select after @ opens without a full re-render', async () => {
		const { widget, store } = await mount();
		await widget.controller.loadMentions('');
		await timeout(0);
		const options = widget.root.querySelectorAll('[data-testid="context-provider-dropdown-item"]');
		assert.ok(options.length > 1);
		const key = (k: string) => new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
		const start = store.state.suggestSelected;
		widget.onEditorKeyDown(key('ArrowDown'));
		assert.strictEqual(store.state.suggestSelected, (start + 1) % options.length);
		widget.onEditorKeyDown(key('ArrowDown'));
		assert.strictEqual(store.state.suggestSelected, (start + 2) % options.length);
		widget.onEditorKeyDown(key('ArrowUp'));
		assert.strictEqual(store.state.suggestSelected, (start + 1) % options.length);
	});

	test('chat and thinking markdown use native highlighting styles', async () => {
		const { widget, store } = await mount();
		const user: IKnoxGuiHistoryItem = { id: 'u', role: 'user', content: 'go' };
		store.patch({
			isStreaming: true,
			history: [user, {
				id: 'a',
				role: 'assistant',
				content: 'Use `App.tsx` and **bold**.\n\n- item one',
				thinking: '- `signup-confirm`\n- **Create account**',
				thinkingCollapsed: false,
				thinkingActive: true,
			}],
		});
		const reply = widget.root.querySelector('.knox-gui-stream-body');
		assert.ok(reply?.querySelector('.rendered-markdown.styled-markdown-preview'));
		assert.ok(reply?.querySelector('code')?.textContent?.includes('App.tsx'));
		assert.ok(reply?.querySelector('strong')?.textContent?.includes('bold'));
		assert.ok(Array.from(reply?.querySelectorAll('li') ?? []).some(el => el.textContent?.includes('item one')));
		const thinking = widget.root.querySelector('.knox-gui-reasoning-content .rendered-markdown');
		assert.ok(thinking);
		assert.ok(thinking?.querySelector('code')?.textContent?.includes('signup-confirm'));
		assert.ok(thinking?.querySelector('strong')?.textContent?.includes('Create account'));
		assert.ok(thinking?.querySelectorAll('li').length === 2);
	});

	test('streaming strips leaked tool markup, heals tables, and live-patches file tool code', async () => {
		const { widget, store } = await mount();
		const user: IKnoxGuiHistoryItem = { id: 'u', role: 'user', content: 'go' };
		store.patch({
			isStreaming: true,
			history: [user, { id: 'a', role: 'assistant', content: 'hello\n< | DSML |  calls>\nsecret' }],
		});
		const leaked = widget.root.querySelector('.knox-gui-stream-body')?.textContent ?? '';
		assert.ok(leaked.includes('hello'));
		assert.ok(!leaked.includes('DSML'));
		assert.ok(!leaked.includes('secret'));

		store.patch({
			history: [user, { id: 'a', role: 'assistant', content: '| col |\n| --- |\n| val' }],
		});
		assert.ok(widget.root.querySelector('.knox-gui-stream-body table'));

		store.patch({
			history: [user, {
				id: 'a',
				role: 'assistant',
				content: '',
				toolCalls: [{
					id: 't',
					name: 'builtin_write_file',
					arguments: '{"filepath":"a.ts","contents":"const x = 1"}',
					status: 'generating',
					parsedArgs: { filepath: 'a.ts', contents: 'const x = 1' },
				}],
			}],
		});
		const tool = widget.root.querySelector('[data-testid="knox-gui-tool"]');
		const code = widget.root.querySelector('.knox-gui-code-scroll');
		assert.ok(tool);
		assert.ok(code);
		store.patch({
			history: [user, {
				id: 'a',
				role: 'assistant',
				content: '',
				toolCalls: [{
					id: 't',
					name: 'builtin_write_file',
					arguments: '{"filepath":"a.ts","contents":"const x = 12"}',
					status: 'generating',
					parsedArgs: { filepath: 'a.ts', contents: 'const x = 12' },
				}],
			}],
		});
		assert.strictEqual(widget.root.querySelector('[data-testid="knox-gui-tool"]'), tool);
		assert.strictEqual(widget.root.querySelector('.knox-gui-code-scroll'), code);
		assert.ok(code?.textContent?.includes('const x = 12'));

		store.patch({
			history: [user, { id: 'a', role: 'assistant', content: 'Use `App.tsx`.\n\n```ts app.ts\nconst y = 1' }],
		});
		const liveFence = widget.root.querySelector('[data-testid="syntax-highlighted-pre"]');
		assert.ok(liveFence?.classList.contains('generating'));
		assert.ok(liveFence?.querySelector('.monaco-tokenized-source, .knox-gui-code-line'));
		assert.ok(widget.root.querySelector('.knox-gui-streaming-cursor'));
		store.patch({
			isStreaming: false,
			history: [user, { id: 'a', role: 'assistant', content: 'Use `App.tsx`.\n\n```ts app.ts\nconst y = 1;\n```' }],
		});
		assert.strictEqual(widget.root.querySelector('[data-testid="syntax-highlighted-pre"]'), liveFence);
		assert.ok(!widget.root.querySelector('.knox-gui-code-scroll.generating'));
		assert.ok(widget.root.querySelector('.knox-gui-msg-actions:not(.knox-gui-msg-actions-slot)'));
	});

	test('response actions use original restore, trash, and copy icons in primary color', async () => {
		const { widget, store } = await mount();
		store.patch({
			isStreaming: false,
			history: [
				{ id: 'u', role: 'user', content: 'go' },
				{ id: 'a', role: 'assistant', content: 'done', checkpointId: 'cp12345678' },
			],
		});
		const restore = widget.root.querySelector('[data-testid="checkpoint-restore-button-1"]');
		const del = widget.root.querySelector('[data-testid="delete-button-1"]');
		const copy = widget.root.querySelector('.knox-gui-msg-actions [data-copied]');
		const restoreSvg = restore?.querySelector('svg.knox-gui-svg') as SVGSVGElement | null;
		const delSvg = del?.querySelector('svg.knox-gui-svg') as SVGSVGElement | null;
		const copySvg = copy?.querySelector('svg.knox-gui-svg') as SVGSVGElement | null;
		assert.ok(restoreSvg?.innerHTML.includes('M12 21q-3.15'));
		assert.ok(!restore?.querySelector('.codicon'));
		assert.ok(delSvg?.innerHTML.includes('M20 6h-4V5'));
		assert.ok(!del?.classList.contains('knox-gui-delete-orange'));
		assert.ok(copySvg?.innerHTML.includes('9.667'));
		assert.deepStrictEqual(
			[restoreSvg, delSvg, copySvg].map(svg => ({ w: svg?.getAttribute('width'), h: svg?.getAttribute('height') })),
			[{ w: '14', h: '14' }, { w: '14', h: '14' }, { w: '14', h: '14' }],
		);
		assert.strictEqual(restoreSvg?.getAttribute('viewBox'), '2.5 3.5 19 18');
		assert.strictEqual(delSvg?.getAttribute('viewBox'), '3 2 18 20');
		assert.strictEqual(copySvg?.getAttribute('viewBox'), '0 0 24 24');
	});

	test('code block hover and file toolbars copy/apply/insert the live fence', async () => {
		const { widget, store } = await mount();
		const posts: Array<{ type: string; data: unknown }> = [];
		const orig = widget.controller.messenger.post.bind(widget.controller.messenger);
		widget.controller.messenger.post = ((type: string, data?: unknown) => {
			posts.push({ type, data });
			return orig(type, data);
		}) as typeof orig;

		store.patch({
			history: [
				{ id: 'u', role: 'user', content: 'go' },
				{ id: 'a', role: 'assistant', content: '```diff\n+ const name = 1;\n```' },
			],
		});
		const hoverBox = widget.root.querySelector('[data-testid="step-container-pre-action-buttons"]') as HTMLElement | null;
		assert.ok(hoverBox?.classList.contains('knox-gui-code-generic'));
		const hover = hoverBox?.querySelector('.knox-gui-code-hover') as HTMLElement | null;
		assert.ok(hover);
		assert.ok(hover.querySelector('.knox-gui-apply'));
		assert.ok(hover.querySelector('[data-copied]'));
		(hover.querySelector('.knox-gui-apply') as HTMLButtonElement).click();
		assert.ok(posts.some(post => post.type === 'applyToFile' && JSON.stringify(post.data).includes('const name = 1')));
		posts.length = 0;
		const insert = hover.querySelector('.knox-gui-code-hover-btn:not(.knox-gui-apply)') as HTMLButtonElement | null;
		assert.ok(insert);
		insert.click();
		assert.ok(posts.some(post => post.type === 'insertAtCursor' && JSON.stringify(post.data).includes('const name = 1')));
		posts.length = 0;
		(hover.querySelector('[data-copied]') as HTMLButtonElement).click();
		assert.ok(posts.some(post => post.type === 'copyText' && JSON.stringify(post.data).includes('const name = 1')));

		store.patch({
			history: [
				{ id: 'u', role: 'user', content: 'go' },
				{ id: 'a', role: 'assistant', content: '```ts app.ts\nexport const x = 1;\n```' },
			],
		});
		const fileBox = widget.root.querySelector('[data-testid="step-container-pre-toolbar"]');
		assert.ok(fileBox);
		assert.ok(fileBox.querySelector('.knox-gui-copy-code'));
		assert.ok(fileBox.querySelector('.knox-gui-apply'));
		(fileBox.querySelector('.knox-gui-apply') as HTMLButtonElement).click();
		assert.ok(posts.some(post => post.type === 'applyToFile' && JSON.stringify(post.data).includes('export const x = 1')));
	});

	test('I-09 shortcut hints render one kbd per key with the platform meta key', async () => {
		const { widget, store } = await mount();
		store.patch({ overlay: 'history', historySessions: [] });
		const keys = Array.from(widget.root.querySelectorAll('.knox-gui-history-empty kbd')).map(el => el.textContent);
		assert.deepStrictEqual(keys, [isMacintosh ? '⌘' : 'Ctrl', 'L']);
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-mode-select"]'));
		const footer = widget.root.querySelector('.knox-gui-history-footer');
		assert.ok(footer?.textContent);
		assert.ok(footer?.querySelector('.knox-gui-history-footer-icon svg.knox-gui-svg'));
		assert.ok(widget.root.querySelector('.knox-gui-toolbar-left')?.classList.contains('knox-gui-xs-hide'));
	});

	function historyWithTool(tool: IKnoxGuiToolCall): IKnoxGuiHistoryItem[] {
		return [
			{ id: 'u', role: 'user', content: 'go' },
			{ id: 'a', role: 'assistant', content: '', toolCalls: [tool] },
		];
	}

	test('KN-373 specialized tool cards render without xterm', async () => {
		const { widget, store } = await mount();

		store.patch({
			history: historyWithTool({
				id: 'term',
				name: 'builtin_build',
				arguments: '{"action":"test"}',
				status: 'done',
				parsedArgs: { action: 'test' },
				outputItems: [{ name: 'Build', content: 'Compiling foo\nFinished test' }],
			}),
		});
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-term"]'));
		assert.strictEqual(widget.root.querySelector('[data-testid="xterm-command"]')?.textContent, 'cargo test');
		assert.ok(widget.root.querySelector('[data-testid="xterm-output"]')?.textContent?.includes('Compiling foo'));
		assert.strictEqual(widget.root.querySelector('.xterm'), null);

		store.patch({
			history: historyWithTool({
				id: 'search',
				name: 'builtin_exact_search',
				arguments: '{"query":"hit"}',
				status: 'done',
				parsedArgs: { query: 'hit' },
				outputItems: [{ name: 'Search', content: 'src/a.ts\n10:const hit = 1;\n11-const skip = 2;' }],
			}),
		});
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-search"]'));
		assert.ok(widget.root.querySelector('.knox-gui-search-query')?.textContent?.includes('hit'));
		assert.ok(widget.root.querySelector('.knox-gui-search-line.match'));
		assert.ok(widget.root.querySelector('.knox-gui-search-line:not(.match)'));

		store.patch({
			history: historyWithTool({
				id: 'search-args',
				name: 'builtin_exact_search',
				arguments: '{"query":"signup-name"}',
				status: 'done',
				outputItems: [{ name: 'Search Results', description: 'Exact search results for "signup-name" - No matches found', content: 'No matches found' }],
			}),
		});
		assert.strictEqual(widget.root.querySelector('.knox-gui-search-query')?.textContent, 'signup-name');
		assert.ok(widget.root.querySelector('.knox-gui-search-empty')?.textContent?.includes('No matches found'));
		assert.ok(!widget.root.querySelector('.knox-gui-search-query')?.textContent?.includes('\uE000'));

		store.patch({
			history: historyWithTool({
				id: 'search-ansi',
				name: 'builtin_exact_search',
				arguments: '{"query":"\\u001b[31mfoo\\u001b[0m"}',
				status: 'done',
				parsedArgs: { query: '\u001b[31mfoo\u001b[0m' },
				outputItems: [{ name: 'Search Results', content: 'No matches found' }],
			}),
		});
		assert.strictEqual(widget.root.querySelector('.knox-gui-search-query')?.textContent, 'foo');

		store.patch({
			history: historyWithTool({
				id: 'repo',
				name: 'builtin_view_repo_map',
				arguments: '{}',
				status: 'done',
				outputItems: [{ name: 'repo map', description: 'repo structure', content: 'src/main.ts\nsrc/lib.rs' }],
			}),
		});
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-repo-map"]'));
		assert.ok(widget.root.querySelector('[data-testid="repo-map-static"]')?.textContent?.includes('main.ts'));

		store.patch({
			history: historyWithTool({
				id: 'create',
				name: 'builtin_create_new_file',
				arguments: '{"filepath":"src/new.ts","contents":"export const x = 1;"}',
				status: 'done',
				parsedArgs: { filepath: 'src/new.ts', contents: 'export const x = 1;' },
			}),
		});
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-create-file"]'));
		assert.ok(widget.root.querySelector('[data-testid="clickable-file-path"]')?.textContent?.includes('new.ts'));

		store.patch({
			history: historyWithTool({
				id: 'task',
				name: 'builtin_task',
				arguments: '{"profile":"explore","prompt":"Find the auth entrypoint"}',
				status: 'done',
				parsedArgs: { profile: 'explore', prompt: 'Find the auth entrypoint' },
				output: 'auth.rs:12',
			}),
		});
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-subagent"]'));
		assert.strictEqual(widget.root.querySelector('[data-testid="knox-gui-subagent"]')?.getAttribute('data-subagent-profile'), 'explore');
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-subagent-meta"]')?.textContent?.includes('Find the auth entrypoint'));

		store.patch({
			history: historyWithTool({
				id: 'ask',
				name: 'builtin_ask_user',
				arguments: '{}',
				status: 'generated',
				parsedArgs: {
					questions: [{
						prompt: 'How would you like to run/play the Rust Tetris game?',
						options: [
							'Terminal game (crossterm) — runs in your terminal',
							'Desktop GUI (e.g. bevy/macroquad) — a windowed native app',
						],
					}],
				},
				questions: [{
					id: 'q1',
					prompt: 'How would you like to run/play the Rust Tetris game?',
					options: [
						'Terminal game (crossterm) — runs in your terminal',
						'Desktop GUI (e.g. bevy/macroquad) — a windowed native app',
					],
				}],
			}),
		});
		const ask = widget.root.querySelector('[data-testid="knox-gui-ask"]') as HTMLElement | null;
		assert.ok(ask);
		const submit = widget.root.querySelector('[data-testid="ask-user-submit"]') as HTMLButtonElement | null;
		assert.ok(submit?.disabled);
		const choice = Array.from(widget.root.querySelectorAll('.knox-gui-ask-choice-label')).find(el => el.textContent === 'Desktop GUI (e.g. bevy/macroquad)');
		assert.ok(choice);
		assert.ok(choice.parentElement?.querySelector('.knox-gui-ask-choice-desc')?.textContent?.includes('a windowed native app'));
		assert.ok(widget.root.querySelector('kbd.knox-gui-ask-kbd'));
		(choice.closest('button') as HTMLButtonElement).click();
		const enabled = widget.root.querySelector('[data-testid="ask-user-submit"]') as HTMLButtonElement | null;
		assert.strictEqual(enabled?.disabled, false);
		const askAfter = widget.root.querySelector('[data-testid="knox-gui-ask"]') as HTMLElement | null;
		askAfter?.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
		assert.ok(widget.root.querySelector('.knox-gui-ask-choice.selected')?.textContent?.includes('Terminal game'));
		widget.askUserDrafts.set('ask', { q1: 'Red\u0001Blue', 'q1::freeform': 'Other' });
		store.patch({
			history: historyWithTool({
				id: 'ask',
				name: 'builtin_ask_user',
				arguments: '{}',
				status: 'done',
				questions: [{
					id: 'q1',
					prompt: 'How would you like to run/play the Rust Tetris game?',
					options: [
						'Terminal game (crossterm) — runs in your terminal',
						'Desktop GUI (e.g. bevy/macroquad) — a windowed native app',
					],
				}],
			}),
		});
		assert.ok(widget.root.querySelector('.knox-gui-ask-answer')?.textContent?.includes('Red, Blue, Other'));
	});

	test('ask_user recovers Cursor-style options and does not trap on empty args', async () => {
		const { widget, store } = await mount();
		store.patch({
			history: historyWithTool({
				id: 'ask-cursor',
				name: 'builtin_ask_user',
				arguments: JSON.stringify({
					title: 'Which syscall to add?',
					questions: [{
						id: 'syscall',
						options: [
							{ id: 'enosys', label: 'Implement an ENOSYS stub' },
							{ id: 'custom', label: 'Add a KnoxOS-specific syscall' },
						],
					}],
				}),
				status: 'generated',
				parsedArgs: {
					title: 'Which syscall to add?',
					questions: [{
						id: 'syscall',
						options: [
							{ id: 'enosys', label: 'Implement an ENOSYS stub' },
							{ id: 'custom', label: 'Add a KnoxOS-specific syscall' },
						],
					}],
				},
			}),
		});
		assert.ok(!widget.root.querySelector('[data-testid="knox-gui-ask-invalid"]'));
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-ask"]'));
		assert.ok(Array.from(widget.root.querySelectorAll('.knox-gui-ask-choice-label')).some(el => el.textContent === 'Implement an ENOSYS stub'));
		assert.ok(widget.root.querySelector('[data-testid="ask-user-deny"]'));
		assert.ok(widget.root.querySelector('[data-testid="ask-user-submit"]'));

		store.patch({
			history: historyWithTool({
				id: 'ask-empty',
				name: 'builtin_ask_user',
				arguments: '{}',
				status: 'generated',
				parsedArgs: {},
			}),
		});
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-ask-invalid"]'));
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-ask"]'));
		assert.ok(widget.root.querySelector('[data-testid="ask-user-deny"]'));
		assert.ok(widget.root.querySelector('[data-testid="ask-user-submit"]'));
	});

	test('tool titles match original Knox + status + catalog template', async () => {
		const { widget, store } = await mount();
		store.patch({
			tools: [{
				name: 'builtin_view_subdirectory',
				group: 'Built-In',
				displayTitle: 'View Subdirectory',
				wouldLikeTo: 'View directory structure for "{{{ directory_path }}}"',
				isCurrently: 'Getting directory structure for "{{{ directory_path }}}"',
				hasAlready: 'Viewed directory structure for "{{{ directory_path }}}"',
			}],
			history: historyWithTool({
				id: 'dir',
				name: 'ls',
				arguments: '{"directory_path":"src"}',
				status: 'canceled',
				parsedArgs: { directory_path: 'src' },
			}),
		});
		const title = widget.root.querySelector('.knox-gui-tool-status-text')?.textContent ?? '';
		assert.ok(title.includes('Knox'), title);
		assert.ok(title.includes('Canceled'), title);
		assert.ok(title.includes('View directory structure for "src"'), title);
		assert.ok(!title.includes('Agent Tool Usage'), title);

		store.patch({
			history: historyWithTool({
				id: 'empty',
				name: '',
				arguments: '{',
				status: 'errored',
				parsedArgs: {},
				output: 'Tool call "" failed',
			}),
		});
		assert.ok(widget.root.querySelector('.knox-gui-tool-status-text')?.textContent?.includes('Agent Tool Usage'));
	});

	test('KN-374 composer @ mentions, / slash, image drop, history, and code-to-edit chips', async () => {
		const { widget, store } = await mount();
		const controller = widget.controller;

		await controller.loadMentions('');
		await timeout(0);
		assert.strictEqual(widget.root.querySelector('[data-suggestion-kind="mention"]')?.getAttribute('data-testid'), 'knox-gui-suggest');
		for (const title of DEFAULT_MENTION_PROVIDER_TITLES) {
			assert.ok(widget.root.querySelector(`[data-mention-id="${title}"]`), title);
		}
		(widget.root.querySelector('[data-mention-id="problems"]') as HTMLButtonElement).click();
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-mention-chip"]')?.textContent?.includes('Problems'));

		await controller.loadSlash('');
		await timeout(0);
		assert.strictEqual(widget.root.querySelector('[data-suggestion-kind="slash"]')?.getAttribute('data-testid'), 'knox-gui-suggest');
		for (const cmd of SLASH_BUILTINS) {
			assert.ok(widget.root.querySelector(`[data-mention-id="/${cmd.name}"]`), cmd.name);
		}
		(widget.root.querySelector('[data-mention-id="/commit"]') as HTMLButtonElement).click();
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-slash-chip"]')?.textContent?.includes('/commit'));

		store.patch({
			imagesSupported: true,
			images: [{ name: 'shot.png', imageUrl: 'data:image/png;base64,QQ==' }],
		});
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-image-thumbs"]'));
		widget.showDropOverlay();
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-drop-overlay"]'));
		widget.hideDropOverlay();
		assert.strictEqual(widget.root.querySelector('[data-testid="knox-gui-drop-overlay"]'), null);

		controller.mentionDroppedFile('/workspace/src/app.ts');
		assert.ok(store.state.input.includes('@app.ts'));

		store.patch({
			mode: 'agent',
			codeToEdit: [{ filepath: 'file:///src/a.ts', range: { start: { line: 0 }, end: { line: 3 } } }],
		});
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-code-to-edit-chip"]')?.textContent?.includes('a.ts'));
		store.patch({
			mode: 'edit',
			history: [],
			codeToEdit: [{ filepath: 'file:///src/a.ts', contents: 'const x = 1;', range: { start: { line: 0 }, end: { line: 3 } } }],
		});
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-code-to-edit"]'));
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-code-to-edit-item"]')?.textContent?.includes('a.ts'));

		store.patch({ mode: 'agent' });
		widget.chatInputHistory = composerInputHistoryAdd(createComposerInputHistory(), inputDocFromPlainText('first'));
		widget.chatInputHistory = composerInputHistoryAdd(widget.chatInputHistory, inputDocFromPlainText('second'));
		store.setInputDoc(inputDocFromPlainText('draft'));
		widget.stepInputHistory(-1);
		assert.strictEqual(store.state.input, 'second');
		widget.stepInputHistory(-1);
		assert.strictEqual(store.state.input, 'first');
		widget.stepInputHistory(1);
		assert.strictEqual(store.state.input, 'second');
	});

	test('K-07 / K-12 checkpoint details modal: tabs, snapshot tree and viewer, getPreviousCheckpoint fallback', async () => {
		const sent: string[] = [];
		const snapshot = (content: string) => ({ relativePath: 'src/a.ts', content, encoding: 'utf8', size: content.length, lastModified: '2026-09-26T00:00:00.000Z' });
		const { widget, store } = await mount(message => {
			sent.push(message.messageType);
			switch (message.messageType) {
				case 'getCheckpointDetails':
					return { success: true, details: { id: 'cp-2', description: '{"step":2}', created: '2026-09-26T01:00:00.000Z', workspacePath: '/ws', conversationContext: { role: 'user', messageContent: 'refactor a', index: 0, timestamp: '2026-09-26T01:00:00.000Z' }, fileSnapshots: [snapshot('const a = 2;')] } };
				case 'computeCheckpointDiff':
					return { success: false, diff: null };
				case 'getPreviousCheckpoint':
					return { success: true, details: { id: 'cp-1', description: 'first', created: '2026-09-26T00:00:00.000Z', fileSnapshots: [snapshot('const a = 1;')] } };
				default:
					return undefined;
			}
		});
		const node = (id: string, created: string): IKnoxGuiCheckpointNode => ({
			id, description: id, created, kind: 'manual', tags: [], shortId: id.replace('-', ''), pinned: false, changedPaths: [], parents: [], fileChanges: { added: 0, modified: 0, deleted: 0 },
		});
		store.navigate('/checkpoint-graph');
		store.patch({
			checkpointShell: { state: 'ready', checkpointCount: 2 },
			checkpoints: [node('cp-2', '2026-09-26T01:00:00.000Z'), node('cp-1', '2026-09-26T00:00:00.000Z')],
			checkpointView: 'checkpoints',
		});
		(widget.root.querySelector('[data-testid="checkpoint-row-cp2"] .knox-gui-checkpoint-details') as HTMLButtonElement).click();
		for (let i = 0; i < 5 && !widget.checkpointDetails?.diff; i++) {
			await timeout(5);
		}
		const modal = widget.root.querySelector('[data-testid="knox-gui-checkpoint-details"]');
		assert.ok(modal);
		assert.strictEqual(modal.querySelector('[data-testid="checkpoint-details-tab-files"]')?.getAttribute('aria-selected'), 'true');
		assert.ok(modal.querySelector('.knox-gui-checkpoint-tree-row.selected')?.textContent?.includes('a.ts'));
		assert.ok(modal.querySelector('[data-testid="checkpoint-code-viewer"]')?.textContent?.includes('const a = 2;'));
		assert.ok(modal.querySelector('[data-testid="checkpoint-tree-splitter"]'));

		(modal.querySelector('[data-testid="checkpoint-details-tab-basic"]') as HTMLButtonElement).click();
		const basic = widget.root.querySelector('[data-testid="checkpoint-details-basic"]');
		assert.ok(basic?.textContent?.includes('/ws'));
		assert.ok(basic?.textContent?.includes('refactor a'));
		assert.ok(basic?.querySelector('pre.knox-gui-checkpoint-json')?.textContent?.includes('"step": 2'));

		assert.ok(sent.includes('getPreviousCheckpoint'));
		(widget.root.querySelector('[data-testid="checkpoint-details-tab-diff"]') as HTMLButtonElement).click();
		assert.ok(widget.root.querySelector('[data-testid="checkpoint-compare-target"]'));
		assert.ok(widget.root.querySelector('[data-testid="checkpoint-diff-viewer"]')?.textContent?.includes('const a = 1;'));

		(widget.root.querySelector('[data-testid="knox-gui-checkpoint-details"] .knox-gui-checkpoint-details-close') as HTMLButtonElement).click();
		assert.strictEqual(widget.root.querySelector('[data-testid="knox-gui-checkpoint-details"]'), null);
	});

	test('K-01 / K-04 / K-05 / K-09 checkpoint shell, list states, chronological compare, restore errors', async () => {
		const { widget, store } = await mount(message => message.messageType === 'previewRestore' ? { success: false, message: 'Workspace is missing' } : undefined);
		const node = (id: string, created: string): IKnoxGuiCheckpointNode => ({
			id, description: id, created, kind: 'manual', tags: [], shortId: id.replace('-', ''), pinned: false, changedPaths: [], parents: [], fileChanges: { added: 0, modified: 0, deleted: 0 },
		});
		store.navigate('/checkpoint-graph');
		store.patch({ checkpointShell: { state: 'failed', checkpointCount: 0 }, checkpointView: 'graph' });
		assert.ok(widget.root.querySelector('[data-testid="checkpoint-graph-shell-action"]'));

		store.patch({ checkpointView: 'checkpoints', checkpointActiveWorkspace: '/ws/proj' });
		const empty = widget.root.querySelector('[data-testid="checkpoint-list-empty"]');
		assert.ok(empty?.textContent?.includes('proj'));
		assert.ok(empty?.querySelector('kbd'));

		store.patch({
			checkpointShell: { state: 'ready', checkpointCount: 2 },
			checkpoints: [node('cp-2', '2026-09-26T01:00:00.000Z'), node('cp-1', '2026-09-26T00:00:00.000Z')],
			checkpointCompareCatalog: [{ id: 'cp-2', description: 'second', created: '2026-09-26T01:00:00.000Z' }, { id: 'cp-1', description: 'first', created: '2026-09-26T00:00:00.000Z' }],
		});
		widget.root.querySelector('[data-testid="checkpoint-row-cp2"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
		assert.strictEqual(widget.checkpointListSelectMode, true);
		assert.ok(widget.checkpointListSelected.has('cp-2'));
		widget.checkpointListSelected = new Set(['cp-2', 'cp-1']);
		widget.render();
		const compare = [...widget.root.querySelectorAll<HTMLButtonElement>('.knox-gui-checkpoint-list-actions button')].find(button => button.textContent?.trim() === 'Compare');
		compare!.click();
		assert.strictEqual(store.state.checkpointCompareLeftId, 'cp-1');
		assert.strictEqual(store.state.checkpointCompareRightId, 'cp-2');
		assert.ok(widget.root.querySelector('[data-testid="checkpoint-compare-dialog"]')?.textContent?.includes('first'));
		store.patch({
			checkpointView: 'analysis',
			checkpointAnalysisCatalog: [{ id: 'cp-1', description: 'first' }],
			checkpointAnalysisId: 'cp-1',
			checkpointAnalysisPending: false,
			checkpointAnalysis: undefined,
		});
		assert.strictEqual(widget.root.querySelector('[data-testid="checkpoint-analysis-unavailable"]')?.textContent, 'No analysis for this checkpoint.');
		store.patch({
			checkpointAnalysis: {
				checkpointId: 'cp-1', generatedDescription: 'd',
				riskAssessment: { level: 'Low', score: 1, factors: [], recommendations: [] },
				impactAnalysis: { affectedFeatures: [], affectedLayers: [], scope: 'Isolated' },
			},
		});
		assert.strictEqual(widget.root.querySelector('[data-testid="checkpoint-risk-badge"]')?.textContent, 'Low(1.0)');
		store.patch({ checkpointView: 'checkpoints' });
		widget.onEscape(new KeyboardEvent('keydown', { key: 'Escape' }), store.state);
		assert.strictEqual(store.state.checkpointDialog, null);

		widget.checkpointListSelected = new Set(['cp-1']);
		widget.checkpointListDeleteConfirm = true;
		widget.render();
		assert.ok(widget.root.querySelector('[data-testid="checkpoint-list-delete"]')?.textContent?.includes('delete 1 checkpoint?'));
		(widget.root.querySelector('[data-testid="checkpoint-list-delete"]')!.parentElement as HTMLElement).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
		assert.strictEqual(widget.checkpointListDeleteConfirm, false);

		await widget.controller.openRestorePreview('cp-1');
		assert.strictEqual(widget.root.querySelector('[data-testid="restore-preview-error"]')?.textContent, 'Workspace is missing');
		(widget.root.querySelector('[data-testid="restore-preview-dialog"]')!.parentElement as HTMLElement).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
		assert.strictEqual(store.state.checkpointDialog, null);
	});

	test('I-11 / I-13 composer chips carry icons and dismiss, and the caret maps to doc positions', async () => {
		const { widget, store } = await mount();
		store.setInputDoc([{
			type: 'paragraph', content: [
				{ type: 'text', text: 'see ' },
				{ type: 'mention', id: 'file:///ws/a.ts', label: 'a.ts', itemType: 'file', query: 'file:///ws/a.ts' },
				{ type: 'text', text: ' @ap' },
			]
		}, { type: 'paragraph', content: [{ type: 'slash', id: '/commit', label: '/commit' }] }]);
		const editor = widget.root.querySelector('[data-testid="knox-gui-input"]') as HTMLElement;
		const chip = editor.querySelector('[data-testid="knox-gui-mention-chip"]') as HTMLElement;
		assert.ok(chip.classList.contains('is-openable'));
		assert.ok(chip.querySelector('[data-testid="mention-chip-file-icon"]'));
		assert.ok(chip.querySelector('[data-testid="mention-chip-file-icon"] .knox-gui-file-icon'));
		assert.ok(editor.querySelector('[data-testid="slash-command-chip-icon"]'));

		const text = chip.nextSibling as Text;
		const selection = document.getSelection()!;
		const range = document.createRange();
		range.setStart(text, 3);
		range.collapse(true);
		selection.removeAllRanges();
		selection.addRange(range);
		assert.deepStrictEqual(widget.caretDocPosition(editor), { block: 0, offset: 8 });
		widget.placeCaretAtDocPosition(editor, { block: 0, offset: 5 });
		assert.deepStrictEqual(widget.caretDocPosition(editor), { block: 0, offset: 5 });

		(chip.querySelector('[data-testid="mention-chip-dismiss"]') as HTMLButtonElement).click();
		assert.ok(!store.state.inputDoc.some(block => block.type === 'paragraph' && block.content.some(node => node.type === 'mention')));
		assert.ok(store.state.input.startsWith('see  @ap'));
	});

	test('KN-375 checkpoint overlay restore preview, word diffs, analysis, dashboard, and branches', async () => {
		const { widget, store } = await mount();
		const node: IKnoxGuiCheckpointNode = {
			id: 'cp-1',
			description: 'head',
			created: '2026-09-26T00:00:00.000Z',
			kind: 'manual',
			tags: ['wip'],
			shortId: 'cp1',
			pinned: false,
			changedPaths: ['a.ts'],
			parents: [],
			fileChanges: { added: 0, modified: 1, deleted: 0 },
		};
		store.navigate('/checkpoint-graph');
		store.patch({
			checkpointShell: { state: 'ready', checkpointCount: 1 },
			checkpoints: [node],
			checkpointBranches: [{ id: 'main', name: 'main', headCheckpointId: 'cp-1', isActive: true, color: '#61afef' }],
			checkpointHeadId: 'cp-1',
			checkpointView: 'graph',
		});
		assert.ok(widget.root.querySelector('[data-testid="checkpoint-panel-tabs"]'));
		assert.ok(widget.root.querySelector('[data-testid="checkpoint-graph-branch"]')?.textContent?.includes('main'));

		store.patch({
			checkpointDialog: 'restore',
			checkpointRestoreId: 'cp-1',
			checkpointRestorePreview: {
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
			checkpointRestoreSelected: ['a.ts'],
			checkpointRestoreShowDiff: true,
			checkpointRestoreDiff: {
				oldCheckpoint: { id: 'workspace', description: '', created: '' },
				newCheckpoint: { id: 'cp-1', description: 'head', created: '2026-09-26T00:00:00.000Z' },
				files: [{
					relativePath: 'a.ts',
					status: 'modified',
					oldContent: 'const foo = 1',
					newContent: 'const bar = 1',
					isBinary: false,
					additions: 1,
					deletions: 1,
				}],
			},
			checkpointDiffSelectedFile: 'a.ts',
		});
		assert.ok(widget.root.querySelector('[data-testid="restore-preview-dialog"]'));
		assert.ok(widget.root.querySelector('[data-testid="restore-preview-dialog"]')?.textContent?.includes('a.ts'));
		const restoreTitleIcon = widget.root.querySelector('.knox-gui-cpl-dialog-title .knox-gui-svg') as SVGElement | null;
		assert.ok(restoreTitleIcon);
		assert.strictEqual(restoreTitleIcon.getAttribute('aria-hidden'), 'true');
		assert.ok(widget.root.querySelector('[data-testid="checkpoint-diff-viewer"]')?.classList.contains('knox-gui-diff-viewer') || widget.root.querySelector('.pierre-diff-container'));
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-diff-word-alt"]'));

		store.patch({
			checkpointDialog: null,
			checkpointView: 'dashboard',
			checkpointDashboardTab: 'overview',
			checkpointDashboard: {
				currentStorage: { totalBytes: 2048, checkpointCount: 1 },
				storageHistory: [],
				creationFrequency: [{ bucket: '2026-09-26', count: 2 }],
				restorationEvents: [],
				aiSessionMetrics: [{ sessionId: 's1', startedAt: '2026-09-26T00:00:00.000Z', filesChanged: 1, checkpointsCreated: 1, durationSeconds: 12 }],
				summary: {
					totalCheckpointsCreated: 4,
					totalRestorations: 1,
					restorationSuccessRate: 100,
					avgCreationTimeMs: 12,
					totalAiSessions: 1,
					avgChangesPerSession: 1,
					totalRollbacks: 0,
				},
			},
		});
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-checkpoint-dashboard"]'));
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-checkpoint-dashboard"]')?.textContent?.includes('4'));

		store.patch({
			checkpointView: 'analysis',
			selectedCheckpointId: 'cp-1',
			checkpointAnalysis: {
				checkpointId: 'cp-1',
				generatedDescription: 'touched auth',
				riskAssessment: { level: 'Medium', score: 4, factors: [{ category: 'auth', description: 'login', weight: 1, affectedFiles: ['a.ts'] }], recommendations: ['review'] },
				impactAnalysis: { affectedFeatures: [{ name: 'login', impactLevel: 'Medium', changedFiles: ['a.ts'] }], affectedLayers: ['src'], scope: 'Module', linesAdded: 1, linesDeleted: 1 },
				counts: { changed: 1 },
			},
			checkpointAnalysisGroups: [{ groupName: 'session s1', kind: 'session', rationale: 'same session', confidence: 0.9, checkpointIds: ['cp-1'] }],
		});
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-checkpoint-analysis"]')?.textContent?.includes('touched auth'));
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-checkpoint-analysis-group"]')?.textContent?.includes('session s1'));
	});

	test('M-01 / M-02 / M-03 memory refresh, overview loading, browser selection and banners', async () => {
		const sent: string[] = [];
		const { widget, store } = await mount(message => {
			sent.push(message.messageType);
			if (message.messageType === 'brain/deleteMemories') {
				return { deleted: 1, failed: 1 };
			}
			if (message.messageType === 'brain/pinMemory') {
				return { success: false };
			}
			return undefined;
		});
		store.navigate('/memory');
		await timeout(0);
		store.patch({ memoryTab: 'overview', memoryOverviewLoading: true });
		assert.ok(widget.root.querySelector('[data-testid="memory-overview-loading"]'));

		const item = (id: string) => ({ id, title: `m${id}`, content: `content ${id}`, category: 'fact', createdAt: new Date().toISOString() });
		store.patch({ memoryOverviewLoading: false, memoryTab: 'memories', memories: [item('1'), item('2'), item('3')], memoryFilterTier: 'hot' });
		sent.length = 0;
		widget.memorySelectionMode = true;
		widget.controller.refreshMemoryActiveTab();
		assert.ok(!sent.includes('brain/searchMemories'));

		const tierSelect = widget.root.querySelector<HTMLSelectElement>('[data-testid="memory-filter-tier"]')!;
		assert.strictEqual(tierSelect.selectedOptions[0].textContent, 'Hot');
		store.patch({ memoryFilterTier: 'all' });
		widget.root.querySelector('[data-testid="memory-row-1"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		widget.root.querySelector('[data-testid="memory-row-3"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
		assert.deepStrictEqual([...widget.memorySelectedIds].sort(), ['1', '2', '3']);
		assert.strictEqual(widget.root.querySelector('[data-testid="memory-select-all-header"] [role="checkbox"]')?.getAttribute('aria-checked'), 'true');
		widget.memorySelectedIds = new Set(['1']);
		widget.render();
		assert.strictEqual(widget.root.querySelector('[data-testid="memory-select-all-header"] [role="checkbox"]')?.getAttribute('aria-checked'), 'mixed');
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		assert.strictEqual(widget.memorySelectionMode, false);

		widget.memorySelectionMode = true;
		widget.memorySelectedIds = new Set(['1', '2']);
		widget.memoryConfirmDeleteIds = ['1', '2'];
		widget.memoryConfirmDeleteBulk = true;
		widget.render();
		(widget.root.querySelector('[data-testid="memory-confirm-delete"]') as HTMLButtonElement).click();
		for (let i = 0; i < 5 && widget.memoryConfirmDeleteIds; i++) {
			await timeout(0);
		}
		assert.deepStrictEqual(store.state.memories.map(memory => memory.id), ['3']);
		assert.strictEqual(widget.memorySelectionMode, false);
		assert.ok(widget.root.querySelector('[data-testid="memory-browser-error"]')?.textContent?.includes('1 memories could not be deleted'));

		await widget.controller.pinMemories(['3'], true, false);
		assert.strictEqual(store.state.memories[0].pinned, undefined);
		assert.strictEqual(store.state.memoryBrowserError?.key, 'memoryPinFailed');
	});

	test('K-17 graph: reveal open details and find hit, hover cleared on scroll, Cmd+H only scrolls, menu flip, prompt form', async () => {
		const sent: { type: string; data: unknown }[] = [];
		const { widget, store } = await mount(message => {
			sent.push({ type: message.messageType, data: message.data });
			return undefined;
		});
		const nodes: IKnoxGuiCheckpointNode[] = Array.from({ length: 40 }, (_, index) => ({
			id: `cp-${index}`,
			description: index === 35 ? 'needle checkpoint' : `checkpoint ${index}`,
			created: new Date(Date.UTC(2026, 8, 1, 0, 40 - index)).toISOString(),
			kind: 'manual',
			tags: [],
			shortId: `c${index}`,
			pinned: false,
			changedPaths: [],
			parents: index < 39 ? [`cp-${index + 1}`] : [],
			fileChanges: { added: 0, modified: 0, deleted: 0 },
		}));
		store.navigate('/checkpoint-graph');
		await new Promise(resolve => setTimeout(resolve, 0));
		store.patch({
			checkpointShell: { state: 'ready', checkpointCount: nodes.length },
			checkpoints: nodes,
			checkpointHeadId: 'cp-0',
			checkpointBranches: [{ id: 'main', name: 'main', headCheckpointId: 'cp-0', isActive: true }],
			checkpointView: 'graph',
		});
		const row = 28;
		widget.checkpointGraphViewport = 200;
		widget.checkpointGraphScrollTop = 0;
		widget.checkpointGraphOpenId = 'cp-20';
		widget.render();
		assert.strictEqual(widget.checkpointGraphScrollTop, 20 * row + row + 240 - 200, 'inline details scroll into view');

		widget.checkpointGraphOpenId = null;
		widget.checkpointGraphScrollTop = 0;
		widget.checkpointGraphFindOpen = true;
		widget.checkpointGraphFindQuery = 'needle';
		widget.render();
		assert.strictEqual(widget.checkpointGraphScrollTop, 35 * row, 'find hit scrolls into view');

		widget.checkpointGraphFindOpen = false;
		widget.checkpointGraphFindQuery = '';
		widget.checkpointGraphScrollTop = 0;
		widget.render();
		widget.root.querySelector('[data-testid="checkpoint-graph-vertex"]')!.dispatchEvent(new MouseEvent('mouseenter', { clientX: 10, clientY: 10 }));
		assert.ok(widget.root.querySelector('[data-testid="checkpoint-graph-hover"]'));
		widget.root.querySelector('.knox-gui-graph-scroll')!.dispatchEvent(new Event('scroll'));
		assert.strictEqual(widget.root.querySelector('[data-testid="checkpoint-graph-hover"]'), null, 'scroll clears the hover tip');

		assert.ok(onCheckpointGraphKeyDown(widget, new KeyboardEvent('keydown', { key: 'h', metaKey: true }), store.state));
		await new Promise(resolve => setTimeout(resolve, 0));
		assert.strictEqual(widget.checkpointGraphOpenId, null, 'Cmd+H scrolls to HEAD without opening it');
		assert.strictEqual(widget.checkpointGraphPendingHead, false);

		const win = window;
		widget.checkpointGraphMenu = { kind: 'row', nodeId: 'cp-3', x: win.innerWidth - 4, y: win.innerHeight - 4 };
		widget.render();
		await Promise.resolve();
		const menu = widget.root.querySelector('[data-testid="checkpoint-graph-menu"]') as HTMLElement;
		assert.ok(parseFloat(menu.style.left) < win.innerWidth - 4 && parseFloat(menu.style.top) < win.innerHeight - 4, 'menu flips inside the window');
		widget.root.querySelector('.knox-gui-graph-menu-backdrop')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		assert.strictEqual(widget.checkpointGraphMenu, null, 'right-click on the backdrop closes the menu');

		widget.checkpointGraphMenu = { kind: 'row', nodeId: 'cp-3', x: 10, y: 10 };
		widget.render();
		([...widget.root.querySelectorAll('.knox-gui-graph-menu-item')].find(item => item.textContent?.includes('Create branch')) as HTMLButtonElement).click();
		await Promise.resolve();
		const input = widget.root.querySelector('#knox-checkpoint-graph-prompt-input') as HTMLInputElement;
		assert.ok(widget.root.querySelector('form.knox-gui-graph-prompt'));
		assert.strictEqual(document.activeElement, input, 'prompt input is focused');
		input.value = 'feature';
		input.dispatchEvent(new Event('input'));
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
		assert.strictEqual(widget.checkpointGraphPrompt, null);
		assert.ok(sent.some(message => message.type === 'createCheckpointBranch' && (message.data as { name: string }).name === 'feature'));
	});

	test('K-08 diff viewer: changed files only, summary header, aligned split rows, collapsed context, folder tree chips, binary previews, empty state', async () => {
		const { widget, store } = await mount();
		const oldLines = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`);
		const newLines = oldLines.map((line, index) => index === 1 ? 'line two' : index === 17 ? 'line eighteen' : line);
		const file = (relativePath: string, status: IKnoxGuiCheckpointDiffFile['status'], extra: Partial<IKnoxGuiCheckpointDiffFile> = {}): IKnoxGuiCheckpointDiffFile => ({
			relativePath, status, oldContent: 'x', newContent: 'x', isBinary: false, additions: 0, deletions: 0, ...extra,
		});
		const diff = {
			oldCheckpoint: { id: 'a', description: 'before work', created: '' },
			newCheckpoint: { id: 'b', description: 'after work', created: '' },
			files: [
				file('src/long.ts', 'modified', { oldContent: oldLines.join('\n'), newContent: newLines.join('\n'), additions: 2, deletions: 2 }),
				file('src/same.ts', 'unchanged'),
				file('src/new.ts', 'added', { oldContent: null, newContent: 'fresh', additions: 1 }),
				file('logo.png', 'modified', { isBinary: true, oldEncoding: 'base64', newEncoding: 'base64', oldContent: 'AAAA', newContent: 'BBBB' }),
			],
		};
		store.navigate('/checkpoint-graph');
		store.patch({
			checkpointShell: { state: 'ready', checkpointCount: 2 },
			checkpointView: 'graph',
			checkpointDialog: 'restore',
			checkpointRestoreId: 'b',
			checkpointRestorePreview: { checkpointId: 'b', description: 'after work', modified: 2, added: 1, deleted: 0, writePaths: [], extraPaths: [], skippedFiles: [], files: [{ relativePath: 'src/long.ts', action: 'overwrite', additions: 2, deletions: 2, hunkCount: 2 }] },
			checkpointRestoreSelected: [],
			checkpointRestoreShowDiff: true,
			checkpointRestoreDiff: diff,
			checkpointDiffSelectedFile: 'src/same.ts',
			checkpointDiffView: 'split',
		});
		const viewer = () => widget.root.querySelector('[data-testid="checkpoint-diff-viewer"]')!;
		assert.ok(viewer().textContent?.includes('before work') && viewer().textContent?.includes('after work'));
		const summary = viewer().querySelector('[data-testid="checkpoint-diff-summary"]')!;
		assert.ok(summary.textContent?.includes('3 files changed'));
		assert.ok(summary.textContent?.includes('+3') && summary.textContent?.includes('-2'));
		const tree = () => viewer().querySelector('[data-testid="checkpoint-diff-tree"]')!;
		assert.ok(!tree().textContent?.includes('same.ts'), 'unchanged files are dropped');
		assert.ok(tree().querySelector('.knox-gui-file-tree-row.selected')?.textContent?.includes('long.ts'), 'falls back to the first changed file');
		assert.ok([...tree().querySelectorAll('.knox-gui-file-tree-chip')].map(chip => chip.textContent).join(',').includes('BIN'));
		assert.ok([...tree().querySelectorAll('.knox-gui-file-tree-chip')].some(chip => chip.textContent === 'A'));

		const pairedRow = [...viewer().querySelectorAll('.knox-gui-diff-split-row')].find(row => row.textContent?.includes('line 2') && row.textContent?.includes('line two'));
		assert.ok(pairedRow, 'removed and added lines share one split row');
		const gaps = viewer().querySelectorAll('[data-testid="checkpoint-diff-gap"]');
		assert.strictEqual(gaps.length, 1);
		assert.ok(gaps[0].textContent?.includes('9 lines hidden'));
		const hasCode = (text: string) => [...viewer().querySelectorAll('.knox-gui-diff-code')].some(code => code.textContent === text);
		assert.ok(!hasCode('line 10'));
		(gaps[0] as HTMLButtonElement).click();
		assert.ok(hasCode('line 10'));

		const folder = [...tree().querySelectorAll('.knox-gui-file-tree-row.is-folder')].find(row => row.textContent?.includes('src')) as HTMLElement;
		folder.click();
		assert.ok(!tree().textContent?.includes('long.ts'), 'folder collapses');
		(tree().querySelector('.knox-gui-file-tree-row.is-folder') as HTMLElement).click();
		assert.ok(tree().textContent?.includes('long.ts'));

		([...tree().querySelectorAll('.knox-gui-file-tree-row')].find(row => row.textContent?.includes('logo.png')) as HTMLElement).click();
		const binary = viewer().querySelector('[data-testid="checkpoint-diff-binary"]')!;
		assert.strictEqual(binary.querySelectorAll('img.knox-gui-diff-binary-image').length, 2);
		assert.ok(binary.textContent?.includes('Previous Version') && binary.textContent?.includes('Current Version'));

		store.patch({ checkpointRestoreDiff: { ...diff, files: [file('src/same.ts', 'unchanged')] } });
		assert.ok(widget.root.querySelector('[data-testid="checkpoint-diff-empty"]')?.textContent?.includes('No Changes Detected'));
	});

	test('K-11 timeline: header and branches, weekday groups, badges, compare indicator, branch and delete forms, keys, empty state', async () => {
		const sent: { type: string; data: unknown }[] = [];
		const { widget, store } = await mount(message => {
			sent.push({ type: message.messageType, data: message.data });
			return message.messageType === 'createCheckpointBranch' || message.messageType === 'switchCheckpointBranch' || message.messageType === 'deleteCheckpoints' ? { success: true } : undefined;
		});
		const node = (id: string, created: string, extra: Partial<IKnoxGuiCheckpointNode> = {}): IKnoxGuiCheckpointNode => ({
			id, description: `desc ${id}`, created, kind: 'manual', tags: [], shortId: id.slice(0, 7), pinned: false, changedPaths: [], parents: [], fileChanges: { added: 1, modified: 0, deleted: 0 }, ...extra,
		});
		store.navigate('/checkpoint-graph');
		store.patch({
			checkpointShell: { state: 'ready', checkpointCount: 3 },
			checkpointView: 'timeline',
			checkpointTimeline: [
				node('cp-old-0001', '2026-09-24T10:00:00.000Z', { branchId: 'main' }),
				node('cp-new-0003', '2026-09-26T10:00:00.000Z', { kind: 'auto', branchId: 'main', tags: ['release'], isIncremental: true, deltaDepth: 2, timelineRisk: 'Medium', conversationContext: { role: 'user', messageContent: 'fix the bug' } }),
				node('cp-mid-0002', '2026-09-26T08:00:00.000Z', { kind: 'merge' }),
			],
			checkpointTimelineBranches: [{ id: 'main', name: 'main', headCheckpointId: 'cp-new-0003', isActive: true }, { id: 'exp', name: 'experiment', headCheckpointId: 'cp-old-0001', isActive: false }],
		});
		const q = (selector: string) => widget.root.querySelector(selector);
		assert.strictEqual(q('[data-testid="checkpoint-timeline-count"]')?.textContent, '3');
		assert.ok(q('[data-testid="checkpoint-timeline-branch-toggle"]')?.textContent?.includes('main'));
		assert.strictEqual(widget.root.querySelectorAll('[data-testid="checkpoint-timeline-date"]').length, 2);
		const cards = [...widget.root.querySelectorAll('[data-testid="checkpoint-timeline-card"]')];
		assert.ok(cards[0].textContent?.includes('desc cp-new-0003'), 'newest first');
		assert.ok(cards[0].classList.contains('current'));
		assert.strictEqual(cards[0].querySelector('[data-testid="checkpoint-timeline-delta"]')?.textContent, 'Δ2');
		assert.ok(cards[0].querySelector('[data-testid="checkpoint-timeline-risk"]'));
		assert.ok(cards[0].querySelector('[data-testid="checkpoint-timeline-branch-dot"]'));
		assert.ok(cards[0].textContent?.includes('release'));

		const chips = q('[data-testid="checkpoint-timeline-branches"]')!;
		[...chips.querySelectorAll('button')].find(button => button.textContent?.includes('experiment'))!.click();
		assert.ok(sent.some(message => message.type === 'switchCheckpointBranch' && (message.data as { branchId: string }).branchId === 'exp'));
		(q('[data-testid="checkpoint-timeline-branch-toggle"]') as HTMLButtonElement).click();
		assert.strictEqual(q('[data-testid="checkpoint-timeline-branches"]'), null);

		widget.checkpointTimelineExpanded.add('cp-new-0003');
		widget.render();
		assert.ok(q('.knox-gui-timeline-message')?.textContent?.includes('fix the bug'));
		(q('[data-testid="checkpoint-timeline-compare-button"]') as HTMLButtonElement).click();
		assert.ok(q('[data-testid="checkpoint-timeline-compare"]')?.textContent?.includes('cp-new-0'));
		assert.ok(q('.knox-gui-timeline-item.is-compare'));

		(q('[data-testid="checkpoint-timeline-branch-button"]') as HTMLButtonElement).click();
		const nameInput = q('#knox-checkpoint-branch-name') as HTMLInputElement;
		nameInput.value = 'hotfix';
		nameInput.dispatchEvent(new Event('input'));
		(q('[data-testid="checkpoint-timeline-branch-create"]') as HTMLButtonElement).click();
		assert.ok(sent.some(message => message.type === 'createCheckpointBranch' && (message.data as { name: string }).name === 'hotfix'));

		(q('[data-testid="checkpoint-timeline-delete"]') as HTMLButtonElement).click();
		assert.ok(q('[data-testid="checkpoint-timeline-delete-dialog"]'));
		assert.ok(!sent.some(message => message.type === 'deleteCheckpoints'), 'delete waits for confirmation');
		(q('[data-testid="checkpoint-timeline-delete-confirm"]') as HTMLButtonElement).click();
		assert.ok(sent.some(message => message.type === 'deleteCheckpoints'));

		widget.checkpointTimelineQuery = 'nothing-matches';
		widget.render();
		assert.ok(q('[data-testid="checkpoint-timeline-empty"]'));
		assert.ok(checkpointTimelineEscape(widget, store.state));
		assert.strictEqual(widget.checkpointTimelineQuery, '');
		assert.strictEqual(store.state.checkpointComparePickId, undefined, 'Escape cancels compare');
		window.dispatchEvent(new KeyboardEvent('keydown', { key: '/' }));
		assert.strictEqual(document.activeElement, q('#knox-checkpoint-timeline-search'));
	});

	test('K-14 performance dashboard: loading and no-data, stat cards, storage tab, full activity list, top-5 AI sessions', async () => {
		const { widget, store } = await mount();
		store.navigate('/checkpoint-graph');
		store.patch({ checkpointShell: { state: 'ready', checkpointCount: 1 }, checkpointView: 'dashboard', checkpointDashboardLoading: true });
		assert.ok(widget.root.querySelector('[data-testid="checkpoint-dashboard-loading"]'));
		store.patch({ checkpointDashboardLoading: false, checkpointDashboard: undefined });
		assert.ok(widget.root.querySelector('[data-testid="checkpoint-dashboard-nodata"]'));

		const session = (i: number) => ({ sessionId: `session-${i}-xyz`, startedAt: '2026-09-26T00:00:00.000Z', filesChanged: i, linesAdded: 3, linesDeleted: 1, checkpointsCreated: 1, rollbacks: i === 0 ? 2 : 0, durationSeconds: 90 });
		store.patch({
			checkpointDashboardTab: 'overview',
			checkpointDashboard: {
				currentStorage: { totalBytes: 1024 * 1024, checkpointCount: 3, blobCount: 7 },
				storageHistory: [{ timestamp: '2026-09-26T00:00:00.000Z', totalBytes: 1024, checkpointCount: 1 }],
				creationFrequency: [{ bucket: '2026-09-26', count: 2 }],
				restorationEvents: Array.from({ length: 15 }, (_, i) => ({ timestamp: '2026-09-26T00:00:00.000Z', checkpointId: `checkpoint-${i}`, success: i !== 0, durationMs: 1500, filesRestored: 2, filesFailed: 0 })),
				aiSessionMetrics: Array.from({ length: 7 }, (_, i) => session(i)),
				summary: { totalCheckpointsCreated: 4, totalRestorations: 15, restorationSuccessRate: 80, avgCreationTimeMs: 12.4, totalAiSessions: 7, avgChangesPerSession: 2, totalRollbacks: 2 },
			},
		});
		const root = () => widget.root.querySelector('[data-testid="knox-gui-checkpoint-dashboard"]')!;
		assert.strictEqual(root().querySelectorAll('.knox-gui-dash-card-icon').length, 4);
		assert.ok(root().textContent?.includes('12ms'));
		assert.ok(root().textContent?.includes('1 MB'));
		assert.ok(root().querySelector('.knox-gui-chart-grid'));
		assert.ok(root().querySelector('.odp-chip')?.textContent?.includes('14'), 'creation chart pads to 14 days');

		store.patch({ checkpointDashboardTab: 'storage' });
		assert.ok(root().textContent?.includes('7 blobs'));
		assert.ok(root().querySelector('.knox-gui-chart'));

		store.patch({ checkpointDashboardTab: 'activity' });
		assert.strictEqual(root().querySelectorAll('[data-testid="checkpoint-dashboard-restoration"]').length, 15);
		assert.ok(root().querySelector('[data-testid="checkpoint-dashboard-rate"]')?.classList.contains('is-yellow'));
		assert.ok(root().textContent?.includes('1.5s'));
		assert.strictEqual(root().querySelector('.knox-gui-chart'), null, 'activity tab has no creation chart');

		store.patch({ checkpointDashboardTab: 'ai' });
		assert.strictEqual(root().querySelectorAll('[data-testid="checkpoint-dashboard-session"]').length, 5);
		assert.ok(root().textContent?.includes('2.0'));
		assert.ok(root().querySelector('.knox-gui-dash-session-stats .is-orange'));
	});

	test('K-15 share panel: loading, header and tab counts, bundle card, missing file, expandable audit rows', async () => {
		const { widget, store } = await mount(message => message.messageType === 'getSharedCheckpointBundles' ? {
			success: true,
			bundles: [
				{ id: 'b1', description: 'Release', sharedAt: '2026-09-26T00:00:00.000Z', checkpointCount: 3, filePath: '/tmp/b1.knoxbundle', machineId: 'abcdef123456', exists: true },
				{ id: 'b2', description: '', sharedAt: '2026-09-25T00:00:00.000Z', checkpointCount: 1, filePath: '/tmp/b2.knoxbundle', machineId: 'unknown', exists: false },
			],
			auditRecords: [{ id: 'a1', timestamp: '2026-09-26T00:00:00.000Z', userId: 'u', machineId: 'm1', action: 'share', resourceType: 'bundle', resourceId: 'b1234567890', outcome: 'success', details: '{"n":3}' }],
		} : undefined);
		store.navigate('/checkpoint-graph');
		store.patch({ checkpointShell: { state: 'ready', checkpointCount: 1 }, checkpointView: 'share', checkpointShareLoading: true });
		assert.ok(widget.root.querySelector('[data-testid="checkpoint-share-loading"]'));
		await widget.controller.loadShareBundles();
		store.patch({ checkpointShareLoading: false });
		assert.strictEqual(widget.root.querySelector('[data-testid="checkpoint-share-tab-shared"] .knox-gui-checkpoint-share-count')?.textContent, '2');
		const bundles = widget.root.querySelectorAll('[data-testid="checkpoint-share-bundle"]');
		assert.strictEqual(bundles.length, 2);
		assert.ok(bundles[0].textContent?.includes('abcdef12'));
		assert.ok(bundles[0].textContent?.includes('3 '));
		assert.ok(bundles[1].querySelector('[data-testid="checkpoint-share-missing"]'));
		assert.strictEqual(bundles[1].querySelectorAll('button').length, 0, 'missing bundles hide Import and Reveal');

		store.patch({ checkpointShareTab: 'audit' });
		assert.ok(widget.root.querySelector('.knox-gui-checkpoint-audit-root'));
		const row = widget.root.querySelector('[data-testid="checkpoint-audit-row"] button') as HTMLButtonElement;
		assert.ok(row.textContent?.includes('bundle/b1234567...'));
		assert.ok(row.textContent?.includes('OK'));
		assert.ok(row.querySelector('.knox-gui-checkpoint-audit-action.is-green'));
		assert.ok(row.querySelector('.knox-gui-checkpoint-audit-outcome.is-default'));
		assert.strictEqual(row.getAttribute('aria-expanded'), 'false');
		row.click();
		const detail = widget.root.querySelector('[data-testid="checkpoint-audit-detail"]');
		assert.ok(detail?.textContent?.includes('Machine'));
		assert.ok(detail?.textContent?.includes('bundle / b1234567890'));
		assert.ok(detail?.querySelector('pre')?.textContent?.includes('"n":3'));
		assert.ok(detail?.textContent?.includes('success'));
		assert.strictEqual((widget.root.querySelector('[data-testid="checkpoint-audit-row"] button') as HTMLButtonElement).getAttribute('aria-expanded'), 'true');
		(widget.root.querySelector('[data-testid="checkpoint-audit-row"] button') as HTMLButtonElement).click();
		assert.strictEqual(widget.root.querySelector('[data-testid="checkpoint-audit-detail"]'), null);

		store.patch({
			checkpointShareAudit: [
				{ id: 'a2', timestamp: '2026-09-26T00:00:00.000Z', userId: 'u', machineId: '', action: 'restore', resourceType: 'checkpoint', resourceId: 'cp1', outcome: 'failure', details: '{}' },
				{ id: 'a3', timestamp: '2026-09-26T00:00:00.000Z', userId: 'u', machineId: 'm', action: 'delete', resourceType: 'checkpoint', resourceId: 'cp2', outcome: 'partial', details: '{}' },
			],
		});
		store.patch({ checkpointShareTab: 'audit' });
		const rows = widget.root.querySelectorAll('[data-testid="checkpoint-audit-row"] button');
		assert.ok(rows[0].querySelector('.knox-gui-checkpoint-audit-action.is-orange'));
		assert.strictEqual(rows[0].querySelector('.knox-gui-checkpoint-audit-outcome.is-destructive')?.textContent, 'FAIL');
		assert.ok(rows[1].querySelector('.knox-gui-checkpoint-audit-action.is-red'));
		assert.strictEqual(rows[1].querySelector('.knox-gui-checkpoint-audit-outcome.is-secondary')?.textContent, 'PARTIAL');

		store.patch({ checkpointShareAudit: [] });
		assert.ok(widget.root.querySelector('[data-testid="checkpoint-audit-empty"]'));
		assert.ok(widget.root.querySelector('.knox-gui-checkpoint-audit-root .knox-gui-cp-empty'));
	});

	test('K-16 checkpoint config form: sections, help and inline errors, raw storage input, conditional rows, save flow', async () => {
		let saved: unknown;
		const { widget, store } = await mount(message => {
			if (message.messageType === 'saveCheckpointConfig') {
				saved = message.data;
				return { success: true };
			}
			return undefined;
		});
		store.navigate('/checkpoint-graph');
		const config = { ...DEFAULT_CHECKPOINT_CONFIG };
		store.patch({ checkpointShell: { state: 'ready', checkpointCount: 1 }, checkpointView: 'configuration', checkpointConfig: config, checkpointConfigDraft: { ...config } });
		const q = (selector: string) => widget.root.querySelector(selector);
		assert.strictEqual(q('[data-testid="checkpoint-config-sections"]')?.querySelectorAll('.knox-gui-config-card').length, 4);
		assert.strictEqual(q('[data-field="maxCheckpoints"] .knox-gui-checkpoint-config-help')?.textContent?.length !== 0, true);
		assert.strictEqual(q('[data-testid="checkpoint-config-unsaved"]'), null);
		assert.ok((q('[data-testid="checkpoint-config-save"]') as HTMLButtonElement).disabled);

		store.patch({ checkpointConfigDraft: { ...config, autoCleanup: false } });
		assert.strictEqual(q('[data-field="cleanupInterval"]'), null, 'cleanup interval only with auto-cleanup');
		assert.ok(q('[data-testid="checkpoint-config-unsaved"]'));
		store.patch({ checkpointConfigDraft: { ...config } });

		const storage = () => q('#maxStorage') as HTMLInputElement;
		storage().value = 'lots';
		storage().dispatchEvent(new Event('input'));
		assert.ok(q('[data-field="maxStorage"] [data-testid="checkpoint-config-error"]'));
		assert.ok(q('[data-testid="checkpoint-config-unsaved"]'), 'an unparseable storage input is a change');
		assert.ok((q('[data-testid="checkpoint-config-save"]') as HTMLButtonElement).disabled);
		storage().value = '2048mb';
		storage().dispatchEvent(new Event('input'));
		assert.strictEqual(store.state.checkpointConfigDraft?.maxStorageBytes, 2048 * 1024 * 1024);
		storage().dispatchEvent(new FocusEvent('blur'));
		assert.strictEqual(storage().value, '2.0 GB', 'normalized on blur');

		const maxCheckpoints = q('#maxCheckpoints') as HTMLInputElement;
		maxCheckpoints.value = '0';
		maxCheckpoints.dispatchEvent(new Event('input'));
		assert.ok(q('[data-field="maxCheckpoints"] [data-testid="checkpoint-config-error"]'));
		(q('#maxCheckpoints') as HTMLInputElement).value = '50';
		q('#maxCheckpoints')!.dispatchEvent(new Event('input'));

		(q('[data-testid="checkpoint-config-save"]') as HTMLButtonElement).click();
		for (let i = 0; i < 5 && store.state.checkpointConfigStatus?.type !== 'success'; i++) {
			await timeout(0);
		}
		assert.strictEqual((saved as { config: { maxCheckpoints: number } }).config.maxCheckpoints, 50);
		assert.ok(q('[data-testid="checkpoint-config-status"]')?.classList.contains('is-success'));
		assert.strictEqual(q('[data-testid="checkpoint-config-unsaved"]'), null);
	});

	test('M-04 / M-05 / M-06 graph and session states, settings validation, confirm, and result', async () => {
		const sent: { type: string; data: unknown }[] = [];
		const { widget, store } = await mount(message => {
			sent.push({ type: message.messageType, data: message.data });
			if (message.messageType === 'brain/updateConfig' || message.messageType === 'brain/heal') {
				return { ok: true };
			}
			return undefined;
		});
		store.navigate('/memory');
		await timeout(0);

		store.patch({
			memoryTab: 'sessions',
			memorySessions: [{ id: 's1', title: 'Ship', messageCount: 1 }, { id: 's2', title: 'Other', messageCount: 1 }],
			memorySessionQuery: 'ship',
			memorySelectedSessionId: 's1',
			memorySessionHistoryLoading: true,
			memorySessionError: 'memorySessionHistoryLoadError',
		});
		assert.ok(widget.root.querySelector('[data-testid="memory-session-error"]'));
		assert.ok(widget.root.querySelector('[data-testid="memory-session-history-loading"]'));
		assert.ok(widget.root.querySelector('[data-testid="memory-session-count"]')?.textContent?.includes('1'));

		const entity = (id: number, entityType: string) => ({ id, name: `E${id}`, entityType, mentionCount: 1 });
		store.patch({
			memoryTab: 'graph',
			memoryGraphStats: { totalEntities: 3, totalEdges: 2, entityTypes: { concept: 2, file: 1 }, maxEntities: 5000, maxDepth: 3 },
			memoryGraphEntities: [entity(1, 'concept')],
			memoryExplore: {
				centerId: 1,
				entities: [entity(1, 'concept'), entity(2, 'file')],
				edges: [{ id: 10, source: 1, target: 2, relationship: 'uses', weight: 1 }, { id: 11, source: 2, target: 9, relationship: 'calls', weight: 1 }],
				entityDepths: { 1: 0, 2: 1 },
			},
			memoryGraphLoading: true,
		});
		const typeOptions = [...widget.root.querySelectorAll<HTMLOptionElement>('[data-testid="memory-graph-type"] option')].map(option => option.textContent);
		assert.deepStrictEqual(typeOptions.slice(1), ['concept (2)', 'file (1)']);
		assert.strictEqual(widget.root.querySelectorAll('[data-testid="memory-explore-edge"]').length, 1);
		assert.ok(widget.root.querySelector('[data-testid="memory-graph-loading"]'));
		store.patch({ memoryGraphLoading: false, memoryGraphError: 'boom' });
		assert.ok(widget.root.querySelector('[data-testid="memory-graph-error"]')?.textContent?.includes('boom'));

		store.patch({ memoryTab: 'settings', memoryConfig: {}, memoryConfigLoading: true });
		assert.ok(widget.root.querySelector('[data-testid="memory-settings-loading"]'));
		store.patch({ memoryConfigLoading: false, memoryConfig: { retrieval_top_k: 20, wm_inject_min_relevance: 0.35 } });
		assert.strictEqual(widget.root.querySelector<HTMLInputElement>('[data-setting="wm_inject_min_relevance"] input')?.value, '35');
		const topK = () => widget.root.querySelector<HTMLInputElement>('[data-setting="retrieval_top_k"] input')!;
		sent.length = 0;
		topK().value = '2';
		topK().dispatchEvent(new FocusEvent('blur'));
		assert.strictEqual(topK().value, '20', 'out-of-range input reverts');
		assert.ok(!sent.some(message => message.type === 'brain/updateConfig'));
		topK().value = '30';
		topK().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
		assert.ok(sent.some(message => message.type === 'brain/updateConfig' && (message.data as { key?: string; value?: string }).value === '30'));
		await timeout(0);
		assert.ok(widget.root.querySelector('[data-setting="retrieval_top_k"] [data-testid="memory-setting-saved"]'));

		(widget.root.querySelector('[data-testid="knox-gui-memory-purge"]') as HTMLButtonElement).click();
		assert.ok(widget.root.querySelector('[data-testid="memory-settings-confirm"]'));
		assert.ok(!sent.some(message => message.type === 'brain/heal'), 'purge waits for confirmation');
		(widget.root.querySelector('[data-testid="memory-settings-confirm-run"]') as HTMLButtonElement).click();
		assert.strictEqual(widget.root.querySelector('[data-testid="memory-settings-confirm"]'), null);
		assert.ok(sent.some(message => message.type === 'brain/heal' && (message.data as { action?: string })?.action === 'prune_expired'));
		for (let i = 0; i < 5 && !store.state.memorySettingsResult; i++) {
			await timeout(0);
		}
		assert.ok(widget.root.querySelector('[data-testid="memory-settings-result"]')?.classList.contains('is-success'));
	});

	test('KN-376 Memory panel renders Overview, Memories, Sessions, Graph, and Settings', async () => {
		const { widget, store } = await mount();
		store.navigate('/memory');
		await timeout(0);
		store.patch({
			memoryTab: 'overview',
			memoryDashboard: {
				totalSessions: 2,
				totalEpisodic: 3,
				totalSemantic: 4,
				totalEntities: 5,
				totalEdges: 6,
				totalTags: 7,
				totalCollections: 1,
				healthStatus: 'healthy',
				healthScore: 91,
				healthGrade: 'A',
				tierCounts: { hot: 1, warm: 1, cold: 1 },
			},
			memoryEffectiveContext: {
				totalEffective: 80,
				levels: [{ id: 'M1', name: 'Sensory', tokens: 4, ratio: 1, effectiveTokens: 4 }],
			},
			memoryEbbinghausStats: { reviewDueCount: 1, avgRetention: 0.8, lambda: 0.05 },
		});
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-memory"]'));
		for (const id of MEMORY_TAB_IDS) {
			assert.ok(widget.root.querySelector(`[data-testid="knox-gui-memory-tab-${id}"]`), id);
		}
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-memory-overview"]')?.textContent?.includes('M1'));
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-memory-overview"]')?.textContent?.includes('λ=0.05'));

		store.patch({
			memoryTab: 'memories',
			memories: [{ id: '7', title: 'auth cookie', content: 'use httpOnly', category: 'insight', tier: 'hot', pinned: true }],
		});
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-memory-browser"]'));
		assert.ok(widget.root.querySelector('[data-testid="memory-row-7"]')?.textContent?.includes('auth cookie'));

		store.patch({
			memoryTab: 'sessions',
			memorySessions: [{ id: 's1', title: 'Ship', messageCount: 3, updatedAt: '2026-09-26T00:00:00.000Z' }],
			memorySelectedSessionId: 's1',
			memorySessionHistory: { sessionId: 's1', episodic: [{ role: 'user', content: 'hi there' }], semantic: [], topics: ['auth'], tokenEstimate: 12, messageCount: 1 },
		});
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-memory-sessions"]')?.textContent?.includes('Ship'));
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-memory-sessions"]')?.textContent?.includes('hi there'));

		store.patch({
			memoryTab: 'graph',
			memoryGraphStats: { totalEntities: 2, totalEdges: 1, entityTypes: { concept: 1 }, maxEntities: 5000, maxDepth: 3 },
			memoryGraphEntities: [{ id: 1, name: 'Auth', entityType: 'concept', mentionCount: 2 }],
			memoryExplore: {
				centerId: 1,
				centerName: 'Auth',
				entities: [{ id: 1, name: 'Auth', entityType: 'concept', mentionCount: 2 }, { id: 2, name: 'JWT', entityType: 'library', mentionCount: 1 }],
				edges: [{ id: 10, source: 1, target: 2, relationship: 'uses', weight: 1 }],
				depthReached: 1,
				entityDepths: { 1: 0, 2: 1 },
			},
		});
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-memory-graph"]')?.textContent?.includes('Auth'));
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-memory-graph-depth"]')?.textContent?.includes('d1'));

		store.patch({
			memoryTab: 'settings',
			memoryConfig: { retrieval_threshold: 0.6, retrieval_top_k: 20, auto_extract_enabled: true },
		});
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-memory-settings"]'));
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-memory-optimize"]'));
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-memory-heal"]'));
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-memory-export"]'));
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-memory-purge"]'));
	});

	test('KN-377 find widget, session tabs, fatal banner, and composer accept/reject-all', async () => {
		const { widget, store } = await mount();
		const closedFind = widget.root.querySelector('[data-testid="knox-gui-find"]');
		assert.ok(closedFind);
		assert.ok(closedFind.classList.contains('is-closed'));
		assert.strictEqual(closedFind.getAttribute('inert'), '');
		widget.openFind();
		store.patch({
			history: [
				{ id: 'u1', role: 'user', content: 'how does auth work' },
				{ id: 'a1', role: 'assistant', content: 'use httpOnly cookies', contextItems: [{ name: 'auth.ts', content: 'cookie jar' }] },
			],
		});
		widget.controller.updateFind({ query: 'httpOnly' });
		const find = widget.root.querySelector('[data-testid="knox-gui-find"]');
		assert.ok(find);
		assert.ok(find.querySelector('input[data-knox-find-input]'));
		assert.ok(find.textContent?.includes('1'));
		assert.ok(widget.root.querySelector('[data-testid="history-row-1"]')?.classList.contains('knox-gui-msg-hit')
			|| widget.root.querySelector('.knox-gui-msg-hit-current')
			|| widget.root.querySelector('.knox-gui-msg-hit'));

		store.patch({
			showSessionTabs: true,
			tabs: [{ id: 'tab-a', title: 'Chat 1', sessionId: 's1' }, { id: 'tab-b', title: 'Chat 2', sessionId: 's2' }],
			activeTabId: 'tab-a',
		});
		const tabs = widget.root.querySelector('[data-testid="knox-gui-tabs"]');
		assert.ok(tabs);
		assert.strictEqual(tabs.getAttribute('role'), 'tablist');
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-tab-tab-a"]')?.classList.contains('active'));
		assert.strictEqual(widget.root.querySelector('[data-testid="knox-gui-tab-tab-a"]')?.getAttribute('aria-selected'), 'true');

		store.patch({ fatalConfig: true, route: KnoxGuiRoute.Chat });
		const fatal = widget.root.querySelector('[data-testid="knox-gui-fatal"]') as HTMLElement | null;
		assert.ok(fatal);
		assert.strictEqual(widget.root.lastElementChild, fatal);
		assert.ok(fatal.textContent?.includes('Error') || fatal.textContent?.includes('configuration') || fatal.textContent?.toLowerCase().includes('error'));

		store.patch({
			fatalConfig: false,
			find: { ...store.state.find, open: false },
			history: [],
			mode: 'edit',
			codeToEdit: [{ filepath: 'src/a.ts', range: { start: { line: 0 }, end: { line: 1 } } }],
			applyStates: [{ streamId: 'diff-1', filepath: 'src/a.ts', status: 'done' }],
		});
		const bar = widget.root.querySelector('[data-testid="knox-gui-accept-reject-all"]');
		assert.ok(bar);
		assert.ok(widget.root.querySelector('[data-testid="edit-accept-button"]'));
		assert.ok(widget.root.querySelector('[data-testid="edit-reject-button"]'));
		store.patch({ isStreaming: true });
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-accept-reject-all"]')?.classList.contains('knox-gui-accept-reject-streaming'));
	});

	test('KP remaining widget: dialog, find, historical editor, images, jobs, settings', async () => {
		const posted: Array<{ type: string; data: unknown }> = [];
		const { widget, store } = await mount(message => {
			posted.push({ type: message.messageType, data: message.data });
			return {};
		});

		assert.ok(widget.root.querySelector('[data-testid="knox-gui-find"]')?.classList.contains('is-closed'));
		widget.openFind();
		const find = widget.root.querySelector('[data-testid="knox-gui-find"]')!;
		assert.ok(!find.classList.contains('is-closed'));
		const findInput = find.querySelector('input[data-knox-find-input]') as HTMLInputElement;
		findInput.value = 'abc';
		findInput.dispatchEvent(new Event('input', { bubbles: true }));
		assert.strictEqual(store.state.find.query, '');
		await timeout(320);
		assert.strictEqual(store.state.find.query, 'abc');
		widget.controller.updateFind({ query: '(', regex: true });
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-find-regex"]')?.classList.contains('is-invalid'));
		assert.strictEqual(store.state.find.total, 0);
		widget.controller.closeFind();
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-find"]')?.classList.contains('is-closed'));

		store.patch({
			history: [{ id: 'u1', role: 'user', content: '', images: ['data:image/png;base64,abc'] }],
			imagesSupported: true,
			markdownFormatting: false,
		});
		const historyEditor = widget.root.querySelector('[data-testid="knox-gui-history-input"]') as HTMLElement;
		assert.ok(historyEditor);
		assert.ok(historyEditor.dataset.placeholder);
		assert.notStrictEqual(historyEditor.dataset.placeholder, knoxGuiT('en', 'askAnything'));
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-image-thumbs"]'));
		(widget.root.querySelector('.knox-gui-thumb') as HTMLElement).click();
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-image-viewer"]'));
		widget.closeImageViewer();
		assert.strictEqual(widget.root.querySelector('[data-testid="knox-gui-image-viewer"]'), null);

		historyEditor.textContent = '@file';
		historyEditor.dispatchEvent(new Event('input', { bubbles: true }));
		assert.strictEqual(store.state.mentionOpen, false);
		assert.strictEqual(widget.controller.suggestTarget, undefined);

		const historyBox = widget.root.querySelector('.knox-gui-history-editor') as HTMLElement;
		historyBox.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true }));
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-drop-overlay"]'));

		store.patch({
			history: [{
				id: 'u2',
				role: 'user',
				content: '',
				inputDoc: [
					{ type: 'codeBlock', code: 'const a = 1;', language: 'typescript', filepath: '/w/a.ts', range: { start: 0, end: 1 } },
					{ type: 'codeBlock', code: 'const b = 2;', language: 'typescript', filepath: '/w/b.ts' },
					{ type: 'paragraph', content: [] },
				],
			}],
		});
		const histChips = Array.from(widget.root.querySelectorAll<HTMLElement>('[data-testid="knox-gui-input-code-block"]'));
		assert.strictEqual(histChips.length, 2);
		assert.strictEqual(histChips[0].querySelector<HTMLElement>('.knox-gui-input-code-body')?.hidden, true);
		assert.strictEqual(histChips[1].querySelector<HTMLElement>('.knox-gui-input-code-body')?.hidden, false);

		store.patch({
			history: [{ id: 'a', role: 'assistant', content: 'done', toolCalls: [{ id: 't', name: 'builtin_edit_file', arguments: '{}', status: 'generated' }] }],
			input: 'hi',
			inputDoc: inputDocFromPlainText('hi'),
			isStreaming: false,
		});
		posted.length = 0;
		widget.submitFromComposer(false);
		assert.ok(posted.some(entry => entry.type === 'showToast' && JSON.stringify(entry.data).includes('Cannot submit message while awaiting tool confirmation')));
		assert.strictEqual(widget.root.querySelector('[data-testid="knox-gui-text-dialog"]'), null);

		widget.controller.storageService.store(KNOX_GUI_MAIN_TEXT_ENTRY_KEY, '299', StorageScope.PROFILE, StorageTarget.MACHINE);
		widget.controller.storageService.remove(KNOX_GUI_MAIN_TEXT_ENTRY_SHOWN_KEY, StorageScope.PROFILE);
		store.patch({
			history: [],
			input: 'milestone',
			inputDoc: inputDocFromPlainText('milestone'),
			isStreaming: false,
		});
		widget.submitFromComposer(false);
		widget.render();
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-text-dialog"]'));
		widget.closeTextDialog();
		store.patch({ input: 'again', inputDoc: inputDocFromPlainText('again') });
		widget.submitFromComposer(false);
		widget.render();
		assert.strictEqual(widget.root.querySelector('[data-testid="knox-gui-text-dialog"]'), null);

		store.patch({
			isStreaming: true,
			jobsPanelOpen: true,
			backgroundJobs: [{ id: 'j1', title: 'build', status: 'running', startedAt: Date.now() - 1500, kind: 'shell' }],
		});
		assert.ok(widget.root.querySelector('[data-testid="agent-job-kill-j1"]'));
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-send"]')?.classList.contains('knox-gui-cancel'));
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-history-attach-image"]')?.classList.contains('knox-gui-xs-hide')
			|| widget.root.querySelector('[data-testid="knox-gui-attach-image"]')?.classList.contains('knox-gui-xs-hide')
			|| widget.root.querySelector('.knox-gui-xs-hide'));

		store.patch({ overlay: 'models', profileType: 'cloud', profileId: 'p1', isStreaming: false, jobsPanelOpen: false, backgroundJobs: [] });
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-open-config"]'));
		store.patch({ profileType: 'local' });
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-open-config"]'));

		store.patch({ overlay: 'settings' });
		assert.ok(widget.root.querySelector('.knox-gui-settings-card h3.knox-gui-cyan'));
		assert.ok(widget.root.querySelector('.knox-gui-number-step'));
		const numberInput = widget.root.querySelector('.knox-gui-number-field input') as HTMLInputElement;
		assert.ok(numberInput);
		const fontSize = store.state.fontSize;
		numberInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
		assert.strictEqual(store.state.fontSize, fontSize + 1);
		const nextNumberInput = widget.root.querySelector('.knox-gui-number-field input') as HTMLInputElement;
		nextNumberInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
		assert.strictEqual(store.state.fontSize, fontSize);
	});

	test('KP leftover: edit composer hide, historical Send, #, Exit Edit, spellcheck', async () => {
		const { widget, store } = await mount();
		const mainInput = widget.root.querySelector('[data-testid="knox-gui-input"]') as HTMLElement;
		assert.ok(mainInput);
		assert.strictEqual(mainInput.getAttribute('spellcheck'), 'false');

		store.patch({
			mode: 'edit',
			history: [],
			codeToEdit: [{ filepath: 'src/a.ts' }],
		});
		assert.ok(widget.root.querySelector('[data-testid="full-composer"]'));
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-exit-edit"]'));

		store.patch({
			mode: 'edit',
			history: [{ id: 'u1', role: 'user', content: 'edit me' }],
			codeToEdit: [{ filepath: 'src/a.ts' }],
			isStreaming: true,
		});
		assert.strictEqual(widget.root.querySelector('[data-testid="full-composer"]'), null);
		assert.ok(widget.root.querySelector('[data-testid="last-user-composer"], [data-testid="history-composer"]'));
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-history-exit-edit"]'));
		const historySend = widget.root.querySelector('[data-testid="knox-gui-history-send"]');
		assert.ok(historySend);
		assert.strictEqual(historySend.classList.contains('knox-gui-cancel'), false);
		const historyBar = widget.root.querySelector('.knox-gui-history-editor .knox-gui-input-bar');
		assert.ok(historyBar);
		assert.strictEqual(historyBar.classList.contains('knox-gui-input-bar--hidden'), false);
		const historyInput = widget.root.querySelector('[data-testid="knox-gui-history-input"]') as HTMLElement;
		assert.ok(historyInput);
		assert.strictEqual(historyInput.getAttribute('spellcheck'), 'false');

		historyInput.textContent = '#';
		historyInput.dispatchEvent(new Event('input', { bubbles: true }));
		assert.strictEqual(store.state.suggestCodeToEdit, true);

		(widget.root.querySelector('[data-testid="knox-gui-history-exit-edit"]') as HTMLElement).click();
		await timeout(0);
		assert.notStrictEqual(store.state.mode, 'edit');

		store.patch({
			mode: 'edit',
			history: [{ id: 'u1', role: 'user', content: 'edit me' }],
			codeToEdit: [{ filepath: 'src/a.ts' }],
			mentionOpen: false,
			slashOpen: false,
			suggestCodeToEdit: false,
		});
		const editor = widget.root.querySelector('[data-testid="knox-gui-history-input"]') as HTMLElement;
		editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
		await timeout(0);
		assert.notStrictEqual(store.state.mode, 'edit');
	});

	test('history row click loads the session transcript and leaves the overlay', async () => {
		const { widget, store } = await mount(message => {
			if (message.messageType === 'history/load') {
				const id = String((message.data as { id?: string } | undefined)?.id ?? '');
				if (id === 'sess-uuid') {
					return {
						sessionId: 'sess-uuid',
						title: 'Workspace Terminal Demo',
						history: [
							{ message: { role: 'user', content: [{ type: 'text', text: 'hello from history' }] } },
							{ message: { role: 'assistant', content: 'Hi! Ready to help.' } },
						],
					};
				}
				return {
					sessionId: id,
					title: 'leftover',
					history: [{ message: { role: 'user', content: [{ type: 'text', text: 'leftover transcript' }] } }],
				};
			}
			return {};
		});
		store.patch({
			overlay: 'history',
			sessionId: '',
			history: [],
			historySessions: [
				{ id: '', title: 'empty-id leftover', date: String(Date.now()) },
				{ id: 'sess-uuid', title: 'Workspace Terminal Demo', date: String(Date.now() - 60_000) },
			],
		});
		const uuidRow = widget.root.querySelector('[data-testid="knox-gui-overlay-history"] [data-session-id="sess-uuid"]') as HTMLElement | null;
		assert.ok(uuidRow);
		uuidRow.click();
		await timeout(0);
		assert.strictEqual(store.state.overlay, null);
		assert.strictEqual(store.state.sessionId, 'sess-uuid');
		assert.ok(widget.root.textContent?.includes('hello from history'));
		assert.ok(widget.root.textContent?.includes('Hi! Ready to help.'));
		assert.ok(widget.root.querySelector('[data-testid="chat-virtual-list"]'));

		store.patch({
			overlay: 'history',
			sessionId: '',
			history: [],
			historySessions: [
				{ id: '', title: 'empty-id leftover', date: String(Date.now()) },
			],
		});
		const leftover = widget.root.querySelector('[data-testid="knox-gui-overlay-history"] [data-session-id=""]') as HTMLElement | null;
		assert.ok(leftover);
		leftover.click();
		await timeout(0);
		assert.strictEqual(store.state.overlay, null);
		assert.ok(widget.root.textContent?.includes('leftover transcript'));
	});

	test('KP leftover: thumbs above editor, prompts unprefixed, history delete tooltip, calling cancel', async () => {
		const posted: string[] = [];
		const { widget, store } = await mount(message => {
			posted.push(message.messageType);
		});
		store.patch({
			overlay: null,
			imagesSupported: true,
			images: [{ name: 'shot.png', imageUrl: 'data:image/png;base64,aaaa' }],
		});
		const wrap = widget.root.querySelector('.knox-gui-editor') as HTMLElement;
		const thumbs = wrap.querySelector('[data-testid="knox-gui-image-thumbs"]') as HTMLElement;
		const editor = wrap.querySelector('[data-testid="knox-gui-input"]') as HTMLElement;
		assert.ok(thumbs && editor);
		assert.ok(thumbs.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING);

		store.patch({
			overlay: 'prompts',
			slashCommands: [{ name: 'commit', description: 'Commit changes', prompt: 'commit the work' }],
		});
		assert.strictEqual(widget.root.querySelector('.knox-gui-prompt-name')?.textContent, 'commit');

		store.patch({
			overlay: 'history',
			historySelectionMode: true,
			historySelected: ['a', 'b'],
			historySessions: [
				{ id: 'a', title: 'One', date: String(Date.now()) },
				{ id: 'b', title: 'Two', date: String(Date.now() - 1000) },
			],
		});
		const del = widget.root.querySelector('.knox-gui-history-delete-btn') as HTMLButtonElement;
		assert.ok(del);
		assert.ok(del.title.includes('2'));

		store.patch({
			overlay: null,
			isStreaming: true,
			history: [{
				id: 'a1',
				role: 'assistant',
				content: '',
				toolCalls: [{ id: 't1', name: 'builtin_run_terminal_command', arguments: '{}', status: 'calling' }],
			}],
		});
		const cancel = widget.root.querySelector('[data-testid="tool-calling-cancel"]') as HTMLButtonElement;
		assert.ok(cancel);
		posted.length = 0;
		cancel.click();
		await timeout(0);
		assert.ok(posted.includes('abort'));
		assert.ok(posted.includes('tools/cancel'));
		assert.strictEqual(store.state.isStreaming, false);
	});

	test('history overlay supports search, shift-range select, select-all, and bulk delete', async () => {
		const posted: string[] = [];
		const { widget, store } = await mount(message => {
			posted.push(message.messageType);
			return {};
		});
		const now = Date.now();
		store.patch({
			overlay: 'history',
			sessionId: 'a',
			historySessions: [
				{ id: 'a', title: 'Alpha login form', date: String(now), workspaceDirectory: '/tmp/demo' },
				{ id: 'b', title: 'Beta notes', date: String(now - 1000), workspaceDirectory: '/tmp/other' },
				{ id: 'c', title: 'Gamma kernel', date: String(now - 2000), workspaceDirectory: '/tmp/demo' },
			],
		});
		assert.ok(widget.root.querySelector('[data-testid="history-count"]')?.textContent?.includes('3'));
		assert.ok(widget.root.querySelector('[data-session-id="a"]')?.classList.contains('current'));
		const search = widget.root.querySelector('[data-testid="history-search"]') as HTMLInputElement;
		search.value = 'demo';
		search.dispatchEvent(new Event('input', { bubbles: true }));
		assert.strictEqual(store.state.historyQuery, 'demo');
		assert.strictEqual(widget.root.querySelectorAll('[data-testid="knox-gui-overlay-history"] [data-session-id]').length, 2);
		store.patch({ historyQuery: '' });

		widget.root.querySelector('[data-testid="history-select"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		assert.strictEqual(store.state.historySelectionMode, true);
		widget.root.querySelector('[data-session-id="a"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		widget.root.querySelector('[data-session-id="c"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
		assert.deepStrictEqual(store.state.historySelected.slice().sort(), ['a', 'b', 'c']);
		assert.ok(widget.root.querySelector('[data-testid="history-selected-count"]')?.textContent?.includes('3'));
		assert.ok(widget.root.querySelector('.knox-gui-history-delete-btn')?.textContent?.includes('3'));

		(widget.root.querySelector('[data-testid="history-clear"]') as HTMLButtonElement).click();
		assert.deepStrictEqual(store.state.historySelected, []);
		(widget.root.querySelector('[data-testid="history-select-all"]') as HTMLButtonElement).click();
		assert.deepStrictEqual(store.state.historySelected.slice().sort(), ['a', 'b', 'c']);

		widget.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		assert.strictEqual(store.state.historySelectionMode, false);

		widget.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', metaKey: true, ctrlKey: true, bubbles: true }));
		assert.strictEqual(store.state.historySelectionMode, true);
		assert.strictEqual(store.state.historySelected.length, 3);

		(widget.root.querySelector('[data-testid="history-delete"]') as HTMLButtonElement).click();
		const alert = widget.root.querySelector('[data-testid="knox-gui-history-delete"] .knox-gui-alert-dialog') as HTMLElement | null;
		assert.ok(alert);
		assert.strictEqual(alert.getAttribute('role'), 'alertdialog');
		assert.ok(widget.root.querySelector('.knox-gui-alert-dialog-title.is-destructive')?.textContent?.includes('Delete Conversations'));
		assert.ok(widget.root.querySelector('.knox-gui-alert-dialog-lead')?.textContent?.includes('3'));
		assert.ok(widget.root.querySelector('.knox-gui-alert-dialog-muted')?.textContent);
		const cancel = widget.root.querySelector('[data-testid="history-delete-cancel"]') as HTMLButtonElement;
		const confirm = widget.root.querySelector('[data-testid="history-delete-confirm"]') as HTMLButtonElement;
		assert.ok(cancel.classList.contains('is-cancel'));
		assert.ok(confirm.classList.contains('is-destructive'));
		assert.ok(!confirm.classList.contains('knox-gui-icon-btn'));
		assert.ok(!cancel.classList.contains('knox-gui-icon-btn'));
		cancel.click();
		assert.strictEqual(store.state.historyConfirmDelete, false);
		assert.strictEqual(store.state.historySelected.length, 3);

		(widget.root.querySelector('[data-testid="history-delete"]') as HTMLButtonElement).click();
		posted.length = 0;
		(widget.root.querySelector('[data-testid="history-delete-confirm"]') as HTMLButtonElement).click();
		await timeout(0);
		assert.ok(posted.filter(type => type === 'history/delete').length >= 1);
		assert.strictEqual(store.state.overlay, 'history');
		assert.deepStrictEqual(store.state.historySessions, []);
		assert.notStrictEqual(store.state.sessionId, 'a');
	});

	test('OpenRouter catalog renders fixture models and cannotLoadModels when empty', async () => {
		const { widget, store } = await mount(message => {
			if (message.messageType === 'openrouter/listModels') {
				return [{ id: 'anthropic/claude-sonnet-4.6', name: 'Claude Sonnet 4.6', supported_parameters: ['tools'] }];
			}
			return {};
		});
		store.navigate('/addModel/provider/openrouter');
		store.patch({
			openrouterModelsLoading: false,
			openrouterModels: [
				{ title: 'Claude Sonnet 4.6', model: 'anthropic/claude-sonnet-4.6', category: 'Anthropic', contextLength: 200000, supportsTools: true },
			],
		});
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-openrouter-search"]'));
		assert.ok(widget.root.querySelector('[data-model="anthropic/claude-sonnet-4.6"]'));
		assert.ok(widget.root.textContent?.includes('Claude Sonnet 4.6'));
		store.patch({ openrouterModels: [], openrouterModelsLoading: false });
		assert.ok(widget.root.textContent?.includes('Can not load models'));
	});

	test('OpenRouter OAuth row covers disconnected, in_progress, connected, and connect paths', async () => {
		const posted: Array<{ type: string; data: unknown }> = [];
		const { widget, store } = await mount(message => {
			posted.push({ type: message.messageType, data: message.data });
			return {};
		});
		store.navigate('/addModel/provider/openrouter');
		store.patch({
			openrouterModelsLoading: false,
			openrouterModels: [
				{ title: 'Claude Sonnet 4.6', model: 'anthropic/claude-sonnet-4.6', category: 'Anthropic', contextLength: 200000, supportsTools: true },
			],
			openrouterSelectedModel: 'anthropic/claude-sonnet-4.6',
		});
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-openrouter-sign-in"]'));
		assert.ok(widget.root.textContent?.includes('Sign in with OpenRouter'));
		assert.ok((widget.root.querySelector('[data-testid="knox-gui-openrouter-connect"]') as HTMLButtonElement).disabled);
		(widget.root.querySelector('[data-testid="knox-gui-openrouter-sign-in"]') as HTMLButtonElement).click();
		assert.ok(posted.some(item => item.type === 'openrouter/oauth/start'));

		posted.length = 0;
		store.patch({ openrouterOauthStatus: 'waiting_for_consent', openrouterOauthConnected: false });
		assert.ok(widget.root.textContent?.includes('Waiting for browser'));
		(widget.root.querySelector('[data-testid="knox-gui-openrouter-cancel"]') as HTMLButtonElement).click();
		assert.ok(posted.some(item => item.type === 'openrouter/oauth/cancel'));

		store.patch({
			openrouterOauthStatus: 'failed',
			openrouterOauthConnected: false,
			openrouterOauthError: 'denied',
		});
		assert.ok(widget.root.textContent?.includes('Sign-in was denied'));
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-openrouter-sign-in"]'));

		posted.length = 0;
		store.patch({
			openrouterOauthStatus: 'success',
			openrouterOauthConnected: true,
			openrouterOauthHandle: 'KnoxCoder',
			openrouterOauthKeyHash: 'deadbeef',
			openrouterOauthError: undefined,
		});
		assert.ok(widget.root.textContent?.includes('Connected as KnoxCoder'));
		assert.ok(!(widget.root.querySelector('[data-testid="knox-gui-openrouter-connect"]') as HTMLButtonElement).disabled);
		(widget.root.querySelector('[data-testid="knox-gui-openrouter-manage-key"]') as HTMLButtonElement).click();
		assert.ok(posted.some(item => item.type === 'openUrl' && String(item.data).includes('/keys/deadbeef')));
		posted.length = 0;
		(widget.root.querySelector('[data-testid="knox-gui-openrouter-sign-out"]') as HTMLButtonElement).click();
		assert.ok(posted.some(item => item.type === 'openrouter/oauth/signOut'));

		posted.length = 0;
		store.patch({
			openrouterOauthStatus: 'success',
			openrouterOauthConnected: true,
			openrouterOauthHandle: 'KnoxCoder',
			addModelDraft: {},
		});
		(widget.root.querySelector('[data-testid="knox-gui-openrouter-connect"]') as HTMLButtonElement).click();
		const oauthAdd = posted.find(item => item.type === 'config/addModel') as { data?: { model?: Record<string, unknown> } } | undefined;
		assert.ok(oauthAdd);
		assert.strictEqual(oauthAdd?.data?.model?.provider, 'openrouter');
		assert.ok(!oauthAdd?.data?.model?.apiKey);

		posted.length = 0;
		store.navigate('/addModel/provider/openrouter');
		store.patch({
			openrouterOauthConnected: false,
			openrouterOauthStatus: 'idle',
			openrouterOauthHandle: undefined,
			openrouterOauthKeyHash: undefined,
			openrouterModelsLoading: false,
			openrouterModels: [
				{ title: 'GPT-4o', model: 'openai/gpt-4o', category: 'OpenAI', contextLength: 128000 },
			],
			openrouterSelectedModel: 'openai/gpt-4o',
			addModelDraft: { apiKey: 'sk-or-v1-paste' },
			addModelModal: false,
		});
		assert.ok(!(widget.root.querySelector('[data-testid="knox-gui-openrouter-connect"]') as HTMLButtonElement).disabled);
		(widget.root.querySelector('[data-testid="knox-gui-openrouter-connect"]') as HTMLButtonElement).click();
		const pastedAdd = posted.find(item => item.type === 'config/addModel') as { data?: { model?: Record<string, unknown> } } | undefined;
		assert.strictEqual(pastedAdd?.data?.model?.provider, 'openrouter');
		assert.strictEqual(pastedAdd?.data?.model?.apiKey, 'sk-or-v1-paste');
	});

	test('Add Model modal can switch to OpenRouter sign-in without mixing KnoxChat OAuth', async () => {
		const posted: Array<{ type: string; data: unknown }> = [];
		const { widget, store } = await mount(message => {
			posted.push({ type: message.messageType, data: message.data });
			if (message.messageType === 'openrouter/listModels') {
				return [{ id: 'anthropic/claude-sonnet-4.6', name: 'Claude Sonnet 4.6', supported_parameters: ['tools'] }];
			}
			return {};
		});
		store.patch({
			addModelModal: true,
			addModelRole: 'chat',
			addModelModalProvider: 'knoxchat',
			knoxChatModelsLoading: false,
			knoxChatModels: [{ title: 'GPT-4o', model: 'openai/gpt-4o', category: 'OpenAI', contextLength: 128000 }],
			openrouterModelsLoading: false,
			openrouterModels: [{ title: 'Claude Sonnet 4.6', model: 'anthropic/claude-sonnet-4.6', category: 'Anthropic', contextLength: 200000, supportsTools: true }],
		});
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-add-model-modal"]'));
		assert.strictEqual(widget.root.querySelector('.knox-gui-add-model-form-title')?.textContent, 'Add Model');
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-add-model-provider-toggle"]'));
		assert.ok(widget.root.textContent?.includes('KnoxStudio'));
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-add-model-provider-knoxchat"]')?.classList.contains('selected'));
		assert.ok(widget.root.textContent?.includes('Sign in with KnoxStudio'));
		assert.ok(!widget.root.textContent?.includes('Sign in with OpenRouter'));
		assert.ok(!widget.root.querySelector('[data-testid="knox-gui-openrouter-sign-in"]'));

		(widget.root.querySelector('[data-testid="knox-gui-add-model-provider-openrouter"]') as HTMLButtonElement).click();
		assert.strictEqual(store.state.addModelModalProvider, 'openrouter');
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-add-model-provider-openrouter"]')?.classList.contains('selected'));
		assert.ok(widget.root.textContent?.includes('Sign in with OpenRouter'));
		assert.ok(!widget.root.textContent?.includes('Sign in with KnoxStudio'));
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-openrouter-sign-in"]'));
		assert.ok((widget.root.querySelector('[data-testid="knox-gui-add-model-connect"]') as HTMLButtonElement).disabled);

		store.patch({
			openrouterOauthStatus: 'success',
			openrouterOauthConnected: true,
			openrouterOauthHandle: 'KnoxCoder',
			openrouterSelectedModel: 'anthropic/claude-sonnet-4.6',
		});
		assert.ok(widget.root.textContent?.includes('Connected as KnoxCoder'));
		assert.ok(!(widget.root.querySelector('[data-testid="knox-gui-add-model-connect"]') as HTMLButtonElement).disabled);
		posted.length = 0;
		(widget.root.querySelector('[data-testid="knox-gui-add-model-connect"]') as HTMLButtonElement).click();
		const oauthAdd = posted.find(item => item.type === 'config/addModel') as { data?: { model?: Record<string, unknown> } } | undefined;
		assert.strictEqual(oauthAdd?.data?.model?.provider, 'openrouter');
		assert.ok(!oauthAdd?.data?.model?.apiKey);
		assert.strictEqual(store.state.oauthConnected, false);
		assert.strictEqual(store.state.addModelModalProvider, 'openrouter');
		widget.controller.closeAddModelModal();
		assert.strictEqual(store.state.addModelModal, false);
		assert.strictEqual(store.state.addModelModalProvider, 'openrouter');
		widget.controller.openAddModel('chat');
		assert.strictEqual(store.state.addModelModal, true);
		assert.strictEqual(store.state.addModelModalProvider, 'openrouter');
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-add-model-provider-openrouter"]')?.classList.contains('selected'));
		assert.ok(widget.root.textContent?.includes('Connected as KnoxCoder'));
	});

	test('search filters KnoxChat models, history, checkpoints, and memories without remounting the input', async () => {
		const { widget, store } = await mount();
		store.navigate('/addModel/provider/knoxchat');
		store.patch({
			oauthConnected: true,
			knoxChatModelsLoading: false,
			knoxChatModels: [
				{ title: 'DeepSeek: DeepSeek V4.1 Flash', model: 'deepseek/deepseek-v4.1-flash', category: 'DeepSeek', contextLength: 1_000_000, supportsTools: true, supportsReasoning: true, modalities: ['text', 'image'] },
				{ title: 'DeepSeek-V4.1-Flash', model: 'knoxchat/flash', category: 'KnoxStudio', contextLength: 1_000_000 },
				{ title: 'GPT-4o', model: 'openai/gpt-4o', category: 'OpenAI', contextLength: 128_000 },
			],
		});
		const knoxSearch = widget.root.querySelector('[data-testid="knox-gui-knoxchat-search"]') as HTMLInputElement;
		assert.ok(knoxSearch);
		knoxSearch.value = 'deepseek';
		knoxSearch.dispatchEvent(new Event('input', { bubbles: true }));
		assert.strictEqual(widget.root.querySelector('[data-testid="knox-gui-knoxchat-search"]'), knoxSearch);
		assert.strictEqual((widget.root.querySelector('[data-model="deepseek/deepseek-v4.1-flash"]') as HTMLElement).hidden, false);
		assert.strictEqual((widget.root.querySelector('[data-model="knoxchat/flash"]') as HTMLElement).hidden, false);
		assert.strictEqual((widget.root.querySelector('[data-model="openai/gpt-4o"]') as HTMLElement).hidden, true);
		assert.ok(widget.root.textContent?.includes('DeepSeek'));
		assert.ok(widget.root.textContent?.includes('KnoxStudio'));

		store.navigate('/');
		store.patch({
			overlay: 'history',
			historySessions: [
				{ id: 'a', title: 'Alpha login form', date: String(Date.now()), workspaceDirectory: '/tmp/demo' },
				{ id: 'b', title: 'Beta notes', date: String(Date.now() - 1000), workspaceDirectory: '/tmp/other' },
			],
		});
		const historySearch = widget.root.querySelector('[data-testid="history-search"]') as HTMLInputElement;
		historySearch.value = 'alpha';
		historySearch.dispatchEvent(new Event('input', { bubbles: true }));
		assert.strictEqual(widget.root.querySelector('[data-testid="history-search"]'), historySearch);
		assert.ok(widget.root.querySelector('[data-session-id="a"]'));
		assert.ok(!widget.root.querySelector('[data-session-id="b"]'));

		const node = (id: string, description: string): IKnoxGuiCheckpointNode => ({
			id, description, created: new Date().toISOString(), kind: 'manual', tags: [], shortId: id, pinned: false, changedPaths: [], parents: [], fileChanges: { added: 0, modified: 0, deleted: 0 },
		});
		store.navigate('/checkpoint-graph');
		store.patch({
			checkpointShell: { state: 'ready', checkpointCount: 2 },
			checkpointView: 'checkpoints',
			checkpoints: [node('cp-a', 'login form'), node('cp-b', 'unrelated')],
		});
		const checkpointSearch = widget.root.querySelector('.knox-gui-cpl-search.has-clear input') as HTMLInputElement;
		assert.ok(checkpointSearch);
		checkpointSearch.value = 'login';
		checkpointSearch.dispatchEvent(new Event('input', { bubbles: true }));
		assert.strictEqual(widget.root.querySelector('.knox-gui-cpl-search.has-clear input'), checkpointSearch);
		assert.strictEqual((widget.root.querySelector('[data-checkpoint-id="cp-a"]') as HTMLElement).hidden, false);
		assert.strictEqual((widget.root.querySelector('[data-checkpoint-id="cp-b"]') as HTMLElement).hidden, true);

		store.navigate('/memory');
		store.patch({
			memoryTab: 'memories',
			memories: [
				{ id: '1', title: 'auth cookie', content: 'use httpOnly', category: 'insight', createdAt: new Date().toISOString() },
				{ id: '2', title: 'unrelated', content: 'other', category: 'general', createdAt: new Date().toISOString() },
			],
		});
		const memorySearch = widget.root.querySelector('.knox-gui-memory-search input') as HTMLInputElement;
		assert.ok(memorySearch);
		memorySearch.value = 'auth';
		memorySearch.dispatchEvent(new Event('input', { bubbles: true }));
		assert.strictEqual(widget.root.querySelector('.knox-gui-memory-search input'), memorySearch);
		assert.strictEqual((widget.root.querySelector('[data-memory-id="1"]') as HTMLElement).hidden, false);
		assert.strictEqual((widget.root.querySelector('[data-memory-id="2"]') as HTMLElement).hidden, true);
	});
	test('NP-03 duplicate assistant replies hide their text even on the last row, but keep reasoning and tools', async () => {
		const { widget, store } = await mount();
		const user: IKnoxGuiHistoryItem = { id: 'u', role: 'user', content: 'hi' };
		const tool = { id: 't1', name: 'builtin_read_file', arguments: '{}', status: 'done' as const };
		store.patch({
			isStreaming: false,
			history: [
				user,
				{ id: 'a1', role: 'assistant', content: 'same reply' },
				{ id: 'a2', role: 'assistant', content: 'same reply', thinking: 'why again', thinkingCollapsed: false, toolCalls: [tool] },
				{ id: 'a3', role: 'assistant', content: 'same reply' },
			],
		});
		const replies = widget.root.querySelectorAll('.knox-gui-msg.assistant .knox-gui-stream-body');
		assert.strictEqual(replies.length, 1, 'only the first reply text is painted; duplicates (including the last row) are hidden');
		assert.ok(widget.root.querySelector('#agent-activity-reasoning_a2'), 'duplicate row with tool calls still mounts its reasoning card');
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-tool"]'), 'duplicate row with tool calls still mounts its tools');
	});
	test('K-040 a finished agent turn closes with a run summary; K-041 long reads collapse and the head is keyboard reachable', async () => {
		const { widget, store } = await mount();
		const long = Array.from({ length: 40 }, (_, i) => `row ${i}`).join('\n');
		store.patch({
			mode: 'agent',
			isStreaming: false,
			history: [
				{ id: 'u', role: 'user', content: 'fix it', createdAt: '2026-10-03T10:00:00.000Z' },
				{
					id: 'a1', role: 'assistant', content: 'done', createdAt: '2026-10-03T10:00:09.000Z',
					toolCalls: [
						{ id: 'r1', name: 'builtin_read_file', arguments: '{"filepath":"a.ts"}', parsedArgs: { filepath: 'a.ts' }, status: 'done', output: long },
						{ id: 'e1', name: 'builtin_edit_file', arguments: '{}', parsedArgs: { filepath: 'a.ts', old_string: 'x', new_string: 'y\nz' }, status: 'done', output: '[soul checkpoint=cp-turn]' },
					],
				},
			],
		});
		const summary = widget.root.querySelector('[data-testid="turn-summary"]');
		assert.ok(summary, 'summary closes the finished turn');
		assert.ok(summary!.querySelector('[data-testid="turn-summary-files"]')?.textContent?.includes('+2 -1'));
		assert.ok(summary!.querySelector('[data-testid="turn-summary-review"]'));
		assert.ok(summary!.querySelector('[data-testid="turn-summary-undo"]'));
		const readCard = widget.root.querySelector('[data-testid="knox-gui-tool"][data-tool-id="r1"]')!;
		assert.strictEqual(readCard.querySelector('.knox-gui-tool-body'), null, 'long read result starts collapsed');
		const head = readCard.querySelector<HTMLElement>('[data-testid="tool-head"]')!;
		assert.strictEqual(head.tabIndex, 0);
		assert.strictEqual(head.getAttribute('aria-expanded'), 'false');
		head.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		const reopened = widget.root.querySelector('[data-testid="knox-gui-tool"][data-tool-id="r1"]')!;
		assert.ok(reopened.querySelector('.knox-gui-tool-body'), 'Enter on the head opens it');
		// A new turn streams without a summary of its own; when it ends, the summary appears (one full render).
		const first = store.state.history;
		const editCall = { id: 'e2', name: 'builtin_write_file', arguments: '{}', parsedArgs: { filepath: 'b.ts', content: 'x' }, status: 'done' as const };
		store.patch({ isStreaming: true, history: [...first, { id: 'u2', role: 'user', content: 'again', createdAt: '2026-10-03T10:05:00.000Z' }, { id: 'a2', role: 'assistant', content: '', toolCalls: [{ ...editCall, status: 'calling' as const }] }] });
		assert.strictEqual(widget.root.querySelectorAll('[data-testid="turn-summary"]').length, 1, 'only the finished first turn has one');
		store.patch({ isStreaming: false, history: [...store.state.history.slice(0, -1), { id: 'a2', role: 'assistant', content: 'ok', toolCalls: [editCall] }] });
		assert.strictEqual(widget.root.querySelectorAll('[data-testid="turn-summary"]').length, 2, 'the turn that just ended gets its summary');
	});
	test('NP-09 pasting text alongside a file still inserts the text when the model has no image support', async () => {
		const { widget, store } = await mount();
		store.patch({ imagesSupported: false });
		const editor = widget.root.querySelector<HTMLElement>('[data-testid="knox-gui-input"]')!;
		editor.focus();
		const data = new DataTransfer();
		data.setData('text/plain', 'pasted text');
		data.items.add(new File(['x'], 'shot.png', { type: 'image/png' }));
		const event = new ClipboardEvent('paste', { clipboardData: data, cancelable: true, bubbles: true });
		editor.dispatchEvent(event);
		assert.strictEqual(event.defaultPrevented, true);
		assert.ok(editor.textContent?.includes('pasted text'), 'text must not be swallowed by the file');
		assert.strictEqual(store.state.images.length, 0, 'unsupported image files are ignored');
	});
	test('Cmd+A in the composer selects only the composer text, never the code editor', async () => {
		const { widget, store } = await mount();
		store.setInputDoc(inputDocFromPlainText('Use rust to create a snake game'));
		const editor = widget.root.querySelector<HTMLElement>('[data-testid="knox-gui-input"]')!;
		editor.focus();
		assert.strictEqual(document.activeElement, editor);
		document.getSelection()?.removeAllRanges();

		// This is what `editor.action.selectAll` calls for the focused element (see knoxGuiEditCommands.ts).
		assert.strictEqual(runKnoxEditCommand('selectAll', document.activeElement), true, 'handled inside Knox so the workbench does not fall back to the editor');
		const selection = document.getSelection()!;
		assert.strictEqual(selection.toString(), 'Use rust to create a snake game');
		assert.ok(editor.contains(selection.anchorNode) && editor.contains(selection.focusNode));
	});
	test('Select All override is registered ahead of the workbench generic-dom fallback', async () => {
		const { widget, store } = await mount();
		store.setInputDoc(inputDocFromPlainText('hello world'));
		const editor = widget.root.querySelector<HTMLElement>('[data-testid="knox-gui-input"]')!;
		editor.focus();
		document.getSelection()?.removeAllRanges();
		const accessor = { get: () => ({ trace() { } }) } as unknown as ServicesAccessor;
		SelectAllCommand.runCommand(accessor, undefined);
		assert.strictEqual(document.getSelection()!.toString(), 'hello world');
	});
	test('Select All leaves native inputs to the workbench and selects the page for non-editable focus', async () => {
		const { widget, store } = await mount();
		store.patch({ find: { ...store.state.find, open: true } });
		const input = widget.root.querySelector<HTMLInputElement>('input');
		assert.ok(input, 'find input is rendered');
		input.focus();
		assert.strictEqual(runKnoxEditCommand('selectAll', input), false, 'native <input> keeps the workbench execCommand path');

		const outside = document.createElement('button');
		document.body.appendChild(outside);
		disposables.add({ dispose: () => outside.remove() });
		outside.focus();
		assert.strictEqual(runKnoxEditCommand('selectAll', outside), false, 'focus outside Knox is not ours');

		const button = widget.root.querySelector<HTMLElement>('button')!;
		button.focus();
		assert.strictEqual(runKnoxEditCommand('selectAll', button), true, 'focus on a Knox control selects the Knox page, not the code editor');
		const selection = document.getSelection()!;
		assert.ok(selection.rangeCount && widget.root.contains(selection.anchorNode));
	});
	test('Undo / Redo in the composer step the composer history instead of the code editor', async () => {
		const { widget, store } = await mount();
		const text = () => store.state.inputDoc.map(block => JSON.stringify(block)).join('');
		store.patch({ inputFocused: true }); // real typing always follows a focus state change, which is when undo recording starts
		const empty = text();
		store.setInputDoc(inputDocFromPlainText('one two'));
		const typed = text();
		const editor = widget.editorEl!;
		assert.ok(editor.isConnected);
		editor.focus();
		assert.strictEqual(runKnoxEditCommand('undo', editor), true, 'undo is handled by the composer, not the workbench editor');
		assert.strictEqual(text(), empty);
		assert.strictEqual(runKnoxEditCommand('redo', editor), true);
		assert.strictEqual(text(), typed);
	});
	test('NP-13 a page render crash shows message + Retry and keeps the session (no persisted-state wipe)', async () => {
		const { widget, store } = await mount();
		const history: IKnoxGuiHistoryItem[] = [{ id: 'u', role: 'user', content: 'keep me' }];
		store.patch({ sessionId: 'keep-session', history });
		const original = widget.renderChat;
		let broken = true;
		widget.renderChat = function (this: KnoxGuiWidget, ...args: Parameters<KnoxGuiWidget['renderChat']>) {
			if (broken) {
				throw new Error('boom');
			}
			return original.apply(this, args);
		};
		widget.render();
		const fallback = widget.root.querySelector('[data-testid="knox-gui-error-boundary"]');
		assert.ok(fallback);
		assert.ok(fallback.textContent?.includes('boom'));
		const retry = fallback.querySelector<HTMLButtonElement>('[data-testid="knox-gui-error-retry"]');
		assert.ok(retry, 'Retry, not the session-wiping Knox button');
		assert.strictEqual(store.state.sessionId, 'keep-session');
		broken = false;
		retry.click();
		assert.strictEqual(widget.root.querySelector('[data-testid="knox-gui-error-boundary"]'), null);
		assert.strictEqual(store.state.sessionId, 'keep-session');
		assert.strictEqual(store.state.history.length, 1);
	});
	test('NP-19 the response restore button is disabled and spins only for the checkpoint being restored', async () => {
		const { widget, store } = await mount();
		store.patch({
			isStreaming: false,
			history: [
				{ id: 'u', role: 'user', content: 'go' },
				{ id: 'a', role: 'assistant', content: 'done', checkpointId: 'cp12345678' },
				{ id: 'u2', role: 'user', content: 'more' },
				{ id: 'b', role: 'assistant', content: 'again', checkpointId: 'cpabcdef00' },
			],
		});
		const first = () => widget.root.querySelector<HTMLButtonElement>('[data-testid="checkpoint-restore-button-1"]')!;
		const second = () => widget.root.querySelector<HTMLButtonElement>('[data-testid="checkpoint-restore-button-3"]')!;
		assert.strictEqual(first().disabled, false);
		store.patch({ checkpointRestoring: true, checkpointRestoringId: 'cp12345678' });
		assert.strictEqual(first().disabled, true);
		assert.ok(first().classList.contains('knox-gui-restoring'));
		assert.strictEqual(first().getAttribute('aria-label'), 'Restoring');
		assert.strictEqual(second().disabled, false, 'other rows are unaffected');
		store.patch({ checkpointRestoring: false, checkpointRestoringId: undefined });
		assert.strictEqual(first().disabled, false);
	});
	test('NP-20 a chat-list render crash keeps the large-session banner outside the retry card', async () => {
		const { widget, store } = await mount();
		const original = widget.renderHistoryRow;
		let broken = true;
		widget.renderHistoryRow = function (this: KnoxGuiWidget, ...args: Parameters<KnoxGuiWidget['renderHistoryRow']>) {
			if (broken) {
				throw new Error('row boom');
			}
			return original.apply(this, args);
		};
		store.patch({
			isStreaming: false,
			historyHydrateNotice: 'large',
			history: [{ id: 'u', role: 'user', content: 'hi' }, { id: 'a', role: 'assistant', content: 'yo' }],
		});
		const card = widget.root.querySelector('[data-testid="chat-list-error"]');
		assert.ok(card, 'list replaced by the error card');
		assert.ok(widget.root.querySelector('[data-testid="large-session-banner"]'), 'banner is outside the boundary');
		broken = false;
		card.querySelector<HTMLButtonElement>('button')!.click();
		assert.strictEqual(widget.root.querySelector('[data-testid="chat-list-error"]'), null);
		assert.ok(widget.root.querySelector('[data-testid="large-session-banner"]'));
	});
	test('NP-24 the Memory editor paints no tabs until the saved tab id is read', async () => {
		const { widget, store } = await mount();
		store.patch({ lockedRoute: KnoxGuiRoute.Memory, route: KnoxGuiRoute.Memory, memoryTabHydrated: false });
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-memory"]'));
		assert.strictEqual(widget.root.querySelector('[data-testid="knox-gui-memory-tab-overview"]'), null, 'Overview must not flash first');
		store.patch({ memoryTab: 'sessions', memoryTabHydrated: true });
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-memory-tab-sessions"].selected'));
	});
	test('background jobs panel keeps the user expand/collapse choice when jobs arrive, and remembers it', async () => {
		const { widget, store } = await mount();
		const controller = widget.controller;
		const jobsPanelOpen = () => widget.root.querySelector('[data-testid="agent-jobs-panel"] .knox-gui-attached-collapse')?.classList.contains('open');
		const sendJob = (id: string) => controller.onHostMessage({
			messageType: 'agent/jobUpdate',
			messageId: `job-${id}`,
			data: { job: { id, title: `cmd ${id}`, status: 'running', kind: 'shell', startedAt: Date.now() } },
		});

		// Original default: expanded.
		assert.strictEqual(store.state.jobsPanelOpen, true);
		sendJob('j1');
		assert.strictEqual(jobsPanelOpen(), true);

		// User collapses; new jobs must not force it open again.
		(widget.root.querySelector('[data-testid="agent-jobs-toggle"]') as HTMLButtonElement).click();
		assert.strictEqual(store.state.jobsPanelOpen, false);
		sendJob('j2');
		controller.onHostMessage({ messageType: 'agent/jobUpdate', messageId: 'jobs-list', data: { jobs: [{ id: 'j1', title: 'a', status: 'running' }, { id: 'j3', title: 'b', status: 'running' }] } });
		assert.strictEqual(store.state.jobsPanelOpen, false);
		assert.strictEqual(jobsPanelOpen(), false);

		// A new session keeps the preference and it is written to storage.
		store.newSession();
		assert.strictEqual(store.state.jobsPanelOpen, false);
		assert.strictEqual(controller.jobsPanelExpanded(), false);

		// User expands again; it stays expanded across further jobs.
		controller.toggleJobsPanel();
		sendJob('j4');
		assert.strictEqual(store.state.jobsPanelOpen, true);
		assert.strictEqual(controller.jobsPanelExpanded(), true);
	});
	test('job title keeps the shell command separate from last-line output', async () => {
		const { widget, store } = await mount();
		store.patch({
			jobsPanelOpen: true,
			backgroundJobs: [{
				id: 'fmt',
				kind: 'shell',
				title: 'cargo fmt --check',
				detail: 'mod game;',
				status: 'exited',
				exitCode: 1,
			}],
		});
		const row = widget.root.querySelector('[data-testid="agent-job-fmt"] .knox-gui-job-title') as HTMLButtonElement;
		assert.ok(row);
		assert.strictEqual(row.getAttribute('aria-label'), 'cargo fmt --check');
		assert.strictEqual(row.querySelector('.knox-gui-job-command')?.textContent, 'cargo fmt --check');
		assert.strictEqual(row.querySelector('.knox-gui-job-detail')?.textContent, 'mod game;');
		assert.ok(row.querySelector('.knox-gui-job-command') !== row.querySelector('.knox-gui-job-detail'));
	});

	test('NP-28 code fences never auto-detect a language while the reply streams (CSLD-09)', async () => {
		const { widget } = await mount();
		let guesses = 0;
		const service = widget.languageService as unknown as { guessLanguageIdByFilepathOrFirstLine: () => string | null };
		service.guessLanguageIdByFilepathOrFirstLine = () => {
			guesses++;
			return null;
		};
		const pre = document.createElement('pre');
		widget.paintHighlightedCode(pre, '', 'const x = 1;', undefined, false);
		assert.strictEqual(guesses, 0, 'streaming untagged fence skips auto-detect');
		assert.ok(pre.textContent?.includes('const x = 1;'));
		widget.paintHighlightedCode(pre, '', 'const x = 1;', undefined, true);
		assert.strictEqual(guesses, 1, 'auto-detect runs once after the stream ends');
	});

	test('long chats mount a 25-row window and prepend 25 more without loading everything', async () => {
		const { widget, store } = await mount();
		const history: IKnoxGuiHistoryItem[] = Array.from({ length: 80 }, (_, i) => ({
			id: `h-${i}`,
			role: i % 2 === 0 ? 'user' : 'assistant',
			content: `msg-${i}`,
		}));
		store.patch({ history });
		const rows = () => widget.root.querySelectorAll('[data-testid^="history-row-"]');
		assert.strictEqual(rows().length, CHAT_DISPLAY_WINDOW);
		assert.strictEqual(widget.root.querySelector('[data-testid="history-row-0"]'), null);
		assert.ok(widget.root.querySelector('[data-testid="history-row-79"]'));
		const load = widget.root.querySelector('[data-testid="load-earlier-messages"]') as HTMLButtonElement | null;
		assert.ok(load);
		assert.ok(load.textContent?.includes(String(80 - CHAT_DISPLAY_WINDOW)));
		const expandedBefore = widget.expandedStart;
		widget.scrollTranscript('top');
		assert.strictEqual(widget.autoScrollEnabled, false);
		assert.strictEqual(widget.expandedStart, expandedBefore, 'scroll-to-top must not mount the full session');
		assert.strictEqual(rows().length, CHAT_DISPLAY_WINDOW);
		load.click();
		assert.strictEqual(rows().length, CHAT_DISPLAY_WINDOW + CHAT_LOAD_MORE_COUNT);
		assert.ok(widget.root.querySelector('[data-testid="history-row-30"]'));
		assert.strictEqual(widget.root.querySelector('[data-testid="history-row-0"]'), null);
		assert.ok(widget.root.querySelector('[data-testid="load-earlier-messages"]'));
	});

	test('scrolling up pauses follow without rebuilding; reaching the bottom resumes auto-scroll', async () => {
		const { widget, store } = await mount();
		store.patch({
			isStreaming: true,
			history: Array.from({ length: 8 }, (_, i) => ({
				id: `s-${i}`,
				role: i % 2 === 0 ? 'user' as const : 'assistant' as const,
				content: `msg-${i}`,
			})),
		});
		const body = widget.bodyEl!;
		body.style.height = '400px';
		body.style.overflow = 'auto';
		const content = body.querySelector('[data-testid="chat-scroll-content"]') as HTMLElement;
		content.style.minHeight = '2000px';
		void body.offsetHeight;
		const bottom = Math.max(0, body.scrollHeight - body.clientHeight);
		widget.lastScrollTop = bottom;
		widget.lastScrollHeight = body.scrollHeight;
		widget.savedScrollTop = bottom;
		widget.autoScrollEnabled = true;
		body.scrollTop = bottom;
		const list = widget.root.querySelector('[data-testid="chat-virtual-list"]');
		assert.ok(list);
		const pausedTop = Math.max(0, bottom - 800);
		body.scrollTop = pausedTop;
		body.dispatchEvent(new Event('scroll'));
		assert.strictEqual(widget.autoScrollEnabled, false);
		assert.strictEqual(widget.root.querySelector('[data-testid="chat-virtual-list"]'), list, 'pause must not tear down the scroller');
		const heldTop = body.scrollTop;
		content.style.minHeight = '2400px';
		void body.offsetHeight;
		body.dispatchEvent(new Event('scroll'));
		assert.strictEqual(widget.autoScrollEnabled, false, 'content growth while paused must not re-follow');
		assert.strictEqual(body.scrollTop, heldTop);
		body.scrollTop = body.scrollHeight;
		body.dispatchEvent(new Event('scroll'));
		assert.strictEqual(widget.autoScrollEnabled, true, 'reaching the bottom resumes stick-to-latest');
		assert.strictEqual(widget.root.querySelector('[data-testid="chat-virtual-list"]'), list);
		widget.scrollTranscript('bottom');
		assert.strictEqual(widget.autoScrollEnabled, true);
	});
});
