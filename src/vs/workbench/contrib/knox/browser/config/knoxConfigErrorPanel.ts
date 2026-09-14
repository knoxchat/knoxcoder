/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../../../base/browser/dom.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IKnoxChatService } from '../../common/knoxChatService.js';
import { knoxSortConfigErrors } from '../../common/knoxConfigUi.js';
import { knoxNls } from '../../common/knoxI18n.js';
import { knoxGuiIconClass } from '../knoxGuiIcons.js';

/**
 * Native config-error view (T9.2): fatal vs warning list; back to chat is the overlay header.
 */
export class KnoxConfigErrorPanel extends Disposable {

	readonly element: HTMLElement;

	constructor(
		parent: HTMLElement,
		@IKnoxChatService private readonly _chatService: IKnoxChatService,
	) {
		super();
		this.element = append(parent, $('.knox-config-error'));
		this.element.setAttribute('role', 'region');
		this.element.setAttribute('aria-label', knoxNls('configErrors'));
		this._register(this._chatService.onDidChange(() => this.refresh()));
		this.refresh();
	}

	refresh(): void {
		clearNode(this.element);
		const t = (key: string) => knoxNls(key, undefined, undefined, this._chatService.language);
		append(this.element, $('h3')).textContent = t('configErrors');
		append(this.element, $('p.knox-muted')).textContent = t('pleaseResolveConfigErrors');
		const errors = knoxSortConfigErrors(this._chatService.configError);
		if (!errors.length) {
			const ok = append(this.element, $('p.knox-config-error-ok'));
			ok.textContent = t('noConfigErrorsFound');
			return;
		}
		const list = append(this.element, $('ul.knox-config-error-list'));
		for (const error of errors) {
			const item = append(list, $('li.knox-config-error-item'));
			item.classList.toggle('fatal', error.fatal === true);
			append(item, $('span')).className = knoxGuiIconClass(error.fatal ? 'exclamation-circle' : 'exclamation-triangle');
			const body = append(item, $('p'));
			const strong = append(body, $('strong'));
			strong.textContent = error.fatal ? t('fatalError') : t('warning');
			body.append(` ${error.message}`);
		}
	}
}
