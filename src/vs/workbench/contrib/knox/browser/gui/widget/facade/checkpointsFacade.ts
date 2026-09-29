/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { KnoxGuiMemoryFacade } from './memoryFacade.js';
import { IKnoxGuiCheckpointDiffFile, IKnoxGuiState } from '../../../../common/knoxGuiState.js';
import { KnoxGuiSvgIcon } from '../../knoxGuiIcons.js';
import * as knoxGuiCheckpointsView from '../checkpoints.js';

/** Checkpoint pages: list, restore/compare dialogs, diff viewer, dashboard, share (`widget/checkpoints.ts` barrel over `widget/checkpoints/`). */
export abstract class KnoxGuiCheckpointsFacade extends KnoxGuiMemoryFacade {
	renderCheckpoints(this: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiCheckpointsView.renderCheckpoints(this, body, state);
	}

	renderCheckpointList(this: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiCheckpointsView.renderCheckpointList(this, body, state);
	}

	renderRestorePreviewDialog(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiCheckpointsView.renderRestorePreviewDialog(this, parent, state);
	}

	renderCompareDialog(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiCheckpointsView.renderCompareDialog(this, parent, state);
	}

	renderDiffViewer(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, diff: NonNullable<IKnoxGuiState['checkpointCompareDiff']>): void {
		knoxGuiCheckpointsView.renderDiffViewer(this, parent, state, diff);
	}

	renderFileTree(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, files: IKnoxGuiCheckpointDiffFile[], onSelect: (path: string) => void): void {
		knoxGuiCheckpointsView.renderFileTree(this, parent, state, files, onSelect);
	}

	renderCheckpointConfig(this: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiCheckpointsView.renderCheckpointConfig(this, body, state);
	}

	renderCheckpointDashboard(this: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiCheckpointsView.renderCheckpointDashboard(this, body, state);
	}

	dashCard(this: KnoxGuiWidget, parent: HTMLElement, label: string, value: string, icon?: KnoxGuiSvgIcon, subtitle?: string): void {
		knoxGuiCheckpointsView.dashCard(this, parent, label, value, icon, subtitle);
	}

	renderCheckpointAnalysis(this: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiCheckpointsView.renderCheckpointAnalysis(this, body, state);
	}

	renderCheckpointShare(this: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiCheckpointsView.renderCheckpointShare(this, body, state);
	}

	modal(this: KnoxGuiWidget, parent: HTMLElement, testId: string, onClose?: () => void): HTMLElement {
		return knoxGuiCheckpointsView.modal(this, parent, testId, onClose);
	}
}
