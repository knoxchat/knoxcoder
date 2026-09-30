/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { knoxGuiLocalAutoApprove } from './knoxGuiAgentRequest.js';
import { knoxGuiListboxNextIndex, knoxGuiSortModelsByApiKey } from './knoxGuiCapabilities.js';
import { composerInputHistoryFromStorage, inputDocFromPlainText, MAX_COMPOSER_INPUT_HISTORY } from './knoxGuiInput.js';
import { knoxGuiNormalizeWorkspace, knoxGuiParseDraftSession, knoxGuiParseLastActiveSession, knoxGuiParseProfilePreferences, knoxGuiProfilePreferences, knoxGuiResolveProfileId, knoxGuiParsePersistedTabs, knoxGuiParsePersistedUi, knoxGuiResolveLanguage, knoxGuiSerializeDraftSession, knoxGuiSerializePersistedUi, knoxGuiStartupSession } from './knoxGuiPersist.js';
import { createInitialKnoxGuiState, IKnoxGuiHistoryItem } from './knoxGuiState.js';
import { knoxGuiContextItemFileIconName, knoxGuiContextItemOpenAction, knoxGuiMatchCodeToSymbolOrFile, knoxGuiMissingSymbolUris, knoxGuiParseSymbolMap, knoxGuiPastFileInfo, knoxGuiSymbolTooltip, patchNestedMarkdown, splitMarkdownBlocks } from './knoxGuiTranscript.js';

suite('Knox native persistence and permission helpers', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('persisted UI round-trips and drops malformed fields', () => {
		const state = { ...createInitialKnoxGuiState(), toolSettings: { builtin_run_terminal_command: 'disabled' as const }, toolGroupExcluded: ['web'], webSearchEnabled: true, permissionMode: 'acceptEdits' as const, mode: 'chat' as const };
		assert.deepStrictEqual(knoxGuiParsePersistedUi(knoxGuiSerializePersistedUi(state)), {
			toolSettings: { builtin_run_terminal_command: 'disabled' },
			toolGroupExcluded: ['web'],
			webSearchEnabled: true,
			permissionMode: 'acceptEdits',
			mode: 'chat',
			codeToEdit: [],
			overlay: null,
			addModelModalProvider: 'knoxchat',
		});
		// NP-11: redux-persist keeps session.mode (including edit) and codeToEdit so a window closed mid-edit reopens in it.
		const editing = { ...state, mode: 'edit' as const, codeToEdit: [{ filepath: 'file:///a.ts', contents: 'x' }] };
		const restored = knoxGuiParsePersistedUi(knoxGuiSerializePersistedUi(editing));
		assert.strictEqual(restored.mode, 'edit');
		assert.deepStrictEqual(restored.codeToEdit, [{ filepath: 'file:///a.ts', contents: 'x' }]);
		assert.deepStrictEqual(knoxGuiParsePersistedUi(JSON.stringify({ mode: 'bogus', codeToEdit: [{ filepath: 3 }, null, { filepath: '' }] })), { codeToEdit: [] });
		assert.deepStrictEqual(knoxGuiParsePersistedUi(JSON.stringify({ toolSettings: { a: 'maybe' }, permissionMode: 'yolo', mode: 'nope', webSearchEnabled: 'yes', overlay: 'nope' })), { toolSettings: {} });
		assert.deepStrictEqual(knoxGuiParsePersistedUi(knoxGuiSerializePersistedUi({ ...state, overlay: 'tools' })).overlay, 'tools');
		assert.strictEqual(knoxGuiParsePersistedUi(JSON.stringify({ addModelModalProvider: 'openrouter' })).addModelModalProvider, 'openrouter');
		assert.strictEqual(knoxGuiParsePersistedUi(JSON.stringify({ addModelModalProvider: 'nope' })).addModelModalProvider, undefined);
		assert.deepStrictEqual(knoxGuiParsePersistedUi('{not json'), {});
		assert.deepStrictEqual(knoxGuiParsePersistedUi(undefined), {});
	});

	test('S-03 draft session drops prompt logs and malformed items; profile preferences are per profile', () => {
		const history: IKnoxGuiHistoryItem[] = [
			{ id: 'u', role: 'user', content: 'hi' },
			{ id: 'a', role: 'assistant', content: 'yo', thinkingActive: true, promptLogs: [{ prompt: 'p' }] },
		];
		const draft = knoxGuiParseDraftSession(knoxGuiSerializeDraftSession({ sessionId: 's1', sessionTitle: 'T', history }));
		assert.deepStrictEqual(draft, {
			sessionId: 's1',
			title: 'T',
			history: [{ id: 'u', role: 'user', content: 'hi' }, { id: 'a', role: 'assistant', content: 'yo', thinkingActive: false }],
		});
		assert.deepStrictEqual(knoxGuiParseDraftSession(JSON.stringify({ sessionId: 's', history: [{ id: 1 }, { id: 'x', role: 'bot', content: '' }] }))?.history, []);
		assert.strictEqual(knoxGuiParseDraftSession(JSON.stringify({ sessionId: '', history: [] })), undefined);
		const prefs = knoxGuiParseProfilePreferences(JSON.stringify({ local: { bookmarkedSlashCommands: ['commit', 3], recentSlashCommands: ['review'] }, bad: 'x' }));
		assert.deepStrictEqual(prefs, { local: { bookmarkedSlashCommands: ['commit'], recentSlashCommands: ['review'] } });
		assert.deepStrictEqual(knoxGuiProfilePreferences(prefs, 'other'), { bookmarkedSlashCommands: [], recentSlashCommands: [] });
	});

	test('tabs and last active session parse defensively', () => {
		assert.deepStrictEqual(knoxGuiParsePersistedTabs(JSON.stringify({ tabs: [{ id: 't1', title: 'Chat 1', sessionId: 's1' }, { id: 5 }], activeTabId: 'gone' })), {
			tabs: [{ id: 't1', title: 'Chat 1', sessionId: 's1' }],
			activeTabId: 't1',
		});
		assert.strictEqual(knoxGuiParsePersistedTabs(JSON.stringify({ tabs: [] })), undefined);
		assert.deepStrictEqual(knoxGuiParseLastActiveSession(JSON.stringify({ sessionId: 's1', isEmpty: false })), { sessionId: 's1', isEmpty: false });
		assert.strictEqual(knoxGuiParseLastActiveSession(JSON.stringify({ sessionId: 's1' })), undefined);
		assert.strictEqual(knoxGuiNormalizeWorkspace('file:///repo/'), '/repo');
	});

	test('startup keeps an empty New Chat, else the last active session, else the newest workspace session', () => {
		const sessions = [{ id: 'newest' }, { id: 'older' }];
		assert.strictEqual(knoxGuiStartupSession({ workspace: 'file:///repo', lastActive: { sessionId: 'x', isEmpty: true }, sessions }), undefined);
		assert.strictEqual(knoxGuiStartupSession({ workspace: 'file:///repo', lastActive: { sessionId: 'older', isEmpty: false }, sessions }), 'older');
		assert.strictEqual(knoxGuiStartupSession({ workspace: 'file:///repo', lastActive: { sessionId: 'other-workspace', isEmpty: false }, sessions }), 'newest');
		assert.strictEqual(knoxGuiStartupSession({ workspace: 'file:///repo', lastActive: undefined, sessions: [] }), undefined);
		assert.strictEqual(knoxGuiStartupSession({ workspace: '', lastActive: undefined, sessions }), undefined);
		assert.strictEqual(knoxGuiStartupSession({ workspace: '', lastActive: { sessionId: 'older', isEmpty: false }, sessions }), 'older');
		assert.strictEqual(knoxGuiStartupSession({ workspace: 'file:///repo', lastActive: undefined, sessions: [{ id: '' }, { id: 'older' }] }), '');
	});

	test('local auto-approve follows permissions.ts ordering and guards checkpoint restore/delete', () => {
		const base = { toolSettings: {}, permissionMode: 'default' as const, sessionAllowlist: [] };
		assert.strictEqual(knoxGuiLocalAutoApprove({ ...base, name: 'builtin_read_file' }), true);
		assert.strictEqual(knoxGuiLocalAutoApprove({ ...base, name: 'builtin_ask_user', permissionMode: 'fullAuto' }), false);
		assert.strictEqual(knoxGuiLocalAutoApprove({ ...base, name: 'builtin_edit_file', toolSettings: { builtin_edit_file: 'disabled' }, permissionMode: 'fullAuto' }), false);
		assert.strictEqual(knoxGuiLocalAutoApprove({ ...base, name: 'builtin_edit_file', toolSettings: { builtin_edit_file: 'allowedWithPermission' } }), false);
		assert.strictEqual(knoxGuiLocalAutoApprove({ ...base, name: 'builtin_edit_file', toolSettings: { builtin_edit_file: 'allowedWithPermission' }, permissionMode: 'acceptEdits' }), true);
		assert.strictEqual(knoxGuiLocalAutoApprove({ ...base, name: 'builtin_generate_tests', toolSettings: { builtin_generate_tests: 'allowedWithPermission' }, permissionMode: 'acceptEdits' }), true);
		assert.strictEqual(knoxGuiLocalAutoApprove({ ...base, name: 'builtin_run_terminal_command', toolSettings: { builtin_run_terminal_command: 'allowedWithPermission' }, sessionAllowlist: ['builtin_run_terminal_command'] }), true);
		assert.strictEqual(knoxGuiLocalAutoApprove({ ...base, name: 'builtin_workspace_checkpoint', args: { action: 'restore' }, permissionMode: 'fullAuto' }), false);
		assert.strictEqual(knoxGuiLocalAutoApprove({ ...base, name: 'builtin_workspace_checkpoint', args: { action: 'create' } }), true);
	});

	test('S-06 stored language wins; otherwise zh* locales get Chinese', () => {
		assert.strictEqual(knoxGuiResolveLanguage('en', 'zh-cn'), 'en');
		assert.strictEqual(knoxGuiResolveLanguage(undefined, 'zh-TW'), 'zh');
		assert.strictEqual(knoxGuiResolveLanguage('fr', 'en-us'), 'en');
	});

	test('I-01 input history loads valid entries only, capped at 100, index past the end', () => {
		const good = inputDocFromPlainText('hello');
		const loaded = composerInputHistoryFromStorage(JSON.stringify([good, [{ type: 'paragraph', content: [{ type: 'bogus' }] }], [], 'x']));
		assert.deepStrictEqual(loaded.entries, [good]);
		assert.strictEqual(loaded.index, 1);
		assert.deepStrictEqual(composerInputHistoryFromStorage('{bad').entries, []);
		const many = Array.from({ length: MAX_COMPOSER_INPUT_HISTORY + 5 }, (_, i) => inputDocFromPlainText(`m${i}`));
		const capped = composerInputHistoryFromStorage(JSON.stringify(many));
		assert.strictEqual(capped.entries.length, MAX_COMPOSER_INPUT_HISTORY);
		assert.deepStrictEqual(capped.entries[0], many[5]);
	});

	test('I-19 model sort keeps missing-key models last; listbox keys clamp', () => {
		const sorted = knoxGuiSortModelsByApiKey([{ title: 'a', apiKey: '' }, { title: 'b' }, { title: 'c', apiKey: 'k' }]);
		assert.deepStrictEqual(sorted.map(model => model.title), ['b', 'c', 'a']);
		assert.strictEqual(knoxGuiListboxNextIndex('ArrowDown', -1, 3), 0);
		assert.strictEqual(knoxGuiListboxNextIndex('ArrowDown', 2, 3), 2);
		assert.strictEqual(knoxGuiListboxNextIndex('ArrowUp', -1, 3), 2);
		assert.strictEqual(knoxGuiListboxNextIndex('ArrowUp', 0, 3), 0);
		assert.strictEqual(knoxGuiListboxNextIndex('End', 0, 3), 2);
		assert.strictEqual(knoxGuiListboxNextIndex('Enter', 0, 3), undefined);
	});
});

suite('Knox native transcript links, fences and profiles', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const symbol = { name: 'runRound', type: 'function', filepath: '/w/src/stream.ts', content: 'function runRound() {}', range: { start: { line: 4 }, end: { line: 9 } } };

	test('C-20 inline code matches earlier files first, then symbols', () => {
		const history: IKnoxGuiHistoryItem[] = [
			{ id: 'u', role: 'user', content: 'look', contextItems: [{ name: 'stream.ts (3-8)', content: '', provider: 'file', uri: '/w/src/stream.ts' }] },
			{ id: 'a', role: 'assistant', content: 'see `stream.ts`' },
			{ id: 'u2', role: 'user', content: 'more', contextItems: [{ name: 'late.ts', content: '', provider: 'file', uri: '/w/late.ts' }] },
		];
		const info = knoxGuiPastFileInfo(history, 1, { '/w/src/stream.ts': [symbol], '/w/late.ts': [] });
		assert.deepStrictEqual(info.rifs, [{ filepath: '/w/src/stream.ts', startLine: 2, endLine: 7 }]);
		assert.deepStrictEqual(knoxGuiMatchCodeToSymbolOrFile('stream.ts', info), { kind: 'file', ref: info.rifs[0] });
		assert.deepStrictEqual(knoxGuiMatchCodeToSymbolOrFile('runRound()', info), { kind: 'symbol', symbol });
		assert.strictEqual(knoxGuiMatchCodeToSymbolOrFile('late.ts', info), undefined);
		assert.deepStrictEqual(knoxGuiMissingSymbolUris(history, { '/w/src/stream.ts': [] }), ['/w/late.ts']);
	});

	test('C-20 symbol map parsing drops malformed entries and truncates tooltips', () => {
		const parsed = knoxGuiParseSymbolMap({ '/w/a.ts': [symbol, { name: 'bad' }], '/w/b.ts': 'nope' });
		assert.deepStrictEqual(Object.keys(parsed), ['/w/a.ts']);
		assert.strictEqual(parsed['/w/a.ts'].length, 1);
		assert.strictEqual(knoxGuiSymbolTooltip({ ...symbol, content: 'x'.repeat(300) }).endsWith('\n...'), true);
		assert.strictEqual(knoxGuiSymbolTooltip({ ...symbol, content: '' }), symbol.filepath);
	});

	test('C-13 an outer fence that wraps inner fences stays one block', () => {
		const source = 'Here:\n```markdown SETUP.md\n# Setup\n\n```bash\nnpm i\n```\n```\nDone';
		assert.ok(patchNestedMarkdown(source).includes('````markdown SETUP.md'));
		const blocks = splitMarkdownBlocks(source);
		assert.deepStrictEqual(blocks.map(b => b.type), ['markdown', 'fence', 'markdown']);
		const fence = blocks[1];
		assert.ok(fence.type === 'fence' && fence.closed && fence.filepath === 'SETUP.md' && fence.code.includes('```bash\nnpm i\n```'));
	});

	test('C-13 an unclosed fence while streaming stays open', () => {
		const blocks = splitMarkdownBlocks('a\n```ts\nconst x');
		assert.deepStrictEqual(blocks.map(b => b.type), ['markdown', 'fence']);
		assert.ok(blocks[1].type === 'fence' && !blocks[1].closed && blocks[1].code === 'const x');
	});

	test('C-19 C-24 context items open a URL, a file range, the file, or a virtual document', () => {
		assert.deepStrictEqual(knoxGuiContextItemOpenAction({ name: 'Docs', content: '', url: 'https://x.dev' }), { kind: 'url', url: 'https://x.dev' });
		assert.deepStrictEqual(knoxGuiContextItemOpenAction({ name: 'a.ts (3-8)', content: '', uri: '/w/a.ts' }), { kind: 'lines', filepath: '/w/a.ts', startLine: 2, endLine: 7 });
		assert.deepStrictEqual(knoxGuiContextItemOpenAction({ name: 'a.ts', content: '', uri: '/w/a.ts' }), { kind: 'file', filepath: '/w/a.ts' });
		assert.deepStrictEqual(knoxGuiContextItemOpenAction({ name: 'Terminal', content: 'out' }), { kind: 'virtual', name: 'Terminal', content: 'out' });
		assert.strictEqual(knoxGuiContextItemFileIconName({ name: 'a.ts', content: '', uri: '/w/a.ts', description: 'src/a.ts#L3 more' }), 'src/a.ts');
		assert.strictEqual(knoxGuiContextItemFileIconName({ name: 'Terminal', content: 'out' }), undefined);
	});

	test('A-23 profile id falls back to the first available profile', () => {
		assert.strictEqual(knoxGuiResolveProfileId([], 'x'), null);
		assert.strictEqual(knoxGuiResolveProfileId(['local', 'team'], 'team'), 'team');
		assert.strictEqual(knoxGuiResolveProfileId(['local', 'team'], 'gone'), 'local');
	});
});
