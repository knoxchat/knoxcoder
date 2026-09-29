/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from '../../../base/common/lifecycle.js';
import { IServerChannel, ProxyChannel } from '../../../base/parts/ipc/common/ipc.js';
import { ICommonNativeHostService } from './native.js';

/**
 * Electron `browser-window-blur` fires throughout the session. The workbench listens to
 * `onDidBlurMainOrAuxiliaryWindow` instead, so buffering `onDidBlurMainWindow` on the
 * native-host IPC channel retains every focus loss until process exit and trips
 * Event.buffer leak detection in VSCODE_DEV.
 */
export const NATIVE_HOST_UNBUFFERED_EVENTS = [
	'onDidBlurMainWindow',
] as const satisfies readonly (keyof ICommonNativeHostService)[];

export function createNativeHostChannel(service: unknown, disposables: DisposableStore): IServerChannel {
	return ProxyChannel.fromService(service, disposables, {
		unbufferedEvents: NATIVE_HOST_UNBUFFERED_EVENTS,
	});
}
