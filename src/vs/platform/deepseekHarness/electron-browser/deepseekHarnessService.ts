/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DEEPSEEK_HARNESS_CHANNEL_NAME, IDeepSeekHarnessService } from '../common/deepseekHarness.js';
import { registerMainProcessRemoteService } from '../../ipc/electron-browser/services.js';

registerMainProcessRemoteService(IDeepSeekHarnessService, DEEPSEEK_HARNESS_CHANNEL_NAME);
