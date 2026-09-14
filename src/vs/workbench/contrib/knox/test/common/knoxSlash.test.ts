/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import type { IKnoxSlashCommand } from '../../common/knoxChatTypes.js';
import {
	AUTONOMOUS_SLASH_COMMAND,
	IKnoxSlashItem,
	KNOX_MAX_RECENT_SLASH_COMMANDS,
	expandPromptSlashCommand,
	extractSlashUserInput,
	groupSlashItems,
	isAutonomousCommand,
	isPromptBasedSlashCommand,
	knoxParseRecentSlashCommands,
	knoxRecordRecentSlash,
	knoxSlashCatalog,
	knoxSlashChipLabel,
	knoxSlashInsertText,
	knoxSlashTriggerAt,
	knoxSuggestSlashItems,
	parseAutonomousGoal,
	rankSlashCommands,
	scoreSlashCommand,
	shouldShowSlashSectionHeaders,
	slashCommandBareName,
	slashCommandForInput,
	slashCommandNameFromItem,
	slashCommandTitle,
	slashFuzzyNameScore,
	slashItemMatchesQuery,
	toKnoxSlashItem,
} from '../../common/knoxSlash.js';

function cmd(name: string, description: string, extra?: Partial<IKnoxSlashCommand>): IKnoxSlashCommand {
	return { name, description, ...extra };
}

function item(
	name: string,
	description: string,
	extra?: Partial<IKnoxSlashItem['metadata']>,
): IKnoxSlashItem {
	return toKnoxSlashItem(cmd(name, description), extra);
}

const catalog = [
	item('autonomous', 'Run a multi-step autonomous agent loop'),
	item('commit', 'Generate a commit message for current changes'),
	item('cmd', 'Generate a shell command'),
	item('changelog', 'Generate a changelog from recent git history'),
	item('review', 'Review code and give feedback'),
];

suite('knox slash names (T4.4)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('strips a leading slash and trims', () => {
		assert.strictEqual(slashCommandBareName('/commit'), 'commit');
		assert.strictEqual(slashCommandBareName('commit'), 'commit');
		assert.strictEqual(slashCommandBareName(' /pr '), 'pr');
		assert.strictEqual(slashCommandBareName(undefined), '');
	});

	test('formats the chip and row title with a single slash', () => {
		assert.strictEqual(slashCommandTitle('commit'), '/commit');
		assert.strictEqual(slashCommandTitle('/commit'), '/commit');
		assert.strictEqual(slashCommandTitle(''), '/');
	});

	test('reads the bare name from combo-box attrs', () => {
		assert.strictEqual(slashCommandNameFromItem({ id: '/commit', title: '/commit' }), 'commit');
		assert.strictEqual(slashCommandNameFromItem({ title: 'skills' }), 'skills');
	});
});

suite('knox slash catalog (T4.4)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('prefixes id/title/label with / and keeps the icon id bare', () => {
		const slash = toKnoxSlashItem({ name: 'commit', description: 'Generate a commit message' });
		assert.deepStrictEqual({
			id: slash.id,
			title: slash.title,
			label: slash.label,
			type: slash.type,
			icon: slash.icon,
			description: slash.description,
			slashSource: slash.metadata.slashSource,
		}, {
			id: '/commit',
			title: '/commit',
			label: '/commit',
			type: 'slashCommand',
			icon: 'commit',
			description: 'Generate a commit message',
			slashSource: 'builtin',
		});
	});

	test('marks prompt-file commands', () => {
		const slash = toKnoxSlashItem({
			name: '/deploy',
			description: 'Ship it',
			prompt: 'Deploy the current branch',
		});
		assert.strictEqual(slash.id, '/deploy');
		assert.strictEqual(slash.metadata.slashSource, 'prompt');
		assert.strictEqual(slash.metadata.bookmarked, false);
	});

	test('records bookmark and recency flags', () => {
		const slash = toKnoxSlashItem(
			{ name: 'pr', description: 'PR' },
			{ bookmarked: true, recent: true, recentIndex: 1 },
		);
		assert.deepStrictEqual(slash.metadata, {
			slashSource: 'builtin',
			bookmarked: true,
			recent: true,
			recentIndex: 1,
		});
	});

	test('inserts a /name chip with a trailing space', () => {
		assert.strictEqual(knoxSlashInsertText(item('commit', 'msg')), '/commit ');
		assert.strictEqual(knoxSlashChipLabel({ id: 'commit', label: 'commit' }), '/commit');
	});
});

suite('knox slash rank (T4.4)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('keeps the catalog on an empty query, bookmarks first', () => {
		const ranked = rankSlashCommands([
			catalog[0],
			{ ...catalog[1], metadata: { ...catalog[1].metadata, bookmarked: true } },
			catalog[2],
		], '');
		assert.deepStrictEqual(ranked.map(row => row.id), ['/commit', '/autonomous', '/cmd']);
	});

	test('ranks an exact name above a prefix sibling', () => {
		const ranked = rankSlashCommands(catalog, 'c');
		assert.strictEqual(ranked[0]?.id, '/cmd');
		assert.ok(ranked.map(row => row.id).includes('/commit'));
		assert.ok(ranked.map(row => row.id).includes('/changelog'));
	});

	test('matches a description word that is not in the name', () => {
		assert.deepStrictEqual(rankSlashCommands(catalog, 'shell').map(row => row.id), ['/cmd']);
	});

	test('matches fuzzy characters in the name (/cmt → commit)', () => {
		assert.notStrictEqual(slashFuzzyNameScore('commit', 'cmt'), null);
		assert.strictEqual(rankSlashCommands(catalog, 'cmt')[0]?.id, '/commit');
	});

	test('does not list unrelated commands for a specific query', () => {
		assert.strictEqual(slashItemMatchesQuery(catalog[4], 'zzz'), false);
		assert.deepStrictEqual(rankSlashCommands(catalog, 'zzz'), []);
	});

	test('does not keep a bookmark that fails the query', () => {
		const ranked = rankSlashCommands([
			{ ...catalog[4], metadata: { ...catalog[4].metadata, bookmarked: true } },
			catalog[1],
		], 'commit');
		assert.deepStrictEqual(ranked.map(row => row.id), ['/commit']);
	});

	test('boosts recents after bookmarks', () => {
		const ranked = rankSlashCommands([
			catalog[0],
			{ ...catalog[1], metadata: { ...catalog[1].metadata, recent: true, recentIndex: 0 } },
			{ ...catalog[2], metadata: { ...catalog[2].metadata, bookmarked: true } },
		], '');
		assert.deepStrictEqual(ranked.map(row => row.id), ['/cmd', '/commit', '/autonomous']);
	});

	test('scores a prefix higher than a description hit', () => {
		const prefix = scoreSlashCommand(item('review', 'feedback'), 'rev');
		const desc = scoreSlashCommand(item('share', 'Review the session export'), 'rev');
		assert.ok(prefix > desc);
	});
});

suite('knox slash group (T4.4)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('groups empty / into bookmarked, recent, commands, prompts', () => {
		const sections = groupSlashItems([
			item('commit', 'commit', { bookmarked: true }),
			item('review', 'review', { recent: true }),
			item('cmd', 'cmd'),
			toKnoxSlashItem(cmd('deploy', 'deploy', { prompt: 'Deploy it' })),
		], { query: '' });
		assert.deepStrictEqual(sections.map(section => section.id), ['bookmarked', 'recent', 'commands', 'prompts']);
		assert.strictEqual(sections[0]?.items[0]?.id, '/commit');
		assert.strictEqual(sections[1]?.items[0]?.id, '/review');
		assert.strictEqual(sections[2]?.items[0]?.id, '/cmd');
		assert.strictEqual(sections[3]?.items[0]?.id, '/deploy');
	});

	test('does not duplicate a bookmarked command into Recent', () => {
		const sections = groupSlashItems([
			item('commit', 'commit', { bookmarked: true, recent: true }),
		], { query: '' });
		assert.deepStrictEqual(sections.map(section => section.id), ['bookmarked']);
	});

	test('uses a single ranked list when there is a query', () => {
		const sections = groupSlashItems(
			[item('commit', 'commit'), toKnoxSlashItem(cmd('cmd', 'cmd', { prompt: 'Shell' }))],
			{ query: 'c' },
		);
		assert.deepStrictEqual(sections.map(section => section.id), ['commands']);
		assert.deepStrictEqual(sections[0]?.items.map(row => row.id), ['/commit', '/cmd']);
		assert.strictEqual(shouldShowSlashSectionHeaders(sections), false);
	});

	test('shows headers only when more than one group is present', () => {
		const mixed = groupSlashItems([
			item('commit', 'commit', { bookmarked: true }),
			item('cmd', 'cmd'),
		], { query: '' });
		assert.strictEqual(shouldShowSlashSectionHeaders(mixed), true);
		assert.strictEqual(shouldShowSlashSectionHeaders(groupSlashItems([item('cmd', 'cmd')], { query: '' })), false);
	});

	test('catalog + rank + group puts bookmarked builtin first on empty /', () => {
		const suggested = knoxSuggestSlashItems({
			commands: [
				cmd('autonomous', 'loop'),
				cmd('commit', 'msg'),
				cmd('deploy', 'ship', { prompt: 'Deploy it' }),
			],
			bookmarks: ['commit'],
			recents: ['autonomous'],
			query: '',
		});
		assert.deepStrictEqual(suggested.sections.map(section => section.id), ['bookmarked', 'recent', 'prompts']);
		assert.deepStrictEqual(suggested.items.map(row => row.id), ['/commit', '/autonomous', '/deploy']);
		assert.strictEqual(suggested.showHeaders, true);
	});
});

suite('knox slash trigger and recents (T4.4)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('triggers / at start of line and rejects mid-line or spaced queries', () => {
		assert.deepStrictEqual(knoxSlashTriggerAt('/commit', 7), { at: 0, query: 'commit' });
		assert.deepStrictEqual(knoxSlashTriggerAt('/', 1), { at: 0, query: '' });
		assert.deepStrictEqual(knoxSlashTriggerAt('  /c', 4), { at: 2, query: 'c' });
		assert.deepStrictEqual(knoxSlashTriggerAt('hello\n/rev', 10), { at: 6, query: 'rev' });
		assert.strictEqual(knoxSlashTriggerAt('hello /c', 8), undefined);
		assert.strictEqual(knoxSlashTriggerAt('/commit extra', 13), undefined);
		assert.strictEqual(knoxSlashTriggerAt('hello world', 11), undefined);
	});

	test('records recents with a cap and no duplicates', () => {
		let recents = knoxRecordRecentSlash([], '/commit');
		recents = knoxRecordRecentSlash(recents, 'review');
		recents = knoxRecordRecentSlash(recents, 'commit');
		assert.deepStrictEqual(recents, ['commit', 'review']);
		const many = Array.from({ length: 12 }, (_, index) => `cmd${index}`);
		const capped = many.reduce((list, name) => knoxRecordRecentSlash(list, name), [] as string[]);
		assert.strictEqual(capped.length, KNOX_MAX_RECENT_SLASH_COMMANDS);
		assert.strictEqual(capped[0], 'cmd11');
		assert.deepStrictEqual(knoxParseRecentSlashCommands('["/pr","review"]'), ['pr', 'review']);
		assert.deepStrictEqual(knoxParseRecentSlashCommands(undefined), []);
	});
});

suite('knox slash send path (T4.4)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('detects /autonomous and parses the goal', () => {
		assert.ok(isAutonomousCommand('/autonomous fix tests'));
		assert.ok(isAutonomousCommand('autonomous fix tests'));
		assert.strictEqual(parseAutonomousGoal('/autonomous fix tests'), 'fix tests');
		assert.strictEqual(parseAutonomousGoal('/autonomous'), '');
		assert.strictEqual(parseAutonomousGoal('/autonomous '), '');
		assert.strictEqual(AUTONOMOUS_SLASH_COMMAND, 'autonomous');
	});

	test('matches builtin vs prompt commands from typed input', () => {
		const commands: IKnoxSlashCommand[] = [
			cmd('commit', 'msg'),
			cmd('review', 'Review', { prompt: 'Review {{{ input }}}' }),
		];
		const builtin = slashCommandForInput('/commit', commands);
		assert.strictEqual(builtin?.[0].name, 'commit');
		const prompt = slashCommandForInput('/review src/a.ts', commands);
		assert.strictEqual(prompt?.[0].name, 'review');
		assert.strictEqual(slashCommandForInput('hello', commands), undefined);
	});

	test('expands prompt slash commands', () => {
		assert.strictEqual(extractSlashUserInput('/explain this file', 'explain'), 'this file');
		assert.strictEqual(extractSlashUserInput('plain text', 'explain'), 'plain text');
		assert.strictEqual(expandPromptSlashCommand('Focus on {{{ input }}} please', 'auth'), 'Focus on auth please');
		assert.strictEqual(expandPromptSlashCommand('Review carefully', 'src/a.ts'), 'Review carefully\n\nsrc/a.ts');
		assert.strictEqual(expandPromptSlashCommand('Just this', ''), 'Just this');
		assert.strictEqual(isPromptBasedSlashCommand({ prompt: 'do X' }), true);
		assert.strictEqual(isPromptBasedSlashCommand({}), false);
		assert.strictEqual(isPromptBasedSlashCommand({ prompt: '' }), false);
	});

	test('catalog flags builtin vs prompt for grouping', () => {
		const items = knoxSlashCatalog([
			cmd('commit', 'msg'),
			cmd('deploy', 'ship', { prompt: 'Deploy' }),
		], ['commit'], ['deploy']);
		assert.strictEqual(items[0]?.metadata.slashSource, 'builtin');
		assert.strictEqual(items[0]?.metadata.bookmarked, true);
		assert.strictEqual(items[1]?.metadata.slashSource, 'prompt');
		assert.strictEqual(items[1]?.metadata.recent, true);
		assert.strictEqual(items[1]?.metadata.recentIndex, 0);
	});
});
