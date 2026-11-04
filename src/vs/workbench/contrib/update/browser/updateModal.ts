/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { isWeb } from '../../../../base/common/platform.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';
import { IMarkdownRendererService, openLinkFromMarkdown } from '../../../../platform/markdown/browser/markdownRenderer.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { asTextOrError, IRequestService } from '../../../../platform/request/common/request.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { createGitHubReleaseByTagUrls } from '../../../../platform/update/common/githubReleaseUpdate.js';
import { IUpdate, IUpdateService, State, StateType } from '../../../../platform/update/common/update.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { computeProgressPercent, formatBytes } from '../common/updateUtils.js';
import { URI } from '../../../../base/common/uri.js';
import './media/updateModal.css';

const SKIPPED_VERSION_KEY = 'update/modal/skippedVersion';
const SHOW_MODAL_SETTING = 'update.showModal';
const SHOW_UPDATE_MODAL_COMMAND = 'update.showUpdateModal';
const SHOW_UPDATE_MODAL_INTERNAL_COMMAND = '_update.showUpdateModal';

/** States in which an update is waiting for the user to act on it. */
const ACTIONABLE_STATES: readonly StateType[] = [StateType.AvailableForDownload, StateType.Downloaded, StateType.Ready];
/** States that are part of the install pipeline once the user pressed "Download & Install". */
const PIPELINE_STATES: readonly StateType[] = [...ACTIONABLE_STATES, StateType.Downloading, StateType.Updating, StateType.Overwriting];

function getUpdate(state: State): IUpdate | undefined {
	switch (state.type) {
		case StateType.AvailableForDownload:
		case StateType.Downloading:
		case StateType.Downloaded:
		case StateType.Updating:
		case StateType.Ready:
		case StateType.Overwriting:
		case StateType.Restarting:
			return state.update;
		default:
			return undefined;
	}
}

function getUpdateVersion(state: State): string | undefined {
	const update = getUpdate(state);
	return update ? update.productVersion ?? update.version : undefined;
}

/**
 * Shows a centered modal popup when a new version is available so that the update
 * is easy to discover, instead of relying on the title bar entry or the Manage menu.
 */
export class UpdateModalContribution extends Disposable implements IWorkbenchContribution {

	private readonly modal = this._register(new MutableDisposable<UpdateModal>());
	/** Versions the user dismissed with "Later" during this session. */
	private readonly dismissedVersions = new Set<string>();

	constructor(
		@IUpdateService private readonly updateService: IUpdateService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IStorageService private readonly storageService: IStorageService,
		@IHostService private readonly hostService: IHostService,
		@IProductService private readonly productService: IProductService,
		@ILayoutService private readonly layoutService: ILayoutService,
		@IMarkdownRendererService private readonly markdownRendererService: IMarkdownRendererService,
		@IOpenerService private readonly openerService: IOpenerService,
		@IRequestService private readonly requestService: IRequestService,
	) {
		super();

		if (isWeb) {
			return; // Electron only
		}

		this._register(CommandsRegistry.registerCommand(SHOW_UPDATE_MODAL_INTERNAL_COMMAND, () => this.show()));
		this._register(updateService.onStateChange(state => this.onStateChange(state)));
		void this.hostService.hadLastFocus().then(hadLastFocus => {
			if (hadLastFocus) {
				this.onStateChange(this.updateService.state);
			}
		});
	}

	/** Opens the modal regardless of previous dismissal or skipped version. */
	show(): void {
		const state = this.updateService.state;
		if (!this.modal.value && ACTIONABLE_STATES.includes(state.type)) {
			this.open(state);
		}
	}

	private onStateChange(state: State): void {
		const modal = this.modal.value;
		if (modal) {
			if (PIPELINE_STATES.includes(state.type)) {
				modal.update(state);
			} else {
				this.close();
			}
			return;
		}

		if (!ACTIONABLE_STATES.includes(state.type) || !this.shouldShow(state)) {
			return;
		}

		this.open(state);
	}

	private shouldShow(state: State): boolean {
		if (this.configurationService.getValue<boolean>(SHOW_MODAL_SETTING) === false) {
			return false;
		}

		const version = getUpdateVersion(state);
		if (!version) {
			return false;
		}

		return !this.dismissedVersions.has(version)
			&& this.storageService.get(SKIPPED_VERSION_KEY, StorageScope.APPLICATION) !== version;
	}

	private open(state: State): void {
		const version = getUpdateVersion(state);
		if (!version) {
			return;
		}

		this.modal.value = new UpdateModal(version, state, {
			updateService: this.updateService,
			productService: this.productService,
			layoutService: this.layoutService,
			markdownRendererService: this.markdownRendererService,
			openerService: this.openerService,
			requestService: this.requestService,
			onLater: () => {
				this.dismissedVersions.add(version);
				this.close();
			},
			onSkip: () => {
				this.storageService.store(SKIPPED_VERSION_KEY, version, StorageScope.APPLICATION, StorageTarget.USER);
				this.close();
			},
			onClose: () => this.close(),
		});
	}

	private close(): void {
		this.modal.clear();
	}
}

interface IUpdateModalServices {
	readonly updateService: IUpdateService;
	readonly productService: IProductService;
	readonly layoutService: ILayoutService;
	readonly markdownRendererService: IMarkdownRendererService;
	readonly openerService: IOpenerService;
	readonly requestService: IRequestService;
	readonly onLater: () => void;
	readonly onSkip: () => void;
	readonly onClose: () => void;
}

class UpdateModal extends Disposable {

	private readonly overlay: HTMLElement;
	private readonly dialog: HTMLElement;
	private buttons: HTMLButtonElement[] = [];
	private readonly metaElement: HTMLElement;
	private readonly notesElement: HTMLElement;
	private readonly footer: HTMLElement;
	private readonly previouslyFocused: Element | null;
	private readonly footerDisposables = this._register(new DisposableStore());

	private footerType: StateType | undefined;
	private progressLabel: HTMLElement | undefined;
	private progressSize: HTMLElement | undefined;
	private progressBar: HTMLElement | undefined;

	/** Set once the user pressed "Download & Install"; the rest of the pipeline then runs automatically. */
	private installRequested = false;
	private packageSize: number | undefined;
	private readonly baseMeta: string;

	constructor(
		private readonly version: string,
		private state: State,
		private readonly services: IUpdateModalServices,
	) {
		super();

		const { productService, layoutService } = services;
		this.previouslyFocused = dom.getActiveElement();
		this.baseMeta = localize('updateModal.currentVersion', "You're on {0}", productService.version);

		const container = layoutService.mainContainer;
		this.overlay = dom.append(container, dom.$('.update-modal-overlay'));
		this._register({ dispose: () => this.overlay.remove() });

		const modal = this.dialog = dom.append(this.overlay, dom.$('.update-modal'));
		modal.tabIndex = -1;
		const titleId = 'update-modal-title';
		modal.setAttribute('role', 'dialog');
		modal.setAttribute('aria-modal', 'true');
		modal.setAttribute('aria-labelledby', titleId);

		const closeButton = dom.append(modal, dom.$('button.update-modal-close')) as HTMLButtonElement;
		this.buttons.push(closeButton);
		closeButton.setAttribute('aria-label', localize('updateModal.close', "Close"));
		dom.append(closeButton, dom.$(ThemeIcon.asCSSSelector(Codicon.close)));
		this._register(dom.addDisposableListener(closeButton, 'click', () => this.services.onLater()));

		const heading = dom.append(modal, dom.$('h2.update-modal-heading'));
		heading.id = titleId;
		dom.append(heading, dom.$(ThemeIcon.asCSSSelector(Codicon.cloudDownload)));
		dom.append(heading, dom.$('span')).textContent = localize('updateModal.title', "Update Available");

		dom.append(modal, dom.$('.update-modal-version')).textContent = `${productService.nameShort} ${version}`;
		this.metaElement = dom.append(modal, dom.$('.update-modal-meta'));

		const notesHeader = dom.append(modal, dom.$('.update-modal-notes-header'));
		dom.append(notesHeader, dom.$('span')).textContent = localize('updateModal.whatsNew', "What's New");
		const releaseNotesUrl = productService.releaseNotesUrl;
		if (releaseNotesUrl) {
			const viewRelease = dom.append(notesHeader, dom.$('button.update-modal-link')) as HTMLButtonElement;
			this.buttons.push(viewRelease);
			dom.append(viewRelease, dom.$(ThemeIcon.asCSSSelector(Codicon.linkExternal)));
			dom.append(viewRelease, dom.$('span')).textContent = localize('updateModal.viewRelease', "View Release");
			this._register(dom.addDisposableListener(viewRelease, 'click', () => {
				void this.services.openerService.open(URI.parse(releaseNotesUrl));
			}));
		}

		this.notesElement = dom.append(modal, dom.$('.update-modal-notes'));
		dom.append(this.notesElement, dom.$('.update-modal-notes-empty')).textContent = localize('updateModal.loadingNotes', "Loading release notes...");

		this.footer = dom.append(modal, dom.$('.update-modal-footer'));

		this._register(dom.addDisposableListener(this.overlay, 'keydown', e => this.onKeyDown(e)));

		this.renderMeta();
		this.renderFooter();
		void this.loadReleaseNotes();
		void this.loadPackageSize();

		this._register({
			dispose: () => {
				if (dom.isHTMLElement(this.previouslyFocused) && this.previouslyFocused.isConnected) {
					this.previouslyFocused.focus();
				}
			}
		});
	}

	update(state: State): void {
		this.state = state;

		// Continue the install pipeline that the user started.
		if (this.installRequested) {
			if (state.type === StateType.Downloaded) {
				void this.services.updateService.applyUpdate();
			} else if (state.type === StateType.Ready) {
				void this.services.updateService.quitAndInstall();
			}
		}

		this.renderMeta();
		this.renderFooter();
	}

	private renderMeta(): void {
		const size = this.state.type === StateType.Downloading && this.state.totalBytes ? this.state.totalBytes : this.packageSize;
		this.metaElement.textContent = size ? `${this.baseMeta} \u00b7 ${formatBytes(size)}` : this.baseMeta;
	}

	private onKeyDown(e: KeyboardEvent): void {
		if (e.key === 'Escape') {
			dom.EventHelper.stop(e, true);
			this.services.onLater();
			return;
		}

		if (e.key === 'Tab') {
			const focusable = this.buttons.filter(b => !b.disabled);
			if (!focusable.length) {
				e.preventDefault();
				return;
			}
			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			const active = dom.getActiveElement();
			if (e.shiftKey && (active === first || !this.overlay.contains(active))) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && (active === last || !this.overlay.contains(active))) {
				e.preventDefault();
				first.focus();
			}
		}
	}

	private renderFooter(): void {
		const state = this.state;

		// While downloading/installing only the progress needs to change.
		if (state.type === this.footerType && this.progressBar) {
			this.renderProgress();
			return;
		}

		this.footerType = state.type;
		this.footerDisposables.clear();
		dom.clearNode(this.footer);
		this.progressLabel = this.progressSize = this.progressBar = undefined;
		this.buttons = [];

		const busy = state.type === StateType.Downloading || state.type === StateType.Updating || state.type === StateType.Overwriting;
		if (busy) {
			this.renderProgressBox();
		}

		const actions = dom.append(this.footer, dom.$('.update-modal-actions'));
		this.buttons = this.buttons.filter(b => !this.footer.contains(b) && b.isConnected);

		if (!busy && !this.installRequested) {
			const skip = dom.append(actions, dom.$('button.update-modal-skip')) as HTMLButtonElement;
			skip.textContent = localize('updateModal.skipVersion', "Skip Version");
			this.footerDisposables.add(dom.addDisposableListener(skip, 'click', () => this.services.onSkip()));
		}

		const later = dom.append(actions, dom.$('button.update-modal-button.secondary')) as HTMLButtonElement;
		later.textContent = localize('updateModal.later', "Later");
		later.disabled = busy;
		this.footerDisposables.add(dom.addDisposableListener(later, 'click', () => this.services.onLater()));

		const primary = dom.append(actions, dom.$('button.update-modal-button.primary')) as HTMLButtonElement;
		primary.disabled = busy;
		primary.textContent = this.getPrimaryLabel(state);
		this.buttons.push(...Array.from(actions.children).filter(dom.isHTMLElement) as HTMLButtonElement[]);
		this.footerDisposables.add(dom.addDisposableListener(primary, 'click', () => this.onPrimary()));

		if (!busy) {
			primary.focus();
		} else {
			this.dialog.focus();
		}

		if (busy) {
			this.renderProgress();
		}
	}

	private getPrimaryLabel(state: State): string {
		switch (state.type) {
			case StateType.Downloading:
				return localize('updateModal.downloading', "Downloading...");
			case StateType.Updating:
			case StateType.Overwriting:
				return localize('updateModal.installing', "Installing...");
			case StateType.Downloaded:
				return localize('updateModal.install', "Install");
			case StateType.Ready:
				return localize('updateModal.restart', "Restart to Update");
			default:
				return localize('updateModal.downloadAndInstall', "Download & Install");
		}
	}

	private onPrimary(): void {
		const { updateService } = this.services;
		this.installRequested = true;

		switch (this.state.type) {
			case StateType.AvailableForDownload:
				void updateService.downloadUpdate(true).then(() => {
					// Platforms that hand the download to the browser (e.g. Linux) never enter the pipeline.
					const type = updateService.state.type;
					if (type === StateType.AvailableForDownload || !PIPELINE_STATES.includes(type)) {
						this.services.onClose();
					}
				});
				break;
			case StateType.Downloaded:
				void updateService.applyUpdate();
				break;
			case StateType.Ready:
				void updateService.quitAndInstall();
				break;
		}
	}

	private renderProgressBox(): void {
		const box = dom.append(this.footer, dom.$('.update-modal-progress'));
		const row = dom.append(box, dom.$('.update-modal-progress-row'));
		const label = dom.append(row, dom.$('.update-modal-progress-label'));
		const spinner = dom.append(label, dom.$(ThemeIcon.asCSSSelector(Codicon.loading)));
		spinner.classList.add('codicon-modifier-spin');
		this.progressLabel = dom.append(label, dom.$('span'));
		this.progressSize = dom.append(row, dom.$('.update-modal-progress-size'));
		const track = dom.append(box, dom.$('.update-modal-progress-track'));
		this.progressBar = dom.append(track, dom.$('.update-modal-progress-bar'));
	}

	private renderProgress(): void {
		const state = this.state;
		if (!this.progressLabel || !this.progressSize || !this.progressBar) {
			return;
		}

		let current: number | undefined;
		let max: number | undefined;

		if (state.type === StateType.Downloading) {
			this.progressLabel.textContent = localize('updateModal.progress.downloading', "Downloading...");
			current = state.downloadedBytes;
			max = state.totalBytes;
			this.progressSize.textContent = current !== undefined && max ? `${formatBytes(current)} / ${formatBytes(max)}` : '';
		} else {
			this.progressLabel.textContent = localize('updateModal.progress.installing', "Installing...");
			if (state.type === StateType.Updating) {
				current = state.currentProgress;
				max = state.maxProgress;
			}
			this.progressSize.textContent = '';
		}

		const percent = computeProgressPercent(current, max);
		this.progressBar.classList.toggle('indeterminate', percent === undefined);
		this.progressBar.style.width = percent === undefined ? '' : `${percent}%`;
	}

	private async loadPackageSize(): Promise<void> {
		const url = getUpdate(this.state)?.url;
		if (!url || !/^https:/i.test(url)) {
			return;
		}

		try {
			const context = await this.services.requestService.request({ type: 'HEAD', url, callSite: 'updateModal.packageSize' }, CancellationToken.None);
			const header = context.res.headers['content-length'];
			const size = Number(Array.isArray(header) ? header[0] : header);
			if (size > 0 && !this._store.isDisposed) {
				this.packageSize = size;
				this.renderMeta();
			}
		} catch {
			// The size is optional; it is also reported once the download starts.
		}
	}

	private async loadReleaseNotes(): Promise<void> {
		const { productService, requestService, markdownRendererService, openerService } = this.services;
		const urls = createGitHubReleaseByTagUrls(productService.updateUrl, this.version);

		let body: string | undefined;
		for (const url of urls) {
			try {
				const context = await requestService.request({
					url,
					headers: { 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
					callSite: 'updateModal.releaseNotes'
				}, CancellationToken.None);
				const payload = JSON.parse(await asTextOrError(context) ?? '') as { body?: string };
				body = payload.body?.trim();
				break;
			} catch {
				// Try the next candidate URL.
			}
		}

		if (this._store.isDisposed) {
			return;
		}

		dom.clearNode(this.notesElement);
		if (!body) {
			dom.append(this.notesElement, dom.$('.update-modal-notes-empty')).textContent = localize('updateModal.noNotes', "Release notes are not available for this version.");
			return;
		}

		const rendered = this._register(markdownRendererService.render(new MarkdownString(body, { supportThemeIcons: false }), {
			actionHandler: (link, markdown) => openLinkFromMarkdown(openerService, link, markdown.isTrusted)
		}));
		this.notesElement.appendChild(rendered.element);
	}
}

registerAction2(class ShowUpdateModalAction extends Action2 {
	constructor() {
		super({
			id: SHOW_UPDATE_MODAL_COMMAND,
			title: localize2('showUpdateModal', "Show Available Update"),
			category: { value: 'KnoxCoder', original: 'KnoxCoder' },
			f1: true,
		});
	}

	run(accessor: ServicesAccessor): void {
		// Re-open through the contribution so dismissal/skip state is bypassed.
		void accessor.get(ICommandService).executeCommand(SHOW_UPDATE_MODAL_INTERNAL_COMMAND);
	}
});
