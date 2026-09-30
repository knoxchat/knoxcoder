/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Memory page shell: tab bar, tab-load dispatch and routing to the five tab renderers. */

import * as DOM from '../../../../../../../base/browser/dom.js';
import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { t } from '../t.js';
import { KnoxGuiRoute } from '../../../../common/knoxGuiProtocol.js';
import { KnoxGuiSvgIcon } from '../../knoxGuiIcons.js';
import { MEMORY_TAB_ICONS, MEMORY_TAB_IDS, MEMORY_TAB_KEYS } from '../../../../common/knoxGuiMemory.js';
import { IKnoxGuiState } from '../../../../common/knoxGuiState.js';
import { renderLanguageToggle } from '../languageToggle.js';
import { mk, svg } from './kit.js';

/** `index.tsx`: Brain / Database / Settings are `text-knoxcyan`; the inline Sessions and Graph svgs use `currentColor`. */
const MEMORY_TEAL_TAB_ICONS = new Set(['overview', 'memories', 'settings']);

export function renderMemory(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void { // KN-376
	body.classList.add('knox-gui-memory-page');
	body.setAttribute('data-testid', 'knox-gui-memory');
	if (state.lockedRoute === KnoxGuiRoute.Memory && !state.memoryTabHydrated) {
		// MemoryPanelPage.tsx renders nothing until the saved tab id is known, so Overview never flashes first.
		return;
	}
	const bar = mk(body, 'div', 'tabbar');
	const tabs = mk(bar, 'div', 'tabs');
	for (const id of MEMORY_TAB_IDS) {
		const selected = state.memoryTab === id;
		const tab = mk(tabs, 'button', selected ? 'tab selected' : 'tab');
		tab.type = 'button';
		tab.style.fontSize = `${state.fontSize - 2}px`;
		tab.setAttribute('data-testid', `knox-gui-memory-tab-${id}`);
		const icon = MEMORY_TAB_ICONS[id] as KnoxGuiSvgIcon | undefined;
		if (icon) {
			svg(tab, icon, 14, MEMORY_TEAL_TAB_ICONS.has(id) ? 'teal' : undefined);
		}
		mk(tab, 'span', '', t(state, MEMORY_TAB_KEYS[id]));
		widget.renderStore.add(DOM.addDisposableListener(tab, 'click', () => {
			widget.controller.store.patch({ memoryTab: id });
			widget.controller.messenger.post('saveMemoryViewUiState', { activeTabId: id });
			if (id === 'overview') {
				void widget.controller.loadMemoryOverview();
			} else if (id === 'memories') {
				void widget.controller.loadMemories(false);
			} else if (id === 'sessions') {
				void widget.controller.loadMemorySessions();
			} else if (id === 'graph') {
				void widget.controller.loadMemoryGraph(false);
			} else {
				void widget.controller.loadMemoryConfig();
			}
		}));
	}
	renderLanguageToggle(widget, bar, state);
	const pane = mk(body, 'div', 'body');
	const paneTestIds: Record<string, string> = {
		overview: 'knox-gui-memory-overview',
		memories: 'knox-gui-memory-browser',
		sessions: 'knox-gui-memory-sessions',
		graph: 'knox-gui-memory-graph',
		settings: 'knox-gui-memory-settings',
	};
	pane.setAttribute('data-testid', paneTestIds[state.memoryTab] ?? `knox-gui-memory-${state.memoryTab}`);
	const view = mk(pane, 'div', 'view');
	if (state.memoryActionMessage) {
		const notice = mk(view, 'div', 'banner is-notice');
		svg(notice, 'check', 14);
		mk(notice, 'span', 'flex-1', t(state, state.memoryActionMessage));
	}
	if (state.memoryTab === 'overview') {
		widget.renderMemoryOverview(view, state);
	} else if (state.memoryTab === 'memories') {
		widget.renderMemoryBrowser(view, state);
	} else if (state.memoryTab === 'sessions') {
		widget.renderMemorySessions(view, state);
	} else if (state.memoryTab === 'graph') {
		widget.renderMemoryGraph(view, state);
	} else {
		widget.renderMemorySettings(view, state);
	}
}
