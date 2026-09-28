/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { t } from '../t.js';
import * as DOM from '../../../../../../../base/browser/dom.js';
import { appendKnoxGuiSvg } from '../../knoxGuiIcons.js';
import { visibleToolOutputPeekItems } from '../../../../common/knoxGuiPanels.js';
import { IKnoxGuiContextItem, IKnoxGuiHistoryItem, IKnoxGuiState } from '../../../../common/knoxGuiState.js';
import { knoxGuiContextItemFileIconName } from '../../../../common/knoxGuiTranscript.js';

/** `ContextItemsPeek.tsx`: collapsed by default; rows open the item. The latest turn shows gathering progress. */
export function renderHistoryContextPeek(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiHistoryItem): void {
	const lastUser = [...state.history].reverse().find(h => h.role === 'user');
	renderContextItemsPeek(widget, parent, state, item.id, item.contextItems ?? [], !!state.isGatheringContext && lastUser?.id === item.id);
}

export function renderContextItemsPeek(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, key: string, all: readonly IKnoxGuiContextItem[], gathering: boolean): void {
	const items = all.filter(ctx => !ctx.hidden);
	if (!items.length && !gathering) {
		return;
	}
	const open = widget.contextPeekOpen.has(key);
	const peek = DOM.append(parent, DOM.$('.knox-gui-context-peek'));
	const toggle = DOM.append(peek, DOM.$('button.knox-gui-context-peek-title')) as HTMLButtonElement;
	toggle.type = 'button';
	toggle.setAttribute('data-testid', 'context-items-peek');
	toggle.setAttribute('aria-expanded', String(open));
	appendKnoxGuiSvg(toggle, open ? 'chevron-down' : 'chevron-right', 14);
	if (gathering) {
		DOM.append(toggle, DOM.$('span.knox-gui-thinking-dots', undefined, t(state, 'gatheringContext')));
	} else {
		toggle.append(t(state, 'relatedContextItems', { count: items.length }));
	}
	widget.renderStore.add(DOM.addDisposableListener(toggle, 'click', () => {
		if (open) {
			widget.contextPeekOpen.delete(key);
		} else {
			widget.contextPeekOpen.add(key);
		}
		widget.render();
	}));
	if (!open) {
		return;
	}
	const list = DOM.append(peek, DOM.$('.knox-gui-context-peek-list'));
	for (const ctx of items) {
		renderContextPeekItem(widget, list, ctx);
	}
}

/** `ContextItemsPeekItem`: icon, name, cyan description (file basename for files), arrow for URLs. */
export function renderContextPeekItem(widget: KnoxGuiWidget, parent: HTMLElement, ctx: IKnoxGuiContextItem, store = widget.renderStore): HTMLElement {
	const row = DOM.append(parent, DOM.$('.knox-gui-context-peek-item'));
	row.setAttribute('data-testid', 'context-items-peek-item');
	row.setAttribute('role', 'button');
	row.tabIndex = 0;
	const iconName = knoxGuiContextItemFileIconName(ctx);
	if (ctx.icon && /^(https?:|data:image\/)/.test(ctx.icon)) {
		const img = DOM.append(row, DOM.$('img.knox-gui-context-peek-icon')) as HTMLImageElement;
		img.src = ctx.icon;
		img.alt = '';
		img.onerror = () => img.remove();
	} else if (iconName) {
		widget.appendFileIcon(row, iconName, 18).classList.add('knox-gui-context-peek-icon');
	} else {
		DOM.append(row, DOM.$(`span.knox-gui-context-peek-icon.codicon.${contextProviderCodicon(ctx.provider)}`));
	}
	DOM.append(row, DOM.$('span.knox-gui-context-peek-name', undefined, ctx.name));
	const description = ctx.uri && ctx.description ? ctx.description.split('/').pop() ?? ctx.description : ctx.description ?? '';
	DOM.append(row, DOM.$('span.knox-gui-context-peek-desc', undefined, description));
	if (ctx.url) {
		row.classList.add('knox-gui-context-peek-url');
		DOM.append(row, DOM.$('span.knox-gui-context-peek-arrow.codicon.codicon-arrow-up-right'));
	}
	const openItem = (e: Event) => {
		e.preventDefault();
		widget.controller.openContextItem(ctx);
	};
	store.add(DOM.addDisposableListener(row, 'click', openItem));
	store.add(DOM.addDisposableListener(row, 'keydown', (e: KeyboardEvent) => {
		if (e.key === 'Enter' || e.key === ' ') {
			openItem(e);
		}
	}));
	return row;
}

/** Codicons standing in for the reference provider icons (`AtMentionDropdown` getIconFromDropdownItem). */
function contextProviderCodicon(provider: string | undefined): string {
	switch (provider) {
		case 'file': case 'currentFile': case 'open': return 'codicon-file';
		case 'folder': case 'tree': return 'codicon-folder';
		case 'codebase': case 'search': return 'codicon-search';
		case 'terminal': return 'codicon-terminal';
		case 'diff': case 'problems': return 'codicon-diff';
		case 'url': case 'web': case 'docs': return 'codicon-globe';
		case 'code': return 'codicon-symbol-method';
		case 'os': return 'codicon-device-desktop';
		case 'clipboard': return 'codicon-clippy';
		case 'debugger': return 'codicon-debug';
		default: return 'codicon-symbol-misc';
	}
}

export function renderToolOutputPeek(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiHistoryItem): void {
	const raw = item.toolCalls?.flatMap(call => call.outputItems ?? []) ?? [];
	const items = visibleToolOutputPeekItems(raw.length ? raw : (item.content.trim() ? [{ name: 'Tool', content: item.content }] : []));
	const wrap = DOM.append(parent, DOM.$('div'));
	wrap.setAttribute('data-testid', 'knox-gui-tool-output');
	renderContextItemsPeek(widget, wrap, state, `${item.id}:tool-output`, items.map(output => ({ ...output, name: output.name || 'Tool', content: output.content ?? '' })), false);
	if (!wrap.childElementCount) {
		wrap.remove();
	}
}
