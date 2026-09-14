/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KnoxNativeOverlay } from './knoxChat.js';

export interface IKnoxNavigateTarget {
	overlay: KnoxNativeOverlay;
	provider?: string;
}

const PATH_OVERLAYS: Record<string, KnoxNativeOverlay> = {
	'/': 'chat',
	'/index.html': 'chat',
	'/history': 'history',
	'/restore': 'restore',
	'/memory': 'memory',
	'/config': 'config',
	'/config-error': 'configError',
	'/addModel': 'addModel',
	'/models': 'addModel',
	'/batch-diff': 'batchDiff',
	'/stats': 'stats',
};

export function knoxNavigateTarget(path: string | undefined): IKnoxNavigateTarget | undefined {
	if (!path) {
		return undefined;
	}
	const normalized = path.startsWith('/') ? path : `/${path}`;
	const providerMatch = normalized.match(/^\/addModel\/provider\/([^/]+)$/);
	if (providerMatch) {
		return { overlay: 'configureProvider', provider: decodeURIComponent(providerMatch[1]) };
	}
	const overlay = PATH_OVERLAYS[normalized];
	return overlay ? { overlay } : undefined;
}

export function knoxToggleNativeOverlay(
	current: KnoxNativeOverlay,
	next: KnoxNativeOverlay,
	toggle: boolean,
): KnoxNativeOverlay {
	if (toggle && current === next) {
		return 'chat';
	}
	return next;
}

export const KNOX_WIDGET_OVERLAYS: ReadonlySet<KnoxNativeOverlay> = new Set([
	'history',
	'memory',
	'config',
	'restore',
	'configError',
	'addModel',
	'configureProvider',
	'batchDiff',
	'stats',
]);
