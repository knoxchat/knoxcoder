/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mock } from '../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { KNOX_VIEW_CONTAINER_ID, KNOX_VIEW_ID } from '../../../common/knox.js';
import { IViewContainersRegistry, IViewDescriptor, IViewDescriptorService, Extensions as ViewContainerExtensions, ViewContainer, ViewContainerLocation } from '../../../common/views.js';
import { pinKnoxToAuxiliaryBar } from './knoxAuxiliaryBar.js';

const ViewContainersRegistry = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry);

suite('KnoxAuxiliaryBar', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('registers Knox as the default Secondary Side Bar container', () => {
		const knoxContainer = ViewContainersRegistry.get(KNOX_VIEW_CONTAINER_ID);
		assert.ok(knoxContainer);
		assert.strictEqual(ViewContainersRegistry.getViewContainerLocation(knoxContainer), ViewContainerLocation.AuxiliaryBar);
		assert.ok(knoxContainer.lockToDefaultLocation);
		assert.ok(knoxContainer.exclusiveAtLocation);
	});

	test('pinKnoxToAuxiliaryBar restores Knox and evicts other containers from the secondary side bar', () => {
		const knoxContainer = ViewContainersRegistry.get(KNOX_VIEW_CONTAINER_ID);
		assert.ok(knoxContainer);

		const otherContainer = { id: `test-other-aux-${Date.now()}` } as ViewContainer;
		const knoxView: IViewDescriptor = {
			id: KNOX_VIEW_ID,
			ctorDescriptor: null!,
			name: { value: 'Knox', original: 'Knox' },
			canMoveView: false
		};
		const locations = new Map<ViewContainer, ViewContainerLocation>([
			[knoxContainer, ViewContainerLocation.Sidebar],
			[otherContainer, ViewContainerLocation.AuxiliaryBar],
		]);
		let knoxViewContainer: ViewContainer = knoxContainer;

		const viewDescriptorService = new class extends mock<IViewDescriptorService>() {
			override getViewContainerById(id: string): ViewContainer | null {
				if (id === KNOX_VIEW_CONTAINER_ID) {
					return knoxContainer;
				}
				return id === otherContainer.id ? otherContainer : null;
			}
			override getViewContainersByLocation(location: ViewContainerLocation): ViewContainer[] {
				return [...locations.entries()].filter(([, loc]) => loc === location).map(([container]) => container);
			}
			override getDefaultViewContainerLocation(container: ViewContainer): ViewContainerLocation | null {
				return container === knoxContainer ? ViewContainerLocation.AuxiliaryBar : ViewContainerLocation.Sidebar;
			}
			override getViewContainerLocation(container: ViewContainer): ViewContainerLocation | null {
				return locations.get(container) ?? null;
			}
			override moveViewContainerToLocation(container: ViewContainer, location: ViewContainerLocation): void {
				locations.set(container, location);
			}
			override getViewDescriptorById(id: string): IViewDescriptor | null {
				return id === KNOX_VIEW_ID ? knoxView : null;
			}
			override getViewContainerByViewId(id: string): ViewContainer | null {
				return id === KNOX_VIEW_ID ? knoxViewContainer : null;
			}
			override moveViewsToContainer(views: IViewDescriptor[], container: ViewContainer): void {
				if (views.some(view => view.id === KNOX_VIEW_ID)) {
					knoxViewContainer = container;
				}
			}
		};

		assert.strictEqual(viewDescriptorService.getViewContainerLocation(knoxContainer), ViewContainerLocation.Sidebar);
		assert.strictEqual(viewDescriptorService.getViewContainerLocation(otherContainer), ViewContainerLocation.AuxiliaryBar);

		assert.strictEqual(pinKnoxToAuxiliaryBar(viewDescriptorService), true);
		assert.strictEqual(viewDescriptorService.getViewContainerLocation(knoxContainer), ViewContainerLocation.AuxiliaryBar);
		assert.strictEqual(viewDescriptorService.getViewContainerLocation(otherContainer), ViewContainerLocation.Sidebar);
		assert.strictEqual(viewDescriptorService.getViewContainerByViewId(KNOX_VIEW_ID), knoxContainer);

		assert.strictEqual(pinKnoxToAuxiliaryBar(viewDescriptorService), false);
	});
});
