/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IStatusbarEntry, IStatusbarService, StatusbarAlignment } from '../../../services/statusbar/browser/statusbar.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IKnoxService } from '../common/knoxService.js';

export const OPEN_KNOX_CHAT_COMMAND_ID = 'workbench.action.knox.openChat';

class OpenKnoxChatAction extends Action2 {
	constructor() {
		super({
			id: OPEN_KNOX_CHAT_COMMAND_ID,
			title: localize2('knox.openChat', 'Open Knox'),
			category: localize2('knox.category', 'Knox'),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(IKnoxService).openChat();
	}
}

registerAction2(OpenKnoxChatAction);

/**
 * KN-174: status-bar Knox entry backed by IKnoxService.openChat().
 */
export class KnoxStatusBarContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.knoxStatusBar';

	constructor(
		@IStatusbarService statusbarService: IStatusbarService,
		@IKnoxService knoxService: IKnoxService,
	) {
		super();

		const makeEntry = (agentActive: boolean): IStatusbarEntry => ({
			name: localize('knox.status.name', "Knox"),
			text: agentActive
				? localize('knox.status.agent', "$(comment-discussion) Knox Agent")
				: localize('knox.status.idle', "$(comment-discussion) Knox"),
			ariaLabel: localize('knox.status.aria', "Open Knox chat"),
			tooltip: localize('knox.status.tooltip', "Open Knox"),
			command: OPEN_KNOX_CHAT_COMMAND_ID,
		});

		const accessor = this._register(statusbarService.addEntry(makeEntry(false), 'status.knox', StatusbarAlignment.LEFT, 0));
		this._register(knoxService.onDidChangeAgentMode(active => {
			accessor.update(makeEntry(active));
		}));
	}
}
