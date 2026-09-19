/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	KnoxCodeBlockStreamIds,
	knoxApplyActionKind,
	knoxApplyStateByStreamId,
	knoxApplyStatesFingerprint,
	knoxBuildApplyToFilePayload,
	knoxCodeBlockStreamKey,
	knoxShouldShowAppliedFlash,
} from '../../common/knoxApply.js';
import { createKnoxChatServiceForTest } from './knoxChatTestUtils.js';

suite('knox apply states (T6.3)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('maps streaming / done / closed onto toolbar kinds', () => {
		assert.strictEqual(knoxApplyActionKind(undefined, false, false), 'apply');
		assert.strictEqual(knoxApplyActionKind({ streamId: 's', status: 'streaming' }, false, false), 'streaming');
		assert.strictEqual(knoxApplyActionKind({ streamId: 's', status: 'done', numDiffs: 2 }, false, false), 'done');
		assert.strictEqual(knoxApplyActionKind({ streamId: 's', status: 'closed', numDiffs: 0 }, false, true), 'applied');
		assert.strictEqual(knoxApplyActionKind({ streamId: 's', status: 'closed', numDiffs: 0 }, false, false), 'reapply');
		assert.strictEqual(knoxApplyActionKind({ streamId: 's', status: 'closed', numDiffs: 0 }, true, true), 'apply');
		assert.ok(knoxShouldShowAppliedFlash({ streamId: 's', status: 'closed', numDiffs: 0 }, false));
		assert.ok(!knoxShouldShowAppliedFlash({ streamId: 's', status: 'closed', numDiffs: 0 }, true));
	});

	test('apply-state fingerprint changes when status or diffs change (T5.5)', () => {
		const streaming = [{ streamId: 's1', status: 'streaming', filepath: '/tmp/a.ts' }];
		const done = [{ streamId: 's1', status: 'done', numDiffs: 2, filepath: '/tmp/a.ts' }];
		assert.notStrictEqual(knoxApplyStatesFingerprint(streaming), knoxApplyStatesFingerprint(done));
		assert.strictEqual(knoxApplyStatesFingerprint(done), knoxApplyStatesFingerprint(done));
	});

	test('looks up apply state by streamId and builds applyToFile payloads', () => {
		const states = [
			{ streamId: 's1', status: 'done', filepath: 'file:///a.ts' },
			{ streamId: 's2', status: 'streaming' },
		];
		assert.strictEqual(knoxApplyStateByStreamId(states, 's1')?.filepath, 'file:///a.ts');
		assert.deepStrictEqual(
			knoxBuildApplyToFilePayload('const x = 1;', 'abc', 'GPT', 'file:///ws/a.ts'),
			{ text: 'const x = 1;', streamId: 'abc', curSelectedModelTitle: 'GPT', filepath: 'file:///ws/a.ts' },
		);
		assert.deepStrictEqual(
			knoxBuildApplyToFilePayload('ls', 'abc', 'GPT'),
			{ text: 'ls', streamId: 'abc', curSelectedModelTitle: 'GPT' },
		);
	});

	test('reuses a stable stream id per session/history/code-block', () => {
		const ids = new KnoxCodeBlockStreamIds();
		const first = ids.get('sess', 2, 0);
		assert.strictEqual(ids.get('sess', 2, 0), first);
		assert.notStrictEqual(ids.get('sess', 2, 1), first);
		assert.strictEqual(knoxCodeBlockStreamKey('sess', 2, 0), 'sess:2:0');
		ids.clear();
		assert.notStrictEqual(ids.get('sess', 2, 0), first);
	});
});

suite('knox chat applyToFile / accept / reject (T6.3)', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('applyToFile posts protocol payload and seeds streaming state', async () => {
		const { service, bridge } = createKnoxChatServiceForTest(store);
		await service.loadConfig();
		const streamId = service.codeBlockStreamId(0, 0);
		await service.applyToFile({ streamId, text: 'const x = 1;', filepath: 'src/a.ts' });
		const post = bridge.posts.find(item => item.messageType === 'applyToFile');
		assert.ok(post);
		const data = post.data as { streamId: string; text: string; curSelectedModelTitle: string; filepath?: string };
		assert.strictEqual(data.streamId, streamId);
		assert.strictEqual(data.text, 'const x = 1;');
		assert.strictEqual(data.curSelectedModelTitle, 'TestModel');
		assert.ok(data.filepath?.includes('a.ts'));
		assert.strictEqual(service.applyStateByStreamId(streamId)?.status, 'streaming');
	});

	test('acceptDiff and rejectDiff post filepath + streamId', async () => {
		const { service, bridge } = createKnoxChatServiceForTest(store);
		service.updateApplyState({ streamId: 's1', status: 'done', filepath: 'file:///tmp/a.ts' });
		await service.acceptDiff('s1', 'file:///tmp/a.ts');
		await service.rejectDiff('s2', '/tmp/b.ts');
		assert.ok(bridge.posts.some(post => post.messageType === 'acceptDiff' && (post.data as { streamId: string }).streamId === 's1'));
		assert.ok(bridge.posts.some(post => post.messageType === 'rejectDiff' && (post.data as { streamId: string }).streamId === 's2'));
		assert.ok(service.wasApplyRejected('s2'));
	});

	test('requestApplyFromChat notifies the next code block', () => {
		const { service } = createKnoxChatServiceForTest(store);
		let fired = 0;
		store.add(service.onDidRequestApplyFromChat(() => fired++));
		service.requestApplyFromChat();
		assert.strictEqual(fired, 1);
		assert.strictEqual(service.applyCurIndex, 0);
	});
});
