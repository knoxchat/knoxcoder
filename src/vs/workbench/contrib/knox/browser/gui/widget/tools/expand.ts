/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Nested-card expand state for terminals, trees and search (and subdirectory tabs). */

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { setCollapseChevronExpanded } from '../controls.js';
import { IKnoxGuiToolCall } from '../../../../common/knoxGuiState.js';
import { syncTerminalCard } from './terminal.js';

export function cardExpanded(widget: KnoxGuiWidget, id: string, defaultExpanded: boolean): boolean {
	if (widget.toolCardExpanded.has(id)) {
		return true;
	}
	if (widget.toolBodyCollapsed.has(`card:${id}`)) {
		return false;
	}
	return defaultExpanded;
}

export function toggleCardExpanded(widget: KnoxGuiWidget, id: string, defaultExpanded: boolean): void {
	const open = widget.cardExpanded(id, defaultExpanded);
	if (open) {
		widget.toolCardExpanded.delete(id);
		widget.toolBodyCollapsed.add(`card:${id}`);
	} else {
		widget.toolBodyCollapsed.delete(`card:${id}`);
		widget.toolCardExpanded.add(id);
	}
	const term = Array.from(widget.root.querySelectorAll<HTMLElement>('[data-testid="knox-gui-term"]')).find(el => el.dataset.toolId === id);
	if (term) {
		const tool = findToolById(widget, id);
		if (tool) {
			syncTerminalCard(widget, term, widget.controller.store.state, tool);
			return;
		}
	}
	const card = widget.root.querySelector(`[data-card-id="${CSS.escape(id)}"]`) as HTMLElement | null;
	if (card) {
		const next = widget.cardExpanded(id, defaultExpanded);
		card.querySelector('.knox-gui-tree-head, .knox-gui-search-head, .knox-gui-term-head')?.classList.toggle('collapsed', !next);
		const body = card.querySelector('.knox-gui-tree-body, .knox-gui-search-body, .knox-gui-term-body') as HTMLElement | null;
		if (body) {
			body.hidden = !next;
		}
		const chevron = card.querySelector('.knox-gui-collapse-chevron') as HTMLElement | null;
		if (chevron) {
			setCollapseChevronExpanded(chevron, next);
		}
		if (body || !next) {
			return;
		}
	}
	widget.render();
}

function findToolById(widget: KnoxGuiWidget, id: string): IKnoxGuiToolCall | undefined {
	for (const item of widget.controller.store.state.history) {
		const match = item.toolCalls?.find(tool => tool.id === id);
		if (match) {
			return match;
		}
	}
	return undefined;
}

export function setCardTab(widget: KnoxGuiWidget, id: string, tab: string): void {
	widget.toolCardTab.set(id, tab);
	widget.render();
}
