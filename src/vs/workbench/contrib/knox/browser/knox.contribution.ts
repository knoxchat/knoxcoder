/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { KNOX_VIEW_CONTAINER_ID } from '../../../common/knox.js';
import { ViewContainerLocation } from '../../../common/views.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { IPaneCompositePartService } from '../../../services/panecomposite/browser/panecomposite.js';

/**
 * One-time layout migration: Knox used to live on the Primary Side Bar. After
 * pinning it to the Secondary Side Bar, open that part once so existing
 * workspaces do not lose the chat view behind a hidden auxiliary bar.
 */
class KnoxSecondarySideBarContribution implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.knoxSecondarySideBar';

	constructor(
		@IStorageService storageService: IStorageService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@IPaneCompositePartService paneCompositeService: IPaneCompositePartService,
	) {
		const key = 'knox.secondarySideBar.migrated';
		if (storageService.getBoolean(key, StorageScope.WORKSPACE, false)) {
			return;
		}

		layoutService.setPartHidden(false, Parts.AUXILIARYBAR_PART);
		void paneCompositeService.openPaneComposite(KNOX_VIEW_CONTAINER_ID, ViewContainerLocation.AuxiliaryBar);
		storageService.store(key, true, StorageScope.WORKSPACE, StorageTarget.MACHINE);
	}
}

registerWorkbenchContribution2(KnoxSecondarySideBarContribution.ID, KnoxSecondarySideBarContribution, WorkbenchPhase.AfterRestored);
