/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../../../base/browser/dom.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { knoxNls } from '../../common/knoxI18n.js';
import { IKnoxChatService } from '../../common/knoxChatService.js';

/**
 * `/stats` stub (T9.6): usage is tracked at the KnoxChat provider. No charts.
 */
export class KnoxStatsPanel extends Disposable {

	readonly element: HTMLElement;

	constructor(
		parent: HTMLElement,
		@IKnoxChatService private readonly _chatService: IKnoxChatService,
	) {
		super();
		this.element = append(parent, $('.knox-stats'));
		this.element.setAttribute('role', 'region');
		this.element.setAttribute('aria-label', knoxNls('tokenUsageDashboard'));
		this._register(this._chatService.onDidChange(() => this.refresh()));
		this.refresh();
	}

	refresh(): void {
		clearNode(this.element);
		const t = (key: string) => knoxNls(key, undefined, undefined, this._chatService.language);
		append(this.element, $('h3')).textContent = t('tokenUsageDashboard');
		append(this.element, $('p.knox-muted')).textContent = t('tokenUsageKnoxChatBilling');
	}
}
