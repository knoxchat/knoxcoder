/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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
import { InMemoryStorageService } from '../../../../platform/storage/common/storage.js';
import { IKnoxGuiMessage, KnoxGuiRoute } from '../common/knoxGuiProtocol.js';
import { knoxGuiEmptyStreamText } from '../common/knoxGuiAgentRequest.js';
import { applyKnoxGuiSetTheme } from '../common/knoxGuiTheme.js';
import { IKnoxGuiCheckpointNode, IKnoxGuiHistoryItem, IKnoxGuiToolCall, IKnoxGuiVscTheme } from '../common/knoxGuiState.js';
import { IKnoxService } from '../common/knoxService.js';
import { KnoxGuiController } from './knoxGuiController.js';
import { KnoxGuiMessenger } from './knoxGuiMessenger.js';
import { KnoxGuiStore } from './knoxGuiStore.js';
import { KnoxGuiWidget } from './gui/knoxGuiWidget.js';

const INTERACTIVE = 'button, [role="button"], [role="tab"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="option"], [role="switch"], [role="checkbox"], [role="textbox"], input, textarea, select, [contenteditable="true"]';

function accessibleName(el: HTMLElement): string {
	if (el.getAttribute('aria-hidden') === 'true') {
		return '(hidden)';
	}
	const labelledBy = el.getAttribute('aria-labelledby');
	if (labelledBy) {
		const label = labelledBy.split(/\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' ').trim();
		if (label) {
			return label;
		}
	}
	const id = el.getAttribute('id');
	if (id) {
		const forLabel = document.querySelector(`label[for="${id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`)?.textContent?.trim();
		if (forLabel) {
			return forLabel.replace(/\s+/g, ' ');
		}
	}
	const wrapLabel = el.closest('label')?.textContent?.trim();
	if (wrapLabel) {
		return wrapLabel.replace(/\s+/g, ' ');
	}
	return (el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || el.textContent || '').replace(/\s+/g, ' ').trim();
}

suite('K-102 Knox GUI screen-reader and theme pass', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	async function mount(): Promise<{ widget: KnoxGuiWidget; store: KnoxGuiStore; controller: KnoxGuiController }> {
		const incoming = disposables.add(new Emitter<IKnoxGuiMessage>());
		const knoxService = new class extends mock<IKnoxService>() {
			override onDidReceiveGuiMessage = incoming.event;
			override async guiPost(message: IKnoxGuiMessage): Promise<void> {
				incoming.fire({
					messageType: message.messageType,
					messageId: message.messageId,
					data: { done: true, status: 'success', content: {} },
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
			override getLanguageIdByLanguageName(): string | null { return null; }
			override isRegisteredLanguageId(): boolean { return false; }
			override requestBasicLanguageFeatures(): void { }
			override guessLanguageIdByFilepathOrFirstLine(): string | null { return null; }
		};
		const markdownRendererService = new class extends mock<IMarkdownRendererService>() {
			override render(markdown: IMarkdownString, options?: import('../../../../base/browser/markdownRenderer.js').MarkdownRenderOptions, target?: HTMLElement) {
				return renderMarkdown(markdown, options, target);
			}
			override setDefaultCodeBlockRenderer(): void { }
		};
		const widget = disposables.add(new KnoxGuiWidget(parent, controller, openerService, hoverService, languageService, { getModel: () => null } as unknown as IModelService, markdownRendererService));
		disposables.add({ dispose: () => parent.remove() });
		return { widget, store, controller };
	}

	function unnamedInteractive(root: HTMLElement): string[] {
		return Array.from(root.querySelectorAll<HTMLElement>(INTERACTIVE))
			.filter(el => el.closest('[aria-hidden="true"]') === null)
			.filter(el => accessibleName(el) === '')
			.map(el => `${el.tagName.toLowerCase()}[role=${el.getAttribute('role') ?? ''}][data-testid=${el.getAttribute('data-testid') ?? ''}]`);
	}

	test('composer, chat, permission cards, jobs, checkpoints, and recipe preview have names and landmarks', async () => {
		const { widget, store } = await mount();
		assert.strictEqual(widget.root.getAttribute('role'), 'region');
		assert.ok(widget.root.getAttribute('aria-label'));
		assert.strictEqual(widget.bodyEl?.getAttribute('role'), 'main');
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-skip-composer"]')?.textContent);
		assert.ok(widget.root.querySelector('[data-testid="full-composer"]')?.getAttribute('aria-label'));
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-input"]')?.getAttribute('aria-label'));
		assert.deepStrictEqual(unnamedInteractive(widget.root), []);

		store.patch({
			permissionMode: 'default',
			toolSettings: { builtin_run_terminal_command: 'allowedWithPermission' },
			history: [
				{ id: 'u', role: 'user', content: 'run tests' },
				{
					id: 'a',
					role: 'assistant',
					content: 'need a tool',
					toolCalls: [{
						id: 'c1',
						name: 'builtin_run_terminal_command',
						arguments: '{"command":"make test"}',
						status: 'generated',
						parsedArgs: { command: 'make test' },
					}],
				},
			],
			recipeDecision: {
				mode: 'exact',
				why: '',
				needsConfirmation: true,
				awaitingChoice: true,
				preview: '1 file',
				recipe: { id: 'r1', title: 'Add lint', uses: 1, reverts: 0, score: 1 },
			},
			backgroundJobs: [{ id: 'j1', kind: 'shell', title: 'cargo test', status: 'running' }],
			jobsPanelOpen: true,
		});
		assert.ok(widget.root.querySelector('[data-testid="chat-virtual-list"]')?.getAttribute('role') === 'log');
		assert.ok(widget.root.querySelector('[data-testid="permission-action-buttons"]')?.getAttribute('aria-label'));
		assert.ok(widget.root.querySelector('[data-testid="recipe-preview-card"]')?.getAttribute('aria-labelledby'));
		assert.ok(widget.root.querySelector('[data-testid="agent-jobs-toggle"]')?.getAttribute('aria-label'));
		assert.deepStrictEqual(unnamedInteractive(widget.root), []);

		const node = (id: string): IKnoxGuiCheckpointNode => ({
			id,
			description: 'save work',
			created: '2026-09-26T00:00:00.000Z',
			kind: 'manual',
			tags: [],
			shortId: id.replace('-', ''),
			pinned: false,
			changedPaths: [],
			parents: [],
			fileChanges: { added: 0, modified: 0, deleted: 0 },
		});
		store.patch({
			route: KnoxGuiRoute.CheckpointGraph,
			checkpointView: 'checkpoints',
			checkpointShell: { state: 'ready', checkpointCount: 1 },
			checkpoints: [node('cp-1')],
		});
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-checkpoints"]'));
		assert.ok(widget.root.querySelector('[data-testid="checkpoint-panel-tabs"]')?.getAttribute('aria-label'));
		assert.ok(widget.root.querySelector('[data-testid="checkpoint-list"]'));
		assert.deepStrictEqual(unnamedInteractive(widget.root), []);
	});

	test('built-in dark, light, and high-contrast themes stamp kind and contrast', async () => {
		const { widget, store } = await mount();
		const apply = (theme: IKnoxGuiVscTheme) => {
			const patch = applyKnoxGuiSetTheme(store.state, { theme });
			assert.ok(patch);
			store.patch(patch);
		};
		apply({ base: 'vs-dark', colors: { 'editor.background': '#282c34', 'editor.foreground': '#abb2bf' } });
		assert.strictEqual(widget.root.getAttribute('data-knox-theme-kind'), 'dark');
		assert.strictEqual(widget.root.getAttribute('data-knox-theme-contrast'), null);

		apply({ base: 'vs', colors: { 'editor.background': '#ffffff', 'editor.foreground': '#202020' } });
		assert.strictEqual(widget.root.getAttribute('data-knox-theme-kind'), 'light');

		apply({ base: 'hc-black', colors: { 'editor.background': '#000000', 'editor.foreground': '#ffffff' } });
		assert.strictEqual(widget.root.getAttribute('data-knox-theme-kind'), 'dark');
		assert.strictEqual(widget.root.getAttribute('data-knox-theme-contrast'), 'high');

		apply({ base: 'hc-light', colors: { 'editor.background': '#ffffff', 'editor.foreground': '#000000' } });
		assert.strictEqual(widget.root.getAttribute('data-knox-theme-kind'), 'light');
		assert.strictEqual(widget.root.getAttribute('data-knox-theme-contrast'), 'high');
	});
});

suite('K-101 Knox GUI DOM event soak', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	async function mount(): Promise<{ widget: KnoxGuiWidget; store: KnoxGuiStore; controller: KnoxGuiController }> {
		const incoming = disposables.add(new Emitter<IKnoxGuiMessage>());
		const knoxService = new class extends mock<IKnoxService>() {
			override onDidReceiveGuiMessage = incoming.event;
			override async guiPost(message: IKnoxGuiMessage): Promise<void> {
				incoming.fire({
					messageType: message.messageType,
					messageId: message.messageId,
					data: { done: true, status: 'success', content: {} },
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
			override getLanguageIdByLanguageName(): string | null { return null; }
			override isRegisteredLanguageId(): boolean { return false; }
			override requestBasicLanguageFeatures(): void { }
			override guessLanguageIdByFilepathOrFirstLine(): string | null { return null; }
		};
		const markdownRendererService = new class extends mock<IMarkdownRendererService>() {
			override render(markdown: IMarkdownString, options?: import('../../../../base/browser/markdownRenderer.js').MarkdownRenderOptions, target?: HTMLElement) {
				return renderMarkdown(markdown, options, target);
			}
			override setDefaultCodeBlockRenderer(): void { }
		};
		const widget = disposables.add(new KnoxGuiWidget(parent, controller, openerService, hoverService, languageService, { getModel: () => null } as unknown as IModelService, markdownRendererService));
		disposables.add({ dispose: () => parent.remove() });
		return { widget, store, controller };
	}

	test('folds 40 shared-loop turns into the widget without unbounded DOM growth', async () => {
		const { widget, store, controller } = await mount();
		const sessionId = store.state.sessionId;
		controller.sharedTurn = { sessionId, acc: knoxGuiEmptyStreamText(), toolCalls: [], awaitingUser: false };
		store.patch({ mode: 'agent', toolsSupported: true, isStreaming: true });

		const turns = 40;
		const history: IKnoxGuiHistoryItem[] = [];
		for (let i = 1; i <= turns; i++) {
			const call: IKnoxGuiToolCall = {
				id: `c${i}`,
				name: 'builtin_read_file',
				arguments: `{"filepath":"src/file${i % 8}.ts"}`,
				status: 'done',
				parsedArgs: { filepath: `src/file${i % 8}.ts` },
				output: `ok ${i}`,
			};
			history.push(
				{ id: `u${i}`, role: 'user', content: `Turn ${i}` },
				{ id: `a${i}`, role: 'assistant', content: `Done ${i}`, toolCalls: [call] },
			);
			controller.enqueueChatTurnEvent({ sessionId, event: { type: 'chunk', chunk: { role: 'assistant', content: `Done ${i}` } } });
			controller.enqueueChatTurnEvent({
				sessionId,
				event: { type: 'assistant', assistant: { role: 'assistant', content: `Done ${i}` }, toolCalls: [{ id: call.id, name: call.name, args: call.parsedArgs }] },
			});
			controller.enqueueChatTurnEvent({ sessionId, event: { type: 'tool_start', callId: call.id, name: call.name } });
			controller.enqueueChatTurnEvent({ sessionId, event: { type: 'tool_end', callId: call.id, ok: true, output: call.output } });
			controller.enqueueChatTurnEvent({ sessionId, event: { type: 'done', stoppedReason: 'completed', steps: 1, summary: `Done ${i}` } });
			store.patch({ history: history.slice(), isStreaming: i < turns });
		}
		await controller.sharedTurnQueue;
		controller.sharedTurn = undefined;

		assert.ok(store.state.history.length >= turns);
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-input"]'));
		assert.ok(widget.root.querySelector('[role="log"]') || widget.root.querySelector('[data-testid="chat-virtual-list"]'));
		assert.ok(widget.root.querySelectorAll('*').length < 25_000, 'DOM node count stayed bounded across soaked turns');
	});
});
