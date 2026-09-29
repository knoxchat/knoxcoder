/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from '../../../../nls.js';
import assert from 'assert';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IViewsRegistry, IViewContainersRegistry, IViewDescriptor, Extensions as ViewContainerExtensions, ViewContainerLocation } from '../../../common/views.js';
import { KNOX_VIEW_CONTAINER_ID, KNOX_VIEW_ID } from '../../../common/knox.js';
import { ViewDescriptorService } from '../../../services/views/browser/viewDescriptorService.js';
import { workbenchInstantiationService } from '../../../test/browser/workbenchTestServices.js';
import { pinKnoxToAuxiliaryBar } from './knoxAuxiliaryBar.js';

const ViewsRegistry = Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry);
const ViewContainersRegistry = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry);

suite('KnoxAuxiliaryBar', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('pinKnoxToAuxiliaryBar restores Knox and evicts other containers from the secondary side bar', () => {
		const instantiationService = disposables.add(workbenchInstantiationService(undefined, disposables));
		const testObject = disposables.add(instantiationService.createInstance(ViewDescriptorService));

		const existing = ViewContainersRegistry.get(KNOX_VIEW_CONTAINER_ID);
		if (existing) {
			ViewsRegistry.deregisterViews(ViewsRegistry.getViews(existing), existing);
			ViewContainersRegistry.deregisterViewContainer(existing);
		}

		const knoxContainer = ViewContainersRegistry.registerViewContainer({
			id: KNOX_VIEW_CONTAINER_ID,
			title: nls.localize2('knox', 'Knox'),
			ctorDescriptor: new SyncDescriptor(<any>{}),
			lockToDefaultLocation: true,
			exclusiveAtLocation: true,
			rejectAddedViews: true,
		}, ViewContainerLocation.AuxiliaryBar, { isDefault: true });
		disposables.add({
			dispose: () => {
				ViewsRegistry.deregisterViews(ViewsRegistry.getViews(knoxContainer), knoxContainer);
				ViewContainersRegistry.deregisterViewContainer(knoxContainer);
			}
		});

		const otherContainer = ViewContainersRegistry.registerViewContainer({
			id: `test-other-aux-${Date.now()}`,
			title: nls.localize2('other', 'other'),
			ctorDescriptor: new SyncDescriptor(<any>{}),
		}, ViewContainerLocation.Sidebar);
		disposables.add({
			dispose: () => {
				ViewsRegistry.deregisterViews(ViewsRegistry.getViews(otherContainer), otherContainer);
				ViewContainersRegistry.deregisterViewContainer(otherContainer);
			}
		});

		const knoxView: IViewDescriptor = {
			id: KNOX_VIEW_ID,
			ctorDescriptor: null!,
			name: nls.localize2('knoxView', 'Knox'),
			canMoveView: false
		};
		ViewsRegistry.registerViews([knoxView], knoxContainer);

		const service = testObject as unknown as {
			moveViewContainerToLocationWithoutSaving(container: typeof knoxContainer, location: ViewContainerLocation): void;
		};
		service.moveViewContainerToLocationWithoutSaving(knoxContainer, ViewContainerLocation.Sidebar);
		service.moveViewContainerToLocationWithoutSaving(otherContainer, ViewContainerLocation.AuxiliaryBar);

		assert.strictEqual(testObject.getViewContainerLocation(knoxContainer), ViewContainerLocation.Sidebar);
		assert.strictEqual(testObject.getViewContainerLocation(otherContainer), ViewContainerLocation.AuxiliaryBar);

		assert.strictEqual(pinKnoxToAuxiliaryBar(testObject), true);
		assert.strictEqual(testObject.getViewContainerLocation(knoxContainer), ViewContainerLocation.AuxiliaryBar);
		assert.strictEqual(testObject.getViewContainerLocation(otherContainer), ViewContainerLocation.Sidebar);
		assert.strictEqual(testObject.getViewContainerByViewId(KNOX_VIEW_ID), knoxContainer);

		assert.strictEqual(pinKnoxToAuxiliaryBar(testObject), false);
	});
});
