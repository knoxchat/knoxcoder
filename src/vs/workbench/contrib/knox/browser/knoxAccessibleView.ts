/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { AccessibleViewProviderId, AccessibleViewType, IAccessibleViewContentProvider, IAccessibleViewOptions } from '../../../../platform/accessibility/browser/accessibleView.js';
import { IAccessibleViewImplementation } from '../../../../platform/accessibility/browser/accessibleViewRegistry.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { AccessibilityVerbositySettingId } from '../../accessibility/browser/accessibilityConfiguration.js';
import { FocusedViewContext } from '../../../common/contextkeys.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { KNOX_VIEW_ID } from '../../../common/knox.js';
import { KnoxNativeGuiContext } from '../common/knoxChat.js';
import { KnoxNativeViewPane } from './knoxViewPane.js';

export class KnoxAccessibilityHelp implements IAccessibleViewImplementation {
	readonly priority = 95;
	readonly name = 'knox';
	readonly type = AccessibleViewType.Help;
	readonly when = ContextKeyExpr.and(
		KnoxNativeGuiContext,
		ContextKeyExpr.equals(FocusedViewContext.key, KNOX_VIEW_ID),
	);

	getProvider(accessor: ServicesAccessor): KnoxAccessibilityHelpProvider | undefined {
		const viewsService = accessor.get(IViewsService);
		const pane = viewsService.getActiveViewWithId<KnoxNativeViewPane>(KNOX_VIEW_ID)
			?? viewsService.getViewWithId<KnoxNativeViewPane>(KNOX_VIEW_ID);
		if (!pane) {
			return undefined;
		}
		return new KnoxAccessibilityHelpProvider(pane);
	}
}

class KnoxAccessibilityHelpProvider extends Disposable implements IAccessibleViewContentProvider {
	readonly id = AccessibleViewProviderId.Knox;
	readonly verbositySettingKey = AccessibilityVerbositySettingId.Chat;
	readonly options: IAccessibleViewOptions = { type: AccessibleViewType.Help };

	constructor(private readonly _pane: KnoxNativeViewPane) {
		super();
	}

	onClose(): void {
		this._pane.focus();
	}

	provideContent(): string {
		const content: string[] = [];
		content.push(localize('knox.a11y.header', "Accessibility Help: Knox Chat"));
		content.push(localize('knox.a11y.context', "You are in the native Knox sidebar. The thread lists the conversation. The input at the bottom sends a message."));
		content.push('');
		content.push(localize('knox.a11y.thread', "Conversation:"));
		content.push(this._pane.accessibleContent() || localize('knox.a11y.empty', "The conversation is empty."));
		content.push('');
		content.push(localize('knox.a11y.keys', "Keyboard:"));
		content.push(localize('knox.a11y.enter', "- Enter in the input sends the message. Shift+Enter inserts a newline."));
		content.push(localize('knox.a11y.cancel', "- Ctrl/Cmd+Backspace cancels a streaming response."));
		content.push(localize('knox.a11y.mention', "- Type @ then Arrow keys and Enter to insert a mention. Escape closes the mention list."));
		content.push(localize('knox.a11y.approve', "- When a tool needs permission, Tab to Deny / Always / Approve. Enter activates the focused button."));
		content.push(localize('knox.a11y.history', "- Open History from the title bar, then Arrow keys and Enter load a conversation."));
		content.push(localize('knox.a11y.find', "- Ctrl/Cmd+F searches the conversation. Escape closes find, or sticks the thread to the bottom if you scrolled up."));
		content.push(localize('knox.a11y.title', "- Title bar actions start a new conversation and open History, Memory, and Settings overlays."));
		return content.join('\n');
	}
}
