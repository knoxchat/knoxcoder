/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RawContextKey } from '../../platform/contextkey/common/contextkey.js';

/**
 * Minimal stubs replacing deleted chat context keys so leftover call sites compile
 * without restoring chat/agent surfaces. Values are always false / disabled.
 */
export const ChatContextKeys = {
	enabled: new RawContextKey<boolean>('chatStub.enabled', false),
	speechToTextConfigured: new RawContextKey<boolean>('chatStub.speechToTextConfigured', false),
};
