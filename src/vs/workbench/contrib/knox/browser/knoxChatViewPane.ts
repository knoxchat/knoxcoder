/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IViewPaneOptions, ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { KNOX_VIEW_ID } from '../../../common/knox.js';
import { KnoxGuiController } from './knoxGuiController.js';
import { KnoxGuiMessenger } from './knoxGuiMessenger.js';
import { KnoxGuiStore } from './knoxGuiStore.js';
import { KnoxGuiWidget } from './gui/knoxGuiWidget.js';

export class KnoxChatViewPane extends ViewPane {
	static readonly ID = KNOX_VIEW_ID;

	private widget: KnoxGuiWidget | undefined;
	private controller: KnoxGuiController | undefined;

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		if (this.widget) {
			return;
		}
		const store = this._register(this.instantiationService.createInstance(KnoxGuiStore));
		const messenger = this._register(this.instantiationService.createInstance(KnoxGuiMessenger));
		this.controller = this._register(this.instantiationService.createInstance(KnoxGuiController, store, messenger));
		this.widget = this._register(this.instantiationService.createInstance(KnoxGuiWidget, container, this.controller));
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		this.widget?.layout(height, width);
	}

	override focus(): void {
		super.focus();
		this.widget?.focusInput();
	}

	isInputFocused(): boolean {
		return this.widget?.isInputFocused() ?? false;
	}

	focusFind(): void { // KN-377
		this.widget?.openFind();
	}

	getController(): KnoxGuiController | undefined {
		return this.controller;
	}
}
