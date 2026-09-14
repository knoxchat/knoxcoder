/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IKnoxModelDescription } from './knoxChatTypes.js';

/**
 * Whether the selected model advertises provider-native web search.
 * Native cannot consult the KnoxChat /v1/models cache, so this uses the
 * serialized model (`supportedParameters` / explicit `capabilities.webSearch`).
 */
export function knoxModelSupportsWebSearch(model: IKnoxModelDescription | undefined): boolean {
	if (!model) {
		return false;
	}
	const params = model.supportedParameters ?? [];
	if (params.includes('web_search') || params.includes('web_search_options')) {
		return true;
	}
	return model.capabilities?.webSearch === true;
}
