/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IViewletViewOptions } from '../../../browser/parts/views/viewsViewlet.js';
import { ViewPane, ViewPaneShowActions } from '../../../browser/parts/views/viewPane.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { MenuId } from '../../../../platform/actions/common/actions.js';
import { localize } from '../../../../nls.js';
import { registerNavigableContainer } from '../../../browser/actions/widgetNavigationCommands.js';
import { KnoxChatWidget, IKnoxInputFocusOptions } from './chat/knoxChatWidget.js';
import { IKnoxAddModelDialogOptions } from '../common/knoxAddModel.js';
import {
	KnoxInputFocusedContext,
	KnoxNativeOverlay,
	KnoxOverlayContext,
} from '../common/knoxChat.js';

/**
 * Native workbench pane for the Knox sidebar: thread + input chrome, with
 * History / Memory / Config / Checkpoints overlays handled in-pane.
 */
export class KnoxViewPane extends ViewPane {

	private _widget: KnoxChatWidget | undefined;
	private readonly _overlayKey: IContextKey<KnoxNativeOverlay>;
	private readonly _inputFocusedKey: IContextKey<boolean>;

	constructor(
		options: IViewletViewOptions,
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
		super(
			{ ...options, titleMenuId: MenuId.ViewTitle, showActions: ViewPaneShowActions.WhenExpanded },
			keybindingService,
			contextMenuService,
			configurationService,
			contextKeyService,
			viewDescriptorService,
			instantiationService,
			openerService,
			themeService,
			hoverService,
		);
		this._overlayKey = KnoxOverlayContext.bindTo(this.scopedContextKeyService);
		this._inputFocusedKey = KnoxInputFocusedContext.bindTo(this.scopedContextKeyService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		container.classList.add('knox-native-view');
		container.setAttribute('aria-label', localize('knox.nativePane', "Knox chat"));
		this._widget = this._register(this.instantiationService.createInstance(KnoxChatWidget, container));
		this._syncOverlayKey();
		this._register(this._widget.onDidChangeOverlay(() => this._syncOverlayKey()));
		this._register(this._widget.onDidFocusInput(() => this._inputFocusedKey.set(true)));
		this._register(this._widget.onDidBlurInput(() => this._inputFocusedKey.set(false)));
		this._register(registerNavigableContainer({
			name: 'knoxChat',
			focusNotifiers: [this],
			focusNextWidget: () => this._widget?.focusInput(),
			focusPreviousWidget: () => this._widget?.focusThread(),
		}));
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		this._widget?.layout(height, width);
	}

	override focus(): void {
		super.focus();
		this.focusInput();
	}

	focusInput(options?: IKnoxInputFocusOptions): void {
		this._widget?.focusInput(options);
		this._inputFocusedKey.set(true);
	}

	focusThread(): void {
		this._widget?.focusThread();
		this._inputFocusedKey.set(false);
	}

	isInputFocused(): boolean {
		return this._widget?.isInputFocused() === true;
	}

	clearInput(): void {
		this._widget?.clearInput();
	}

	showOverlay(overlay: KnoxNativeOverlay, options?: { provider?: string }): void {
		this._widget?.showOverlay(overlay, options);
		this._syncOverlayKey();
	}

	openAddModelDialog(options?: IKnoxAddModelDialogOptions): void {
		this._widget?.openAddModelDialog(options);
		this._syncOverlayKey();
	}

	openFind(): void {
		this._widget?.openFind();
	}

	hideFind(): void {
		this._widget?.hideFind();
	}

	findNext(): void {
		this._widget?.findNext();
	}

	findPrevious(): void {
		this._widget?.findPrevious();
	}

	scrollToTop(): void {
		this._widget?.scrollToTop();
	}

	scrollToBottom(): void {
		this._widget?.scrollToBottom();
	}

	stickToBottom(): void {
		this._widget?.stickToBottom();
	}

	get overlay(): KnoxNativeOverlay {
		return this._widget?.overlay ?? 'chat';
	}

	accessibleContent(): string {
		return this._widget?.accessibleContent() ?? localize('knox.nativePane', "Knox chat");
	}

	private _syncOverlayKey(): void {
		this._overlayKey.set(this.overlay);
	}
}

/** Alias for existing ViewAction typings. */
export { KnoxViewPane as KnoxNativeViewPane };
