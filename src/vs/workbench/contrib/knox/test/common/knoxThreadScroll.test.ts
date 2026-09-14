/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	knoxIsAtBottom,
	knoxIsAtTop,
	knoxResetScrollState,
	knoxScrollStateFromMetrics,
	knoxShouldShowScrollButtons,
} from '../../common/knoxThreadScroll.js';

suite('knox thread scroll', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('detects top and bottom with the GUI thresholds', () => {
		assert.strictEqual(knoxIsAtTop({ scrollTop: 0, scrollHeight: 400, clientHeight: 200 }), true);
		assert.strictEqual(knoxIsAtTop({ scrollTop: 20, scrollHeight: 400, clientHeight: 200 }), false);
		assert.strictEqual(knoxIsAtBottom({ scrollTop: 160, scrollHeight: 400, clientHeight: 200 }), false);
		assert.strictEqual(knoxIsAtBottom({ scrollTop: 165, scrollHeight: 400, clientHeight: 200 }), true);
	});

	test('shows scroll buttons only when content overflows and the viewport is not pinned to both ends', () => {
		assert.strictEqual(knoxShouldShowScrollButtons({ scrollTop: 0, scrollHeight: 200, clientHeight: 200 }, true, true), false);
		assert.strictEqual(knoxShouldShowScrollButtons({ scrollTop: 80, scrollHeight: 400, clientHeight: 200 }, false, false), true);
	});

	test('user scroll away from bottom unsticks; returning to bottom re-sticks', () => {
		const previous = knoxResetScrollState();
		const scrolledUp = knoxScrollStateFromMetrics(
			{ scrollTop: 20, scrollHeight: 400, clientHeight: 200 },
			previous,
			false,
		);
		assert.strictEqual(scrolledUp.stickToBottom, false);
		assert.strictEqual(scrolledUp.showScrollButtons, true);

		const backToBottom = knoxScrollStateFromMetrics(
			{ scrollTop: 200, scrollHeight: 400, clientHeight: 200 },
			scrolledUp,
			false,
		);
		assert.strictEqual(backToBottom.stickToBottom, true);
		assert.strictEqual(backToBottom.isAtBottom, true);
	});

	test('programmatic scroll does not unstick while following', () => {
		const previous = knoxResetScrollState();
		const midReveal = knoxScrollStateFromMetrics(
			{ scrollTop: 10, scrollHeight: 400, clientHeight: 200 },
			previous,
			true,
		);
		assert.strictEqual(midReveal.stickToBottom, true);
	});
});
