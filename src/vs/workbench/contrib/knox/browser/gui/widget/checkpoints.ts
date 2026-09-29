/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Checkpoint overlay: tab bar and routing, list, timeline, restore/compare dialogs, diff viewer,
 * configuration, dashboard, analysis and share.
 * Implementations live in `widget/checkpoints/`; this file is the public surface used by
 * `knoxGuiWidget.ts`, `facade/checkpointsFacade.ts`, `chrome.ts` and `checkpointDetails.ts`.
 */

export { checkpointButton, checkpointBadge, checkpointCheckbox, checkpointSelect, checkpointDialogClose, checkpointDialogHeader, checkpointRiskIcon, modal } from './checkpoints/primitives.js';
export type { KnoxCheckpointButtonVariant, KnoxCheckpointButtonSize } from './checkpoints/primitives.js';
export { renderCheckpoints } from './checkpoints/page.js';
export { renderCheckpointList, syncCheckpointList } from './checkpoints/list.js';
export { syncCheckpointTimeline, checkpointTimelineEscape, renderCheckpointTimeline } from './checkpoints/timeline.js';
export { renderRestorePreviewDialog, renderCompareDialog } from './checkpoints/dialogs.js';
export { renderDiffViewer, renderFileTree } from './checkpoints/diff.js';
export { renderCheckpointConfig } from './checkpoints/config.js';
export { renderCheckpointDashboard, dashCard } from './checkpoints/dashboard.js';
export { renderCheckpointAnalysis } from './checkpoints/analysis.js';
export { checkpointAuditActionClass, checkpointAuditOutcome, renderCheckpointShare } from './checkpoints/share.js';
