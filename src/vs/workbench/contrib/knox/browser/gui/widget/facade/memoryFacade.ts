/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { KnoxGuiPagesFacade } from './pagesFacade.js';
import { IKnoxGuiState } from '../../../../common/knoxGuiState.js';
import * as knoxGuiMemoryView from '../memory.js';

/** Memory pages: overview, browser, sessions, graph, settings (`widget/memory/`). */
export abstract class KnoxGuiMemoryFacade extends KnoxGuiPagesFacade {
	renderMemory(this: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiMemoryView.renderMemory(this, body, state);
	}

	renderMemoryOverview(this: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiMemoryView.renderMemoryOverview(this, body, state);
	}

	renderMemoryBrowser(this: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiMemoryView.renderMemoryBrowser(this, body, state);
	}

	renderMemorySessions(this: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiMemoryView.renderMemorySessions(this, body, state);
	}

	renderMemoryGraph(this: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiMemoryView.renderMemoryGraph(this, body, state);
	}

	renderMemorySettings(this: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiMemoryView.renderMemorySettings(this, body, state);
	}
}
