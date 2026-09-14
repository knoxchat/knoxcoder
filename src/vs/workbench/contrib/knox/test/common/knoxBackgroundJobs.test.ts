/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	isKnoxTaskJobId,
	knoxCollectRunningTaskJobs,
	knoxCountRunningJobs,
	knoxMergeBackgroundJobs,
	knoxParseBackgroundJobs,
	knoxRunningJobCount,
	knoxSortBackgroundJobs,
	knoxTruncateJobTitle,
} from '../../common/knoxBackgroundJobs.js';
import type { IKnoxBackgroundJob, IKnoxChatHistoryItem } from '../../common/knoxChatTypes.js';
import { KnoxBuiltInToolName } from '../../common/knoxToolNames.js';

suite('knox background jobs (T5.2)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	function job(partial: Partial<IKnoxBackgroundJob> & Pick<IKnoxBackgroundJob, 'id'>): IKnoxBackgroundJob {
		return {
			kind: 'shell',
			title: partial.id,
			status: 'running',
			...partial,
		};
	}

	test('truncates titles and sorts running first', () => {
		assert.strictEqual(knoxTruncateJobTitle('  pnpm   test  '), 'pnpm test');
		assert.strictEqual(knoxTruncateJobTitle('x'.repeat(80), 10), `${'x'.repeat(9)}…`);
		const sorted = knoxSortBackgroundJobs([
			job({ id: 'old-done', status: 'exited', startedAt: 30 }),
			job({ id: 'new-run', status: 'running', startedAt: 10 }),
			job({ id: 'old-run', status: 'running', startedAt: 5 }),
		]);
		assert.deepStrictEqual(sorted.map(j => j.id), ['new-run', 'old-run', 'old-done']);
	});

	test('merges shell + task jobs and counts running', () => {
		const merged = knoxMergeBackgroundJobs(
			[job({ id: 'sh_1', title: 'echo' })],
			[job({ id: 'task:a', kind: 'task', title: 'review' })],
		);
		assert.deepStrictEqual(merged.map(j => j.id).sort(), ['sh_1', 'task:a']);
		assert.strictEqual(knoxCountRunningJobs(merged), 2);
	});

	test('collects in-flight builtin_task tools only', () => {
		const history: IKnoxChatHistoryItem[] = [{
			message: { role: 'assistant', content: '', id: 'a' },
			contextItems: [],
			toolCallStates: [{
				toolCallId: 't1',
				status: 'calling',
				parsedArgs: { prompt: 'find auth', profile: 'explore' },
				toolCall: { id: 't1', type: 'function', function: { name: KnoxBuiltInToolName.Task, arguments: '{}' } },
			}, {
				toolCallId: 't2',
				status: 'done',
				parsedArgs: { prompt: 'old' },
				toolCall: { id: 't2', type: 'function', function: { name: KnoxBuiltInToolName.Task, arguments: '{}' } },
			}],
		}];
		const jobs = knoxCollectRunningTaskJobs(history);
		assert.strictEqual(jobs.length, 1);
		assert.strictEqual(jobs[0].id, 'task:t1');
		assert.strictEqual(jobs[0].title, 'find auth');
		assert.ok(isKnoxTaskJobId(jobs[0].id));
		assert.strictEqual(knoxRunningJobCount([], history), 1);
	});

	test('parses agent/jobUpdate payloads', () => {
		const jobs = knoxParseBackgroundJobs({
			jobs: [{ id: 'sh_1', kind: 'shell', title: 'make', status: 'running', startedAt: 1 }, { id: 2 }],
		});
		assert.strictEqual(jobs.length, 1);
		assert.strictEqual(jobs[0].title, 'make');
	});
});
