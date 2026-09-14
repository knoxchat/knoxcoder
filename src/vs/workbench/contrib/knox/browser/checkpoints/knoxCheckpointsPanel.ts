/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { knoxCheckpointTabIcon, knoxGuiIconClass } from '../knoxGuiIcons.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import {
	KNOX_CHECKPOINT_TABS,
	KnoxCheckpointPanelTab,
} from '../../common/knoxCheckpoints.js';
import { KnoxCheckpointList } from './knoxCheckpointList.js';
import {
	KnoxCheckpointAnalysisView,
	KnoxCheckpointConfigView,
	KnoxCheckpointDashboardView,
	KnoxCheckpointShareView,
	KnoxCheckpointTimelineView,
} from './knoxCheckpointTabs.js';

/**
 * Native checkpoints overlay / Lump section (T7.3–T7.11).
 */
export class KnoxCheckpointsPanel extends Disposable {

	readonly element: HTMLElement;

	private readonly _tabs: HTMLElement;
	private readonly _body: HTMLElement;
	private readonly _tabStore = this._register(new DisposableStore());
	private readonly _bodyStore = this._register(new DisposableStore());
	private _tab: KnoxCheckpointPanelTab = 'checkpoints';
	private _list: KnoxCheckpointList | undefined;

	private readonly _onDidChangeHeight = this._register(new Emitter<void>());
	readonly onDidChangeHeight = this._onDidChangeHeight.event;

	constructor(
		parent: HTMLElement,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		super();
		this.element = append(parent, $('.knox-checkpoints'));
		this.element.setAttribute('role', 'region');
		this.element.setAttribute('aria-label', localize('knox.checkpoints', "Checkpoints"));
		this._tabs = append(this.element, $('.knox-checkpoint-tabs'));
		this._tabs.setAttribute('role', 'tablist');
		this._body = append(this.element, $('.knox-checkpoint-body'));
		this._renderTabs();
		this._renderBody();
	}

	refresh(): void {
		this._renderBody();
	}

	private _renderTabs(): void {
		this._tabStore.clear();
		clearNode(this._tabs);
		for (const id of KNOX_CHECKPOINT_TABS) {
			const button = append(this._tabs, $<HTMLButtonElement>('button.knox-checkpoint-tab-btn'));
			button.type = 'button';
			button.setAttribute('role', 'tab');
			button.setAttribute('aria-selected', String(this._tab === id));
			button.classList.toggle('selected', this._tab === id);
			button.title = tabLabel(id);
			append(button, $('span')).className = knoxGuiIconClass(knoxCheckpointTabIcon(id));
			const label = append(button, $('span.knox-checkpoint-tab-label'));
			label.textContent = tabLabel(id);
			this._tabStore.add(addDisposableListener(button, 'click', () => {
				if (this._tab === id) {
					return;
				}
				this._tab = id;
				this._renderTabs();
				this._renderBody();
			}));
		}
	}

	private _renderBody(): void {
		this._bodyStore.clear();
		clearNode(this._body);
		this._list = undefined;
		if (this._tab === 'checkpoints') {
			this._list = this._bodyStore.add(this._instantiationService.createInstance(KnoxCheckpointList, this._body));
			this._bodyStore.add(this._list.onDidChangeHeight(() => this._onDidChangeHeight.fire()));
		} else if (this._tab === 'timeline') {
			const listHost = append(this._body, $('.hidden'));
			this._list = this._bodyStore.add(this._instantiationService.createInstance(KnoxCheckpointList, listHost));
			this._bodyStore.add(this._instantiationService.createInstance(KnoxCheckpointTimelineView, this._body, this._list));
		} else if (this._tab === 'analysis') {
			this._bodyStore.add(this._instantiationService.createInstance(KnoxCheckpointAnalysisView, this._body));
		} else if (this._tab === 'dashboard') {
			this._bodyStore.add(this._instantiationService.createInstance(KnoxCheckpointDashboardView, this._body));
		} else if (this._tab === 'share') {
			this._bodyStore.add(this._instantiationService.createInstance(KnoxCheckpointShareView, this._body));
		} else {
			this._bodyStore.add(this._instantiationService.createInstance(KnoxCheckpointConfigView, this._body));
		}
		this._onDidChangeHeight.fire();
	}
}

function tabLabel(tab: KnoxCheckpointPanelTab): string {
	switch (tab) {
		case 'checkpoints': return localize('knox.checkpoints', "Checkpoints");
		case 'timeline': return localize('knox.checkpointTimeline.tab', "Timeline");
		case 'analysis': return localize('knox.checkpointAnalysis.tab', "Analysis");
		case 'dashboard': return localize('knox.checkpointDashboard.tab', "Dashboard");
		case 'share': return localize('knox.checkpointShare.tab', "Share");
		case 'configuration': return localize('knox.configuration', "Configuration");
	}
}
