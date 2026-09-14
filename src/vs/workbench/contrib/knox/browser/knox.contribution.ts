/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../nls.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { AccessibleViewRegistry } from '../../../../platform/accessibility/browser/accessibleViewRegistry.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { KNOX_EXTENSION_ID, KNOX_VIEW_CONTAINER_ID, KNOX_VIEW_ID, KNOX_VIEWS_CONTAINER_KEY } from '../../../common/knox.js';
import { Extensions as ViewExtensions, ICustomViewDescriptor, IViewContainersRegistry, IViewsRegistry, ViewContainerLocation } from '../../../common/views.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { IPaneCompositePartService } from '../../../services/panecomposite/browser/panecomposite.js';
import { KnoxChatService, IKnoxChatService } from '../common/knoxChatService.js';
import { KnoxGuiBridge } from '../common/knoxGuiBridge.js';
import { IKnoxGuiBridge } from '../common/knoxGuiProtocol.js';
import { KnoxAccessibilityHelp } from './knoxAccessibleView.js';
import { knoxViewIcon } from './knoxIcons.js';
import { KnoxViewPane } from './knoxViewPane.js';
import './media/knox.css';
import './knoxContextKeys.js';
import './knoxActions.js';

registerSingleton(IKnoxChatService, KnoxChatService, InstantiationType.Delayed);
registerSingleton(IKnoxGuiBridge, KnoxGuiBridge, InstantiationType.Delayed);

const viewContainersRegistry = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry);
const viewsRegistry = Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry);

/**
 * First-party Knox chat container. Same id as the old extension
 * `viewsContainers` contribution so stored layout stays valid.
 */
const knoxViewContainer = viewContainersRegistry.registerViewContainer({
	id: KNOX_VIEW_CONTAINER_ID,
	title: localize2('knox', 'Knox'),
	icon: knoxViewIcon,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [KNOX_VIEW_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: KNOX_VIEW_CONTAINER_ID,
	hideIfEmpty: false,
	rejectAddedViews: true,
	alwaysUseContainerInfo: true,
	order: 0,
}, ViewContainerLocation.AuxiliaryBar, { isDefault: true });

export function createKnoxViewDescriptor(): ICustomViewDescriptor {
	return {
		id: KNOX_VIEW_ID,
		name: localize2('knox', 'Knox'),
		ctorDescriptor: new SyncDescriptor(KnoxViewPane),
		containerIcon: knoxViewIcon,
		canToggleVisibility: false,
		canMoveView: false,
		extensionId: new ExtensionIdentifier(KNOX_EXTENSION_ID),
		originalContainerId: KNOX_VIEWS_CONTAINER_KEY,
	};
}

viewsRegistry.registerViews([createKnoxViewDescriptor()], knoxViewContainer);

class KnoxChatStartupContribution implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.knoxChatStartup';

	constructor(
		@IKnoxChatService chatService: IKnoxChatService,
	) {
		chatService.start();
	}
}

registerWorkbenchContribution2(KnoxChatStartupContribution.ID, KnoxChatStartupContribution, WorkbenchPhase.AfterRestored);

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

AccessibleViewRegistry.register(new KnoxAccessibilityHelp());
