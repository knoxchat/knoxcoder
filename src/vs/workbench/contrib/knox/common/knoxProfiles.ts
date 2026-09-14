/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IKnoxProfileDescription } from './knoxChatTypes.js';

export function knoxSelectProfileId(
	profiles: readonly IKnoxProfileDescription[] | null | undefined,
	requestedId: string | null | undefined,
): string | null {
	if (!profiles || profiles.length === 0) {
		return requestedId ?? null;
	}
	if (requestedId && profiles.some(profile => profile.id === requestedId)) {
		return requestedId;
	}
	return profiles[0].id;
}

export function knoxCycleProfileId(
	profiles: readonly IKnoxProfileDescription[] | null | undefined,
	currentId: string | null | undefined,
): string | null {
	if (!profiles || profiles.length === 0) {
		return null;
	}
	const ids = profiles.map(profile => profile.id);
	if (!currentId) {
		return ids[0];
	}
	const index = ids.indexOf(currentId);
	return ids[(index + 1) % ids.length];
}

export function knoxProfileBookmarkStorageKey(profileId: string | undefined, baseKey: string): string {
	return profileId ? `${baseKey}.${profileId}` : baseKey;
}

export function knoxReadProfileScopedJson(
	get: (key: string) => string | undefined,
	baseKey: string,
	profileId: string | undefined,
): string | undefined {
	if (profileId) {
		const scoped = get(knoxProfileBookmarkStorageKey(profileId, baseKey));
		if (scoped !== undefined) {
			return scoped;
		}
	}
	return get(baseKey);
}
