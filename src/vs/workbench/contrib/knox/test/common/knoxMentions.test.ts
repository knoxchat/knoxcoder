/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { timeout } from '../../../../../base/common/async.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IKnoxContextProviderDescription } from '../../common/knoxChatTypes.js';
import {
	EMPTY_QUERY_FILE_LIMIT,
	KNOX_PROMPT_FILE_SUBMENU_TITLE,
	LIVE_MENTION_DEBOUNCE_MS,
	LIVE_MENTION_SEARCH_CAP,
	MENTION_LOADING_ID,
	MENTION_TRUNCATED_ID,
	IKnoxMentionItem,
	attachMentionSubActions,
	buildTopLevelMentionItems,
	createKnoxDebouncedLiveFileSearch,
	getMentionOpenUri,
	groupMentionItems,
	isFolderMention,
	isOpenableMentionRow,
	jumpMentionIndex,
	knoxMentionContextProviderName,
	knoxMentionInsertText,
	knoxMentionOptionId,
	knoxMentionSubAction,
	knoxMentionTriggerAt,
	knoxNewPromptFileItem,
	mentionChipLabel,
	mentionChipTooltip,
	mentionIndexIsTruncated,
	mentionItemMatchesQuery,
	mentionListKeyAction,
	mergeLiveMentionItems,
	mergeMatchingLiveMentionItems,
	pathMentionItemType,
	rankMentionItems,
	shouldLiveSearchMentions,
	shouldOfferNewPromptFile,
	shouldShowMentionSectionHeaders,
	wrapMentionIndex,
} from '../../common/knoxMentions.js';

function provider(
	title: string,
	displayTitle: string,
	extra?: Partial<IKnoxContextProviderDescription>,
): IKnoxContextProviderDescription {
	return {
		title,
		displayTitle,
		description: `${displayTitle} desc`,
		type: extra?.type ?? 'normal',
		...extra,
	};
}

const defaultProviders: IKnoxContextProviderDescription[] = [
	provider('file', 'File | Folder', { type: 'submenu' }),
	provider('diff', 'Git Diff'),
	provider('problems', 'Problems'),
	provider('terminal', 'Terminal'),
	provider('memory', 'Project Memory', { type: 'query' }),
];

function fileHit(title: string, id: string, extra?: Partial<{ icon: string; description: string }>): {
	id: string;
	title: string;
	description: string;
	providerTitle: string;
	icon: string;
} {
	return {
		id,
		title,
		description: extra?.description ?? id.replace('file:///ws/', ''),
		providerTitle: 'file',
		icon: extra?.icon ?? 'file',
	};
}

function fileItem(title: string, extra?: Partial<IKnoxMentionItem>): IKnoxMentionItem {
	return {
		title,
		description: extra?.description ?? title,
		id: extra?.id ?? `file:///ws/${title}`,
		type: extra?.type ?? 'file',
		icon: extra?.icon ?? 'file',
		query: extra?.query ?? `file:///ws/${title}`,
		...extra,
	};
}

suite('knox mentions buildTopLevel (T4.3 / MN-02)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('puts file hits first for a filename query without entering a submenu', () => {
		const items = buildTopLevelMentionItems({
			query: 'core.ts',
			providers: defaultProviders,
			submenuItems: [
				fileHit('core.ts', 'file:///ws/core/core.ts'),
				fileHit('MentionExtension.ts', 'file:///ws/gui/MentionExtension.ts'),
			],
		});
		assert.strictEqual(items[0]?.title, 'core.ts');
		assert.strictEqual(items[0]?.type, 'file');
		assert.strictEqual(items[0]?.query, 'file:///ws/core/core.ts');
		assert.ok(!items.some(item => item.type === 'contextProvider'));
	});

	test('types folder hits as folder so they group and resolve as directories', () => {
		const items = buildTopLevelMentionItems({
			query: 'gui',
			providers: defaultProviders,
			submenuItems: [
				fileHit('gui', 'file:///ws/gui', { icon: 'folder', description: 'gui' }),
				fileHit('gui.ts', 'file:///ws/gui.ts'),
			],
		});
		assert.strictEqual(items.find(item => item.title === 'gui')?.type, 'folder');
		assert.strictEqual(items.find(item => item.title === 'gui.ts')?.type, 'file');
	});

	test('shows the File provider and files whose names start with file', () => {
		const items = buildTopLevelMentionItems({
			query: 'file',
			providers: defaultProviders,
			submenuItems: [
				fileHit('file.ts', 'file:///ws/file.ts'),
				fileHit('FileFolderContextProvider.ts', 'file:///ws/FileFolder.ts'),
			],
		});
		const titles = items.map(item => item.title);
		assert.ok(titles.includes('File | Folder'));
		assert.ok(titles.includes('file.ts'));
		assert.ok(titles.indexOf('file.ts') < titles.indexOf('File | Folder'));
	});

	test('keeps Git Diff when the query is diff and still lists matching files below', () => {
		const items = buildTopLevelMentionItems({
			query: 'diff',
			providers: defaultProviders,
			submenuItems: [fileHit('diff.ts', 'file:///ws/gui/diff.ts')],
		});
		const titles = items.map(item => item.title);
		assert.ok(titles.includes('Git Diff'));
		assert.ok(titles.includes('diff.ts'));
		assert.ok(titles.indexOf('diff.ts') < titles.indexOf('Git Diff'));
	});

	test('on empty query shows a handful of files then providers, not thousands of paths', () => {
		const submenuItems = Array.from({ length: 200 }, (_, i) => fileHit(`f${i}.ts`, `file:///ws/f${i}.ts`));
		const items = buildTopLevelMentionItems({
			query: '',
			providers: defaultProviders,
			submenuItems,
		});
		const files = items.filter(item => item.type === 'file');
		const providers = items.filter(item => item.type === 'contextProvider');
		assert.strictEqual(files.length, EMPTY_QUERY_FILE_LIMIT);
		assert.deepStrictEqual(providers.map(item => item.id), ['file', 'diff', 'problems', 'terminal', 'memory']);
		assert.strictEqual(items.length, EMPTY_QUERY_FILE_LIMIT + defaultProviders.length);
	});
});

suite('knox mentions rank (T4.3 / MN-03)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	function item(title: string, description: string, extra?: Partial<IKnoxMentionItem>): IKnoxMentionItem {
		return {
			id: extra?.id ?? `file:///ws/${description}`,
			title,
			description,
			type: extra?.icon === 'folder' ? 'folder' : 'file',
			icon: extra?.icon ?? 'file',
			score: extra?.score,
			...extra,
		};
	}

	test('keeps every row when the query is empty and drops unrelated fallback rows', () => {
		assert.strictEqual(mentionItemMatchesQuery(item('README.md', 'README.md'), ''), true);
		assert.strictEqual(mentionItemMatchesQuery(item('README.md', 'README.md'), 'core.ts'), false);
		assert.strictEqual(mentionItemMatchesQuery(item('core.ts', 'core/core.ts'), 'core.ts'), true);
	});

	test('ranks an exact basename above a fuzzy path that only contains core', () => {
		const ranked = rankMentionItems(
			[item('util.ts', 'core/util.ts', { score: 80 }), item('core.ts', 'core/core.ts', { score: 10 })],
			'core.ts',
		);
		assert.deepStrictEqual(ranked.map(row => row.title), ['core.ts', 'util.ts']);
	});

	test('puts a matching open file at the top', () => {
		const open = item('core.ts', 'core/core.ts', { id: 'file:///ws/open/core.ts', score: 1 });
		const other = item('core.ts', 'pkg/core.ts', { id: 'file:///ws/pkg/core.ts', score: 90 });
		const ranked = rankMentionItems([other, open], 'core.ts', [open.id!]);
		assert.strictEqual(ranked[0]?.id, open.id);
	});

	test('prefers the shorter path among exact basename matches and files over folders', () => {
		const shorter = rankMentionItems(
			[item('core.ts', 'src/deep/nested/core.ts'), item('core.ts', 'core.ts')],
			'core.ts',
		);
		assert.strictEqual(shorter[0]?.description, 'core.ts');

		const fileFirst = rankMentionItems(
			[item('notes', 'a/notes', { icon: 'folder' }), item('notes', 'b/notes', { icon: 'file' })],
			'notes',
		);
		assert.strictEqual(fileFirst[0]?.icon, 'file');
		assert.strictEqual(fileFirst[1]?.icon, 'folder');
	});

	test('matches nested relative paths and camelCase tokens in the basename', () => {
		const nested = rankMentionItems(
			[item('App.tsx', 'gui/src/components/App.tsx'), item('util.ts', 'core/util.ts')],
			'gui/src/components',
		);
		assert.strictEqual(nested[0]?.description, 'gui/src/components/App.tsx');
		assert.strictEqual(
			mentionItemMatchesQuery(item('App.tsx', 'gui/src/components/App.tsx'), 'gui/src/components'),
			true,
		);

		const camel = rankMentionItems(
			[item('util.ts', 'gui/util.ts'), item('MentionExtension.ts', 'gui/src/MentionExtension.ts')],
			'mention',
		);
		assert.strictEqual(camel[0]?.title, 'MentionExtension.ts');
	});
});

suite('knox mentions group (T4.3 / MN-10)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('groups empty @ as Open then Providers', () => {
		const sections = groupMentionItems(
			[
				fileItem('App.tsx'),
				fileItem('editorConfig.ts'),
				fileItem('File | Folder', { type: 'contextProvider', id: 'file', icon: undefined }),
				fileItem('Git Diff', { type: 'contextProvider', id: 'diff', icon: undefined }),
			],
			{ query: '' },
		);
		assert.deepStrictEqual(sections.map(section => section.id), ['open', 'providers']);
		assert.deepStrictEqual(sections[0]?.items.map(row => row.title), ['App.tsx', 'editorConfig.ts']);
		assert.deepStrictEqual(sections[1]?.items.map(row => row.id), ['file', 'diff']);
	});

	test('groups a query as Files, Folders, then Providers', () => {
		const sections = groupMentionItems(
			[
				fileItem('core.ts', { description: 'core/core.ts' }),
				fileItem('core', { icon: 'folder', description: 'core/' }),
				fileItem('File | Folder', { type: 'contextProvider', id: 'file', icon: undefined }),
			],
			{ query: 'core' },
		);
		assert.deepStrictEqual(sections.map(section => section.id), ['files', 'folders', 'providers']);
		assert.strictEqual(sections[0]?.items[0]?.title, 'core.ts');
		assert.strictEqual(sections[1]?.items[0]?.title, 'core');
	});

	test('drops loading and truncated utility rows from sections', () => {
		const sections = groupMentionItems(
			[
				fileItem('Loading', { id: MENTION_LOADING_ID, type: 'action' }),
				fileItem('core.ts'),
				fileItem('truncated', { id: MENTION_TRUNCATED_ID, type: 'action' }),
			],
			{ query: 'core' },
		);
		assert.strictEqual(sections.length, 1);
		assert.deepStrictEqual(sections[0]?.items.map(row => row.title), ['core.ts']);
	});

	test('section headers: slash-only hides, empty @ providers show, submenu only when mixed', () => {
		assert.strictEqual(
			shouldShowMentionSectionHeaders(groupMentionItems([fileItem('/commit', { type: 'slashCommand', icon: undefined })], { query: '' })),
			false,
		);
		assert.strictEqual(
			shouldShowMentionSectionHeaders(groupMentionItems([fileItem('Git Diff', { type: 'contextProvider', id: 'diff', icon: undefined })], { query: '' })),
			true,
		);
		assert.strictEqual(
			shouldShowMentionSectionHeaders(groupMentionItems([fileItem('core.ts'), fileItem('gui', { icon: 'folder' })], { query: '', inSubmenu: 'file' }), 'file'),
			true,
		);
		assert.strictEqual(
			shouldShowMentionSectionHeaders(groupMentionItems([fileItem('core.ts')], { query: '', inSubmenu: 'file' }), 'file'),
			false,
		);
	});

	test('reads the truncated marker', () => {
		assert.deepStrictEqual(
			mentionIndexIsTruncated([{ id: MENTION_TRUNCATED_ID, metadata: { truncated: true, truncatedCount: 10_000 } }]),
			{ truncated: true, count: 10_000 },
		);
		assert.deepStrictEqual(mentionIndexIsTruncated([{ id: 'file.ts' }]), { truncated: false, count: 10_000 });
	});
});

suite('knox mentions keyboard (T4.3 / MN-11)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('wraps, jumps Home/End, selects on Enter/Tab, and Space only for a single item', () => {
		assert.strictEqual(wrapMentionIndex(2, 3, 1), 0);
		assert.deepStrictEqual(mentionListKeyAction('ArrowDown', 2, 3), { type: 'move', index: 0 });
		assert.strictEqual(wrapMentionIndex(0, 3, -1), 2);
		assert.deepStrictEqual(mentionListKeyAction('ArrowUp', 0, 3), { type: 'move', index: 2 });
		assert.strictEqual(jumpMentionIndex(4, 'home'), 0);
		assert.strictEqual(jumpMentionIndex(4, 'end'), 3);
		assert.deepStrictEqual(mentionListKeyAction('Home', 2, 4), { type: 'move', index: 0 });
		assert.deepStrictEqual(mentionListKeyAction('End', 0, 4), { type: 'move', index: 3 });
		assert.deepStrictEqual(mentionListKeyAction('Enter', 1, 3), { type: 'select' });
		assert.deepStrictEqual(mentionListKeyAction('Tab', 1, 3), { type: 'select' });
		assert.deepStrictEqual(mentionListKeyAction('Escape', 1, 3), { type: 'close' });
		assert.deepStrictEqual(mentionListKeyAction(' ', 0, 1), { type: 'select' });
		assert.deepStrictEqual(mentionListKeyAction(' ', 0, 3), { type: 'ignore' });
		assert.strictEqual(wrapMentionIndex(0, 0, 1), 0);
		assert.strictEqual(jumpMentionIndex(0, 'end'), 0);
		assert.strictEqual(knoxMentionOptionId(4), 'mention-option-4');
	});
});

suite('knox mentions live search (T4.3 / MN-04)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('merges unique live hits after MiniSearch rows and only matching extras', () => {
		const existing = [fileItem('core.ts')];
		const live = [fileItem('core.ts'), fileItem('brand-new-xyz.ts')];
		assert.deepStrictEqual(mergeLiveMentionItems(existing, live).map(item => item.title), ['core.ts', 'brand-new-xyz.ts']);
		assert.deepStrictEqual(mergeMatchingLiveMentionItems(existing, live, 'core').map(item => item.title), ['core.ts']);
		assert.deepStrictEqual(mergeMatchingLiveMentionItems(existing, live, 'brand').map(item => item.title), ['core.ts', 'brand-new-xyz.ts']);
	});

	test('skips live search when there are enough path hits, a short query, or only slash commands', () => {
		const many = Array.from({ length: 8 }, (_, i) => fileItem(`file${i}.ts`));
		assert.strictEqual(shouldLiveSearchMentions('file', many), false);
		assert.strictEqual(shouldLiveSearchMentions('xy', [fileItem('a.ts')]), true);
		assert.strictEqual(shouldLiveSearchMentions('x', [fileItem('a.ts')]), false);
		assert.strictEqual(shouldLiveSearchMentions('co', [{ title: '/commit', description: 'Generate a commit message', id: '/commit', type: 'slashCommand' }]), false);
	});

	test('debounces requests and only calls Core once', async () => {
		let calls = 0;
		let lastQuery: string | undefined;
		const search = createKnoxDebouncedLiveFileSearch(async (query, limit) => {
			calls += 1;
			lastQuery = query;
			assert.strictEqual(limit, LIVE_MENTION_SEARCH_CAP);
			return [fileItem('brand-new-xyz.ts')];
		}, LIVE_MENTION_DEBOUNCE_MS);
		const first = search('brand');
		const second = search('brand-new');
		await timeout(LIVE_MENTION_DEBOUNCE_MS + 20);
		const [a, b] = await Promise.all([first, second]);
		assert.strictEqual(calls, 1);
		assert.strictEqual(lastQuery, 'brand-new');
		assert.strictEqual(a[0]?.title, 'brand-new-xyz.ts');
		assert.strictEqual(b[0]?.title, 'brand-new-xyz.ts');
	});
});

suite('knox mentions chips, sub-actions, and prompt file (T4.3)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('parses the @ trigger until a space and not across newlines', () => {
		assert.deepStrictEqual(knoxMentionTriggerAt('hello @core.ts', 14), { at: 6, query: 'core.ts' });
		assert.strictEqual(knoxMentionTriggerAt('hello @core.ts more', 19), undefined);
		assert.strictEqual(knoxMentionTriggerAt('hello world', 11), undefined);
		assert.deepStrictEqual(knoxMentionTriggerAt('@', 1), { at: 0, query: '' });
	});

	test('file and folder chips resolve through the file provider', () => {
		assert.strictEqual(knoxMentionContextProviderName({ id: 'file:///ws/gui', itemType: 'folder' }), 'file');
		assert.strictEqual(knoxMentionContextProviderName({ id: 'diff', itemType: 'contextProvider' }), 'diff');
		assert.strictEqual(mentionChipLabel({ label: 'core.ts', id: 'file:///ws/core.ts' }), '@core.ts');
		assert.strictEqual(getMentionOpenUri({ itemType: 'file', query: 'file:///ws/core/core.ts' }), 'file:///ws/core/core.ts');
		assert.strictEqual(getMentionOpenUri({ itemType: 'contextProvider', id: 'diff' }), null);
		assert.strictEqual(mentionChipTooltip({ itemType: 'file', description: 'core/core.ts' }), 'core/core.ts');
		assert.strictEqual(isFolderMention({ itemType: 'file', icon: 'folder' }), true);
	});

	test('sub-actions open files and leave providers alone', () => {
		assert.strictEqual(pathMentionItemType('folder'), 'folder');
		assert.strictEqual(pathMentionItemType('file', 'file'), 'file');
		assert.strictEqual(isOpenableMentionRow({ type: 'contextProvider' }), false);
		assert.strictEqual(isOpenableMentionRow({ type: 'file', icon: 'file' }), true);
		assert.strictEqual(knoxMentionSubAction(fileItem('core.ts', { query: 'file:///ws/core/core.ts' })), 'openFile');
		assert.strictEqual(knoxMentionSubAction({ id: 'diff', type: 'contextProvider' }), undefined);
		const attached = attachMentionSubActions([
			fileItem('core.ts', { query: 'file:///ws/core/core.ts' }),
			{ title: 'Git Diff', description: 'diff', id: 'diff', type: 'contextProvider' },
		]);
		assert.strictEqual(attached[0]?.actionId, 'openFile');
		assert.strictEqual(attached[1]?.actionId, undefined);
	});

	test('submenu File | Folder keeps @, query providers wait for IQuickInputService, files insert chips', () => {
		assert.strictEqual(knoxMentionInsertText({ title: 'File | Folder', description: '', type: 'contextProvider', actionId: 'enterSubmenu' }), '');
		assert.strictEqual(knoxMentionInsertText({ title: 'Project Memory', description: '', type: 'contextProvider', actionId: 'queryProvider' }), '');
		assert.strictEqual(knoxMentionInsertText({ title: 'Project Memory', description: '', type: 'contextProvider', actionId: 'queryProvider', label: 'Project Memory' }, 'auth'), '@Project Memory: auth ');
		assert.strictEqual(knoxMentionInsertText(fileItem('core.ts')), '@core.ts ');
	});

	test('adds the new .prompt file action in the prompts submenu', () => {
		assert.strictEqual(shouldOfferNewPromptFile(KNOX_PROMPT_FILE_SUBMENU_TITLE, 'file'), true);
		assert.strictEqual(shouldOfferNewPromptFile('Files', 'file'), false);
		assert.strictEqual(shouldOfferNewPromptFile(undefined, 'prompts'), true);
		assert.strictEqual(knoxNewPromptFileItem().actionId, 'newPromptFile');
	});
});
