/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	enterKnoxAgentLoop,
	hasKnoxAskUserWaiter,
	hasKnoxToolApproval,
	isKnoxAgentLoopRunning,
	leaveKnoxAgentLoop,
	rejectKnoxLoopWaiters,
	resolveKnoxAskUser,
	resolveKnoxToolApproval,
	waitForKnoxAskUser,
	waitForKnoxToolApproval,
} from '../../common/knoxGuiApproval.js';

suite('knox gui approval (T12.1)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	teardown(() => {
		rejectKnoxLoopWaiters();
		while (isKnoxAgentLoopRunning()) {
			leaveKnoxAgentLoop();
		}
	});

	test('tracks nested agent-loop depth', () => {
		assert.strictEqual(isKnoxAgentLoopRunning(), false);
		enterKnoxAgentLoop();
		enterKnoxAgentLoop();
		assert.strictEqual(isKnoxAgentLoopRunning(), true);
		leaveKnoxAgentLoop();
		assert.strictEqual(isKnoxAgentLoopRunning(), true);
		leaveKnoxAgentLoop();
		assert.strictEqual(isKnoxAgentLoopRunning(), false);
	});

	test('resolves an in-flight tool approval', async () => {
		const pending = waitForKnoxToolApproval({ callId: 'c1' });
		assert.strictEqual(hasKnoxToolApproval('c1'), true);
		assert.strictEqual(resolveKnoxToolApproval('c1', true, true), true);
		assert.deepStrictEqual(await pending, { allow: true, always: true });
		assert.strictEqual(hasKnoxToolApproval('c1'), false);
	});

	test('resolves ask_user with output or cancel', async () => {
		const pending = waitForKnoxAskUser({ callId: 'a1' });
		assert.strictEqual(hasKnoxAskUserWaiter('a1'), true);
		const output = [{ name: 'answers', description: 'ok', content: 'yes' }];
		assert.strictEqual(resolveKnoxAskUser('a1', output), true);
		assert.deepStrictEqual(await pending, output);
	});

	test('rejects waiters on stop', async () => {
		const approval = waitForKnoxToolApproval({ callId: 'c2' });
		const ask = waitForKnoxAskUser({ callId: 'a2' });
		rejectKnoxLoopWaiters();
		assert.deepStrictEqual(await approval, { allow: false });
		assert.strictEqual(await ask, null);
	});
});
