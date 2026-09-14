/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { timeout } from '../../../../../base/common/async.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { KnoxChatService } from '../../common/knoxChatService.js';
import type { IKnoxChatHistoryItem, IKnoxToolCallState } from '../../common/knoxChatTypes.js';
import { hasKnoxToolApproval } from '../../common/knoxGuiApproval.js';
import { KnoxBuiltInToolName } from '../../common/knoxToolNames.js';
import { createKnoxChatServiceForTest } from './knoxChatTestUtils.js';

function generatedReadTool(id = 'tc1'): IKnoxToolCallState {
	return {
		toolCallId: id,
		status: 'generated',
		parsedArgs: { filepath: 'a.ts' },
		toolCall: {
			id,
			type: 'function',
			function: { name: 'builtin_read_file', arguments: '{"filepath":"a.ts"}' },
		},
	};
}

function historyWithGeneratedTool(tool: IKnoxToolCallState): IKnoxChatHistoryItem[] {
	return [
		{ message: { role: 'user', content: 'read it', id: 'u1' }, contextItems: [] },
		{
			message: {
				role: 'assistant',
				content: '',
				id: 'a1',
				toolCalls: [tool.toolCall],
			},
			contextItems: [],
			toolCallState: tool,
			toolCallStates: [tool],
		},
	];
}

function findTool(service: KnoxChatService, id: string): IKnoxToolCallState | undefined {
	for (const item of service.history) {
		const match = item.toolCallStates?.find(state => state.toolCallId === id) ??
			(item.toolCallState?.toolCallId === id ? item.toolCallState : undefined);
		if (match) {
			return match;
		}
	}
	return undefined;
}

suite('KnoxChatService thunks', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('streamResponse streams assistant tokens into history', async () => {
		const { service, bridge } = createKnoxChatServiceForTest(store);
		await service.loadConfig();
		bridge.streamChunks = [[{ role: 'assistant', content: 'Hello' }]];

		await service.streamResponse({ content: 'hi', modifiers: { noContext: true } });

		const assistant = service.history.find(item => item.message.role === 'assistant');
		assert.strictEqual(assistant?.message.content, 'Hello');
		assert.strictEqual(service.isStreaming, false);
		assert.ok(bridge.requests.some(item => item.messageType === 'history/save'));
	});

	test('streamResponse fires onDidStreamError then rethrows', async () => {
		const { service } = createKnoxChatServiceForTest(store);
		let seen: unknown;
		store.add(service.onDidStreamError(error => { seen = error; }));
		await assert.rejects(() => service.streamResponse({ content: 'hi', modifiers: { noContext: true } }));
		assert.ok(seen instanceof Error);
	});

	test('cancelStream posts tools/cancel and kills jobs', async () => {
		const { service, bridge } = createKnoxChatServiceForTest(store);
		service.setStreaming(true);
		await service.cancelStream();
		assert.ok(bridge.posts.some(item => item.messageType === 'tools/cancel'));
		assert.ok(bridge.requests.some(item => item.messageType === 'agent/jobs'));
		assert.ok(bridge.requests.some(item => item.messageType === 'brain/cancelAutonomousLoop'));
		assert.strictEqual(service.isStreaming, false);
	});

	test('callTool executes generated tool via tools/call', async () => {
		const { service, bridge } = createKnoxChatServiceForTest(store);
		await service.loadConfig();
		const tool = generatedReadTool();
		service.replaceHistory(historyWithGeneratedTool(tool));
		bridge.handlers.set('tools/call', () => ({
			status: 'success',
			content: { contextItems: [{ name: 'file', description: 'a.ts', content: 'ok' }] },
		}));
		bridge.streamChunks = [[{ role: 'assistant', content: 'done' }]];

		await service.callTool({ toolCallId: 'tc1' });

		assert.ok(bridge.requests.some(item => item.messageType === 'tools/call'));
		assert.strictEqual(findTool(service, 'tc1')?.status, 'done');
	});

	test('callTool blocks when maxSteps is already reached', async () => {
		const { service, bridge } = createKnoxChatServiceForTest(store);
		await service.loadConfig();
		(service as unknown as { _config: { experimental: { agentMaxSteps: number } } })._config = {
			experimental: { agentMaxSteps: 1 },
		} as never;
		service.incrementToolLoopSteps();
		const tool = generatedReadTool();
		service.replaceHistory(historyWithGeneratedTool(tool));
		await service.callTool({ toolCallId: 'tc1' });
		assert.strictEqual(findTool(service, 'tc1')?.status, 'canceled');
		assert.ok(!bridge.requests.some(item => item.messageType === 'tools/call'));
	});

	test('callTool blocks a doom-loop of identical reads', async () => {
		const { service, bridge } = createKnoxChatServiceForTest(store);
		await service.loadConfig();
		const done = (id: string): IKnoxToolCallState => ({
			...generatedReadTool(id),
			status: 'done',
			output: [{ name: 'ok', description: 'ok', content: 'ok' }],
		});
		const pending = generatedReadTool('tc3');
		service.replaceHistory([
			{ message: { role: 'user', content: 'read', id: 'u1' }, contextItems: [] },
			{
				message: { role: 'assistant', content: '', id: 'a1', toolCalls: [done('tc1').toolCall, done('tc2').toolCall, pending.toolCall] },
				contextItems: [],
				toolCallStates: [done('tc1'), done('tc2'), pending],
				toolCallState: pending,
			},
		]);
		await service.callTool({ toolCallId: 'tc3' });
		assert.strictEqual(findTool(service, 'tc3')?.status, 'done');
		assert.ok(findTool(service, 'tc3')?.output?.[0]?.content?.includes('doom-loop'));
		assert.ok(!bridge.requests.some(item => item.messageType === 'tools/call'));
	});

	test('saveCurrentSession writes history/save', async () => {
		const { service, bridge } = createKnoxChatServiceForTest(store);
		service.submitEditorAndInitAtIndex(0);
		service.updateHistoryItemAtIndex(0, { message: { role: 'user', content: 'hello', id: 'u1' } });
		await service.saveCurrentSession({ generateTitle: false });
		const saved = bridge.requests.find(item => item.messageType === 'history/save');
		assert.ok(saved);
		assert.strictEqual((saved!.data as { history: unknown[] }).history.length, 2);
	});

	test('refreshSessionMetadata / rename / delete / export use history protocol', async () => {
		const { service, bridge } = createKnoxChatServiceForTest(store);
		const sessions = [
			{ sessionId: 's1', title: 'First', dateCreated: '2026-09-14T00:00:00.000Z' },
			{ sessionId: 's2', title: 'Second', dateCreated: '2026-09-13T00:00:00.000Z' },
		];
		bridge.handlers.set('history/list', () => ({ status: 'success', content: sessions }));
		bridge.handlers.set('history/load', (data: unknown) => ({
			status: 'success',
			content: {
				sessionId: (data as { id: string }).id,
				title: sessions.find(item => item.sessionId === (data as { id: string }).id)?.title ?? 'First',
				workspaceDirectory: '/tmp/ws',
				history: [{ message: { role: 'user', content: 'hello' }, contextItems: [] }],
			},
		}));

		const listed = await service.refreshSessionMetadata({});
		assert.deepStrictEqual(listed.map(item => item.sessionId), ['s1', 's2']);
		assert.strictEqual(service.allSessionMetadata.length, 2);

		await service.updateSessionTitle('s1', 'Renamed');
		assert.ok(bridge.requests.some(item => item.messageType === 'history/save'));

		await service.deleteSession('s2');
		assert.ok(bridge.requests.some(item => item.messageType === 'history/delete'));

		const exported = await service.exportSession('s1');
		assert.ok(exported?.filename.endsWith('.md'));
		assert.ok(bridge.requests.some(item => item.messageType === 'writeFile'));
		assert.ok(bridge.requests.some(item => item.messageType === 'openFile'));
	});

	test('loadConfig then loadLastSession starts a new chat when history is empty', async () => {
		const { service } = createKnoxChatServiceForTest(store);
		assert.strictEqual(await service.loadConfig(), true);
		await service.loadLastSession({ saveCurrentSession: false });
		assert.strictEqual(service.history.length, 0);
		assert.ok(service.sessionId);
	});

	test('streamResponse /autonomous runs the loop with the parsed goal', async () => {
		const { service, bridge } = createKnoxChatServiceForTest(store);
		await service.loadConfig();
		bridge.handlers.set('brain/runAutonomousLoop', () => ({
			status: 'success',
			content: { final_result: 'tests are green' },
		}));

		await service.streamResponse({ content: '/autonomous fix the tests', modifiers: { noContext: true } });

		const call = bridge.requests.find(item => item.messageType === 'brain/runAutonomousLoop');
		assert.ok(call);
		assert.strictEqual((call!.data as { goal: string }).goal, 'fix the tests');
		const assistant = service.history.find(item => item.message.role === 'assistant');
		assert.strictEqual(assistant?.message.content, 'tests are green');
		assert.ok(!bridge.streamRequests.some(item => item.messageType === 'llm/streamChat'));
	});

	test('streamResponse /autonomous without a goal throws usage', async () => {
		const { service } = createKnoxChatServiceForTest(store);
		await service.loadConfig();
		await assert.rejects(
			() => service.streamResponse({ content: '/autonomous', modifiers: { noContext: true } }),
			/Usage: \/autonomous/,
		);
	});

	test('streamResponse expands a prompt slash command before streaming', async () => {
		const { service, bridge } = createKnoxChatServiceForTest(store);
		bridge.handlers.set('config/getSerializedProfileInfo', () => ({
			status: 'success',
			content: {
				result: {
					config: {
						models: [{ title: 'TestModel', provider: 'test' }],
						slashCommands: [{ name: 'review', description: 'Review', prompt: 'Review {{{ input }}}' }],
						selectedModelByRole: { chat: { title: 'TestModel' } },
						experimental: {},
					},
				},
				profileId: 'local',
			},
		}));
		await service.loadConfig();
		bridge.streamChunks = [[{ role: 'assistant', content: 'looks good' }]];

		await service.streamResponse({ content: '/review src/a.ts', modifiers: { noContext: true } });

		const user = service.history.find(item => item.message.role === 'user');
		assert.strictEqual(user?.message.content, 'Review src/a.ts');
		const stream = bridge.streamRequests.find(item => item.messageType === 'llm/streamChat');
		assert.ok(stream);
		assert.strictEqual((stream!.data as { legacySlashCommandData?: unknown }).legacySlashCommandData, undefined);
	});

	test('streamResponse passes builtin slash commands as legacySlashCommandData', async () => {
		const { service, bridge } = createKnoxChatServiceForTest(store);
		bridge.handlers.set('config/getSerializedProfileInfo', () => ({
			status: 'success',
			content: {
				result: {
					config: {
						models: [{ title: 'TestModel', provider: 'test' }],
						slashCommands: [{ name: 'commit', description: 'Generate a commit message' }],
						selectedModelByRole: { chat: { title: 'TestModel' } },
						experimental: {},
					},
				},
				profileId: 'local',
			},
		}));
		await service.loadConfig();
		bridge.streamChunks = [[{ role: 'assistant', content: 'feat: add slash' }]];

		await service.streamResponse({ content: '/commit', modifiers: { noContext: true } });

		const stream = bridge.streamRequests.find(item => item.messageType === 'llm/streamChat');
		assert.ok(stream);
		const legacy = (stream!.data as { legacySlashCommandData?: { command?: { name?: string }; input?: string } }).legacySlashCommandData;
		assert.strictEqual(legacy?.command?.name, 'commit');
		assert.strictEqual(legacy?.input, '/commit');
	});

	test('streamResponse resolves mention chips via context/getContextItems', async () => {
		const { service, bridge } = createKnoxChatServiceForTest(store);
		await service.loadConfig();
		bridge.handlers.set('context/getContextItems', (data) => {
			const request = data as { name?: string; query?: string };
			if (request.name === 'file' && request.query === 'file:///ws/package.json') {
				return {
					status: 'success',
					content: [{
						name: 'package.json',
						description: 'package.json',
						content: '{ "name": "knox" }',
						uri: { type: 'file', value: 'file:///ws/package.json' },
					}],
				};
			}
			return { status: 'success', content: [] };
		});
		bridge.streamChunks = [[{ role: 'assistant', content: 'ok' }]];

		await service.streamResponse({
			content: '@package.json what version',
			modifiers: { noContext: true },
			editorState: {
				mentions: [{
					id: 'file:///ws/package.json',
					label: 'package.json',
					query: 'file:///ws/package.json',
					itemType: 'file',
				}],
			},
		});

		const user = service.history.find(item => item.message.role === 'user');
		assert.strictEqual(user?.contextItems[0]?.name, 'package.json');
		const stream = bridge.streamRequests.find(item => item.messageType === 'llm/streamChat');
		assert.ok(stream);
		const messages = (stream!.data as { messages: Array<{ role: string; content: unknown }> }).messages;
		const userMessage = messages.find(item => item.role === 'user');
		assert.deepStrictEqual(userMessage?.content, [
			{ type: 'text', text: '{ "name": "knox" }\n' },
			{ type: 'text', text: '@package.json what version' },
		]);
	});

	test('streamResponse packs imageUrl parts into the user message', async () => {
		const { service, bridge } = createKnoxChatServiceForTest(store);
		await service.loadConfig();
		bridge.streamChunks = [[{ role: 'assistant', content: 'saw it' }]];

		await service.streamResponse({
			content: [
				{ type: 'imageUrl', imageUrl: { url: 'data:image/png;base64,aa' } },
				{ type: 'text', text: 'what is this' },
			],
			modifiers: { noContext: true },
		});

		const user = service.history.find(item => item.message.role === 'user');
		assert.deepStrictEqual(user?.message.content, [
			{ type: 'imageUrl', imageUrl: { url: 'data:image/png;base64,aa' } },
			{ type: 'text', text: 'what is this' },
		]);
	});

	test('streamResponse in edit mode prepends the multifile prompt', async () => {
		const { service, bridge } = createKnoxChatServiceForTest(store);
		await service.loadConfig();
		service.setMode('edit');
		service.addCodeToEdit({ filepath: 'file:///tmp/ws/a.ts', contents: 'export const a = 1;' });
		service.addCodeToEdit({ filepath: 'file:///tmp/ws/b.ts', contents: 'export const b = 2;' });
		bridge.streamChunks = [[{ role: 'assistant', content: 'done' }]];

		await service.streamResponse({ content: 'rename both', modifiers: { noContext: true } });

		const user = service.history.find(item => item.message.role === 'user');
		const text = typeof user?.message.content === 'string' ? user.message.content : '';
		assert.ok(text.includes('<files>'));
		assert.ok(text.includes('export const a = 1;'));
		assert.ok(text.includes('rename both'));
	});

	test('setDefaultModel posts config/updateSelectedModel for the loaded profile', async () => {
		const { service, bridge } = createKnoxChatServiceForTest(store);
		bridge.handlers.set('config/getSerializedProfileInfo', () => ({
			status: 'success',
			content: {
				result: {
					config: {
						models: [
							{ title: 'One', provider: 'knoxchat', capabilities: { tools: true } },
							{ title: 'Two', provider: 'knoxchat', capabilities: { tools: true } },
						],
						selectedModelByRole: { chat: { title: 'One' } },
					},
				},
				profileId: 'local',
			},
		}));
		await service.loadConfig();
		service.setDefaultModel('Two');
		assert.strictEqual(service.defaultModelTitle, 'Two');
		const post = bridge.posts.find(item => item.messageType === 'config/updateSelectedModel');
		assert.deepStrictEqual(post?.data, { profileId: 'local', role: 'chat', title: 'Two' });
		assert.strictEqual(service.config?.selectedModelByRole?.chat?.title, 'Two');
	});

	test('setSelectedModelByRole posts non-chat roles and toggles the Lump section', async () => {
		const { service, bridge } = createKnoxChatServiceForTest(store);
		bridge.handlers.set('config/getSerializedProfileInfo', () => ({
			status: 'success',
			content: {
				result: {
					config: {
						models: [
							{ title: 'Chat', provider: 'knoxchat', roles: ['chat'] },
							{ title: 'Apply', provider: 'knoxchat', roles: ['apply'] },
						],
						modelsByRole: {
							chat: [{ title: 'Chat', provider: 'knoxchat' }],
							apply: [{ title: 'Apply', provider: 'knoxchat' }],
						},
						selectedModelByRole: { chat: { title: 'Chat' } },
					},
				},
				profileId: 'local',
			},
		}));
		await service.loadConfig();
		service.setSelectedModelByRole('apply', 'Apply');
		const post = bridge.posts.find(item => item.messageType === 'config/updateSelectedModel' && (item.data as { role?: string }).role === 'apply');
		assert.deepStrictEqual(post?.data, { profileId: 'local', role: 'apply', title: 'Apply' });
		assert.strictEqual(service.config?.selectedModelByRole?.apply?.title, 'Apply');

		service.toggleLumpSection('models');
		assert.strictEqual(service.lumpSection, 'models');
		service.toggleLumpSection('models');
		assert.strictEqual(service.lumpSection, undefined);

		service.submitEditorAndInitAtIndex(0);
		service.updateHistoryItemAtIndex(0, { message: { role: 'user', content: 'hello', id: 'u1' } });
		const previousId = service.sessionId;
		await service.startNewChat();
		assert.notStrictEqual(service.sessionId, previousId);
		assert.strictEqual(service.history.length, 0);
		assert.ok(bridge.requests.some(item => item.messageType === 'history/save'));
	});

	test('setSessionMode posts setAgentMode and refuses agent when tools are unsupported', async () => {
		const { service, bridge } = createKnoxChatServiceForTest(store);
		await service.loadConfig();
		await service.setSessionMode('chat');
		assert.strictEqual(service.mode, 'chat');
		await service.setSessionMode('agent');
		assert.strictEqual(service.mode, 'chat');
		assert.ok(!bridge.posts.some(item => item.messageType === 'setAgentMode' && (item.data as { active?: boolean }).active === true));

		bridge.handlers.set('config/getSerializedProfileInfo', () => ({
			status: 'success',
			content: {
				result: {
					config: {
						models: [{ title: 'AgentModel', provider: 'knoxchat', capabilities: { tools: true } }],
						selectedModelByRole: { chat: { title: 'AgentModel' } },
					},
				},
				profileId: 'local',
			},
		}));
		assert.ok(await service.loadConfig());
		await service.setSessionMode('agent');
		assert.strictEqual(service.mode, 'agent');
		const post = [...bridge.posts].reverse().find(item => item.messageType === 'setAgentMode');
		assert.deepStrictEqual(post?.data, { active: true, sessionId: service.sessionId });
	});

	test('llm/streamChat carries reasoningEffort and webSearch completion options', async () => {
		const { service, bridge } = createKnoxChatServiceForTest(store);
		bridge.handlers.set('config/getSerializedProfileInfo', () => ({
			status: 'success',
			content: {
				result: {
					config: {
						models: [{
							title: 'Thinker',
							provider: 'knoxchat',
							supportedParameters: ['reasoning_effort', 'web_search'],
							capabilities: { tools: false },
						}],
						selectedModelByRole: { chat: { title: 'Thinker' } },
					},
				},
				profileId: 'local',
			},
		}));
		await service.loadConfig();
		service.setMode('chat');
		service.setReasoningEffort('high');
		service.setWebSearchEnabled(true);
		bridge.streamChunks = [[{ role: 'assistant', content: 'ok' }]];
		await service.streamResponse({ content: 'hi', modifiers: { noContext: true } });
		const stream = bridge.streamRequests.find(item => item.messageType === 'llm/streamChat');
		assert.deepStrictEqual((stream?.data as { completionOptions?: unknown }).completionOptions, {
			reasoningEffort: 'high',
			webSearch: true,
		});
	});

	test('agent/jobUpdate feeds the running-job count used by Stop and ModeSelect', async () => {
		const { service, bridge } = createKnoxChatServiceForTest(store);
		assert.strictEqual(service.runningJobCount, 0);
		bridge.handlePush({
			messageType: 'agent/jobUpdate',
			messageId: '1',
			data: { jobs: [{ id: 'sh_1', kind: 'shell', title: 'make', status: 'running' }] },
		});
		assert.strictEqual(service.runningJobCount, 1);
		assert.strictEqual(service.backgroundJobs[0].title, 'make');
	});

	test('runAgentWorktree enter/discard updates worktree state', async () => {
		const { service, bridge } = createKnoxChatServiceForTest(store);
		bridge.handlers.set('agent/worktree', (data: unknown) => {
			const action = (data as { action?: string }).action;
			if (action === 'enter') {
				return { status: 'success', content: { ok: true, state: { enabled: true, branch: 'knox/wt', files: ['a.ts'] } } };
			}
			return { status: 'success', content: { ok: true, state: { enabled: false, files: [] } } };
		});
		await service.runAgentWorktree('enter');
		assert.strictEqual(service.worktree.enabled, true);
		assert.strictEqual(service.worktree.branch, 'knox/wt');
		await service.runAgentWorktree('discard');
		assert.strictEqual(service.worktree.enabled, false);
	});

	test('runAgentJobAction list/kill updates background jobs', async () => {
		const { service, bridge } = createKnoxChatServiceForTest(store);
		bridge.handlers.set('agent/jobs', (data: unknown) => {
			const action = (data as { action?: string }).action;
			if (action === 'kill') {
				return { status: 'success', content: { jobs: [{ id: 'sh_1', kind: 'shell', title: 'make', status: 'killed' }] } };
			}
			return { status: 'success', content: { jobs: [{ id: 'sh_1', kind: 'shell', title: 'make', status: 'running' }] } };
		});
		await service.refreshAgentJobs();
		assert.strictEqual(service.backgroundJobs[0].status, 'running');
		await service.runAgentJobAction('kill', 'sh_1');
		assert.strictEqual(service.backgroundJobs[0].status, 'killed');
	});

	test('compaction/applied ignores no-op payloads', () => {
		const { service, bridge } = createKnoxChatServiceForTest(store);
		bridge.handlePush({
			messageType: 'compaction/applied',
			messageId: 'c0',
			data: { tokensSaved: 0, originalMessageCount: 2, compactedMessageCount: 2, summarized: false, deduplicated: false, summarizationMethod: 'none' },
		});
		assert.strictEqual(service.lastCompaction, null);
	});

	test('compaction/applied stores a real compaction banner', () => {
		const { service, bridge } = createKnoxChatServiceForTest(store);
		bridge.handlePush({
			messageType: 'compaction/applied',
			messageId: 'c1',
			data: { tokensSaved: 80, originalMessageCount: 12, compactedMessageCount: 4, summarized: true, deduplicated: false, summarizationMethod: 'heuristic', summaryText: 'kept plan' },
		});
		assert.strictEqual(service.lastCompaction?.tokensSaved, 80);
		assert.strictEqual(service.lastCompaction?.summaryText, 'kept plan');
	});

	test('pin and forget injected memories go through brain/*', async () => {
		const { service, bridge } = createKnoxChatServiceForTest(store);
		service.setLastInjectedMemories([
			{ id: 7, kind: 'semantic', title: 'note', reason: 'hit', pinned: false },
			{ id: 8, kind: 'semantic', title: 'old', reason: 'hit' },
		]);
		bridge.handlers.set('brain/pinMemory', () => ({ status: 'success', content: { success: true } }));
		bridge.handlers.set('brain/deleteMemory', () => ({ status: 'success', content: { success: true } }));
		await service.pinInjectedMemory(7, false);
		assert.strictEqual(service.injectedMemories.find(item => item.id === 7)?.pinned, true);
		await service.forgetInjectedMemory(8);
		assert.deepStrictEqual(service.injectedMemories.map(item => item.id), [7]);
	});

	test('acceptOrRejectAllPending posts each done apply', async () => {
		const { service, bridge } = createKnoxChatServiceForTest(store);
		service.updateApplyState({ streamId: 's1', status: 'done', filepath: '/tmp/a.ts' });
		service.updateApplyState({ streamId: 's2', status: 'streaming', filepath: '/tmp/b.ts' });
		assert.strictEqual(service.pendingApplyStates.length, 1);
		await service.acceptOrRejectAllPending('rejectDiff');
		assert.ok(bridge.posts.some(post => post.messageType === 'rejectDiff' && (post.data as { streamId: string }).streamId === 's1'));
		assert.ok(!bridge.posts.some(post => post.messageType === 'rejectDiff' && (post.data as { streamId: string }).streamId === 's2'));
	});

	test('setToolGenerated auto-approves when the current tool needs no UI (T6.16)', async () => {
		const { service, bridge } = createKnoxChatServiceForTest(store);
		await service.loadConfig();
		service.submitEditorAndInitAtIndex(0);
		service.streamUpdate([{
			role: 'assistant',
			content: '',
			toolCalls: [{
				id: 'tc1',
				type: 'function',
				function: { name: 'builtin_read_file', arguments: '{"filepath":"a.ts"}' },
			}],
		}]);
		bridge.handlers.set('tools/call', () => ({
			status: 'success',
			content: { contextItems: [{ name: 'file', description: 'a.ts', content: 'ok' }] },
		}));
		service.setToolGenerated();
		assert.strictEqual(service.history.at(-1)?.toolCallState?.status, 'generated');
		assert.strictEqual(service.isCurrentToolAutoApproved, true);
		await timeout(20);
		assert.ok(bridge.requests.some(item => item.messageType === 'tools/call'));
	});

	test('T12.2 send → stream tokens → tool card → approve → continue', async () => {
		const { service, bridge } = createKnoxChatServiceForTest(store);
		bridge.handlers.set('config/getSerializedProfileInfo', () => ({
			status: 'success',
			content: {
				result: {
					config: {
						models: [{ title: 'TestModel', provider: 'knoxchat', capabilities: { tools: true } }],
						tools: [{ function: { name: KnoxBuiltInToolName.EditFile }, readonly: false }],
						selectedModelByRole: { chat: { title: 'TestModel' } },
						experimental: {},
					},
				},
				profileId: 'local',
			},
		}));
		await service.loadConfig();
		service.applyToolPermissionPreset('safe');
		service.setMode('agent');
		service.setPermissionMode('default');
		bridge.streamChunks = [[{
			role: 'assistant',
			content: 'I will edit the file.',
			toolCalls: [{
				id: 'tc-edit',
				type: 'function',
				function: { name: KnoxBuiltInToolName.EditFile, arguments: '{"filepath":"a.ts"}' },
			}],
		}]];
		bridge.handlers.set('tools/call', () => ({
			status: 'success',
			content: { contextItems: [{ name: 'edit', description: 'a.ts', content: 'patched' }] },
		}));

		const pending = service.streamResponse({ content: 'edit a.ts', modifiers: { noContext: true } });
		for (let i = 0; i < 80 && !hasKnoxToolApproval('tc-edit'); i++) {
			await timeout(15);
		}
		assert.ok(hasKnoxToolApproval('tc-edit'), 'agent loop should wait for native Approve');
		assert.strictEqual(findTool(service, 'tc-edit')?.status, 'generated');
		assert.strictEqual(service.isCurrentToolAutoApproved, false);

		bridge.streamChunks = [[{ role: 'assistant', content: 'done' }]];
		service.approveTool('tc-edit');
		await pending;

		assert.ok(bridge.requests.some(item => item.messageType === 'tools/call'));
		assert.strictEqual(findTool(service, 'tc-edit')?.status, 'done');
		const assistants = service.history.filter(item => item.message.role === 'assistant');
		assert.ok(assistants.some(item => String(item.message.content).includes('done')));
		assert.strictEqual(service.isStreaming, false);
	});
});

