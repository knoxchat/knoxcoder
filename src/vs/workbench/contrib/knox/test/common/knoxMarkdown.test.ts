/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	getTerminalCommand,
	hasVisibleCodeContent,
	initialCodeBlockExpanded,
	isTerminalCodeBlock,
	knoxAutoCloseIncompleteFences,
	knoxContextItemToRif,
	knoxHasFileExtension,
	knoxParseDisplayRange,
	knoxParseFenceInfo,
	knoxParseMarkdownBlocks,
	knoxMarkdownCodeWrap,
	knoxMarkdownDisplayRaw,
	knoxPrepareMarkdownSource,
	knoxResolveWorkspaceUri,
	knoxRifsFromHistory,
	knoxTruncateSymbolPreview,
	matchCodeToSymbolOrFile,
	parseMarkdownIntoBlocks,
	patchNestedMarkdown,
	shouldAutoExpandGeneratingCodeBlock,
	splitDisplayPath,
	isSymbolNotRif,
	getContextItemsFromHistory,
} from '../../common/knoxMarkdown.js';
import type { IKnoxChatHistoryItem } from '../../common/knoxChatTypes.js';

suite('knox markdown blocks (T6.1)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('keeps a completed code fence as its own block when a heading starts after it', () => {
		const closed = 'Intro\n\n```js\nconst a = 1;\n```';
		const next = `${closed}\n\n## Next`;
		const closedBlocks = parseMarkdownIntoBlocks(closed);
		const nextBlocks = parseMarkdownIntoBlocks(next);
		assert.ok(closedBlocks.some(block => block.includes('const a = 1;')));
		assert.ok(nextBlocks.length > closedBlocks.length);
		assert.strictEqual(nextBlocks[0], closedBlocks[0]);
	});

	test('does not treat an unclosed fence as later prose until the closer arrives', () => {
		const streaming = '```ts\nexport function foo() {\n  return 1;';
		const blocks = parseMarkdownIntoBlocks(streaming);
		const joined = blocks.join('');
		assert.ok(joined.includes('export function foo()'));
		assert.ok(!joined.includes('```\n'));
	});

	test('auto-closes an odd fence so marked can parse the last block', () => {
		const streaming = '```ts\nexport function foo() {\n  return 1;';
		const closed = knoxAutoCloseIncompleteFences(streaming);
		assert.ok(closed.endsWith('\n```'));
		assert.strictEqual(knoxAutoCloseIncompleteFences('```js\nconst a = 1;\n```'), '```js\nconst a = 1;\n```');
	});

	test('raises the outer fence when markdown contains nested fences', () => {
		const source = [
			'```markdown SETUP.md',
			'# Setup',
			'',
			'```bash',
			'npm install',
			'```',
			'```',
		].join('\n');
		const patched = patchNestedMarkdown(source);
		assert.ok(patched.startsWith('````markdown SETUP.md'));
		assert.ok(patched.trimEnd().endsWith('````'));
		assert.ok(patched.includes('```bash'));
	});

	test('parses fence language, filepath, and range', () => {
		assert.deepStrictEqual(knoxParseFenceInfo('ts src/main.ts 10-20'), {
			language: 'ts',
			relativeFilePath: 'src/main.ts',
			range: '10-20',
		});
		assert.deepStrictEqual(knoxParseFenceInfo('javascript'), {
			language: 'javascript',
			relativeFilePath: '',
			range: '',
		});
	});

	test('splits prepared source into markdown and code blocks with last-code flagged', () => {
		const blocks = knoxParseMarkdownBlocks('Hello\n\n```ts foo.ts\nconst x = 1;\n```\n\nDone', false);
		const code = blocks.filter(block => block.kind === 'code');
		assert.strictEqual(code.length, 1);
		assert.strictEqual(code[0].language, 'ts');
		assert.strictEqual(code[0].relativeFilePath, 'foo.ts');
		assert.strictEqual(code[0].code.includes('const x = 1;'), true);
		assert.strictEqual(code[0].isLast, true);
		assert.ok(blocks.some(block => block.kind === 'markdown' && block.source.includes('Hello')));
	});

	test('streaming prepare auto-closes incomplete fences', () => {
		const prepared = knoxPrepareMarkdownSource('```ts\nconst x = 1;', true);
		assert.ok(prepared.includes('const x = 1;'));
		assert.ok(prepared.trimEnd().endsWith('```'));
		assert.strictEqual(knoxPrepareMarkdownSource('hello', false), 'hello');
	});
});

suite('knox code block helpers (T6.2)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('treats blank fences as having no visible code', () => {
		assert.strictEqual(hasVisibleCodeContent(''), false);
		assert.strictEqual(hasVisibleCodeContent('\n'), false);
		assert.strictEqual(hasVisibleCodeContent('  \n  '), false);
		assert.strictEqual(hasVisibleCodeContent('const x = 1;'), true);
	});

	test('starts collapsed when a read-style preview has no code', () => {
		assert.strictEqual(initialCodeBlockExpanded(''), false);
		assert.strictEqual(initialCodeBlockExpanded('\n', false), false);
	});

	test('starts expanded when there is code unless explicitly collapsed', () => {
		assert.strictEqual(initialCodeBlockExpanded('fn main() {}'), true);
		assert.strictEqual(initialCodeBlockExpanded('fn main() {}', false), false);
		assert.strictEqual(initialCodeBlockExpanded('', true), true);
	});

	test('does not auto-expand empty generating blocks', () => {
		assert.strictEqual(shouldAutoExpandGeneratingCodeBlock(true, ''), false);
		assert.strictEqual(shouldAutoExpandGeneratingCodeBlock(true, '\n'), false);
		assert.strictEqual(shouldAutoExpandGeneratingCodeBlock(true, 'let x = 1;'), true);
		assert.strictEqual(shouldAutoExpandGeneratingCodeBlock(true, 'let x = 1;', false), false);
		assert.strictEqual(shouldAutoExpandGeneratingCodeBlock(false, 'let x = 1;'), false);
	});

	test('detects terminal fences and strips a leading dollar', () => {
		assert.strictEqual(isTerminalCodeBlock('bash', 'ls'), true);
		assert.strictEqual(isTerminalCodeBlock('sh', 'pwd'), true);
		assert.strictEqual(isTerminalCodeBlock('', 'npm install'), true);
		assert.strictEqual(isTerminalCodeBlock('ts', 'npm install'), false);
		assert.strictEqual(getTerminalCommand('$ npm test'), 'npm test');
		assert.strictEqual(getTerminalCommand('npm test'), 'npm test');
	});

	test('requires a file extension before showing the apply toolbar path', () => {
		assert.strictEqual(knoxHasFileExtension('src/main.ts'), true);
		assert.strictEqual(knoxHasFileExtension('README'), false);
		assert.strictEqual(knoxHasFileExtension('src/main'), false);
	});
});

suite('knox clickable paths (T6.4)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('splits a nested relative path into dir and filename', () => {
		assert.deepStrictEqual(splitDisplayPath('tetris/src/main.rs'), { dir: 'tetris/src/', name: 'main.rs' });
		assert.deepStrictEqual(splitDisplayPath('main.rs'), { dir: '', name: 'main.rs' });
		assert.deepStrictEqual(splitDisplayPath('.\\src\\main.rs'), { dir: 'src/', name: 'main.rs' });
	});

	test('parses 1-based display ranges from fence metadata', () => {
		assert.deepStrictEqual(knoxParseDisplayRange('483'), { startLine: 483, endLine: 483 });
		assert.deepStrictEqual(knoxParseDisplayRange('10-20'), { startLine: 10, endLine: 20 });
		assert.deepStrictEqual(knoxParseDisplayRange(''), {});
		assert.deepStrictEqual(knoxParseDisplayRange('nope'), {});
	});

	test('resolves relative, absolute, and URI filepaths against the workspace', () => {
		const folder = URI.file('/tmp/ws');
		assert.strictEqual(
			knoxResolveWorkspaceUri('src/main.rs', [folder]),
			URI.file('/tmp/ws/src/main.rs').toString(),
		);
		assert.strictEqual(
			knoxResolveWorkspaceUri('file:///Users/knox/tetris/src/main.rs', [folder]),
			'file:///Users/knox/tetris/src/main.rs',
		);
		assert.strictEqual(knoxResolveWorkspaceUri('  ', [folder]), '');
		assert.ok(knoxResolveWorkspaceUri('/abs/foo.ts', [folder]).startsWith('file:'));
	});

	test('matches inline code to a previous file or symbol', () => {
		const rifs = [{
			filepath: 'file:///ws/src/main.ts',
			range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } },
		}];
		const symbols = [{
			name: 'subtract',
			type: 'function',
			content: 'function subtract() {}',
			filepath: 'file:///ws/src/main.ts',
			range: { start: { line: 4, character: 0 }, end: { line: 8, character: 1 } },
		}];
		const file = matchCodeToSymbolOrFile('main.ts', symbols, rifs);
		assert.ok(file && !isSymbolNotRif(file));
		assert.strictEqual((file as typeof rifs[0]).filepath, 'file:///ws/src/main.ts');
		const symbol = matchCodeToSymbolOrFile('subtract(number)', symbols, rifs);
		assert.ok(symbol && isSymbolNotRif(symbol));
		assert.strictEqual(symbol.name, 'subtract');
		assert.ok(knoxTruncateSymbolPreview('a'.repeat(250)).endsWith('\n...'));
	});

	test('collects file context items up to a history index', () => {
		const history: IKnoxChatHistoryItem[] = [
			{
				message: { role: 'user', content: 'a' },
				contextItems: [{ name: 'a.ts', description: '', content: '', uri: { type: 'file', value: 'file:///ws/a.ts' } }],
			},
			{
				message: { role: 'assistant', content: 'b' },
				contextItems: [{ name: 'b.ts', description: '', content: '', uri: { type: 'file', value: 'file:///ws/b.ts' } }],
			},
		];
		assert.strictEqual(getContextItemsFromHistory(history, 0).length, 1);
		assert.strictEqual(knoxRifsFromHistory(history).length, 2);
		assert.strictEqual(knoxContextItemToRif(history[0].contextItems[0])?.filepath, 'file:///ws/a.ts');
	});

	test('displayRawMarkdown and codeWrap are independent UI flags (T3.5)', () => {
		assert.strictEqual(knoxMarkdownDisplayRaw(undefined), false);
		assert.strictEqual(knoxMarkdownDisplayRaw({ displayRawMarkdown: true }), true);
		assert.strictEqual(knoxMarkdownCodeWrap({ codeWrap: true, displayRawMarkdown: true }), true);
	});
});
