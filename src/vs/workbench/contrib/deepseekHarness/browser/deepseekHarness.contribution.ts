/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { Event } from '../../../../base/common/event.js';
import { localize, localize2 } from '../../../../nls.js';
import { ILocalizedString } from '../../../../platform/action/common/action.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { DEEPSEEK_HARNESS_DEFAULT_PORT, DeepSeekHarnessColorScheme, IDeepSeekHarnessService, IDeepSeekHarnessStartOptions, IDeepSeekHarnessStatus } from '../../../../platform/deepseekHarness/common/deepseekHarness.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { ViewAction } from '../../../browser/parts/views/viewPane.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { Extensions as ViewContainerExtensions, IViewContainersRegistry, IViewsRegistry, ViewContainerLocation } from '../../../common/views.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { DEEPSEEK_HARNESS_VIEW_CONTAINER_ID, DEEPSEEK_HARNESS_VIEW_ID } from '../common/deepseekHarness.js';
import { DeepSeekHarnessViewPane } from './deepseekHarnessViewPane.js';

class NullDeepSeekHarnessService implements IDeepSeekHarnessService {
	declare readonly _serviceBrand: undefined;
	readonly onDidChangeStatus = Event.None;
	async getStatus(): Promise<IDeepSeekHarnessStatus> {
		return { state: 'error', message: localize('deepseekHarness.desktopOnly', "DeepSeek Harness is only available in the desktop app.") };
	}
	async start(_options: IDeepSeekHarnessStartOptions): Promise<IDeepSeekHarnessStatus> {
		return this.getStatus();
	}
	async syncWorkspaces(_folders: readonly string[]): Promise<void> { }
	async syncTheme(_colorScheme: DeepSeekHarnessColorScheme): Promise<void> { }
	async stop(): Promise<void> { }
}

registerSingleton(IDeepSeekHarnessService, NullDeepSeekHarnessService, InstantiationType.Delayed);

const deepseekHarnessViewIcon = registerIcon('deepseek-harness-view-icon', Codicon.sparkle, localize('deepseekHarnessViewIcon', 'View icon of the DeepSeek Harness view.'));

const viewContainerTitle: ILocalizedString = localize2('deepseekHarness', "DeepSeek Harness");

const VIEW_CONTAINER = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry).registerViewContainer({
	id: DEEPSEEK_HARNESS_VIEW_CONTAINER_ID,
	title: viewContainerTitle,
	icon: deepseekHarnessViewIcon,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [DEEPSEEK_HARNESS_VIEW_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: DEEPSEEK_HARNESS_VIEW_CONTAINER_ID,
	hideIfEmpty: false,
	rejectAddedViews: true,
	alwaysUseContainerInfo: true,
	canMove: false,
	order: 1,
	openCommandActionDescriptor: {
		id: DEEPSEEK_HARNESS_VIEW_CONTAINER_ID,
		title: viewContainerTitle,
		mnemonicTitle: localize({ key: 'miDeepSeekHarness', comment: ['&& denotes a mnemonic'] }, "&&DeepSeek Harness"),
		order: 1,
	},
}, ViewContainerLocation.AuxiliaryBar, { isDefault: true });

Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry).registerViews([{
	id: DEEPSEEK_HARNESS_VIEW_ID,
	name: viewContainerTitle,
	containerIcon: deepseekHarnessViewIcon,
	ctorDescriptor: new SyncDescriptor(DeepSeekHarnessViewPane),
	canToggleVisibility: false,
	canMoveView: false,
	collapsed: false,
	order: 1,
	weight: 100,
}], VIEW_CONTAINER);

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'deepseekHarness',
	title: localize('deepseekHarness.configTitle', "DeepSeek Harness"),
	type: 'object',
	properties: {
		'deepseekHarness.port': {
			type: 'number',
			default: DEEPSEEK_HARNESS_DEFAULT_PORT,
			minimum: 1,
			maximum: 65535,
			description: localize('deepseekHarness.port', "Port used by the bundled DeepSeek Harness Web UI.")
		},
		'deepseekHarness.checkoutPath': {
			type: 'string',
			default: '',
			description: localize('deepseekHarness.checkoutPath', "Optional path to a DeepSeek Harness checkout. When empty, KnoxCoder uses the bundled runtime shipped with the editor.")
		},
		'deepseekHarness.extraArgs': {
			type: 'array',
			items: { type: 'string' },
			default: [],
			description: localize('deepseekHarness.extraArgs', "Extra arguments forwarded to `dsh web`.")
		}
	}
});

registerAction2(class extends ViewAction<DeepSeekHarnessViewPane> {
	constructor() {
		super({
			id: 'deepseekHarness.reload',
			title: localize2('deepseekHarness.reload', "Reload DeepSeek Harness"),
			category: viewContainerTitle,
			icon: Codicon.refresh,
			viewId: DEEPSEEK_HARNESS_VIEW_ID,
			menu: {
				id: MenuId.ViewTitle,
				when: ContextKeyExpr.equals('view', DEEPSEEK_HARNESS_VIEW_ID),
				group: 'navigation',
				order: 1,
			}
		});
	}
	runInView(_accessor: ServicesAccessor, view: DeepSeekHarnessViewPane): void {
		void view.reload();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'deepseekHarness.open',
			title: localize2('deepseekHarness.open', "Open DeepSeek Harness"),
			category: viewContainerTitle,
			f1: true,
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(IViewsService).openView(DEEPSEEK_HARNESS_VIEW_ID, true);
	}
});
