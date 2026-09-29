/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Checkpoint page shell: tab bar, tab routing, graph force-mount and dialogs. */

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { t } from '../t.js';
import * as DOM from '../../../../../../../base/browser/dom.js';
import type { KnoxGuiSvgIcon } from '../../knoxGuiIcons.js';
import {
	CHECKPOINT_PANEL_TABS,
	CHECKPOINT_TAB_I18N_KEY,
	CHECKPOINT_TAB_ICON,
	checkpointGraphForceMountKey,
	checkpointShellAction,
	checkpointShellMessageKey,
	checkpointShellViewState,
} from '../../../../common/knoxGuiCheckpoints.js';
import { IKnoxGuiState } from '../../../../common/knoxGuiState.js';
import { renderCheckpointDetailsDialog } from '../checkpointDetails.js';
import { renderCheckpointGraph } from '../checkpointGraph.js';
import { renderCheckpointTimeline } from './timeline.js';

export function renderCheckpoints(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
	body.classList.add('knox-gui-checkpoint-page');
	body.setAttribute('data-testid', 'knox-gui-checkpoints');
	const shell = checkpointShellViewState(state.checkpointShell?.state, state.checkpoints.length, state.checkpointShell?.checkpointCount);
	const tabBar = DOM.append(body, DOM.$('.knox-gui-checkpoint-tab-bar'));
	const tabs = DOM.append(tabBar, DOM.$('.knox-gui-checkpoint-tabs'));
	tabs.setAttribute('data-testid', 'checkpoint-panel-tabs');
	tabs.setAttribute('role', 'tablist');
	for (const tab of CHECKPOINT_PANEL_TABS) {
		widget.chromeButton(tabs, {
			svg: CHECKPOINT_TAB_ICON[tab] as KnoxGuiSvgIcon,
			svgSize: 16,
			label: t(state, CHECKPOINT_TAB_I18N_KEY[tab]),
			title: t(state, CHECKPOINT_TAB_I18N_KEY[tab]),
			selected: state.checkpointView === tab,
			extraClass: 'knox-gui-checkpoint-tab',
			onClick: () => widget.controller.setCheckpointTab(tab),
		});
	}
	const panel = DOM.append(body, DOM.$('.knox-gui-checkpoint-panel'));
	if (shell !== 'ready') {
		widget.releaseCheckpointGraph();
	} else {
		mountCheckpointGraph(widget, panel, state);
	}
	if (state.checkpointView === 'graph' && shell !== 'ready') {
		const empty = DOM.append(panel, DOM.$('.knox-gui-checkpoint-shell'));
		DOM.append(empty, DOM.$('h1.knox-gui-checkpoint-shell-title', undefined, t(state, 'checkpointGraph.title')));
		const status = DOM.append(empty, DOM.$('p.knox-gui-muted', undefined, t(state, checkpointShellMessageKey(shell), { count: state.checkpointShell?.checkpointCount ?? 0 })));
		status.setAttribute('data-testid', 'checkpoint-graph-status');
		const action = checkpointShellAction(shell);
		if (action) {
			widget.chromeButton(empty, {
				label: t(state, action.key),
				disabled: state.checkpointGraphActionBusy,
				testId: 'checkpoint-graph-shell-action',
				onClick: () => void widget.controller.runCheckpointGraphAction(action.action),
			});
		}
	} else {
		if (state.checkpointView === 'timeline') {
			renderCheckpointTimeline(widget, panel, state);
		} else if (state.checkpointView === 'configuration') {
			widget.renderCheckpointConfig(panel, state);
		} else if (state.checkpointView === 'dashboard') {
			widget.renderCheckpointDashboard(panel, state);
		} else if (state.checkpointView === 'analysis') {
			widget.renderCheckpointAnalysis(panel, state);
		} else if (state.checkpointView === 'share') {
			widget.renderCheckpointShare(panel, state);
		} else if (state.checkpointView !== 'graph') {
			widget.renderCheckpointList(panel, state);
		}
	}
	renderCheckpointDetailsDialog(widget, body, state);
	if (state.checkpointDialog === 'restore') {
		widget.renderRestorePreviewDialog(body, state);
	} else if (state.checkpointDialog === 'compare') {
		widget.renderCompareDialog(body, state);
	}
}

function mountCheckpointGraph(widget: KnoxGuiWidget, panel: HTMLElement, state: IKnoxGuiState): void {
	const key = checkpointGraphForceMountKey({
		checkpoints: state.checkpoints,
		branches: state.checkpointBranches,
		ui: state.checkpointGraphUi,
		workingTreePaths: state.checkpointWorkingTreePaths,
		headId: state.checkpointHeadId,
		workspace: state.checkpointActiveWorkspace,
		hasMore: state.checkpointGraphHasMore,
		loadMoreError: state.checkpointGraphLoadMoreError,
		findOpen: widget.checkpointGraphFindOpen,
		findQuery: widget.checkpointGraphFindQuery,
		findIndex: widget.checkpointGraphFindIndex,
		findOpenDetails: widget.checkpointGraphFindOpenDetails,
		openId: widget.checkpointGraphOpenId,
		menu: widget.checkpointGraphMenu,
		prompt: widget.checkpointGraphPrompt,
		promptValue: widget.checkpointGraphPromptValue,
		settingsOpen: widget.checkpointGraphSettingsOpen,
		compare: widget.checkpointGraphCompare,
		comparePaths: widget.checkpointGraphComparePaths,
		compareError: widget.checkpointGraphCompareError,
		armCompare: widget.checkpointGraphArmCompare,
		scrollTop: widget.checkpointGraphScrollTop,
		viewport: widget.checkpointGraphViewport,
		pendingHead: widget.checkpointGraphPendingHead,
		expandedFolders: [...widget.checkpointGraphExpandedFolders],
	});
	if (!widget.checkpointGraphMount) {
		widget.checkpointGraphMount = DOM.$('.knox-gui-graph-force-mount');
		widget.checkpointGraphMount.setAttribute('data-testid', 'checkpoint-graph-mount');
	}
	const host = widget.checkpointGraphMount;
	const reuse = widget.checkpointGraphRenderKey === key && host.childElementCount > 0;
	if (!reuse) {
		widget.checkpointGraphStore.clear();
		host.replaceChildren();
		widget.listenerStore = widget.checkpointGraphStore;
		try {
			renderCheckpointGraph(widget, host, state);
		} finally {
			widget.listenerStore = widget.renderStore;
		}
		widget.checkpointGraphRenderKey = key;
	} else {
		widget.checkpointGraphFindInput = host.querySelector('[data-testid="checkpoint-graph-find"] input') as HTMLInputElement | undefined;
	}
	host.classList.toggle('hidden', state.checkpointView !== 'graph');
	host.setAttribute('aria-hidden', state.checkpointView === 'graph' ? 'false' : 'true');
	panel.appendChild(host);
}
