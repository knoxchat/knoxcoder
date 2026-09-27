/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { timeout } from '../../../../base/common/async.js';
import { Emitter } from '../../../../base/common/event.js';
import { mock } from '../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { InMemoryStorageService } from '../../../../platform/storage/common/storage.js';
import { KNOX_GUI_LUMP_TOOLBAR } from '../common/knoxGuiChrome.js';
import { IKnoxGuiMessage, KnoxGuiRoute } from '../common/knoxGuiProtocol.js';
import { IKnoxGuiCheckpointNode, IKnoxGuiGitDiffFile, IKnoxGuiHistoryItem, IKnoxGuiToolCall } from '../common/knoxGuiState.js';
import { composerInputHistoryAdd, createComposerInputHistory, DEFAULT_MENTION_PROVIDER_TITLES, inputDocFromPlainText, SLASH_BUILTINS } from '../common/knoxGuiInput.js';
import { MEMORY_TAB_IDS } from '../common/knoxGuiMemory.js';
import { IKnoxService } from '../common/knoxService.js';
import { KnoxGuiController } from './knoxGuiController.js';
import { KnoxGuiMessenger } from './knoxGuiMessenger.js';
import { KnoxGuiStore } from './knoxGuiStore.js';
import { KnoxGuiWidget } from './gui/knoxGuiWidget.js';

suite('Knox native GUI widget chrome (GP-083)', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	async function mount(): Promise<{ widget: KnoxGuiWidget; store: KnoxGuiStore }> {
		const incoming = disposables.add(new Emitter<IKnoxGuiMessage>());
		const knoxService = new class extends mock<IKnoxService>() {
			override onDidReceiveGuiMessage = incoming.event;
			override async guiPost(message: IKnoxGuiMessage): Promise<void> {
				incoming.fire({
					messageType: message.messageType,
					messageId: message.messageId,
					data: { done: true, status: 'error', error: 'unhandled' },
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
		};
		const widget = disposables.add(new KnoxGuiWidget(parent, controller, openerService, hoverService, languageService));
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

	test('Agent is the default tab and shows a chevron dropdown trigger', async () => {
		const { widget } = await mount();
		const agent = widget.root.querySelector('[data-testid="knox-gui-mode-agent"]') as HTMLButtonElement | null;
		const chat = widget.root.querySelector('[data-testid="knox-gui-mode-chat"]') as HTMLButtonElement | null;
		assert.ok(agent);
		assert.ok(chat);
		assert.ok(agent.classList.contains('selected'));
		assert.strictEqual(chat.classList.contains('selected'), false);
		assert.ok(agent.querySelector('svg.knox-gui-svg'));
		assert.strictEqual(agent.getAttribute('data-menu-trigger'), 'true');
		agent.click();
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-agent-menu"]'));
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
				chat: [{ title: 'GPT-4o', provider: 'openai', model: 'gpt-4o' }],
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

	test('add-model provider cards use PNG logos', async () => {
		const { widget, store } = await mount();
		store.navigate('/addModel');
		const logos = widget.root.querySelectorAll('img.knox-gui-provider-icon');
		assert.ok(logos.length >= 3);
		assert.ok(Array.from(logos).some(img => (img as HTMLImageElement).src.includes('openai.png')));
		assert.ok(Array.from(logos).some(img => (img as HTMLImageElement).src.includes('anthropic.png')));
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

	test('KN-372 stats page renders daily and per-model tables', async () => {
		const { widget, store } = await mount();
		store.patch({
			route: KnoxGuiRoute.Stats,
			statsDaily: [{ day: '2026-09-26', promptTokens: 12, generatedTokens: 3400 }],
			statsByModel: [{ model: 'gpt-4o', promptTokens: 12, generatedTokens: 3400 }],
		});
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-stats"]'));
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-stats-daily"]')?.textContent?.includes('2026-09-26'));
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-stats-model"]')?.textContent?.includes('gpt-4o'));
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-stats-copy-daily"]'));
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-stats-copy-model"]'));
		store.patch({ statsDaily: [], statsByModel: [] });
		assert.ok(widget.root.querySelector('[data-testid="knox-gui-stats-empty"]'));
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
		(choice.parentElement as HTMLButtonElement).click();
		const enabled = widget.root.querySelector('[data-testid="ask-user-submit"]') as HTMLButtonElement | null;
		assert.strictEqual(enabled?.disabled, false);
		const askAfter = widget.root.querySelector('[data-testid="knox-gui-ask"]') as HTMLElement | null;
		askAfter?.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
		assert.ok(widget.root.querySelector('.knox-gui-ask-choice.selected')?.textContent?.includes('Terminal game'));
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
		assert.strictEqual(widget.root.querySelector('[data-testid="knox-gui-find"]'), null);
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
});
