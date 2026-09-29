/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { knoxGuiStringsZhCommon } from './zh/common.js';
import { knoxGuiStringsZhSettings } from './zh/settings.js';
import { knoxGuiStringsZhChat } from './zh/chat.js';
import { knoxGuiStringsZhHistory } from './zh/history.js';
import { knoxGuiStringsZhErrors } from './zh/errors.js';
import { knoxGuiStringsZhModels } from './zh/models.js';
import { knoxGuiStringsZhStats } from './zh/stats.js';
import { knoxGuiStringsZhTools } from './zh/tools.js';

// Merge modules in the same order as the original knox gui-src i18n.
export const knoxGuiStringsZh: Record<string, unknown> = {
	...knoxGuiStringsZhCommon,
	...knoxGuiStringsZhSettings,
	...knoxGuiStringsZhChat,
	...knoxGuiStringsZhHistory,
	...knoxGuiStringsZhErrors,
	...knoxGuiStringsZhModels,
	...knoxGuiStringsZhStats,
	...knoxGuiStringsZhTools,
};
