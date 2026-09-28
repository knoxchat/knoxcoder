/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { KnoxGuiOverlaysFacade } from './overlaysFacade.js';
import { IKnoxGuiState } from '../../../../common/knoxGuiState.js';
import * as knoxGuiPagesView from '../pages.js';

/** Config-error, stats, add-model and batch-diff pages (`widget/pages.ts`). */
export abstract class KnoxGuiPagesFacade extends KnoxGuiOverlaysFacade {
	renderConfigError(this: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiPagesView.renderConfigError(this, body, state);
	}

	renderStats(this: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiPagesView.renderStats(this, body, state);
	}

	renderAddModel(this: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiPagesView.renderAddModel(this, body, state);
	}

	renderAddModelForm(this: KnoxGuiWidget, state: IKnoxGuiState): void {
		knoxGuiPagesView.renderAddModelForm(this, state);
	}

	renderConfigureProvider(this: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiPagesView.renderConfigureProvider(this, body, state);
	}

	renderKnoxChatModelList(this: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState, ready: boolean, options?: { selectOnly?: boolean }): void {
		knoxGuiPagesView.renderKnoxChatModelList(this, body, state, ready, options);
	}

	renderOAuthRow(this: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiPagesView.renderOAuthRow(this, body, state);
	}

	renderAddModelInput(this: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState, input: { key: string; labelKey: string; placeholderKey?: string; inputType?: string; defaultValue?: string | number; min?: number; max?: number; step?: number }): void {
		knoxGuiPagesView.renderAddModelInput(this, body, state, input);
	}

	renderBatchDiff(this: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiPagesView.renderBatchDiff(this, body, state);
	}
}
