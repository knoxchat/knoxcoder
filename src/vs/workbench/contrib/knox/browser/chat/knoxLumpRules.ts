/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { getDefaultHoverDelegate } from '../../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { knoxGuiIconClass, KnoxGuiIconName } from '../knoxGuiIcons.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IKnoxChatService } from '../../common/knoxChatService.js';
import { IKnoxGuiBridge } from '../../common/knoxGuiProtocol.js';
import { IKnoxRuleCard, knoxMergeRuleCards, knoxParseYamlRules, knoxProfileIsLocal } from '../../common/knoxRules.js';

export class KnoxLumpRulesSection extends Disposable {

	readonly element: HTMLElement;

	private readonly _list: HTMLElement;
	private readonly _explore: HTMLButtonElement;
	private readonly _itemStore = this._register(new DisposableStore());

	constructor(
		parent: HTMLElement,
		@IKnoxChatService private readonly _chatService: IKnoxChatService,
		@IKnoxGuiBridge private readonly _bridge: IKnoxGuiBridge,
		@IDialogService private readonly _dialogService: IDialogService,
		@IHoverService private readonly _hoverService: IHoverService,
	) {
		super();
		this.element = append(parent, $('.knox-lump-rules'));
		this._list = append(this.element, $('.knox-lump-rule-list'));
		this._explore = append(this.element, $<HTMLButtonElement>('button.knox-lump-open-config'));
		this._explore.type = 'button';
		this._register(addDisposableListener(this._explore, 'click', () => {
			const profile = this._chatService.profile;
			if (!knoxProfileIsLocal(profile?.profileType) || !profile?.id) {
				return;
			}
			void this._bridge.post('config/openProfile', { profileId: profile.id }).catch(() => { });
		}));
		this.refresh();
	}

	refresh(): void {
		this._itemStore.clear();
		clearNode(this._list);
		const cards = knoxMergeRuleCards(
			this._chatService.config?.rules,
			knoxParseYamlRules(this._chatService.profile?.rawYaml),
		);
		for (const card of cards) {
			this._renderCard(card);
		}

		const local = knoxProfileIsLocal(this._chatService.profile?.profileType);
		clearNode(this._explore);
		append(this._explore, $('span')).className = knoxGuiIconClass(local ? 'add' : 'share');
		append(this._explore, $('span')).textContent = local
			? localize('knox.addRules', "Add Rules")
			: localize('knox.exploreRules', "Explore Rules");
	}

	private _renderCard(card: IKnoxRuleCard): void {
		const root = append(this._list, $('.knox-lump-rule-card'));
		const header = append(root, $('.knox-lump-rule-header'));
		const body = append(header, $('.knox-lump-rule-body'));
		const title = append(body, $('div.knox-lump-rule-title'));
		title.textContent = ruleTitle(card);
		const preview = append(body, $('div.knox-lump-rule-text'));
		preview.textContent = card.text;

		const actions = append(header, $('.knox-lump-rule-actions'));
		const expand = iconButton(actions, 'maximize-2', localize('knox.expand', "Expand"));
		this._itemStore.add(this._hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), expand, localize('knox.expand', "Expand")));
		this._itemStore.add(addDisposableListener(expand, 'click', () => {
			void this._dialogService.info(ruleTitle(card), card.text);
		}));
		if (card.editable) {
			const edit = iconButton(actions, 'pencil-square', localize('knox.edit', "Edit"));
			this._itemStore.add(this._hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), edit, localize('knox.edit', "Edit")));
			this._itemStore.add(addDisposableListener(edit, 'click', () => {
				void this._bridge.post('config/openProfile', { profileId: undefined }).catch(() => { });
			}));
		}
	}
}

function ruleTitle(card: IKnoxRuleCard): string {
	switch (card.titleKind) {
		case 'local': return localize('knox.locallyDefinedRule', "Locally Defined Rule");
		case 'inline': return localize('knox.inlineRule', "Inline Rule");
		case 'uses': return card.uses || localize('knox.lump.rules', "Rules");
	}
}

function iconButton(parent: HTMLElement, icon: KnoxGuiIconName, label: string): HTMLButtonElement {
	const button = append(parent, $<HTMLButtonElement>('button.knox-icon-button'));
	button.type = 'button';
	button.setAttribute('aria-label', label);
	append(button, $('span')).className = knoxGuiIconClass(icon);
	return button;
}
