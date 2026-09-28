/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { KnoxGuiComposerFacade } from './composerFacade.js';
import { KnoxGuiOverlay } from '../../../../common/knoxGuiProtocol.js';
import { IKnoxGuiState } from '../../../../common/knoxGuiState.js';
import * as knoxGuiOverlaysView from '../overlays.js';

/** Overlay pages: models, rules, prompts, context, tools, history, settings (`widget/overlays.ts`). */
export abstract class KnoxGuiOverlaysFacade extends KnoxGuiComposerFacade {
	renderOverlay(this: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState, overlay: Exclude<KnoxGuiOverlay, null>): void {
		knoxGuiOverlaysView.renderOverlay(this, body, state, overlay);
	}

	renderModels(this: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiOverlaysView.renderModels(this, body, state);
	}

	renderRules(this: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiOverlaysView.renderRules(this, body, state);
	}

	renderExploreBlocksButton(this: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState, blockType: string): void {
		knoxGuiOverlaysView.renderExploreBlocksButton(this, body, state, blockType);
	}

	renderRuleExpandDialog(this: KnoxGuiWidget, state: IKnoxGuiState): void {
		knoxGuiOverlaysView.renderRuleExpandDialog(this, state);
	}

	renderPrompts(this: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiOverlaysView.renderPrompts(this, body, state);
	}

	renderPromptEditor(this: KnoxGuiWidget, state: IKnoxGuiState): void {
		knoxGuiOverlaysView.renderPromptEditor(this, state);
	}

	renderContext(this: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiOverlaysView.renderContext(this, body, state);
	}

	renderTools(this: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiOverlaysView.renderTools(this, body, state);
	}

	savePolicy(this: KnoxGuiWidget, partial: Partial<IKnoxGuiState['policy']>): void {
		knoxGuiOverlaysView.savePolicy(this, partial);
	}

	renderHistoryPage(this: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState, compact?: boolean): void {
		knoxGuiOverlaysView.renderHistoryPage(this, body, state, compact);
	}

	renderHistorySessionRow(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, session: IKnoxGuiState['historySessions'][number], index: number, sessions?: IKnoxGuiState['historySessions']): void {
		knoxGuiOverlaysView.renderHistorySessionRow(this, parent, state, session, index, sessions);
	}

	renderHistoryDeleteDialog(this: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiOverlaysView.renderHistoryDeleteDialog(this, body, state);
	}

	renderSettings(this: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState, compact: boolean): void {
		knoxGuiOverlaysView.renderSettings(this, body, state, compact);
	}
}
