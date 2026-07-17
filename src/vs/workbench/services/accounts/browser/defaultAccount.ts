/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Barrier } from '../../../../base/common/async.js';
import { IAccountTokenInfo, IDefaultAccount, IDefaultAccountAuthenticationProvider, IPolicyData } from '../../../../base/common/defaultAccount.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { equals } from '../../../../base/common/objects.js';
import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { IDefaultAccountProvider, IDefaultAccountService, ManagedSettingsFetchStatus } from '../../../../platform/defaultAccount/common/defaultAccount.js';
import { IProductService } from '../../../../platform/product/common/productService.js';

interface IDefaultAccountConfig {
	readonly preferredExtensions: string[];
	readonly authenticationProvider: {
		readonly default: {
			readonly id: string;
			readonly name: string;
		};
		readonly enterprise: {
			readonly id: string;
			readonly name: string;
		};
		readonly enterpriseProviderConfig: string;
		readonly enterpriseProviderUriSetting: string;
		readonly scopes: string[][];
	};
	readonly tokenEntitlementUrl: string;
	readonly entitlementUrl: string;
	readonly toolRegistryDataUrl: string;
	readonly managedSettingsUrl: string;
}

export const DEFAULT_ACCOUNT_SIGN_IN_COMMAND = 'workbench.actions.accounts.signIn';

export const enum DefaultAccountStatus {
	Uninitialized = 'uninitialized',
	Unavailable = 'unavailable',
	Available = 'available',
}

export const CONTEXT_DEFAULT_ACCOUNT_STATE = new RawContextKey<string>('defaultAccountStatus', DefaultAccountStatus.Uninitialized);

export class DefaultAccountService extends Disposable implements IDefaultAccountService {
	declare _serviceBrand: undefined;

	private defaultAccount: IDefaultAccount | null = null;
	get currentDefaultAccount(): IDefaultAccount | null { return this.defaultAccount; }
	get policyData(): IPolicyData | null { return this.defaultAccountProvider?.policyData ?? null; }
	get accountTokenInfo(): IAccountTokenInfo | null { return this.defaultAccountProvider?.accountTokenInfo ?? null; }

	get managedSettingsFetchStatus(): ManagedSettingsFetchStatus { return this.defaultAccountProvider?.managedSettingsFetchStatus ?? null; }
	get managedSettingsFetchedAt(): number | null { return this.defaultAccountProvider?.managedSettingsFetchedAt ?? null; }
	get managedSettingsRawResponse(): unknown { return this.defaultAccountProvider?.managedSettingsRawResponse ?? null; }

	private readonly initBarrier = new Barrier();

	private readonly _onDidChangeDefaultAccount = this._register(new Emitter<IDefaultAccount | null>());
	readonly onDidChangeDefaultAccount = this._onDidChangeDefaultAccount.event;

	private readonly _onDidChangePolicyData = this._register(new Emitter<IPolicyData | null>());
	readonly onDidChangePolicyData = this._onDidChangePolicyData.event;

	private readonly _onDidChangeAccountTokenInfo = this._register(new Emitter<IAccountTokenInfo | null>());
	readonly onDidChangeAccountTokenInfo = this._onDidChangeAccountTokenInfo.event;

	private readonly defaultAccountConfig: IDefaultAccountConfig;
	private defaultAccountProvider: IDefaultAccountProvider | null = null;

	constructor(
		@IProductService _productService: IProductService,
	) {
		super();
		this.defaultAccountConfig = {
			preferredExtensions: [],
			authenticationProvider: {
				default: { id: '', name: '' },
				enterprise: { id: '', name: '' },
				enterpriseProviderConfig: '',
				enterpriseProviderUriSetting: '',
				scopes: [],
			},
			tokenEntitlementUrl: '',
			entitlementUrl: '',
			toolRegistryDataUrl: '',
			managedSettingsUrl: '',
		};
	}

	async getDefaultAccount(): Promise<IDefaultAccount | null> {
		await this.initBarrier.wait();
		return this.defaultAccount;
	}

	getDefaultAccountAuthenticationProvider(): IDefaultAccountAuthenticationProvider {
		if (this.defaultAccountProvider) {
			return this.defaultAccountProvider.getDefaultAccountAuthenticationProvider();
		}
		return {
			...this.defaultAccountConfig.authenticationProvider.default,
			enterprise: false
		};
	}

	setDefaultAccountProvider(provider: IDefaultAccountProvider): void {
		if (this.defaultAccountProvider) {
			throw new Error('Default account provider is already set');
		}

		this.defaultAccountProvider = provider;
		if (this.defaultAccountProvider.policyData) {
			this._onDidChangePolicyData.fire(this.defaultAccountProvider.policyData);
		}
		provider.refresh().then(account => {
			this.defaultAccount = account;
		}).finally(() => {
			this.initBarrier.open();
			this._register(provider.onDidChangeDefaultAccount(account => this.setDefaultAccount(account)));
			this._register(provider.onDidChangePolicyData(policyData => this._onDidChangePolicyData.fire(policyData)));
			this._register(provider.onDidChangeAccountTokenInfo(tokenInfo => this._onDidChangeAccountTokenInfo.fire(tokenInfo)));
		});
	}

	async refresh(options?: { forceRefresh?: boolean }): Promise<IDefaultAccount | null> {
		await this.initBarrier.wait();

		const account = await this.defaultAccountProvider?.refresh(options);
		this.setDefaultAccount(account ?? null);
		return this.defaultAccount;
	}

	async signIn(options?: { additionalScopes?: readonly string[];[key: string]: unknown }): Promise<IDefaultAccount | null> {
		await this.initBarrier.wait();
		return this.defaultAccountProvider?.signIn(options) ?? null;
	}

	async signOut(): Promise<void> {
		await this.initBarrier.wait();
		await this.defaultAccountProvider?.signOut();
	}

	resolveGitHubUrl(path: string): string {
		if (this.defaultAccountProvider) {
			return this.defaultAccountProvider.resolveGitHubUrl(path);
		}

		return `https://github.com/${path}`;
	}

	private setDefaultAccount(account: IDefaultAccount | null): void {
		if (equals(this.defaultAccount, account)) {
			return;
		}
		this.defaultAccount = account;
		this._onDidChangeDefaultAccount.fire(this.defaultAccount);
	}
}
