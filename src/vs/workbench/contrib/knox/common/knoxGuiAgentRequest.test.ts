/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { KNOX_CANCELED_TOOL_RESULT, KNOX_NO_RELEVANT_MEMORIES, KNOX_REDACTED_THINKING_TEXT, KNOX_TOOL_CALL_BASE_DELAY_MS, KNOX_TOOL_CALL_MAX_RETRIES, knoxGuiAccumulateChunk, knoxGuiChunkToolCalls, knoxGuiEmptyStreamText, knoxGuiFlushStreamText, knoxGuiIsCancelledToolError, knoxGuiIsRetryableToolError, knoxGuiShouldSplitForTools, knoxGuiToolFailureOutput, knoxGuiToolPreferredModel, knoxGuiToolRetryDelay, knoxGuiChunkText, knoxGuiChunkThinking, knoxGuiFallbackMessages, knoxGuiFormatAskUserAnswers, knoxGuiFormatTurnInject, knoxGuiHasUnsettledToolCalls, knoxGuiHistoryToCoreHistory, knoxGuiHistoryToSessionHistory, knoxGuiMemoryGoal, knoxGuiShouldContinueTurn, knoxGuiTurnDoomCalls, knoxGuiTurnMessages } from './knoxGuiAgentRequest.js';
import { IKnoxGuiHistoryItem, IKnoxGuiToolCall } from './knoxGuiState.js';

function call(id: string, status: IKnoxGuiToolCall['status'], output?: string): IKnoxGuiToolCall {
	return { id, name: 'builtin_read_file', arguments: '{"filepath":"a.ts"}', status, output };
}

suite('Knox native agent request helpers', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('history keeps tool calls and pairs every settled call with a tool result', () => {
		const history: IKnoxGuiHistoryItem[] = [
			{ id: 'u', role: 'user', content: 'read it', contextItems: [{ name: 'a.ts', content: 'code', provider: 'file' }], promptPreamble: 'PRE ' },
			{ id: 't', role: 'thinking', content: 'hmm' },
			{ id: 'a', role: 'assistant', content: '', toolCalls: [call('c1', 'done', 'file body'), call('c2', 'canceled'), call('c3', 'generated')] },
			{ id: 'p', role: 'assistant', content: '' },
		];
		const core = knoxGuiHistoryToCoreHistory(history);
		assert.deepStrictEqual(core.map(item => item.message.role), ['user', 'assistant', 'tool', 'tool']);
		assert.strictEqual(core[0].message.content, 'PRE read it');
		assert.deepStrictEqual(core[0].contextItems.map(item => [item.name, item.content, item.id.providerTitle]), [['a.ts', 'code', 'file']]);
		assert.deepStrictEqual(core[1].message.toolCalls?.map(item => item.id), ['c1', 'c2', 'c3']);
		assert.deepStrictEqual(core.slice(2).map(item => [item.message.toolCallId, item.message.content]), [['c1', 'file body'], ['c2', KNOX_CANCELED_TOOL_RESULT]]);
	});

	test('session save wraps native rows in message.role like ./knox', () => {
		const saved = knoxGuiHistoryToSessionHistory([
			{ id: 'u', role: 'user', content: 'hi' },
			{ id: 'a', role: 'assistant', content: '', toolCalls: [call('c1', 'done', 'file body')] },
		]);
		assert.strictEqual(saved[0].message.role, 'user');
		assert.strictEqual(saved[1].message.role, 'assistant');
		assert.strictEqual(saved[1].toolCallStates?.[0].toolCall.function.name, 'builtin_read_file');
		assert.ok(saved[0].message.role);
	});

	test('user images become imageUrl parts', () => {
		const core = knoxGuiHistoryToCoreHistory([{ id: 'u', role: 'user', content: 'see', images: ['data:x'] }]);
		assert.deepStrictEqual(core[0].message.content, [{ type: 'text', text: 'see' }, { type: 'imageUrl', imageUrl: { url: 'data:x' } }]);
	});

	test('turn continues only after the latest tool round is fully settled', () => {
		const base: IKnoxGuiHistoryItem[] = [{ id: 'u', role: 'user', content: 'go' }];
		assert.strictEqual(knoxGuiShouldContinueTurn([...base, { id: 'a', role: 'assistant', content: '', toolCalls: [call('c1', 'done'), call('c2', 'generated')] }]), false);
		assert.strictEqual(knoxGuiHasUnsettledToolCalls([...base, { id: 'a', role: 'assistant', content: '', toolCalls: [call('c1', 'calling')] }]), true);
		assert.strictEqual(knoxGuiShouldContinueTurn([...base, { id: 'a', role: 'assistant', content: '', toolCalls: [call('c1', 'done'), call('c2', 'errored')] }]), true);
		assert.strictEqual(knoxGuiShouldContinueTurn([
			...base,
			{ id: 'a', role: 'assistant', content: '', toolCalls: [call('c1', 'done')] },
			{ id: 'b', role: 'assistant', content: 'finished' },
		]), false, 'a text reply after the tools ends the turn');
		assert.strictEqual(knoxGuiShouldContinueTurn(base), false);
	});

	test('doom-loop input covers settled calls of the current turn only', () => {
		const history: IKnoxGuiHistoryItem[] = [
			{ id: 'u0', role: 'user', content: 'old' },
			{ id: 'a0', role: 'assistant', content: '', toolCalls: [call('old', 'done', 'x')] },
			{ id: 'u1', role: 'user', content: 'new' },
			{ id: 'a1', role: 'assistant', content: '', toolCalls: [call('n1', 'errored', 'boom'), call('n2', 'generated')] },
		];
		assert.deepStrictEqual(knoxGuiTurnDoomCalls(history), [{ name: 'builtin_read_file', args: '{"filepath":"a.ts"}', output: 'boom', ok: false }]);
		assert.deepStrictEqual(knoxGuiTurnMessages(history), { userMessage: 'new', assistantMessage: '' });
	});

	test('turn inject adds the memory header and drops the empty sentinel', () => {
		assert.strictEqual(knoxGuiFormatTurnInject(KNOX_NO_RELEVANT_MEMORIES, undefined), undefined);
		const inject = knoxGuiFormatTurnInject('- fact', 'Restored to cp-1');
		assert.ok(inject?.startsWith('Restored to cp-1\n\n## Relevant Memory Context\n'));
		assert.ok(inject?.endsWith('- fact'));
	});

	test('fallback transcript inlines context and puts the inject in a system message', () => {
		const core = knoxGuiHistoryToCoreHistory([{ id: 'u', role: 'user', content: 'q', contextItems: [{ name: 'a', content: 'ctx' }] }]);
		assert.deepStrictEqual(knoxGuiFallbackMessages(core, 'mem'), [
			{ role: 'system', content: 'mem' },
			{ role: 'user', content: 'ctx\n\nq' },
		]);
	});

	test('stream chunks split visible text from thinking and never stringify objects', () => {
		assert.strictEqual(knoxGuiChunkText({ role: 'assistant', content: 'hi' }), 'hi');
		assert.strictEqual(knoxGuiChunkText({ role: 'thinking', content: 'plan' }), '');
		assert.strictEqual(knoxGuiChunkText({ role: 'assistant', toolCalls: [{ id: 'x' }] }), '');
		assert.strictEqual(knoxGuiChunkText({ role: 'assistant', content: [{ type: 'text', text: 'a' }, { type: 'thinking', text: 'b' }] }), 'a');
		assert.strictEqual(knoxGuiChunkThinking({ role: 'thinking', content: 'plan' }), 'plan');
		assert.strictEqual(knoxGuiChunkThinking({ role: 'assistant', content: [{ type: 'reasoning', text: 'r' }] }), 'r');
		assert.strictEqual(knoxGuiChunkThinking({ role: 'assistant', content: 'hi' }), '');
	});

	test('memory goal prefers the plan title, else the first non-empty line', () => {
		assert.strictEqual(knoxGuiMemoryGoal('fix it\nmore', ' Ship v2 '), 'Ship v2');
		assert.strictEqual(knoxGuiMemoryGoal('\n  fix the build\nthen test'), 'fix the build');
		assert.strictEqual(knoxGuiMemoryGoal('   '), undefined);
		assert.strictEqual(knoxGuiMemoryGoal('x'.repeat(501))?.length, 503);
	});

	test('ask_user answers render as Q/A pairs', () => {
		const questions = [{ id: 'q1', prompt: 'Pick?', options: [] }, { id: 'q2', prompt: 'Why?', options: [] }];
		assert.strictEqual(knoxGuiFormatAskUserAnswers(questions, { q1: ['a', 'b'] }), 'Q: Pick?\nA: a, b\n\nQ: Why?\nA: (no answer)');
	});
});

suite('Knox native agent stream and retry helpers', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('A-12 think tags split across chunks go to reasoning, not the reply', () => {
		const acc = knoxGuiEmptyStreamText();
		for (const content of ['Hi <th', 'ink>', 'plan it</thi', 'nk> ', 'answer <']) {
			knoxGuiAccumulateChunk(acc, { role: 'assistant', content });
		}
		assert.strictEqual(acc.content.endsWith('<'), false);
		knoxGuiFlushStreamText(acc);
		assert.strictEqual(acc.content.endsWith('answer <'), true);
		assert.strictEqual(acc.inThinkTag, false);
		assert.strictEqual(acc.thinking.includes('plan it'), true);
		assert.strictEqual(acc.content.includes('answer'), true);
		assert.strictEqual(acc.content.includes('plan it'), false);
	});

	test('A-12 thinking role keeps signature and redacted blocks', () => {
		const acc = knoxGuiEmptyStreamText();
		knoxGuiAccumulateChunk(acc, { role: 'thinking', content: 'step', signature: 'sig' });
		knoxGuiAccumulateChunk(acc, { role: 'thinking', content: '', redactedThinking: 'opaque' });
		assert.strictEqual(acc.thinkingSignature, 'sig');
		assert.strictEqual(acc.redactedThinking, 'opaque');
		assert.strictEqual(acc.thinking, `step\n\n${KNOX_REDACTED_THINKING_TEXT}`);
		assert.strictEqual(acc.content, '');
	});

	test('A-13 the first tool-call delta after text splits the assistant item', () => {
		const acc = knoxGuiEmptyStreamText();
		assert.strictEqual(knoxGuiShouldSplitForTools(acc, false, 1), false);
		knoxGuiAccumulateChunk(acc, { role: 'assistant', content: 'Let me look.' });
		const incoming = knoxGuiChunkToolCalls({ tool_calls: [{ id: 'a' }], toolCalls: [{ id: 'b' }] });
		assert.strictEqual(incoming.length, 2);
		assert.strictEqual(knoxGuiShouldSplitForTools(acc, false, incoming.length), true);
		assert.strictEqual(knoxGuiShouldSplitForTools(acc, true, incoming.length), false);
		assert.strictEqual(knoxGuiShouldSplitForTools(acc, false, 0), false);
	});

	test('A-10 retry classification, backoff and failure output', () => {
		assert.strictEqual(knoxGuiIsRetryableToolError('Request timeout after 30s'), true);
		assert.strictEqual(knoxGuiIsRetryableToolError('ECONNRESET'), true);
		assert.strictEqual(knoxGuiIsRetryableToolError('File not found'), false);
		assert.strictEqual(knoxGuiIsCancelledToolError('Operation aborted'), true);
		assert.deepStrictEqual([1, 2].map(knoxGuiToolRetryDelay), [KNOX_TOOL_CALL_BASE_DELAY_MS, KNOX_TOOL_CALL_BASE_DELAY_MS * 2]);
		const failed = knoxGuiToolFailureOutput('builtin_read_file', 'boom', { attemptsUsed: KNOX_TOOL_CALL_MAX_RETRIES + 1, name: 'Tool failed', description: 'desc' });
		assert.strictEqual(failed.name, 'Tool failed');
		assert.ok(failed.content.includes('(after 3 attempts)'));
		const aborted = knoxGuiToolFailureOutput('builtin_read_file', 'boom', { unexpectedAbort: true, attemptsUsed: 1, name: 'n', description: 'd' });
		assert.ok(aborted.content.includes('was interrupted'));
	});

	test('A-10 preferred model follows the reference tool roles', () => {
		assert.strictEqual(knoxGuiToolPreferredModel('builtin_search_web', { realTimeSearch: 'r', viewRead: 'v' }), 'realTimeSearch');
		assert.strictEqual(knoxGuiToolPreferredModel('builtin_run_terminal_command', { viewRead: 'v' }), 'chat');
		assert.strictEqual(knoxGuiToolPreferredModel('builtin_read_file', { viewRead: 'v' }), 'viewRead');
		assert.strictEqual(knoxGuiToolPreferredModel('builtin_read_file', {}), undefined);
	});
});
