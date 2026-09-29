/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual } from 'assert';
import { timeout } from '../../../../base/common/async.js';
import { Emitter } from '../../../../base/common/event.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { createNativeHostChannel } from '../../common/nativeHostChannel.js';

suite('NativeHostChannel', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('does not retain unused main-window blur events', async () => {
		const onDidBlurMainWindow = store.add(new Emitter<number>());
		const onDidBlurMainOrAuxiliaryWindow = store.add(new Emitter<number>());
		const channel = createNativeHostChannel({
			onDidBlurMainWindow: onDidBlurMainWindow.event,
			onDidBlurMainOrAuxiliaryWindow: onDidBlurMainOrAuxiliaryWindow.event,
		}, store.add(new DisposableStore()));
		const eagerSubscriptions = {
			onDidBlurMainWindow: onDidBlurMainWindow.hasListeners(),
			onDidBlurMainOrAuxiliaryWindow: onDidBlurMainOrAuxiliaryWindow.hasListeners(),
		};

		onDidBlurMainWindow.fire(1);
		onDidBlurMainOrAuxiliaryWindow.fire(1);

		const receivedBlur: number[] = [];
		const receivedAuxiliary: number[] = [];
		store.add(channel.listen<number>('window', 'onDidBlurMainWindow')(id => receivedBlur.push(id)));
		store.add(channel.listen<number>('window', 'onDidBlurMainOrAuxiliaryWindow')(id => receivedAuxiliary.push(id)));
		await timeout(0);

		onDidBlurMainWindow.fire(2);
		onDidBlurMainOrAuxiliaryWindow.fire(2);

		deepStrictEqual({
			eagerSubscriptions,
			receivedBlur,
			receivedAuxiliary,
		}, {
			eagerSubscriptions: {
				onDidBlurMainWindow: false,
				onDidBlurMainOrAuxiliaryWindow: true,
			},
			receivedBlur: [2],
			receivedAuxiliary: [1, 2],
		});
	});
});
