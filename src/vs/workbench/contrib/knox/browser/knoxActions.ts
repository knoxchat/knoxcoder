/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../nls.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { ViewAction } from '../../../browser/parts/views/viewPane.js';
import { FocusedViewContext } from '../../../common/contextkeys.js';
import { KNOX_VIEW_ID } from '../../../common/knox.js';
import { IKnoxChatService } from '../common/knoxChatService.js';
import {
	KNOX_NATIVE_FIND_COMMAND_ID,
	KNOX_NATIVE_FIND_NEXT_COMMAND_ID,
	KNOX_NATIVE_FIND_PREVIOUS_COMMAND_ID,
	KNOX_NATIVE_FOCUS_INPUT_COMMAND_ID,
	KNOX_NATIVE_FOCUS_INPUT_WITHOUT_CLEAR_COMMAND_ID,
	KNOX_NATIVE_FOCUS_INPUT_WITH_NEW_SESSION_COMMAND_ID,
	KNOX_NATIVE_FOCUS_EDIT_COMMAND_ID,
	KNOX_NATIVE_FOCUS_EDIT_WITHOUT_CLEAR_COMMAND_ID,
	KNOX_NATIVE_EXIT_EDIT_MODE_COMMAND_ID,
	KNOX_NATIVE_HIDE_FIND_COMMAND_ID,
	KNOX_NATIVE_NEW_SESSION_COMMAND_ID,
	KNOX_NATIVE_OPEN_CONFIG_COMMAND_ID,
	KNOX_NATIVE_VIEW_CONFIG_ERROR_COMMAND_ID,
	KNOX_NATIVE_ADD_MODEL_COMMAND_ID,
	KNOX_NATIVE_BATCH_DIFF_COMMAND_ID,
	KNOX_NATIVE_VIEW_STATS_COMMAND_ID,
	KNOX_NATIVE_NAVIGATE_COMMAND_ID,
	KNOX_NATIVE_CYCLE_PROFILE_COMMAND_ID,
	KNOX_NATIVE_SCROLL_TO_BOTTOM_COMMAND_ID,
	KNOX_NATIVE_SCROLL_TO_TOP_COMMAND_ID,
	KNOX_NATIVE_STICK_TO_BOTTOM_COMMAND_ID,
	KNOX_NATIVE_VIEW_HISTORY_COMMAND_ID,
	KNOX_NATIVE_VIEW_MEMORY_COMMAND_ID,
	KNOX_NATIVE_VIEW_RESTORE_COMMAND_ID,
	KNOX_NATIVE_CYCLE_PERMISSION_COMMAND_ID,
	KNOX_NATIVE_CYCLE_MODEL_COMMAND_ID,
	KNOX_NATIVE_CYCLE_MODEL_PREV_COMMAND_ID,
	KNOX_NATIVE_APPLY_CODE_COMMAND_ID,
	KNOX_NATIVE_SEND_USER_INPUT_COMMAND_ID,
	KNOX_NATIVE_FOCUS_SESSION_COMMAND_ID,
	KnoxFindVisibleContext,
	KnoxModeContext,
	KnoxNativeGuiContext,
	KnoxNativeOverlay,
	KnoxScrolledUpContext,
	KnoxSessionStreamingContext,
} from '../common/knoxChat.js';
import { knoxNavigateTarget, knoxToggleNativeOverlay } from '../common/knoxNavigate.js';
import { IKnoxAddModelDialogOptions } from '../common/knoxAddModel.js';
import { knoxConfigIcon, knoxHistoryIcon, knoxMemoryIcon, knoxRestoreIcon } from './knoxIcons.js';
import { KnoxNativeViewPane } from './knoxViewPane.js';

const nativeViewWhen = ContextKeyExpr.and(
	ContextKeyExpr.equals('view', KNOX_VIEW_ID),
	KnoxNativeGuiContext,
);

const knoxCategory = localize2('knox.category', 'Knox');

async function openNativePane(accessor: ServicesAccessor, focus = true): Promise<KnoxNativeViewPane | undefined> {
	const viewsService = accessor.get(IViewsService);
	const view = await viewsService.openView<KnoxNativeViewPane>(KNOX_VIEW_ID, focus);
	return view ?? viewsService.getViewWithId<KnoxNativeViewPane>(KNOX_VIEW_ID) ?? undefined;
}

async function showNativeOverlay(accessor: ServicesAccessor, overlay: KnoxNativeOverlay, options?: { provider?: string }): Promise<void> {
	const pane = await openNativePane(accessor, true);
	pane?.showOverlay(overlay, options);
}

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: KNOX_NATIVE_NEW_SESSION_COMMAND_ID,
			title: localize2('knox.native.newSession', 'New Conversation'),
			category: knoxCategory,
			f1: false,
			precondition: KnoxNativeGuiContext,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const chatService = accessor.get(IKnoxChatService);
		const pane = await openNativePane(accessor, true);
		await chatService.exitEditMode();
		chatService.newSession();
		pane?.showOverlay('chat');
		pane?.focusInput({ clear: true });
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: KNOX_NATIVE_VIEW_HISTORY_COMMAND_ID,
			title: localize2('knox.native.viewHistory', 'View History'),
			category: knoxCategory,
			icon: knoxHistoryIcon,
			f1: false,
			precondition: KnoxNativeGuiContext,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		await showNativeOverlay(accessor, 'history');
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: KNOX_NATIVE_VIEW_MEMORY_COMMAND_ID,
			title: localize2('knox.native.viewMemory', 'View Memory'),
			category: knoxCategory,
			icon: knoxMemoryIcon,
			f1: false,
			precondition: KnoxNativeGuiContext,
			menu: {
				id: MenuId.ViewTitle,
				group: 'navigation',
				order: 1,
				when: nativeViewWhen,
			},
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		await showNativeOverlay(accessor, 'memory');
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: KNOX_NATIVE_OPEN_CONFIG_COMMAND_ID,
			title: localize2('knox.native.openConfig', 'Settings'),
			category: knoxCategory,
			icon: knoxConfigIcon,
			f1: false,
			precondition: KnoxNativeGuiContext,
			menu: {
				id: MenuId.ViewTitle,
				group: 'navigation',
				order: 2,
				when: nativeViewWhen,
			},
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		await showNativeOverlay(accessor, 'config');
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: KNOX_NATIVE_VIEW_CONFIG_ERROR_COMMAND_ID,
			title: localize2('knox.native.viewConfigError', 'View Config Errors'),
			category: knoxCategory,
			f1: false,
			precondition: KnoxNativeGuiContext,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		await showNativeOverlay(accessor, 'configError');
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: KNOX_NATIVE_ADD_MODEL_COMMAND_ID,
			title: localize2('knox.native.addModel', 'Add Model'),
			category: knoxCategory,
			f1: false,
			precondition: KnoxNativeGuiContext,
		});
	}

	async run(accessor: ServicesAccessor, options?: IKnoxAddModelDialogOptions): Promise<void> {
		const pane = await openNativePane(accessor, true);
		pane?.openAddModelDialog(options);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: KNOX_NATIVE_BATCH_DIFF_COMMAND_ID,
			title: localize2('knox.native.batchDiff', 'Batch Diff'),
			category: knoxCategory,
			f1: false,
			precondition: KnoxNativeGuiContext,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		await showNativeOverlay(accessor, 'batchDiff');
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: KNOX_NATIVE_VIEW_STATS_COMMAND_ID,
			title: localize2('knox.native.viewStats', 'Token Usage'),
			category: knoxCategory,
			f1: false,
			precondition: KnoxNativeGuiContext,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		await showNativeOverlay(accessor, 'stats');
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: KNOX_NATIVE_NAVIGATE_COMMAND_ID,
			title: localize2('knox.native.navigateTo', 'Navigate Knox View'),
			category: knoxCategory,
			f1: false,
			precondition: KnoxNativeGuiContext,
		});
	}

	async run(accessor: ServicesAccessor, path?: string, toggle?: boolean): Promise<void> {
		const pane = await openNativePane(accessor, true);
		if (!pane) {
			return;
		}
		const target = knoxNavigateTarget(path);
		if (!target) {
			return;
		}
		pane.showOverlay(knoxToggleNativeOverlay(pane.overlay, target.overlay, toggle === true), { provider: target.provider });
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: KNOX_NATIVE_CYCLE_PROFILE_COMMAND_ID,
			title: localize2('knox.native.cycleProfile', 'Cycle Knox Profile'),
			category: knoxCategory,
			f1: false,
			precondition: KnoxNativeGuiContext,
		});
	}

	run(accessor: ServicesAccessor): void {
		accessor.get(IKnoxChatService).cycleProfile();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: KNOX_NATIVE_VIEW_RESTORE_COMMAND_ID,
			title: localize2('knox.native.viewRestore', 'View Checkpoints'),
			category: knoxCategory,
			icon: knoxRestoreIcon,
			f1: false,
			precondition: KnoxNativeGuiContext,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		await showNativeOverlay(accessor, 'restore');
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: KNOX_NATIVE_FOCUS_INPUT_COMMAND_ID,
			title: localize2('knox.native.focusInput', 'Focus Knox Input'),
			category: knoxCategory,
			f1: false,
			precondition: KnoxNativeGuiContext,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const chatService = accessor.get(IKnoxChatService);
		const pane = await openNativePane(accessor, true);
		// GUI `focusKnoxInput`: persist-if-history + clear code-to-edit, same session.
		await chatService.focusKnoxInput();
		pane?.showOverlay('chat');
		pane?.focusInput();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: KNOX_NATIVE_FOCUS_INPUT_WITHOUT_CLEAR_COMMAND_ID,
			title: localize2('knox.native.focusInputWithoutClear', 'Focus Knox Input Without Clear'),
			category: knoxCategory,
			f1: false,
			precondition: KnoxNativeGuiContext,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const viewsService = accessor.get(IViewsService);
		const existing = viewsService.getViewWithId<KnoxNativeViewPane>(KNOX_VIEW_ID);
		if (existing?.isInputFocused()) {
			await accessor.get(ICommandService).executeCommand('workbench.action.closeAuxiliaryBar');
			return;
		}
		const pane = await openNativePane(accessor, true);
		pane?.focusInput();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: KNOX_NATIVE_FOCUS_INPUT_WITH_NEW_SESSION_COMMAND_ID,
			title: localize2('knox.native.focusInputWithNewSession', 'Focus Knox Input With New Session'),
			category: knoxCategory,
			f1: false,
			precondition: KnoxNativeGuiContext,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const viewsService = accessor.get(IViewsService);
		const chatService = accessor.get(IKnoxChatService);
		const existing = viewsService.getViewWithId<KnoxNativeViewPane>(KNOX_VIEW_ID);
		if (existing?.isInputFocused()) {
			if (chatService.history.length === 0) {
				await accessor.get(ICommandService).executeCommand('workbench.action.closeAuxiliaryBar');
				return;
			}
			await chatService.exitEditMode();
			chatService.newSession();
			existing.showOverlay('chat');
			existing.focusInput({ clear: true });
			return;
		}
		const pane = await openNativePane(accessor, true);
		await chatService.exitEditMode();
		chatService.newSession();
		pane?.showOverlay('chat');
		pane?.focusInput({ clear: true });
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: KNOX_NATIVE_FOCUS_EDIT_COMMAND_ID,
			title: localize2('knox.native.focusEdit', 'Focus Knox Edit'),
			category: knoxCategory,
			f1: false,
			precondition: KnoxNativeGuiContext,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const chatService = accessor.get(IKnoxChatService);
		const pane = await openNativePane(accessor, true);
		await chatService.focusEdit();
		pane?.showOverlay('chat');
		pane?.focusInput({ clear: true });
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: KNOX_NATIVE_FOCUS_EDIT_WITHOUT_CLEAR_COMMAND_ID,
			title: localize2('knox.native.focusEditWithoutClear', 'Focus Knox Edit Without Clear'),
			category: knoxCategory,
			f1: false,
			precondition: KnoxNativeGuiContext,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const chatService = accessor.get(IKnoxChatService);
		const pane = await openNativePane(accessor, true);
		await chatService.focusEditWithoutClear();
		pane?.showOverlay('chat');
		pane?.focusInput();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: KNOX_NATIVE_EXIT_EDIT_MODE_COMMAND_ID,
			title: localize2('knox.native.exitEditMode', 'Exit Knox Edit Mode'),
			category: knoxCategory,
			f1: false,
			precondition: KnoxNativeGuiContext,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(IKnoxChatService).exitEditMode();
	}
});

registerAction2(class extends ViewAction<KnoxNativeViewPane> {
	constructor() {
		super({
			id: 'knox.native.focusThread',
			title: localize2('knox.native.focusThread', 'Focus Knox Conversation'),
			category: knoxCategory,
			f1: false,
			viewId: KNOX_VIEW_ID,
			precondition: KnoxNativeGuiContext,
		});
	}

	runInView(_accessor: ServicesAccessor, view: KnoxNativeViewPane): void {
		view.focusThread();
	}
});

const knoxViewFocused = ContextKeyExpr.and(
	KnoxNativeGuiContext,
	ContextKeyExpr.equals(FocusedViewContext.key, KNOX_VIEW_ID),
);

registerAction2(class extends ViewAction<KnoxNativeViewPane> {
	constructor() {
		super({
			id: KNOX_NATIVE_FIND_COMMAND_ID,
			title: localize2('knox.native.find', 'Find in Conversation'),
			category: knoxCategory,
			f1: false,
			viewId: KNOX_VIEW_ID,
			precondition: KnoxNativeGuiContext,
			keybinding: {
				when: knoxViewFocused,
				primary: KeyMod.CtrlCmd | KeyCode.KeyF,
				weight: KeybindingWeight.WorkbenchContrib + 10,
			},
		});
	}

	runInView(_accessor: ServicesAccessor, view: KnoxNativeViewPane): void {
		view.openFind();
	}
});

registerAction2(class extends ViewAction<KnoxNativeViewPane> {
	constructor() {
		super({
			id: KNOX_NATIVE_HIDE_FIND_COMMAND_ID,
			title: localize2('knox.native.hideFind', 'Hide Find in Conversation'),
			category: knoxCategory,
			f1: false,
			viewId: KNOX_VIEW_ID,
			precondition: KnoxFindVisibleContext,
			keybinding: {
				when: ContextKeyExpr.and(knoxViewFocused, KnoxFindVisibleContext),
				primary: KeyCode.Escape,
				weight: KeybindingWeight.WorkbenchContrib + 10,
			},
		});
	}

	runInView(_accessor: ServicesAccessor, view: KnoxNativeViewPane): void {
		view.hideFind();
	}
});

registerAction2(class extends ViewAction<KnoxNativeViewPane> {
	constructor() {
		super({
			id: KNOX_NATIVE_FIND_NEXT_COMMAND_ID,
			title: localize2('knox.native.findNext', 'Find Next in Conversation'),
			category: knoxCategory,
			f1: false,
			viewId: KNOX_VIEW_ID,
			precondition: KnoxFindVisibleContext,
			keybinding: {
				when: ContextKeyExpr.and(knoxViewFocused, KnoxFindVisibleContext),
				primary: KeyCode.F3,
				mac: { primary: KeyMod.CtrlCmd | KeyCode.KeyG },
				weight: KeybindingWeight.WorkbenchContrib + 10,
			},
		});
	}

	runInView(_accessor: ServicesAccessor, view: KnoxNativeViewPane): void {
		view.findNext();
	}
});

registerAction2(class extends ViewAction<KnoxNativeViewPane> {
	constructor() {
		super({
			id: KNOX_NATIVE_FIND_PREVIOUS_COMMAND_ID,
			title: localize2('knox.native.findPrevious', 'Find Previous in Conversation'),
			category: knoxCategory,
			f1: false,
			viewId: KNOX_VIEW_ID,
			precondition: KnoxFindVisibleContext,
			keybinding: {
				when: ContextKeyExpr.and(knoxViewFocused, KnoxFindVisibleContext),
				primary: KeyMod.Shift | KeyCode.F3,
				mac: { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyG },
				weight: KeybindingWeight.WorkbenchContrib + 10,
			},
		});
	}

	runInView(_accessor: ServicesAccessor, view: KnoxNativeViewPane): void {
		view.findPrevious();
	}
});

registerAction2(class extends ViewAction<KnoxNativeViewPane> {
	constructor() {
		super({
			id: KNOX_NATIVE_STICK_TO_BOTTOM_COMMAND_ID,
			title: localize2('knox.native.stickToBottom', 'Stick Knox Conversation to Bottom'),
			category: knoxCategory,
			f1: false,
			viewId: KNOX_VIEW_ID,
			precondition: KnoxNativeGuiContext,
			keybinding: {
				when: ContextKeyExpr.and(knoxViewFocused, KnoxScrolledUpContext, KnoxFindVisibleContext.toNegated()),
				primary: KeyCode.Escape,
				weight: KeybindingWeight.WorkbenchContrib + 5,
			},
		});
	}

	runInView(_accessor: ServicesAccessor, view: KnoxNativeViewPane): void {
		view.stickToBottom();
	}
});

registerAction2(class extends ViewAction<KnoxNativeViewPane> {
	constructor() {
		super({
			id: KNOX_NATIVE_SCROLL_TO_TOP_COMMAND_ID,
			title: localize2('knox.native.scrollToTop', 'Scroll Knox Conversation to Top'),
			category: knoxCategory,
			f1: false,
			viewId: KNOX_VIEW_ID,
			precondition: KnoxNativeGuiContext,
		});
	}

	runInView(_accessor: ServicesAccessor, view: KnoxNativeViewPane): void {
		view.scrollToTop();
	}
});

registerAction2(class extends ViewAction<KnoxNativeViewPane> {
	constructor() {
		super({
			id: KNOX_NATIVE_SCROLL_TO_BOTTOM_COMMAND_ID,
			title: localize2('knox.native.scrollToBottom', 'Scroll Knox Conversation to Bottom'),
			category: knoxCategory,
			f1: false,
			viewId: KNOX_VIEW_ID,
			precondition: KnoxNativeGuiContext,
		});
	}

	runInView(_accessor: ServicesAccessor, view: KnoxNativeViewPane): void {
		view.scrollToBottom();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: KNOX_NATIVE_CYCLE_PERMISSION_COMMAND_ID,
			title: localize2('knox.native.cyclePermission', 'Cycle Knox Permission Mode'),
			category: knoxCategory,
			f1: false,
			precondition: ContextKeyExpr.and(
				KnoxNativeGuiContext,
				KnoxModeContext.isEqualTo('agent'),
				KnoxSessionStreamingContext.toNegated(),
			),
			keybinding: {
				when: ContextKeyExpr.and(
					KnoxNativeGuiContext,
					KnoxModeContext.isEqualTo('agent'),
					KnoxSessionStreamingContext.toNegated(),
				),
				primary: KeyMod.Shift | KeyCode.Tab,
				weight: KeybindingWeight.WorkbenchContrib + 10,
			},
		});
	}

	run(accessor: ServicesAccessor): void {
		accessor.get(IKnoxChatService).cyclePermissionMode();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: KNOX_NATIVE_CYCLE_MODEL_COMMAND_ID,
			title: localize2('knox.native.cycleChatModel', 'Next Knox Chat Model'),
			category: knoxCategory,
			f1: false,
			precondition: KnoxNativeGuiContext,
			keybinding: {
				when: KnoxNativeGuiContext,
				primary: KeyMod.CtrlCmd | KeyCode.Quote,
				weight: KeybindingWeight.WorkbenchContrib + 5,
			},
		});
	}

	run(accessor: ServicesAccessor): void {
		accessor.get(IKnoxChatService).cycleChatModel(1);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: KNOX_NATIVE_CYCLE_MODEL_PREV_COMMAND_ID,
			title: localize2('knox.native.cycleChatModelPrev', 'Previous Knox Chat Model'),
			category: knoxCategory,
			f1: false,
			precondition: KnoxNativeGuiContext,
			keybinding: {
				when: KnoxNativeGuiContext,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Quote,
				weight: KeybindingWeight.WorkbenchContrib + 5,
			},
		});
	}

	run(accessor: ServicesAccessor): void {
		accessor.get(IKnoxChatService).cycleChatModel(-1);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: KNOX_NATIVE_APPLY_CODE_COMMAND_ID,
			title: localize2('knox.native.applyCodeFromChat', 'Apply Code from Chat'),
			category: knoxCategory,
			f1: false,
			precondition: KnoxNativeGuiContext,
		});
	}

	run(accessor: ServicesAccessor): void {
		accessor.get(IKnoxChatService).requestApplyFromChat();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: KNOX_NATIVE_SEND_USER_INPUT_COMMAND_ID,
			title: localize2('knox.native.sendUserInput', 'Send Knox User Input'),
			category: knoxCategory,
			f1: false,
			precondition: KnoxNativeGuiContext,
		});
	}

	async run(accessor: ServicesAccessor, text?: string): Promise<void> {
		if (typeof text !== 'string' || !text.trim()) {
			return;
		}
		const pane = await openNativePane(accessor, true);
		pane?.showOverlay('chat');
		// GUI `Chat.tsx` `sendInput`: a generated tool waits for approval; do not
		// start a second turn from the command path either.
		if (!pane?.canSubmitInput()) {
			return;
		}
		await accessor.get(IKnoxChatService).streamResponse({ content: text, modifiers: { noContext: true } });
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: KNOX_NATIVE_FOCUS_SESSION_COMMAND_ID,
			title: localize2('knox.native.focusSession', 'Focus Knox Session'),
			category: knoxCategory,
			f1: false,
			precondition: KnoxNativeGuiContext,
		});
	}

	async run(accessor: ServicesAccessor, sessionId?: string): Promise<void> {
		if (typeof sessionId !== 'string' || !sessionId) {
			return;
		}
		const pane = await openNativePane(accessor, true);
		pane?.showOverlay('chat');
		await accessor.get(IKnoxChatService).loadSession(sessionId, true);
	}
});

