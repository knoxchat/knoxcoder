/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	DEFAULT_COLLAPSED_LINES,
	knoxVisibleCodeText,
	MAX_EXPANDED_CODE_LINES,
	visibleCodeLineRange,
} from '../../common/knoxCodeLineWindow.js';
import { knoxHasNlsKey, knoxNls } from '../../common/knoxI18n.js';

suite('knox code line window (T8.3)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('windows a 5000-line collapsed block to 12 lines', () => {
		const collapsed = visibleCodeLineRange(5000, {
			isGenerating: false,
			isExpanded: false,
		});
		assert.strictEqual(collapsed.end - collapsed.start, DEFAULT_COLLAPSED_LINES);
		assert.strictEqual(collapsed.start, 0);

		const streaming = visibleCodeLineRange(5000, {
			isGenerating: true,
			isExpanded: false,
		});
		assert.strictEqual(streaming.end - streaming.start, DEFAULT_COLLAPSED_LINES);
		assert.strictEqual(streaming.end, 5000);

		const expanded = visibleCodeLineRange(5000, {
			isGenerating: false,
			isExpanded: true,
		});
		assert.strictEqual(expanded.end - expanded.start, MAX_EXPANDED_CODE_LINES);
	});

	test('slices collapsed source to the visible window', () => {
		const code = Array.from({ length: 40 }, (_, i) => `line-${i}`).join('\n');
		const windowed = knoxVisibleCodeText(code, { isGenerating: false, isExpanded: false });
		assert.strictEqual(windowed.lineCount, 40);
		assert.strictEqual(windowed.start, 0);
		assert.strictEqual(windowed.end, DEFAULT_COLLAPSED_LINES);
		assert.ok(windowed.text.startsWith('line-0'));
		assert.ok(windowed.text.endsWith(`line-${DEFAULT_COLLAPSED_LINES - 1}`));
		assert.ok(!windowed.text.includes('line-20'));
	});

	test('linesHiddenExpand / showingLinesOf / collapseCodeBlock i18n exist in en and zh', () => {
		assert.ok(knoxHasNlsKey('linesHiddenExpand'));
		assert.ok(knoxNls('linesHiddenExpand', { hidden: 12 }, undefined, 'en').includes('12'));
		assert.ok(knoxNls('linesHiddenExpand', { hidden: 12 }, undefined, 'zh').includes('12'));
		assert.strictEqual(knoxNls('collapseCodeBlock', undefined, undefined, 'en'), 'Collapse');
		assert.strictEqual(knoxNls('collapseCodeBlock', undefined, undefined, 'zh'), '收起');
		assert.ok(knoxNls('showingLinesOf', { shown: 400, total: 900 }, undefined, 'en').includes('400'));
	});
});
