/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	KNOX_MEMORY_PROTOCOL,
	KNOX_MEMORY_TABS,
	knoxFilterAndSortMemories,
	knoxFormatConsolidateResult,
	knoxGroupMemoriesByDate,
	knoxImportLooksValid,
	knoxImportNeedsPassword,
	knoxMemoriesToExportJson,
	knoxMemoriesToExportMarkdown,
	knoxMemorySearchPayload,
	knoxMemorySettingSections,
	knoxMemorySnippet,
	knoxParseBacklogMatches,
	knoxParseBrainSessions,
	knoxParseDashboard,
	knoxParseExploreResult,
	knoxParseGraphEntities,
	knoxParseMemoryConfig,
	knoxParseMemoryList,
	knoxRangeSelectIds,
	type IKnoxMemoryItem,
} from '../../common/knoxMemory.js';

function mem(partial: Partial<IKnoxMemoryItem> & Pick<IKnoxMemoryItem, 'id' | 'title'>): IKnoxMemoryItem {
	return {
		category: 'fact',
		content: partial.content ?? partial.title,
		keywords: '',
		importance_score: 0.5,
		retrieval_count: 0,
		tier: 'warm',
		created_at: '2026-08-16T00:00:00.000Z',
		last_accessed_at: null,
		source_session_id: null,
		...partial,
	};
}

suite('knox memory (T8.1–T8.7)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('exposes the five native memory tabs', () => {
		assert.deepStrictEqual([...KNOX_MEMORY_TABS], ['overview', 'browser', 'sessions', 'graph', 'settings']);
	});

	test('reuses existing brain/* and memory/* protocol names', () => {
		assert.strictEqual(KNOX_MEMORY_PROTOCOL.dashboard, 'brain/dashboard');
		assert.strictEqual(KNOX_MEMORY_PROTOCOL.searchMemories, 'brain/searchMemories');
		assert.strictEqual(KNOX_MEMORY_PROTOCOL.listSessions, 'brain/listSessions');
		assert.strictEqual(KNOX_MEMORY_PROTOCOL.searchEntities, 'brain/searchEntities');
		assert.strictEqual(KNOX_MEMORY_PROTOCOL.getConfig, 'brain/getConfig');
		assert.strictEqual(KNOX_MEMORY_PROTOCOL.buildContext, 'memory/buildContext');
		assert.strictEqual(KNOX_MEMORY_PROTOCOL.postTurn, 'memory/postTurn');
		for (const name of Object.values(KNOX_MEMORY_PROTOCOL)) {
			assert.ok(name.startsWith('brain/') || name.startsWith('memory/'), name);
		}
	});

	test('filters by category, tier, and pin, then sorts', () => {
		const items = [
			mem({ id: 1, title: 'A', category: 'decision', tier: 'hot', pinned: true, importance_score: 0.2, retrieval_count: 9 }),
			mem({ id: 2, title: 'B', category: 'fact', tier: 'cold', pinned: false, importance_score: 0.9, retrieval_count: 1 }),
			mem({ id: 3, title: 'C', category: 'fact', tier: 'hot', pinned: true, importance_score: 0.7, retrieval_count: 4 }),
		];
		assert.deepStrictEqual(knoxFilterAndSortMemories(items, { category: 'fact' }).map(item => item.id).sort(), [2, 3]);
		assert.deepStrictEqual(knoxFilterAndSortMemories(items, { tier: 'hot' }).map(item => item.id).sort(), [1, 3]);
		assert.deepStrictEqual(knoxFilterAndSortMemories(items, { pinned: 'pinned' }).map(item => item.id).sort(), [1, 3]);
		assert.deepStrictEqual(knoxFilterAndSortMemories(items, { sortBy: 'importance' }).map(item => item.id), [2, 3, 1]);
		assert.deepStrictEqual(knoxFilterAndSortMemories(items, { sortBy: 'accessed' }).map(item => item.id), [1, 3, 2]);
	});

	test('groups memories into today / week / month / earlier', () => {
		const now = Date.parse('2026-08-16T12:00:00.000Z');
		const items = [
			mem({ id: 1, title: 'today', created_at: '2026-08-16T10:00:00.000Z' }),
			mem({ id: 2, title: 'week', created_at: '2026-08-12T10:00:00.000Z' }),
			mem({ id: 3, title: 'month', created_at: '2026-07-25T10:00:00.000Z' }),
			mem({ id: 4, title: 'old', created_at: '2026-01-01T10:00:00.000Z' }),
		];
		assert.deepStrictEqual(
			knoxGroupMemoriesByDate(items, now).map(section => [section.headerKey, section.memories.map(item => item.id)]),
			[['today', [1]], ['thisWeek', [2]], ['thisMonth', [3]], ['memoryEarlier', [4]]],
		);
	});

	test('exports JSON and Markdown for selected memories', () => {
		const items = [mem({ id: 7, title: 'RNG', content: 'xorshift', category: 'decision', pinned: true })];
		const json = JSON.parse(knoxMemoriesToExportJson(items));
		assert.strictEqual(json.version, 'knox-memories-selected-v1');
		assert.strictEqual(json.count, 1);
		assert.strictEqual(json.memories[0].title, 'RNG');
		assert.strictEqual(json.memories[0].pinned, true);
		const md = knoxMemoriesToExportMarkdown(items);
		assert.ok(md.includes('# Memories export (1)'));
		assert.ok(md.includes('## RNG'));
		assert.ok(md.includes('xorshift'));
		assert.ok(md.includes('Pin: yes'));
	});

	test('range-selects inclusive ids and toggles without an anchor', () => {
		const ordered = [1, 2, 3, 4];
		assert.deepStrictEqual([...knoxRangeSelectIds(ordered, null, 2, new Set())], [2]);
		assert.deepStrictEqual([...knoxRangeSelectIds(ordered, 1, 3, new Set([1]))].sort(), [1, 2, 3]);
	});

	test('truncates snippets', () => {
		assert.strictEqual(knoxMemorySnippet('short'), 'short');
		assert.ok(knoxMemorySnippet('a'.repeat(120)).endsWith('…'));
		assert.strictEqual(knoxMemorySnippet('a'.repeat(120)).length, 96);
	});

	test('parses memory list, sessions, graph, and config envelopes', () => {
		assert.deepStrictEqual(
			knoxParseMemoryList({ status: 'success', content: { memories: [{ id: 3, title: 'Pin', category: 'fact', content: 'x', keywords: '', importance_score: 1, retrieval_count: 0, tier: 'hot', created_at: '2026-01-01', last_accessed_at: null, source_session_id: null, pinned: true }] } }).map(item => item.id),
			[3],
		);
		assert.deepStrictEqual(
			knoxParseBrainSessions({ status: 'success', content: { sessions: [{ id: 's1', title: 'Chat', created_at: 'a', updated_at: 'b', message_count: 2 }] } }).map(item => item.id),
			['s1'],
		);
		assert.deepStrictEqual(
			knoxParseGraphEntities({ status: 'success', content: { entities: [{ id: 9, name: 'Rust', entity_type: 'language', mention_count: 4 }] } }).map(item => item.name),
			['Rust'],
		);
		const explore = knoxParseExploreResult({
			status: 'success',
			content: {
				result: {
					center: { id: 9, name: 'Rust', entity_type: 'language' },
					entities: [{ id: 10, name: 'Cargo', entity_type: 'tool' }],
					edges: [{ id: 1, source_entity_id: 9, target_entity_id: 10, relationship: 'uses', weight: 1 }],
					depth_reached: 2,
				},
			},
		});
		assert.strictEqual(explore?.center.name, 'Rust');
		assert.strictEqual(explore?.entities[0].name, 'Cargo');
		const config = knoxParseMemoryConfig({ status: 'success', content: { config: { memory_mode: 'selective', retrieval_top_k: 8 } } });
		assert.strictEqual(config.memory_mode, 'selective');
		assert.strictEqual(config.retrieval_top_k, 8);
		assert.strictEqual(config.auto_extract_enabled, true);
	});

	test('parses dashboard defaults and backlog search hits', () => {
		const dashboard = knoxParseDashboard({
			status: 'success',
			content: {
				stats: { total_semantic: 4, total_episodic: 2, tier_counts: { hot: 1, warm: 2, cold: 3 }, db_size_bytes: 2048 },
				health: { status: 'healthy', issues: [], recommendations: [] },
				sessions: [{ id: 's', title: 'Today' }],
			},
		});
		assert.strictEqual(dashboard?.stats.total_semantic, 4);
		assert.strictEqual(dashboard?.stats.tier_counts.cold, 3);
		assert.strictEqual(dashboard?.sessions[0].title, 'Today');
		const matches = knoxParseBacklogMatches({
			status: 'success',
			content: {
				result: {
					semantic: [{ id: 1, title: 'Decision', category: 'decision', content: 'use rust', source_session_id: 'abc' }],
					episodic: [{ id: 2, role: 'user', content: 'hello', session_id: 'abc' }],
				},
			},
		});
		assert.deepStrictEqual(matches.map(item => item.kind), ['semantic', 'episodic']);
	});

	test('search payload omits all-filters and formats consolidate results', () => {
		assert.deepStrictEqual(knoxMemorySearchPayload({
			query: '  rust  ',
			category: 'all',
			tier: 'hot',
			pinned: 'pinned',
			limit: 51,
			offset: 0,
		}), { query: 'rust', category: undefined, tier: 'hot', pinned: true, limit: 51, offset: 0 });
		assert.ok(knoxFormatConsolidateResult({ status: 'success', content: { result: { promoted: 2, pruned: 1 } } }).includes('promoted'));
		assert.ok(knoxImportLooksValid(JSON.stringify({ version: 'knox-brain-v1' })));
		assert.ok(knoxImportNeedsPassword(JSON.stringify({ version: 'knox-brain-encrypted-v1' })));
		assert.ok(!knoxImportLooksValid('not-json'));
	});

	test('settings catalog covers MemoryConfig keys used by the GUI form', () => {
		const keys = new Set<string>();
		for (const section of knoxMemorySettingSections()) {
			for (const entry of section.entries) {
				if ('key' in entry) {
					keys.add(entry.key);
				}
			}
		}
		assert.ok(keys.has('memory_mode'));
		assert.ok(keys.has('ebbinghaus_lambda'));
		assert.ok(keys.has('graph_max_entities'));
		assert.ok(keys.has('memory_build_timeout_ms'));
		assert.ok(sectionIds().includes('general'));
		assert.ok(sectionIds().includes('features'));
	});
});

function sectionIds(): string[] {
	return knoxMemorySettingSections().map(section => section.id);
}
