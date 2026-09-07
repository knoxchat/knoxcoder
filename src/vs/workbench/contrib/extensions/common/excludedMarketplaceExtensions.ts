/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { onUnexpectedError } from '../../../../base/common/errors.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { ExtensionType } from '../../../../platform/extensions/common/extensions.js';
import { IExtensionManagementService, InstallOperation } from '../../../../platform/extensionManagement/common/extensionManagement.js';
import { isExcludedMarketplaceExtension } from '../../../../platform/extensionManagement/common/extensionManagementUtil.js';
import { Severity, INotificationService } from '../../../../platform/notification/common/notification.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';

const NOTIFIED_STORAGE_KEY = 'extensions.excludedMarketplaceNotified';

/**
 * One-time notice when a user-installed marketplace extension is superseded by a
 * bundled system extension (`product.json` `excludedMarketplaceExtensions`).
 * Enablement itself is handled by the workbench extension enablement service.
 */
export class ExcludedMarketplaceExtensionsContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.excludedMarketplaceExtensions';

	constructor(
		@IProductService private readonly productService: IProductService,
		@IExtensionManagementService private readonly extensionManagementService: IExtensionManagementService,
		@INotificationService private readonly notificationService: INotificationService,
		@IStorageService private readonly storageService: IStorageService,
	) {
		super();
		void this.check().then(undefined, onUnexpectedError);
		this._register(this.extensionManagementService.onDidInstallExtensions(results => {
			const installedIds = results
				.filter(r => r.operation === InstallOperation.Install && !!r.local)
				.map(r => r.identifier.id);
			if (!installedIds.length) {
				return;
			}
			const excluded = this.productService.excludedMarketplaceExtensions;
			if (!installedIds.some(id => isExcludedMarketplaceExtension(id, excluded))) {
				return;
			}
			this.removeNotified(installedIds);
			void this.check().then(undefined, onUnexpectedError);
		}));
	}

	private async check(): Promise<void> {
		const excluded = this.productService.excludedMarketplaceExtensions;
		if (!excluded?.length) {
			return;
		}

		const installed = await this.extensionManagementService.getInstalled(ExtensionType.User);
		const notified = new Set(this.getNotified());

		for (const local of installed) {
			if (!isExcludedMarketplaceExtension(local.identifier.id, excluded)) {
				continue;
			}
			const key = local.identifier.id.toLowerCase();
			if (notified.has(key)) {
				continue;
			}

			this.notificationService.prompt(
				Severity.Info,
				localize(
					'excludedMarketplaceExtensionInstalled',
					"{0} already includes this feature. The marketplace extension '{1}' is disabled and can be uninstalled.",
					this.productService.nameLong,
					local.identifier.id
				),
				[{
					label: localize('uninstall', "Uninstall"),
					run: () => {
						void this.extensionManagementService.uninstall(local);
					}
				}]
			);

			notified.add(key);
			this.setNotified([...notified]);
		}
	}

	private getNotified(): string[] {
		try {
			const raw = this.storageService.get(NOTIFIED_STORAGE_KEY, StorageScope.APPLICATION);
			if (!raw) {
				return [];
			}
			const parsed: unknown = JSON.parse(raw);
			return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string').map(id => id.toLowerCase()) : [];
		} catch {
			return [];
		}
	}

	private setNotified(ids: string[]): void {
		this.storageService.store(NOTIFIED_STORAGE_KEY, JSON.stringify(ids), StorageScope.APPLICATION, StorageTarget.MACHINE);
	}

	private removeNotified(ids: string[]): void {
		const remove = new Set(ids.map(id => id.toLowerCase()));
		this.setNotified(this.getNotified().filter(id => !remove.has(id)));
	}
}
