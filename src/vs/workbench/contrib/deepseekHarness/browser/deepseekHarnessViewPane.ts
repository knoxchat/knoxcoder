/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener, findParentWithClass, getWindow } from '../../../../base/browser/dom.js';
import { DisposableStore, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../base/common/network.js';
import { escape } from '../../../../base/common/strings.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { DEEPSEEK_HARNESS_DEFAULT_PORT, DeepSeekHarnessColorScheme, IDeepSeekHarnessService, IDeepSeekHarnessStatus } from '../../../../platform/deepseekHarness/common/deepseekHarness.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { isDark } from '../../../../platform/theme/common/theme.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ViewPane, ViewPaneShowActions } from '../../../browser/parts/views/viewPane.js';
import { IViewletViewOptions } from '../../../browser/parts/views/viewsViewlet.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IOverlayWebview, IWebviewService, WebviewContentPurpose } from '../../webview/browser/webview.js';
import { WebviewWindowDragMonitor } from '../../webview/browser/webviewWindowDragMonitor.js';

export class DeepSeekHarnessViewPane extends ViewPane {

	private readonly _webview = this._register(new MutableDisposable<IOverlayWebview>());
	private readonly _webviewDisposables = this._register(new DisposableStore());
	private _container?: HTMLElement;
	private _rootContainer?: HTMLElement;
	private _activated = false;
	private _startGeneration = 0;

	constructor(
		options: IViewletViewOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IWebviewService private readonly webviewService: IWebviewService,
		@IDeepSeekHarnessService private readonly deepseekHarnessService: IDeepSeekHarnessService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
	) {
		super({ ...options, showActions: ViewPaneShowActions.WhenExpanded }, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);

		this._register(this.onDidChangeBodyVisibility(() => this.updateVisibility()));
		this._register(this.deepseekHarnessService.onDidChangeStatus(status => this.renderStatus(status)));
		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => void this.followWorkspace()));
		this._register(this.workspaceContextService.onDidChangeWorkbenchState(() => void this.followWorkspace()));
		this._register(this.themeService.onDidColorThemeChange(() => void this.followTheme()));
		this.updateVisibility();
	}

	override focus(): void {
		super.focus();
		this._webview.value?.focus();
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		this._container = container;
		this._rootContainer = undefined;
		container.tabIndex = 0;
		container.setAttribute('role', 'document');
		this._register(addDisposableListener(container, 'focus', e => {
			if (e.target === container && this._webview.value) {
				this._webview.value.focus();
			}
		}));

		this.layoutWebview();
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		this.layoutWebview();
	}

	async reload(): Promise<void> {
		this._startGeneration++;
		await this.deepseekHarnessService.stop();
		await this.startRuntime();
	}

	private updateVisibility(): void {
		if (this.isBodyVisible()) {
			this.activate();
			this._webview.value?.claim(this, getWindow(this.element), undefined);
			void this.startRuntime();
		} else {
			this._webview.value?.release(this);
		}
	}

	private activate(): void {
		if (this._activated) {
			return;
		}
		this._activated = true;

		const port = this.getPort();
		const webview = this.webviewService.createWebviewOverlay({
			providedViewType: this.id,
			title: this.title,
			options: {
				purpose: WebviewContentPurpose.WebviewView,
				retainContextWhenHidden: true,
			},
			contentOptions: {
				allowScripts: true,
				allowForms: true,
				portMapping: [{ webviewPort: port, extensionHostPort: port }],
			},
			extension: undefined,
		});
		this._webview.value = webview;
		this.layoutWebview();

		this._webviewDisposables.add(toDisposable(() => {
			this._webview.value?.release(this);
		}));
		this._webviewDisposables.add(new WebviewWindowDragMonitor(getWindow(this.element), () => this._webview.value));

		this.renderStatus({ state: 'starting', message: localize('deepseekHarness.starting', "Starting DeepSeek Harness…") });
	}

	private editorWorkspaceFolders(): string[] {
		return this.workspaceContextService.getWorkspace().folders
			.filter(folder => folder.uri.scheme === Schemas.file)
			.map(folder => folder.uri.fsPath);
	}

	private async startRuntime(): Promise<void> {
		const generation = ++this._startGeneration;
		const folders = this.editorWorkspaceFolders();
		if (folders.length === 0) {
			this.renderHint(
				localize('deepseekHarness.openFolderTitle', "DeepSeek Harness"),
				localize('deepseekHarness.openFolder', "Open a folder in KnoxCoder to use DeepSeek Harness as the workspace agent."),
			);
			return;
		}

		this.renderStatus({ state: 'starting', message: localize('deepseekHarness.starting', "Starting DeepSeek Harness…") });

		const port = this.getPort();
		if (this._webview.value) {
			this._webview.value.contentOptions = {
				allowScripts: true,
				allowForms: true,
				portMapping: [{ webviewPort: port, extensionHostPort: port }],
			};
		}

		const checkoutPath = this.configurationService.getValue<string>('deepseekHarness.checkoutPath')?.trim();
		const extraArgsValue = this.configurationService.getValue('deepseekHarness.extraArgs');
		const extraArgs = Array.isArray(extraArgsValue) ? extraArgsValue.filter((arg): arg is string => typeof arg === 'string') : [];

		try {
			const status = await this.deepseekHarnessService.start({
				port,
				workspaceFolders: folders,
				colorScheme: this.editorColorScheme(),
				checkoutPath: checkoutPath || undefined,
				extraArgs,
			});

			if (generation !== this._startGeneration) {
				return;
			}

			this.renderStatus(status);
		} catch (error) {
			if (generation !== this._startGeneration) {
				return;
			}
			const message = error instanceof Error ? error.message : String(error);
			this.renderStatus({ state: 'error', message });
		}
	}

	private followWorkspace(): void {
		if (!this.isBodyVisible()) {
			return;
		}
		void this.startRuntime();
	}

	private followTheme(): void {
		if (!this.isBodyVisible()) {
			return;
		}
		const colorScheme = this.editorColorScheme();
		void this.deepseekHarnessService.syncTheme(colorScheme).then(undefined, () => { });
		void this._webview.value?.postMessage({ knoxColorScheme: colorScheme });
	}

	private editorColorScheme(): DeepSeekHarnessColorScheme {
		return isDark(this.themeService.getColorTheme().type) ? 'dark' : 'light';
	}

	private renderStatus(status: IDeepSeekHarnessStatus): void {
		const webview = this._webview.value;
		if (!webview) {
			return;
		}

		if (status.state === 'running' && status.url) {
			webview.setHtml(this.getFrameHtml(this.workspaceAwareUrl(status.url)));
			return;
		}

		const title = status.state === 'error'
			? localize('deepseekHarness.errorTitle', "DeepSeek Harness could not start")
			: localize('deepseekHarness.startingTitle', "DeepSeek Harness");
		const message = status.message
			?? localize('deepseekHarness.starting', "Starting DeepSeek Harness…");
		this.renderHint(title, message);
	}

	private renderHint(title: string, message: string): void {
		this._webview.value?.setHtml(this.getMessageHtml(title, message));
	}

	private getPort(): number {
		const port = this.configurationService.getValue<number>('deepseekHarness.port');
		return typeof port === 'number' && port > 0 ? port : DEEPSEEK_HARNESS_DEFAULT_PORT;
	}

	private workspaceAwareUrl(baseUrl: string): string {
		const folders = this.editorWorkspaceFolders();
		if (folders.length === 0) {
			return baseUrl;
		}
		const url = new URL(baseUrl);
		url.searchParams.set('knoxWorkspace', folders.join('|'));
		return url.toString();
	}

	private getFrameHtml(url: string): string {
		const safeUrl = escape(url);
		const colorScheme = this.editorColorScheme();
		return `<!DOCTYPE html>
<html style="color-scheme: ${colorScheme};">
<head>
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-src *;">
	<meta name="color-scheme" content="${colorScheme}">
	<style>
		html, body, iframe { width: 100%; height: 100%; margin: 0; padding: 0; border: 0; background: transparent; color-scheme: ${colorScheme}; }
		body { overflow: hidden; }
	</style>
</head>
<body>
	<iframe src="${safeUrl}" style="color-scheme: ${colorScheme};" sandbox="allow-scripts allow-forms allow-same-origin allow-downloads allow-popups allow-modals" allow="clipboard-read; clipboard-write"></iframe>
	<script>
		window.addEventListener('message', event => {
			const scheme = event.data && event.data.knoxColorScheme;
			if (scheme !== 'light' && scheme !== 'dark') {
				return;
			}
			document.documentElement.style.colorScheme = scheme;
			const frame = document.querySelector('iframe');
			if (frame) {
				frame.style.colorScheme = scheme;
			}
			const meta = document.querySelector('meta[name="color-scheme"]');
			if (meta) {
				meta.setAttribute('content', scheme);
			}
		});
	</script>
</body>
</html>`;
	}

	private getMessageHtml(title: string, message: string): string {
		const colorScheme = this.editorColorScheme();
		return `<!DOCTYPE html>
<html style="color-scheme: ${colorScheme};">
<head>
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
	<meta name="color-scheme" content="${colorScheme}">
	<style>
		html, body { width: 100%; height: 100%; margin: 0; background: transparent; color: var(--vscode-foreground, #ccc); font-family: var(--vscode-font-family, sans-serif); color-scheme: ${colorScheme}; }
		.wrap { box-sizing: border-box; padding: 16px; line-height: 1.5; }
		h1 { font-size: 13px; font-weight: 600; margin: 0 0 8px; }
		p { font-size: 12px; margin: 0; white-space: pre-wrap; }
	</style>
</head>
<body>
	<div class="wrap">
		<h1>${escape(title)}</h1>
		<p>${escape(message)}</p>
	</div>
</body>
</html>`;
	}

	private layoutWebview(): void {
		const webview = this._webview.value;
		if (!this._container || !webview) {
			return;
		}
		if (!this._rootContainer || !this._rootContainer.isConnected) {
			this._rootContainer = this.findRootContainer(this._container);
		}
		webview.setAnchorElement(this._container, this._rootContainer);
	}

	private findRootContainer(container: HTMLElement): HTMLElement | undefined {
		return findParentWithClass(container, 'monaco-scrollable-element') ?? undefined;
	}
}
