/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	knoxAskUserItems,
	knoxAskUserShortcutIndex,
	knoxFormatAskUserAnswer,
	knoxIsAskUserAnswered,
	knoxParseAskUserQuestions,
	knoxSetAskUserChoice,
	knoxSplitChoiceText,
} from '../../common/knoxAskUser.js';
import { knoxDisplayBuildCommand } from '../../common/knoxDisplayBuildCommand.js';
import {
	knoxDirectoryFilterBadges,
	knoxExtractDirectoryContents,
	knoxExtractRepoMapContent,
	knoxFlattenRepoTreePaths,
	knoxParseTreeText,
	knoxPathsToTree,
	knoxRepoTreeStats,
	knoxShortDirectoryName,
} from '../../common/knoxRepoTree.js';
import {
	knoxCalculateFence,
	knoxDisplayArgsForToolCall,
	knoxExtractStreamingToolCode,
} from '../../common/knoxStreamingToolCode.js';
import { knoxExtractTerminalOutput } from '../../common/knoxTerminalOutput.js';
import {
	knoxCreateFileMarkdown,
	knoxFindTool,
	knoxMustacheRender,
	knoxShouldShowToolParameters,
	knoxTerminalCommandIsRunnable,
	knoxTerminalCommandLabel,
	knoxToolCardKind,
	knoxToolOutputItems,
	knoxToolStatusMessage,
} from '../../common/knoxToolCard.js';
import { knoxTaskSubagentInfo } from '../../common/knoxTaskCard.js';
import {
	knoxDetectSearchLanguage,
	knoxExactSearchQuery,
	knoxExactSearchStats,
	knoxExtractExactSearchContent,
	knoxHighlightSearchQuery,
	knoxParseExactSearchResults,
} from '../../common/knoxExactSearch.js';
import {
	knoxCollapseFileToolCodePreview,
	knoxGenericCodePreview,
	knoxGenericPreviewLanguage,
	knoxMarkdownLanguageTagForFile,
} from '../../common/knoxGenericCodePreview.js';
import {
	knoxContextItemBasename,
	knoxContextItemRange,
	knoxVisibleToolOutputItems,
} from '../../common/knoxToolOutput.js';
import type { IKnoxChatHistoryItem, IKnoxTool, IKnoxToolCallState } from '../../common/knoxChatTypes.js';
import { KnoxBuiltInToolName } from '../../common/knoxToolNames.js';
import { knoxParseTools } from '../../common/knoxToolPermissions.js';

function toolState(
	name: string,
	status: IKnoxToolCallState['status'],
	parsedArgs: unknown = {},
	raw = '{}',
): IKnoxToolCallState {
	return {
		toolCallId: 't1',
		status,
		parsedArgs,
		toolCall: { id: 't1', type: 'function', function: { name, arguments: raw } },
	};
}

suite('knox tool cards (T6.6–T6.16)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	suite('streaming tool code', () => {
		test('reads write-style parsed args', () => {
			assert.deepStrictEqual(
				knoxExtractStreamingToolCode({
					parsedArgs: { filepath: 'src/main.rs', contents: 'fn main() {}' },
				}),
				{
					filepath: 'src/main.rs',
					codeContent: 'fn main() {}',
					contentKey: 'contents',
					started: true,
				},
			);
		});

		test('accepts path aliases used by models instead of filepath', () => {
			assert.deepStrictEqual(
				knoxExtractStreamingToolCode({
					parsedArgs: { target_file: 'app.ts', new_string: 'export const x = 1;' },
				}),
				{
					filepath: 'app.ts',
					codeContent: 'export const x = 1;',
					contentKey: 'new_string',
					started: true,
				},
			);
		});

		test('prefers new_string over old_string while editing', () => {
			assert.strictEqual(
				knoxExtractStreamingToolCode({
					parsedArgs: {
						filepath: 'a.ts',
						old_string: 'const a = 1;',
						new_string: 'const a = 2;',
					},
				}).contentKey,
				'new_string',
			);
		});

		test('pulls contents from incomplete JSON before parsedArgs is ready', () => {
			const raw = '{"filepath": "game.rs", "contents": "fn handle() {\\n    match event";';
			assert.deepStrictEqual(
				knoxExtractStreamingToolCode({ parsedArgs: {}, rawArguments: raw }),
				{
					filepath: 'game.rs',
					codeContent: 'fn handle() {\n    match event',
					contentKey: 'contents',
					started: true,
				},
			);
		});

		test('marks the stream as started once a contents field opens', () => {
			assert.strictEqual(
				knoxExtractStreamingToolCode({ rawArguments: '{"contents": "' }).started,
				true,
			);
		});

		test('fills filepath from aliases so tool headers are not blank', () => {
			assert.strictEqual(
				knoxDisplayArgsForToolCall({ target_file: 'src/lib.rs' }).filepath,
				'src/lib.rs',
			);
		});

		test('lengthens fences when the contents include backticks', () => {
			assert.strictEqual(knoxCalculateFence('```rust\nfn x() {}\n```'), '````');
		});
	});

	suite('wrapper status and routing', () => {
		test('renders wouldLikeTo with Mustache filepath HTML', () => {
			const tool: IKnoxTool = {
				function: { name: KnoxBuiltInToolName.CreateNewFile },
				displayTitle: 'Create New File',
				wouldLikeTo: 'create <code class="filepath-badge">{{{ filepath }}}</code>',
			};
			const message = knoxToolStatusMessage(
				toolState(KnoxBuiltInToolName.CreateNewFile, 'generated', { filepath: 'src/a.ts' }),
				tool,
			);
			assert.ok(message.intro.includes('Would like to') || message.intro.length > 0);
			assert.ok(message.message.includes('src/a.ts'));
			assert.ok(message.message.includes('filepath-badge'));
			assert.ok(message.text.includes('src/a.ts'));
		});

		test('falls back to Agent Tool Usage without a catalog entry', () => {
			const message = knoxToolStatusMessage(
				toolState('custom_http', 'calling'),
				undefined,
			);
			assert.strictEqual(message.message, 'Agent Tool Usage');
		});

		test('hides parameters for AskUser and completed CreateFile', () => {
			assert.strictEqual(
				knoxShouldShowToolParameters(toolState(KnoxBuiltInToolName.AskUser, 'generated', { questions: [] })),
				false,
			);
			assert.strictEqual(
				knoxShouldShowToolParameters(toolState(KnoxBuiltInToolName.CreateNewFile, 'done', { filepath: 'a.ts' })),
				false,
			);
			assert.strictEqual(
				knoxShouldShowToolParameters(toolState(KnoxBuiltInToolName.CreateNewFile, 'generating', { filepath: 'a.ts' })),
				true,
			);
		});

		test('routes built-in names onto card kinds', () => {
			assert.strictEqual(knoxToolCardKind(KnoxBuiltInToolName.CreateNewFile), 'createFile');
			assert.strictEqual(knoxToolCardKind('run_terminal_command'), 'terminal');
			assert.strictEqual(knoxToolCardKind(KnoxBuiltInToolName.Build), 'terminal');
			assert.strictEqual(knoxToolCardKind(KnoxBuiltInToolName.ViewSubdirectory), 'viewSubdirectory');
			assert.strictEqual(knoxToolCardKind(KnoxBuiltInToolName.ViewRepoMap), 'viewRepoMap');
			assert.strictEqual(knoxToolCardKind(KnoxBuiltInToolName.AskUser), 'askUser');
			assert.strictEqual(knoxToolCardKind(KnoxBuiltInToolName.Task), 'task');
			assert.strictEqual(knoxToolCardKind(KnoxBuiltInToolName.ExactSearch), 'exactSearch');
			assert.strictEqual(knoxToolCardKind(KnoxBuiltInToolName.ReadFile), 'generic');
			assert.strictEqual(knoxToolCardKind(KnoxBuiltInToolName.EditFile), 'generic');
			assert.strictEqual(knoxToolCardKind(KnoxBuiltInToolName.SearchWeb), 'generic');
		});

		test('parses isCurrently / hasAlready from the tool catalog', () => {
			const tools = knoxParseTools([{
				function: { name: 'builtin_create_new_file' },
				wouldLikeTo: 'create {{{ filepath }}}',
				isCurrently: 'creating {{{ filepath }}}',
				hasAlready: 'created {{{ filepath }}}',
			}]);
			assert.strictEqual(tools[0].isCurrently, 'creating {{{ filepath }}}');
			assert.strictEqual(knoxFindTool(tools, 'create_new_file')?.function.name, 'builtin_create_new_file');
		});

		test('escapes double-brace Mustache values', () => {
			assert.strictEqual(
				knoxMustacheRender('use {{ name }}', { name: '<script>' }),
				'use &lt;script&gt;',
			);
			assert.strictEqual(
				knoxMustacheRender('use {{{ name }}}', { name: '<b>x</b>' }),
				'use <b>x</b>',
			);
		});

		test('builds a create-file markdown fence', () => {
			const md = knoxCreateFileMarkdown('README.md', '# Hi');
			assert.strictEqual(md.language, 'text');
			assert.ok(md.source.startsWith('```text README.md'));
			assert.ok(md.source.includes('# Hi'));
		});

		test('prefers the matching tool-role context items for output', () => {
			const state = toolState(KnoxBuiltInToolName.RunTerminalCommand, 'done', { command: 'ls' });
			state.output = [{ name: 'stale', description: '', content: 'old' }];
			const history: IKnoxChatHistoryItem[] = [
				{ message: { role: 'assistant', content: '', id: 'a', toolCalls: [state.toolCall] }, contextItems: [], toolCallState: state },
				{ message: { role: 'tool', content: 'out', id: 't', toolCallId: 't1' }, contextItems: [{ name: 'Terminal', description: 'Terminal command exited 0', content: 'hi' }] },
			];
			assert.strictEqual(knoxToolOutputItems(history, 0, state)[0].content, 'hi');
		});
	});

	suite('terminal family', () => {
		test('previews cargo check from action + extraArgs', () => {
			assert.strictEqual(
				knoxDisplayBuildCommand({ action: 'check', extraArgs: '--release' }),
				'cargo check --release',
			);
		});

		test('prefers an explicit command override', () => {
			assert.strictEqual(
				knoxDisplayBuildCommand({ command: 'cargo check -p foo', action: 'check' }),
				'cargo check -p foo',
			);
		});

		test('previews rustc --explain and rustdoc lookup', () => {
			assert.strictEqual(knoxDisplayBuildCommand({ explain: 'error[E0502]' }), 'rustc --explain E0502');
			assert.strictEqual(
				knoxDisplayBuildCommand({ action: 'doc', doc: 'tokio::sync::Mutex' }),
				'rustdoc tokio::sync::Mutex',
			);
		});

		test('falls back to project build', () => {
			assert.strictEqual(knoxDisplayBuildCommand(undefined), 'project build');
			assert.strictEqual(knoxDisplayBuildCommand({}), 'project build');
		});

		test('labels await/kill/list, pty, qemu, and debug the same as the GUI', () => {
			assert.strictEqual(
				knoxTerminalCommandLabel(KnoxBuiltInToolName.AwaitShell, { job_id: 'sh_1' }),
				'await sh_1',
			);
			assert.strictEqual(
				knoxTerminalCommandLabel(KnoxBuiltInToolName.AwaitShell, { job_id: 'sh_1', kill: true }),
				'kill sh_1',
			);
			assert.strictEqual(
				knoxTerminalCommandLabel(KnoxBuiltInToolName.AwaitShell, {}),
				'list shell jobs',
			);
			assert.strictEqual(
				knoxTerminalCommandLabel(KnoxBuiltInToolName.PtySend, { job_id: 'p1' }),
				'pty send p1',
			);
			assert.strictEqual(
				knoxTerminalCommandLabel(KnoxBuiltInToolName.Qemu, { action: 'start', arch: 'riscv64' }),
				'qemu riscv64',
			);
			assert.strictEqual(
				knoxTerminalCommandLabel(KnoxBuiltInToolName.Debug, { op: 'continue' }),
				'debug continue',
			);
			assert.strictEqual(
				knoxTerminalCommandLabel(KnoxBuiltInToolName.RunTerminalCommand, { command: 'ls -la' }),
				'ls -la',
			);
		});

		test('only real shell commands are re-runnable', () => {
			assert.strictEqual(knoxTerminalCommandIsRunnable(KnoxBuiltInToolName.RunTerminalCommand, 'ls'), true);
			assert.strictEqual(knoxTerminalCommandIsRunnable(KnoxBuiltInToolName.AwaitShell, 'await sh_1'), false);
		});

		test('reads the Terminal / Build context items', () => {
			assert.strictEqual(
				knoxExtractTerminalOutput([
					{ name: 'Terminal', description: 'Terminal command exited 0', content: 'hi' },
				]),
				'hi',
			);
			assert.strictEqual(
				knoxExtractTerminalOutput([
					{ name: 'Build', description: 'Terminal command running (sh_1)', content: 'Compiling foo' },
					{ name: 'Build diagnostics', description: 'clean', content: 'no errors' },
				]),
				'Compiling foo',
			);
			assert.strictEqual(knoxExtractTerminalOutput([{ name: 'Other', content: 'fallback' }]), 'fallback');
			assert.strictEqual(knoxExtractTerminalOutput(undefined), '');
		});
	});

	suite('repo trees', () => {
		test('converts a flat file list into directory nodes', () => {
			const nodes = knoxPathsToTree('src/main.ts\nsrc/lib.ts\nREADME.md\n');
			assert.strictEqual(nodes.length, 2);
			const src = nodes.find(n => n.name === 'src');
			assert.ok(src?.isDirectory);
			assert.deepStrictEqual(src?.children.map(c => c.name).sort(), ['lib.ts', 'main.ts']);
			assert.ok(knoxFlattenRepoTreePaths(nodes).includes('src/main.ts'));
		});

		test('parses box-drawing tree text with git markers', () => {
			const nodes = knoxParseTreeText([
				'├── src/',
				'│   └── main.ts [M]',
				'└── README.md',
			].join('\n'));
			assert.strictEqual(nodes[0].name, 'src');
			assert.strictEqual(nodes[0].isDirectory, true);
			assert.strictEqual(nodes[0].children[0].gitStatus, 'M');
			assert.strictEqual(nodes[1].name, 'README.md');
		});

		test('extracts subdirectory summary/structure and filter badges', () => {
			const contents = knoxExtractDirectoryContents([
				{ name: 'Summary', description: 'Analysis', content: 'Directory Analysis Summary\nTotal Files: 2\nTotal Directories: 1' },
				{ name: 'Structure', description: 'Structure', content: '├── a.ts\n└── b.ts' },
				{ name: 'Notice', description: '', content: 'truncated' },
			]);
			assert.strictEqual(contents.enhanced, true);
			assert.ok(contents.structure.includes('a.ts'));
			assert.strictEqual(contents.notice, 'truncated');
			assert.deepStrictEqual(
				knoxDirectoryFilterBadges({ fileTypes: ['.ts'], depth: 2, includeGitStatus: true }),
				['.ts', 'depth: 2', 'git'],
			);
			assert.strictEqual(knoxShortDirectoryName('src/vs/workbench'), 'workbench');
			assert.deepStrictEqual(knoxRepoTreeStats([], contents.summary), {
				files: 2,
				folders: 1,
				total: 3,
				size: undefined,
			});
		});

		test('extracts repo-map content from context items', () => {
			assert.strictEqual(
				knoxExtractRepoMapContent([
					{ name: 'repo', description: 'repo structure', content: 'a.ts\nb.ts' },
				]),
				'a.ts\nb.ts',
			);
		});
	});

	suite('AskUser', () => {
		test('parses questions and splits em-dash choice labels', () => {
			const questions = knoxParseAskUserQuestions([
				{
					prompt: 'How would you like to run/play the Rust Tetris game?',
					options: [
						'Terminal game (crossterm) — runs in your terminal',
						'Desktop GUI (e.g. bevy/macroquad) — a windowed native app',
					],
				},
			]);
			assert.strictEqual(questions[0].id, 'q1');
			const items = knoxAskUserItems(questions);
			assert.strictEqual(items[0].choices?.[1].label, 'Desktop GUI (e.g. bevy/macroquad)');
			assert.strictEqual(items[0].choices?.[1].description, 'a windowed native app');
			assert.strictEqual(knoxSplitChoiceText('plain').label, 'plain');
		});

		test('keeps explicit ids and walks multi-select answers', () => {
			const questions = knoxParseAskUserQuestions([
				{ prompt: 'Library?', options: ['zod', 'joi'] },
				{ id: 'scope', prompt: 'Scope?', options: ['auth', 'all'] },
			]);
			assert.strictEqual(questions[1].id, 'scope');
			const item = knoxAskUserItems(questions)[1];
			const next = knoxSetAskUserChoice(item, undefined, 'auth');
			assert.strictEqual(next, 'auth');
			assert.strictEqual(knoxIsAskUserAnswered(next), true);
			assert.strictEqual(knoxFormatAskUserAnswer(['a', 'b']), 'a, b');
		});

		test('maps number shortcuts onto choice indexes', () => {
			assert.strictEqual(knoxAskUserShortcutIndex('2', 'numbers'), 1);
			assert.strictEqual(knoxAskUserShortcutIndex('b', 'letters'), 1);
			assert.strictEqual(knoxAskUserShortcutIndex('x', false), -1);
		});

		test('returns no questions for invalid payloads', () => {
			assert.deepStrictEqual(knoxParseAskUserQuestions('nope'), []);
			assert.deepStrictEqual(knoxParseAskUserQuestions([{ prompt: '' }]), []);
		});
	});

	suite('TaskSubagent', () => {
		test('shows profile × explores and a truncated prompt', () => {
			const info = knoxTaskSubagentInfo({
				profile: 'explore',
				explores: ['a', 'b', 'c'],
				prompt: 'x'.repeat(180),
			}, [{ name: 'Task', description: '', content: 'found 3 files' }]);
			assert.strictEqual(info.profile, 'explore');
			assert.strictEqual(info.explores, 3);
			assert.ok(info.label.startsWith('explore ×3 — '));
			assert.ok(info.promptPreview.endsWith('…'));
			assert.strictEqual(info.output, 'found 3 files');
		});

		test('defaults to explore with no extra multiplier', () => {
			const info = knoxTaskSubagentInfo({}, undefined);
			assert.strictEqual(info.label, 'explore');
			assert.strictEqual(info.output, '');
		});
	});

	suite('ExactSearch', () => {
		test('parses ripgrep hits with match vs context lines', () => {
			const results = knoxParseExactSearchResults([
				'src/main.ts',
				'10-const a = 1;',
				'11:const query = "hello";',
				'12-return query;',
				'--',
				'README.md',
				'3:hello world',
			].join('\n'));
			assert.strictEqual(results.length, 2);
			assert.strictEqual(results[0].filePath, 'src/main.ts');
			assert.strictEqual(results[0].language, 'typescript');
			assert.strictEqual(results[0].lines[1].isMatch, true);
			assert.strictEqual(results[0].lines[0].isMatch, false);
			assert.deepStrictEqual(knoxExactSearchStats(results), { files: 2, matches: 2 });
		});

		test('extracts the search context item and highlights the query', () => {
			assert.strictEqual(
				knoxExtractExactSearchContent([
					{ name: 'Other', description: '', content: 'nope' },
					{ name: 'Exact Search', description: 'search results', content: 'a.ts\n1:hit' },
				]),
				'a.ts\n1:hit',
			);
			assert.strictEqual(knoxExactSearchQuery({ query: 'hello' }), 'hello');
			assert.strictEqual(knoxDetectSearchLanguage('app.tsx'), 'typescript');
			assert.ok(knoxHighlightSearchQuery('say hello there', 'hello').includes('knox-search-match'));
			assert.strictEqual(knoxParseExactSearchResults('No matches found').length, 0);
		});
	});

	suite('GenericCodePreview', () => {
		test('builds a markdown fence from write/edit args', () => {
			const preview = knoxGenericCodePreview(toolState(
				KnoxBuiltInToolName.WriteFile,
				'generating',
				{ filepath: 'src/lib.rs', contents: 'fn x() {}' },
			));
			assert.ok(preview);
			assert.strictEqual(preview.language, 'rust');
			assert.ok(preview.source.includes('src/lib.rs'));
			assert.ok(preview.source.includes('fn x() {}'));
			assert.strictEqual(preview.collapse, false);
		});

		test('collapses read-file previews and uses diff language for patches', () => {
			assert.strictEqual(knoxCollapseFileToolCodePreview(KnoxBuiltInToolName.ReadFile), true);
			assert.strictEqual(knoxCollapseFileToolCodePreview(KnoxBuiltInToolName.EditFile), false);
			assert.strictEqual(knoxMarkdownLanguageTagForFile('app.ts'), 'typescript');
			assert.strictEqual(knoxGenericPreviewLanguage('README.md', undefined), 'text');
			assert.strictEqual(knoxGenericPreviewLanguage('a.ts', 'patch'), 'diff');
			assert.strictEqual(
				knoxGenericCodePreview(toolState(KnoxBuiltInToolName.ReadFile, 'done')) === undefined,
				true,
			);
		});
	});

	suite('ToolOutput peek', () => {
		test('hides durable plan items and hidden rows', () => {
			assert.deepStrictEqual(knoxVisibleToolOutputItems([
				{ name: 'Plan', description: 'created', content: 'Task Execution Plan\n1. [ ] Do it' },
				{ name: 'hidden', description: '', content: 'x', hidden: true },
				{ name: 'file.ts', description: '/tmp/file.ts', content: 'hi' },
			]).map(item => item.name), ['file.ts']);
			assert.deepStrictEqual(knoxContextItemRange('file.ts (10-20)'), { startLine: 10, endLine: 20 });
			assert.strictEqual(knoxContextItemBasename('src/vs/workbench/file.ts extra'), 'file.ts');
		});
	});
});
