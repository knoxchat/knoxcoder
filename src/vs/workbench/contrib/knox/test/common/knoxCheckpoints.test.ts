/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	buildCheckpointSearchDocument,
	CHECKPOINT_LIST_PAGE_SIZE,
	chronologicalCheckpointPair,
	compareCheckpointTargets,
	knoxFilterCheckpoints,
	knoxFormatBytes,
	knoxLanguageFromPath,
	knoxNormalizeCheckpointConfig,
	knoxParseStorageBytes,
	KNOX_CHECKPOINT_TABS,
	KNOX_DEFAULT_CHECKPOINT_CONFIG,
	parseKnoxCheckpointList,
	selectCheckpointIdRange,
	type IKnoxCheckpointMetadata,
} from '../../common/knoxCheckpoints.js';
import { knoxProtocolSuccess, knoxUnwrapProtocol } from '../../common/knoxGuiProtocol.js';

function metadata(partial: Partial<IKnoxCheckpointMetadata> & Pick<IKnoxCheckpointMetadata, 'id' | 'description' | 'dateCreated'>): IKnoxCheckpointMetadata {
	return partial;
}

suite('knox checkpoints (T7.3–T7.10)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('indexes tag, path, and session for search', () => {
		const doc = buildCheckpointSearchDocument(metadata({
			id: 'cp_1',
			description: 'Auth work',
			dateCreated: '2026-08-17T00:00:00.000Z',
			tags: ['manual', 'auth'],
			sessionId: 'sess-9',
			changedPaths: ['src/auth.ts', 'src/login.tsx'],
		}));
		assert.ok(doc.tags.includes('auth'));
		assert.ok(doc.paths.includes('src/auth.ts'));
		assert.strictEqual(doc.sessionId, 'sess-9');
	});

	test('filters by MiniSearch fields and substring fallbacks', () => {
		const checkpoints = [
			metadata({
				id: 'cp_auth',
				description: 'Login flow',
				dateCreated: '2026-09-14T00:00:00.000Z',
				tags: ['auth'],
				changedPaths: ['src/login.ts'],
				sessionId: 'sess-1',
			}),
			metadata({
				id: 'cp_other',
				description: 'Unrelated',
				dateCreated: '2026-09-13T00:00:00.000Z',
			}),
		];
		assert.strictEqual(knoxFilterCheckpoints(checkpoints, '').length, 2);
		assert.deepStrictEqual(knoxFilterCheckpoints(checkpoints, 'login').map(item => item.id), ['cp_auth']);
		assert.deepStrictEqual(knoxFilterCheckpoints(checkpoints, 'cp_auth').map(item => item.id), ['cp_auth']);
		assert.deepStrictEqual(knoxFilterCheckpoints(checkpoints, 'sess-1').map(item => item.id), ['cp_auth']);
		assert.deepStrictEqual(knoxFilterCheckpoints(checkpoints, 'src/login.ts').map(item => item.id), ['cp_auth']);
	});

	test('selects an inclusive keyboard range and chronological compare pair', () => {
		assert.deepStrictEqual(selectCheckpointIdRange(['a', 'b', 'c', 'd'], 'b', 'd'), ['b', 'c', 'd']);
		assert.deepStrictEqual(selectCheckpointIdRange(['a', 'b', 'c'], 'c', 'a'), ['a', 'b', 'c']);
		const older = { id: 'old', dateCreated: '2026-01-01T00:00:00.000Z' };
		const newer = { id: 'new', dateCreated: '2026-09-01T00:00:00.000Z' };
		assert.deepStrictEqual(chronologicalCheckpointPair(newer, older).map(item => item.id), ['old', 'new']);
		assert.deepStrictEqual(compareCheckpointTargets([older, newer], 'old').map(item => item.id), ['new']);
	});

	test('parses list payloads from wrapped protocol envelopes', () => {
		const listed = parseKnoxCheckpointList({
			status: 'success',
			content: {
				checkpoints: [{ id: 'cp1', description: 'one', dateCreated: '2026-09-14T00:00:00.000Z' }],
				total: 3,
				hasMore: true,
				compareCatalog: [{ id: 'cp1', description: 'one', dateCreated: '2026-09-14T00:00:00.000Z' }],
				workspaceFolders: [{ path: '/tmp/ws', name: 'ws' }],
				activeWorkspacePath: '/tmp/ws',
			},
		});
		assert.strictEqual(listed.checkpoints[0]?.id, 'cp1');
		assert.strictEqual(listed.total, 3);
		assert.strictEqual(listed.hasMore, true);
		assert.strictEqual(listed.activeWorkspacePath, '/tmp/ws');
		assert.strictEqual(CHECKPOINT_LIST_PAGE_SIZE, 50);
	});

	test('normalizes checkpoint config and storage units', () => {
		const config = knoxNormalizeCheckpointConfig({ maxCheckpoints: '12' as unknown as number });
		assert.strictEqual(config.maxCheckpoints, 12);
		assert.strictEqual(config.retentionDays, KNOX_DEFAULT_CHECKPOINT_CONFIG.retentionDays);
		assert.strictEqual(knoxParseStorageBytes('1 GB'), 1024 * 1024 * 1024);
		assert.ok(knoxFormatBytes(2048).includes('KB'));
		assert.strictEqual(knoxLanguageFromPath('src/app.ts'), 'typescript');
	});

	test('lists the GUI checkpoint tabs in order', () => {
		assert.deepStrictEqual(
			[...KNOX_CHECKPOINT_TABS],
			['checkpoints', 'timeline', 'analysis', 'dashboard', 'share', 'configuration'],
		);
	});

	test('protocol unwrap treats missing success as ok', () => {
		assert.strictEqual(knoxUnwrapProtocol({ foo: 1 }).status, 'success');
		assert.strictEqual(knoxProtocolSuccess({ status: 'success', content: { success: true } }), true);
		assert.strictEqual(knoxProtocolSuccess({ status: 'success', content: { success: false } }), false);
	});
});
