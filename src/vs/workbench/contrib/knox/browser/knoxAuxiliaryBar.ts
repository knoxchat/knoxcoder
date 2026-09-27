/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { IViewDescriptorService, ViewContainerLocation } from '../../../common/views.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { KNOX_VIEW_CONTAINER_ID, KNOX_VIEW_ID } from '../../../common/knox.js';

/**
 * Keep Knox in the Secondary Side Bar even if a previous session cached it
 * in the activity bar or as a generated container.
 */
export function pinKnoxToAuxiliaryBar(viewDescriptorService: IViewDescriptorService): boolean {
	const knoxContainer = viewDescriptorService.getViewContainerById(KNOX_VIEW_CONTAINER_ID);
	if (!knoxContainer) {
		return false;
	}

	let didChange = false;

	const occupants = [...viewDescriptorService.getViewContainersByLocation(ViewContainerLocation.AuxiliaryBar)];
	for (const container of occupants) {
		if (container.id === KNOX_VIEW_CONTAINER_ID) {
			continue;
		}
		const defaultLocation = viewDescriptorService.getDefaultViewContainerLocation(container);
		const target = defaultLocation !== null && defaultLocation !== ViewContainerLocation.AuxiliaryBar
			? defaultLocation
			: ViewContainerLocation.Sidebar;
		if (viewDescriptorService.getViewContainerLocation(container) !== target) {
			viewDescriptorService.moveViewContainerToLocation(container, target, undefined, 'knox-pin');
			didChange = true;
		}
	}

	const knoxView = viewDescriptorService.getViewDescriptorById(KNOX_VIEW_ID);
	if (knoxView) {
		const currentContainer = viewDescriptorService.getViewContainerByViewId(KNOX_VIEW_ID);
		if (currentContainer && currentContainer !== knoxContainer) {
			viewDescriptorService.moveViewsToContainer([knoxView], knoxContainer, undefined, 'knox-pin');
			didChange = true;
		}
	}

	if (viewDescriptorService.getViewContainerLocation(knoxContainer) !== ViewContainerLocation.AuxiliaryBar) {
		viewDescriptorService.moveViewContainerToLocation(knoxContainer, ViewContainerLocation.AuxiliaryBar, undefined, 'knox-pin');
		didChange = true;
	}

	return didChange;
}

export class KnoxAuxiliaryBarContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.knoxAuxiliaryBar';

	constructor(
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IViewsService viewsService: IViewsService,
		@IExtensionService extensionService: IExtensionService,
	) {
		super();

		const pin = () => {
			if (!viewDescriptorService.getViewContainerById(KNOX_VIEW_CONTAINER_ID)) {
				return;
			}
			pinKnoxToAuxiliaryBar(viewDescriptorService);
		};

		this._register(viewDescriptorService.onDidChangeViewContainers(() => pin()));
		this._register(viewDescriptorService.onDidChangeContainerLocation(({ viewContainer, to }) => {
			if (viewContainer.id === KNOX_VIEW_CONTAINER_ID && to !== ViewContainerLocation.AuxiliaryBar) {
				pin();
			} else if (to === ViewContainerLocation.AuxiliaryBar && viewContainer.id !== KNOX_VIEW_CONTAINER_ID) {
				pin();
			}
		}));
		this._register(viewDescriptorService.onDidChangeContainer(({ views, to }) => {
			if (views.some(view => view.id === KNOX_VIEW_ID) && to.id !== KNOX_VIEW_CONTAINER_ID) {
				pin();
			}
		}));

		void extensionService.whenInstalledExtensionsRegistered().then(() => {
			if (this._store.isDisposed) {
				return;
			}
			pin();
			void viewsService.openViewContainer(KNOX_VIEW_CONTAINER_ID, false);
		});
	}
}
