/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { KnoxGuiToolsFacade } from './toolsFacade.js';
import { IKnoxGuiBackgroundJob, IKnoxGuiGitDiffFile, IKnoxGuiInjectedMemory, IKnoxGuiState, IKnoxGuiTaskPlanStep } from '../../../../common/knoxGuiState.js';
import * as knoxGuiPanelsView from '../panels.js';

/** Attached panels above the composer: meter, git diff, plan, memories, jobs (`widget/panels.ts`). */
export abstract class KnoxGuiPanelsFacade extends KnoxGuiToolsFacade {
	renderAgentMeter(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiPanelsView.renderAgentMeter(this, parent, state);
	}

	renderPanels(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiPanelsView.renderPanels(this, parent, state);
	}

	renderAutonomousBanner(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiPanelsView.renderAutonomousBanner(this, parent, state);
	}

	renderGitDiffPanel(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiPanelsView.renderGitDiffPanel(this, parent, state);
	}

	renderGitDiffRow(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, file: IKnoxGuiGitDiffFile): void {
		knoxGuiPanelsView.renderGitDiffRow(this, parent, state, file);
	}

	renderCompactionPanel(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiPanelsView.renderCompactionPanel(this, parent, state);
	}

	renderWorktreePanel(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiPanelsView.renderWorktreePanel(this, parent, state);
	}

	renderReviewPanel(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiPanelsView.renderReviewPanel(this, parent, state);
	}

	renderHooksPanel(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiPanelsView.renderHooksPanel(this, parent, state);
	}

	renderTaskPlanPanel(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiPanelsView.renderTaskPlanPanel(this, parent, state);
	}

	renderTaskPlanStep(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, step: IKnoxGuiTaskPlanStep, index: number): void {
		knoxGuiPanelsView.renderTaskPlanStep(this, parent, state, step, index);
	}

	renderInjectedMemoriesPanel(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiPanelsView.renderInjectedMemoriesPanel(this, parent, state);
	}

	renderInjectedMemoryRow(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiInjectedMemory): void {
		knoxGuiPanelsView.renderInjectedMemoryRow(this, parent, state, item);
	}

	renderBackgroundJobsPanel(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiPanelsView.renderBackgroundJobsPanel(this, parent, state);
	}

	renderJobRow(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, job: IKnoxGuiBackgroundJob): void {
		knoxGuiPanelsView.renderJobRow(this, parent, state, job);
	}

	attachedPanel(this: KnoxGuiWidget, parent: HTMLElement, testId: string): HTMLElement {
		return knoxGuiPanelsView.attachedPanel(this, parent, testId);
	}

	attachedToggle(this: KnoxGuiWidget, panel: HTMLElement, _state: IKnoxGuiState, options: { expanded: boolean; testId: string; onToggle: () => void }): HTMLButtonElement {
		return knoxGuiPanelsView.attachedToggle(this, panel, _state, options);
	}

	attachedBody(this: KnoxGuiWidget, panel: HTMLElement, expanded: boolean, tag: 'div' | 'ul' = 'div'): HTMLElement {
		return knoxGuiPanelsView.attachedBody(this, panel, expanded, tag);
	}

	attachedDismiss(this: KnoxGuiWidget, parent: HTMLElement, label: string, onClick: () => void): HTMLElement {
		return knoxGuiPanelsView.attachedDismiss(this, parent, label, onClick);
	}

	syncJobClock(this: KnoxGuiWidget, jobs: IKnoxGuiBackgroundJob[]): void {
		knoxGuiPanelsView.syncJobClock(this, jobs);
	}

	clearJobClock(this: KnoxGuiWidget): void {
		knoxGuiPanelsView.clearJobClock(this);
	}

	clearMeterClock(this: KnoxGuiWidget): void {
		knoxGuiPanelsView.clearMeterClock(this);
	}
}
