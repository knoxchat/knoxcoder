/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { knoxGuiIconClass, knoxMemoryTabIcon } from '../knoxGuiIcons.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import {
	KNOX_MEMORY_TABS,
	KnoxMemoryPanelTab,
	knoxMemoryTabLabel,
} from '../../common/knoxMemory.js';
import { KnoxMemoryBrowser } from './knoxMemoryBrowser.js';
import { KnoxMemoryGraph } from './knoxMemoryGraph.js';
import { KnoxMemoryOverview } from './knoxMemoryOverview.js';
import { KnoxMemorySessions } from './knoxMemorySessions.js';
import { KnoxMemorySettings } from './knoxMemorySettings.js';

/**
 * Native Memory overlay (T8.1): Overview, Browser, Sessions, Graph, Settings.
 */
export class KnoxMemoryPanel extends Disposable {

	readonly element: HTMLElement;

	private readonly _tabs: HTMLElement;
	private readonly _body: HTMLElement;
	private readonly _tabStore = this._register(new DisposableStore());
	private readonly _bodyStore = this._register(new DisposableStore());
	private _tab: KnoxMemoryPanelTab = 'overview';
	private _child: { refresh(): void } | undefined;

	private readonly _onDidChangeHeight = this._register(new Emitter<void>());
	readonly onDidChangeHeight = this._onDidChangeHeight.event;

	constructor(
		parent: HTMLElement,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		super();
		this.element = append(parent, $('.knox-memory'));
		this.element.setAttribute('role', 'region');
		this.element.setAttribute('aria-label', localize('knox.memory', "Memory"));
		this._tabs = append(this.element, $('.knox-checkpoint-tabs'));
		this._tabs.setAttribute('role', 'tablist');
		this._body = append(this.element, $('.knox-memory-body'));
		this._renderTabs();
		this._renderBody();
	}

	refresh(): void {
		this._child?.refresh();
	}

	accessibleSummary(): string {
		return `${localize('knox.memory', "Memory")} — ${knoxMemoryTabLabel(this._tab)}`;
	}

	private _renderTabs(): void {
		this._tabStore.clear();
		clearNode(this._tabs);
		for (const id of KNOX_MEMORY_TABS) {
			const button = append(this._tabs, $<HTMLButtonElement>('button.knox-checkpoint-tab-btn'));
			button.type = 'button';
			button.setAttribute('role', 'tab');
			button.setAttribute('aria-selected', String(this._tab === id));
			button.classList.toggle('selected', this._tab === id);
			button.title = knoxMemoryTabLabel(id);
			append(button, $('span')).className = knoxGuiIconClass(knoxMemoryTabIcon(id));
			const label = append(button, $('span.knox-checkpoint-tab-label'));
			label.textContent = knoxMemoryTabLabel(id);
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
		this._child = undefined;
		if (this._tab === 'overview') {
			this._child = this._bodyStore.add(this._instantiationService.createInstance(KnoxMemoryOverview, this._body));
		} else if (this._tab === 'browser') {
			this._child = this._bodyStore.add(this._instantiationService.createInstance(KnoxMemoryBrowser, this._body));
		} else if (this._tab === 'sessions') {
			this._child = this._bodyStore.add(this._instantiationService.createInstance(KnoxMemorySessions, this._body));
		} else if (this._tab === 'graph') {
			this._child = this._bodyStore.add(this._instantiationService.createInstance(KnoxMemoryGraph, this._body));
		} else {
			this._child = this._bodyStore.add(this._instantiationService.createInstance(KnoxMemorySettings, this._body));
		}
		this._onDidChangeHeight.fire();
	}
}
