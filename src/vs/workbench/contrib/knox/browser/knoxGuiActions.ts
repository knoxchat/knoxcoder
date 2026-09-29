/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { FocusedViewContext } from '../../../common/contextkeys.js';
import { KNOX_VIEW_ID } from '../../../common/knox.js';
import { IKnoxService } from '../common/knoxService.js';
import { KnoxChatViewPane } from './knoxChatViewPane.js';
import { KnoxCheckpointGraphEditorInput, KnoxMemoryEditorInput } from './knoxGuiEditors.js';

async function knoxPane(accessor: ServicesAccessor): Promise<KnoxChatViewPane | undefined> {
	const view = await accessor.get(IViewsService).openView<KnoxChatViewPane>(KNOX_VIEW_ID, true);
	return view ?? undefined;
}

registerAction2(class extends Action2 { // KN-377 Cmd+F when Knox chat is focused
	constructor() {
		super({
			id: 'workbench.action.knox.findInChat',
			title: localize2('knox.findInChat', 'Knox: Find in Chat'),
			category: localize2('knox.category', 'Knox'),
			f1: true,
			keybinding: {
				when: FocusedViewContext.isEqualTo(KNOX_VIEW_ID),
				primary: KeyMod.CtrlCmd | KeyCode.KeyF,
				weight: KeybindingWeight.WorkbenchContrib + 10,
			},
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const pane = await knoxPane(accessor);
		pane?.focusFind();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.knox.focusInput',
			title: localize2('knox.focusInput', 'Focus Knox Input'),
			category: localize2('knox.category', 'Knox'),
			f1: true,
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const pane = await knoxPane(accessor);
		pane?.focus();
		pane?.getController()?.store.patch({ inputFocused: true });
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.knox.applyCodeFromChat',
			title: localize2('knox.applyCodeFromChat', 'Knox: Apply Code From Chat'),
			category: localize2('knox.category', 'Knox'),
			f1: true,
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const pane = await knoxPane(accessor);
		pane?.getController()?.applyCodeFromChat();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.knox.openConfigPage',
			title: localize2('knox.openConfigPage', 'Knox: Open Config'),
			category: localize2('knox.category', 'Knox'),
			f1: true,
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const pane = await knoxPane(accessor);
		pane?.getController()?.openSettingsOverlay();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.knox.newSession',
			title: localize2('knox.newSession', 'Knox: New Session'),
			category: localize2('knox.category', 'Knox'),
			f1: true,
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const pane = await knoxPane(accessor);
		await pane?.getController()?.newSession();
		await accessor.get(IKnoxService).newSession();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.knox.nativeNewSession',
			title: localize2('knox.nativeNewSession', 'Knox: New Chat Session'),
			category: localize2('knox.category', 'Knox'),
			f1: true,
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const pane = await knoxPane(accessor);
		await pane?.getController()?.newSession();
		await accessor.get(IKnoxService).newSession();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.knox.openHistory',
			title: localize2('knox.openHistory', 'Knox: Open History'),
			category: localize2('knox.category', 'Knox'),
			f1: true,
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const pane = await knoxPane(accessor);
		pane?.getController()?.store.navigate('/history');
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.knox.openSettings',
			title: localize2('knox.openSettings', 'Knox: Open Settings'),
			category: localize2('knox.category', 'Knox'),
			f1: true,
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const pane = await knoxPane(accessor);
		pane?.getController()?.store.setOverlay('settings');
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.knox.openMemory',
			title: localize2('knox.openMemoryEditor', 'Knox: Open Memory'),
			category: localize2('knox.category', 'Knox'),
			f1: true,
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(IEditorService).openEditor(new KnoxMemoryEditorInput(), { pinned: true });
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.knox.openCheckpointGraph',
			title: localize2('knox.openCheckpointGraphEditor', 'Knox: Open Checkpoint Graph'),
			category: localize2('knox.category', 'Knox'),
			f1: true,
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(IEditorService).openEditor(new KnoxCheckpointGraphEditorInput(), { pinned: true });
	}
});
