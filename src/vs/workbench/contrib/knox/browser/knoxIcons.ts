/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FileAccess } from '../../../../base/common/network.js';
import { URI } from '../../../../base/common/uri.js';
import { Icon } from '../../../../platform/action/common/action.js';
import { knoxGuiTitleIcon } from './knoxGuiIcons.js';

/** Same SVG as `knox/extensions/vscode/media/agent.svg` (view container). */
export const knoxViewIcon: URI = FileAccess.asFileUri('vs/workbench/contrib/knox/browser/media/icons/knox-view.svg');
/** Same Restore icon as Lump checkpoints / `knox/gui/src/svg-icons/Restore.tsx`. */
export const knoxRestoreIcon: Icon = knoxGuiTitleIcon('restore.svg');
/** Same SVG as `knox/extensions/vscode/media/memory.svg` (view/title). */
export const knoxMemoryIcon: Icon = knoxGuiTitleIcon('memory.svg');
/** Same hexagon as `knox/gui/src/svg-icons/Settings.tsx` (view/title). */
export const knoxConfigIcon: Icon = knoxGuiTitleIcon('settings.svg');
/** Same History icon as Lump / `knox/gui/src/svg-icons/HistoryIcon.tsx`. */
export const knoxHistoryIcon: Icon = knoxGuiTitleIcon('history.svg');
