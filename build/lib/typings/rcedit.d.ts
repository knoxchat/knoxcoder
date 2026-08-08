/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'rcedit' {
	export function rcedit(exePath: string, options: rcedit.Options): Promise<void>;

	export namespace rcedit {
		type RequestedExecutionLevel = 'asInvoker' | 'highestAvailable' | 'requireAdministrator';

		interface VersionStringOptions {
			Comments?: string;
			CompanyName?: string;
			FileDescription?: string;
			InternalFilename?: string;
			LegalCopyright?: string;
			LegalTrademarks1?: string;
			LegalTrademarks2?: string;
			OriginalFilename?: string;
			ProductName?: string;
		}

		interface ResourceStrings {
			[n: number]: string;
		}

		interface Options {
			'version-string'?: VersionStringOptions;
			'file-version'?: string;
			'product-version'?: string;
			icon?: string;
			'requested-execution-level'?: RequestedExecutionLevel;
			'application-manifest'?: string;
			'resource-string'?: ResourceStrings;
		}
	}
}
