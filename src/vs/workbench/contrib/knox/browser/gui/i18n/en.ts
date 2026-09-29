/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { knoxGuiStringsEnCommon } from './en/common.js';
import { knoxGuiStringsEnSettings } from './en/settings.js';
import { knoxGuiStringsEnChat } from './en/chat.js';
import { knoxGuiStringsEnHistory } from './en/history.js';
import { knoxGuiStringsEnErrors } from './en/errors.js';
import { knoxGuiStringsEnModels } from './en/models.js';
import { knoxGuiStringsEnStats } from './en/stats.js';
import { knoxGuiStringsEnTools } from './en/tools.js';

// Merge modules in the same order as the original knox gui-src i18n.
export const knoxGuiStringsEn: Record<string, unknown> = {
	...knoxGuiStringsEnCommon,
	...knoxGuiStringsEnSettings,
	...knoxGuiStringsEnChat,
	...knoxGuiStringsEnHistory,
	...knoxGuiStringsEnErrors,
	...knoxGuiStringsEnModels,
	...knoxGuiStringsEnStats,
	...knoxGuiStringsEnTools,
};
