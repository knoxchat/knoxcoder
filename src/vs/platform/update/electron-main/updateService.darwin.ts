/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as electron from 'electron';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { memoize } from '../../../base/common/decorators.js';
import { Event } from '../../../base/common/event.js';
import { hash } from '../../../base/common/hash.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
import { ILifecycleMainService, IRelaunchHandler, IRelaunchOptions } from '../../lifecycle/electron-main/lifecycleMainService.js';
import { ILogService } from '../../log/common/log.js';
import { IProductService } from '../../product/common/productService.js';
import { IRequestService } from '../../request/common/request.js';
import { IApplicationStorageMainService } from '../../storage/electron-main/storageMainService.js';
import { ITelemetryService } from '../../telemetry/common/telemetry.js';
import { IGitHubAssetQuery, isGitHubUpdateUrl } from '../common/githubReleaseUpdate.js';
import { AvailableForDownload, IUpdate, State, StateType, UpdateType } from '../common/update.js';
import { IMeteredConnectionService } from '../../meteredConnection/common/meteredConnection.js';
import { AbstractUpdateService, createUpdateURL, getUpdateRequestHeaders, IUpdateURLOptions, UpdateErrorClassification } from './abstractUpdateService.js';

export class DarwinUpdateService extends AbstractUpdateService implements IRelaunchHandler {

	private pendingSquirrelFeedUrl: string | undefined;

	@memoize private get onRawError(): Event<string> { return Event.fromNodeEventEmitter(electron.autoUpdater, 'error', (_, message) => message); }
	@memoize private get onRawCheckingForUpdate(): Event<void> { return Event.fromNodeEventEmitter<void>(electron.autoUpdater, 'checking-for-update'); }
	@memoize private get onRawUpdateNotAvailable(): Event<void> { return Event.fromNodeEventEmitter<void>(electron.autoUpdater, 'update-not-available'); }
	@memoize private get onRawUpdateAvailable(): Event<void> { return Event.fromNodeEventEmitter(electron.autoUpdater, 'update-available'); }
	@memoize private get onRawUpdateDownloaded(): Event<IUpdate> {
		return Event.fromNodeEventEmitter(electron.autoUpdater, 'update-downloaded', (_, version: string, productVersion: string, releaseDate: Date | number) => ({
			version,
			productVersion,
			timestamp: releaseDate instanceof Date ? releaseDate.getTime() || undefined : releaseDate
		}));
	}

	constructor(
		@ILifecycleMainService lifecycleMainService: ILifecycleMainService,
		@IConfigurationService configurationService: IConfigurationService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IEnvironmentMainService environmentMainService: IEnvironmentMainService,
		@IRequestService requestService: IRequestService,
		@ILogService logService: ILogService,
		@IProductService productService: IProductService,
		@IApplicationStorageMainService applicationStorageMainService: IApplicationStorageMainService,
		@IMeteredConnectionService meteredConnectionService: IMeteredConnectionService,
	) {
		super(lifecycleMainService, configurationService, environmentMainService, requestService, logService, productService, telemetryService, applicationStorageMainService, meteredConnectionService, true);

		lifecycleMainService.setRelaunchHandler(this);
	}

	handleRelaunch(options?: IRelaunchOptions): boolean {
		if (options?.addArgs || options?.removeArgs) {
			return false; // we cannot apply an update and restart with different args
		}

		if (this.state.type !== StateType.Ready) {
			return false; // we only handle the relaunch when we have a pending update
		}

		this.logService.trace('update#handleRelaunch(): running raw#quitAndInstall()');
		this.doQuitAndInstall();

		return true;
	}

	protected override async initialize(): Promise<void> {
		await super.initialize();

		this.onRawError(this.onError, this, this._store);
		this.onRawCheckingForUpdate(this.onCheckingForUpdate, this, this._store);
		this.onRawUpdateAvailable(this.onUpdateAvailable, this, this._store);
		this.onRawUpdateDownloaded(this.onUpdateDownloaded, this, this._store);
		this.onRawUpdateNotAvailable(this.onUpdateNotAvailable, this, this._store);
	}

	private onCheckingForUpdate(): void {
		this.logService.trace('update#onCheckingForUpdate - Electron autoUpdater is checking for updates');
	}

	private onError(err: string): void {
		this.telemetryService.publicLog2<{ messageHash: string }, UpdateErrorClassification>('update:error', { messageHash: String(hash(String(err))) });
		this.logService.error('UpdateService error:', err);

		// Only react while actively checking/downloading; a late error must not clobber Disabled or Ready.
		if (this.state.type !== StateType.CheckingForUpdates && this.state.type !== StateType.Downloading && this.state.type !== StateType.Overwriting) {
			return;
		}

		// only show message when explicitly checking for updates
		const message = (this.state.type === StateType.CheckingForUpdates && this.state.explicit) ? err : undefined;
		this.setState(State.Idle(UpdateType.Archive, message));
	}

	protected override getUpdateAssetQuery(): IGitHubAssetQuery {
		return { platform: 'darwin', arch: process.arch };
	}

	protected buildUpdateFeedUrl(quality: string, commit: string, options?: IUpdateURLOptions): string | undefined {
		const assetID = this.productService.darwinUniversalAssetId ?? (process.arch === 'x64' ? 'darwin' : 'darwin-arm64');
		const url = createUpdateURL(this.productService.updateUrl!, assetID, quality, commit, options);
		if (isGitHubUpdateUrl(this.productService.updateUrl)) {
			return url;
		}

		const headers = getUpdateRequestHeaders(this.productService.version);
		try {
			this.logService.trace('update#buildUpdateFeedUrl - setting feed URL for Electron autoUpdater', { url, assetID, quality, commit, headers });
			electron.autoUpdater.setFeedURL({ url, headers });
		} catch (e) {
			this.logService.error('Failed to set update feed URL', e);
			return undefined;
		}
		return url;
	}

	protected doCheckForUpdates(explicit: boolean, pendingCommit?: string): void {
		if (!this.quality) {
			return;
		}

		this.setState(State.CheckingForUpdates(explicit));

		const internalOrg = this.getInternalOrg();
		const background = !explicit && !internalOrg;
		const url = this.buildUpdateFeedUrl(this.quality, pendingCommit ?? this.productService.commit!, { background, internalOrg });

		if (!url) {
			this.setState(State.Idle(UpdateType.Archive));
			return;
		}

		if (isGitHubUpdateUrl(this.productService.updateUrl)) {
			this.checkGitHubForUpdates(url, explicit);
			return;
		}

		if (!explicit && this.meteredConnectionService.isConnectionMetered) {
			this.logService.info('update#doCheckForUpdates - checking for update without auto-download because connection is metered');
			this.checkForUpdateNoDownload(url);
			return;
		}

		this.logService.trace('update#doCheckForUpdates - using Electron autoUpdater', { url, explicit, background });
		electron.autoUpdater.checkForUpdates();
	}

	private checkGitHubForUpdates(url: string, explicit: boolean): void {
		this.fetchAvailableUpdate(url, CancellationToken.None)
			.then(result => {
				if (this.state.type !== StateType.CheckingForUpdates && this.state.type !== StateType.Overwriting) {
					return;
				}

				if (result.isLatest || !result.update?.url || !result.update.version || !result.update.productVersion) {
					this.setState(State.Idle(UpdateType.Archive, undefined, explicit || undefined));
					return;
				}

				this.pendingSquirrelFeedUrl = result.squirrelFeedUrl;
				if (result.squirrelFeedUrl && (explicit || !this.meteredConnectionService.isConnectionMetered)) {
					this.startSquirrelDownload(result.squirrelFeedUrl, result.update);
					return;
				}

				this.setState(State.AvailableForDownload(result.update));
			})
			.then(undefined, err => {
				if (this.state.type !== StateType.CheckingForUpdates) {
					return;
				}

				this.logService.error(err);
				const message: string | undefined = explicit ? (err.message || err) : undefined;
				this.setState(State.Idle(UpdateType.Archive, message));
			});
	}

	private startSquirrelDownload(feedUrl: string, update?: IUpdate): void {
		const headers = getUpdateRequestHeaders(this.productService.version, { github: true });
		try {
			this.logService.info('update#startSquirrelDownload - downloading KnoxCoder update', { feedUrl });
			electron.autoUpdater.setFeedURL({ url: feedUrl, headers });
			if (this.state.type !== StateType.CheckingForUpdates && this.state.type !== StateType.Downloading && this.state.type !== StateType.Overwriting) {
				this.setState(State.CheckingForUpdates(true));
			}
			electron.autoUpdater.checkForUpdates();
		} catch (e) {
			this.logService.error('Failed to start KnoxCoder auto-update download', e);
			if (update) {
				this.setState(State.AvailableForDownload(update));
			} else {
				this.setState(State.Idle(UpdateType.Archive));
			}
		}
	}

	private async checkForUpdateNoDownload(url: string, canInstall?: boolean): Promise<void> {
		this.logService.trace('update#checkForUpdateNoDownload - checking KnoxCoder releases', { url });

		try {
			const result = await this.fetchAvailableUpdate(url, CancellationToken.None);
			if (result.isLatest || !result.update?.url || !result.update.version || !result.update.productVersion) {
				const notAvailable = this.state.type === StateType.CheckingForUpdates && this.state.explicit;
				this.setState(State.Idle(UpdateType.Archive, undefined, notAvailable || undefined));
			} else {
				this.pendingSquirrelFeedUrl = result.squirrelFeedUrl;
				this.setState(State.AvailableForDownload(result.update, canInstall));
			}
		} catch (err) {
			this.logService.error('update#checkForUpdateNoDownload - failed to check for update', err);
			this.setState(State.Idle(UpdateType.Archive));
		}
	}

	private onUpdateAvailable(): void {
		this.logService.trace('update#onUpdateAvailable - Electron autoUpdater reported update available');

		if (this.state.type !== StateType.CheckingForUpdates && this.state.type !== StateType.Overwriting) {
			return;
		}

		this.setState(State.Downloading(this.state.type === StateType.Overwriting ? this.state.update : undefined, this.state.explicit, this._overwrite));
	}

	private onUpdateDownloaded(update: IUpdate): void {
		if (this.state.type !== StateType.Downloading) {
			return;
		}

		this.setState(State.Downloaded(update, this.state.explicit, this._overwrite));
		this.logService.info(`Update downloaded: ${JSON.stringify(update)}`);

		this.setState(State.Ready(update, this.state.explicit, this._overwrite));
	}

	private onUpdateNotAvailable(): void {
		this.logService.trace('update#onUpdateNotAvailable - Electron autoUpdater reported no update available');

		if (this.state.type !== StateType.CheckingForUpdates) {
			return;
		}

		const notAvailable = this.state.explicit;
		this.setState(State.Idle(UpdateType.Archive, undefined, notAvailable || undefined));
	}

	protected override async doDownloadUpdate(state: AvailableForDownload): Promise<void> {
		if (this.pendingSquirrelFeedUrl) {
			this.startSquirrelDownload(this.pendingSquirrelFeedUrl, state.update);
			return;
		}

		if (state.update.url) {
			await electron.shell.openExternal(state.update.url);
		}

		this.setState(State.Idle(UpdateType.Archive));
	}

	protected override doQuitAndInstall(): void {
		this.logService.trace('update#quitAndInstall(): running raw#quitAndInstall()');
		electron.autoUpdater.quitAndInstall();
	}
}
