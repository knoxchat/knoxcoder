/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { knoxGuiIconClass, KnoxGuiIconName, knoxMemorySettingsSectionIcon } from '../knoxGuiIcons.js';
import { IClipboardService } from '../../../../../platform/clipboard/common/clipboardService.js';
import { IDialogService, IFileDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IKnoxGuiBridge, knoxProtocolObject, knoxProtocolSuccess, knoxUnwrapProtocol } from '../../common/knoxGuiProtocol.js';
import {
	IKnoxMemoryConfig,
	IKnoxMemorySettingField,
	KNOX_MEMORY_PROTOCOL,
	knoxFormatConsolidateResult,
	knoxImportLooksValid,
	knoxImportNeedsPassword,
	knoxMemorySettingSections,
	knoxParseExportPayload,
	knoxParseMemoryConfig,
} from '../../common/knoxMemory.js';

export class KnoxMemorySettings extends Disposable {

	readonly element: HTMLElement;
	private readonly _viewStore = this._register(new DisposableStore());
	private _config: IKnoxMemoryConfig | undefined;
	private _savedKey: string | undefined;
	private _busy = '';
	private _exportPassword = '';
	private _importPassword = '';
	private _collapsed = new Set<string>();

	constructor(
		parent: HTMLElement,
		@IKnoxGuiBridge private readonly _bridge: IKnoxGuiBridge,
		@IDialogService private readonly _dialog: IDialogService,
		@INotificationService private readonly _notification: INotificationService,
		@IClipboardService private readonly _clipboard: IClipboardService,
		@IFileDialogService private readonly _fileDialog: IFileDialogService,
		@IFileService private readonly _fileService: IFileService,
	) {
		super();
		this.element = append(parent, $('.knox-memory-tab.knox-memory-settings'));
		for (const section of knoxMemorySettingSections()) {
			if (section.collapsible) {
				this._collapsed.add(section.id);
			}
		}
		void this.refresh();
	}

	async refresh(): Promise<void> {
		try {
			this._config = knoxParseMemoryConfig(await this._bridge.request(KNOX_MEMORY_PROTOCOL.getConfig));
		} catch {
			this._config = undefined;
		}
		this._render();
	}

	private _render(): void {
		this._viewStore.clear();
		clearNode(this.element);
		if (!this._config) {
			append(this.element, $('p.knox-muted')).textContent = localize('knox.memoryNoData', "No memory data yet.");
			return;
		}
		for (const section of knoxMemorySettingSections()) {
			this._renderSection(section.id, section.title, section.collapsible === true, section.entries);
		}
		this._renderMaintenance();
		this._renderDanger();
	}

	private _renderSection(id: string, title: string, collapsible: boolean, entries: ReturnType<typeof knoxMemorySettingSections>[number]['entries']): void {
		const card = append(this.element, $('.knox-checkpoint-card'));
		const header = append(card, $<HTMLButtonElement>('button.knox-memory-section-header'));
		header.type = 'button';
		header.disabled = !collapsible;
		if (collapsible) {
			append(header, $('span')).className = knoxGuiIconClass(this._collapsed.has(id) ? 'lucide-chevron-right' : 'lucide-chevron-down');
		}
		append(header, $('span')).className = knoxGuiIconClass(knoxMemorySettingsSectionIcon(id));
		append(header, $('h3')).textContent = title;
		if (collapsible) {
			this._viewStore.add(addDisposableListener(header, 'click', () => {
				if (this._collapsed.has(id)) {
					this._collapsed.delete(id);
				} else {
					this._collapsed.add(id);
				}
				this._render();
			}));
		}
		if (collapsible && this._collapsed.has(id)) {
			return;
		}
		for (const entry of entries) {
			if (entry.kind === 'heading') {
				append(card, $('h4')).textContent = entry.label;
				continue;
			}
			if (entry.kind === 'note') {
				append(card, $('p.knox-muted')).textContent = entry.text;
				continue;
			}
			this._renderField(card, entry);
		}
	}

	private _renderField(parent: HTMLElement, field: IKnoxMemorySettingField): void {
		if (!this._config) {
			return;
		}
		const wrap = append(parent, $('label.knox-checkpoint-field'));
		const title = append(wrap, $('span'));
		title.textContent = field.label;
		if (this._savedKey === field.key) {
			const saved = append(title, $('span.knox-memory-saved'));
			saved.textContent = ` ${localize('knox.saved', "Saved")}`;
		}
		append(wrap, $('span.knox-muted')).textContent = field.description;
		const current = this._config[field.key];
		if (field.kind === 'toggle') {
			const input = append(wrap, $<HTMLInputElement>('input'));
			input.type = 'checkbox';
			input.checked = !!current;
			this._viewStore.add(addDisposableListener(input, 'change', () => void this._save(field.key, input.checked)));
			return;
		}
		if (field.kind === 'select') {
			const select = append(wrap, $<HTMLSelectElement>('select.knox-memory-select'));
			for (const option of field.options ?? []) {
				const node = append(select, $<HTMLOptionElement>('option'));
				node.value = option.value;
				node.textContent = option.label;
			}
			select.value = String(current);
			this._viewStore.add(addDisposableListener(select, 'change', () => void this._save(field.key, select.value)));
			return;
		}
		const input = append(wrap, $<HTMLInputElement>('input'));
		if (field.kind === 'text') {
			input.type = 'text';
			input.value = String(current ?? '');
			this._viewStore.add(addDisposableListener(input, 'change', () => void this._save(field.key, input.value)));
			return;
		}
		input.type = 'number';
		if (field.min != null) {
			input.min = String(field.min);
		}
		if (field.max != null) {
			input.max = String(field.max);
		}
		if (field.step != null) {
			input.step = String(field.step);
		}
		const scale = field.scale ?? 1;
		input.value = String(Number(current) * scale);
		if (field.suffix) {
			append(wrap, $('span.knox-muted')).textContent = field.suffix;
		}
		this._viewStore.add(addDisposableListener(input, 'change', () => {
			const next = Number(input.value);
			if (!Number.isFinite(next)) {
				return;
			}
			void this._save(field.key, scale === 1 ? next : next / scale);
		}));
	}

	private _renderMaintenance(): void {
		const card = append(this.element, $('.knox-checkpoint-card'));
		const maintenanceTitle = append(card, $('h3'));
		append(maintenanceTitle, $('span')).className = knoxGuiIconClass('wrench');
		append(maintenanceTitle, $('span')).textContent = localize('knox.memoryMaintenanceActions', "Maintenance");
		const grid = append(card, $('.knox-memory-actions'));
		this._action(grid, localize('knox.memoryOptimizeDb', "Optimize DB"), 'zap', 'optimize', () => void this._run('optimize'));
		this._action(grid, localize('knox.memoryConsolidateNow', "Consolidate now"), 'refresh-cw', 'consolidate', () => void this._confirm(
			'consolidate',
			localize('knox.memoryConsolidateNow', "Consolidate now"),
			localize('knox.memoryConsolidateWarning', "Run sleep consolidation now? This may take a moment."),
		));
		this._action(grid, localize('knox.memoryExportData', "Export"), 'file-down', 'export', () => void this._export());
		this._action(grid, localize('knox.memoryImportData', "Import"), 'upload', 'import', () => void this._import());
		this._action(grid, localize('knox.memoryHealSystem', "Heal"), 'heart-pulse', 'heal', () => void this._run('heal'));

		const passwords = append(card, $('.knox-memory-split'));
		this._password(passwords, localize('knox.memoryExportPasswordOptional', "Export password (optional)"), this._exportPassword, value => this._exportPassword = value);
		this._password(passwords, localize('knox.memoryImportPasswordOptional', "Import password (optional)"), this._importPassword, value => this._importPassword = value);
		append(card, $('p.knox-muted')).textContent = localize('knox.memoryBackupLocalOnly', "Exports stay on this machine unless you copy them elsewhere.");
	}

	private _renderDanger(): void {
		const card = append(this.element, $('.knox-checkpoint-card'));
		const dangerTitle = append(card, $('h3'));
		append(dangerTitle, $('span')).className = knoxGuiIconClass('alert-triangle');
		append(dangerTitle, $('span')).textContent = localize('knox.memoryDangerZone', "Danger zone");
		append(card, $('p.knox-muted')).textContent = localize('knox.memoryDangerZoneDesc', "Destructive maintenance. Confirm before running.");
		this._action(card, localize('knox.memoryPurgeExpired', "Purge expired"), 'trash-2', 'prune_expired', () => void this._confirm(
			'prune_expired',
			localize('knox.memoryPurgeExpired', "Purge expired"),
			localize('knox.memoryPurgeWarning', "Permanently delete expired cold memories?"),
		), true);
	}

	private async _save(key: keyof IKnoxMemoryConfig, value: unknown): Promise<void> {
		if (!this._config) {
			return;
		}
		(this._config as unknown as Record<string, unknown>)[key] = value as never;
		try {
			await this._bridge.request(KNOX_MEMORY_PROTOCOL.updateConfig, { key, value: String(value) });
			this._savedKey = key;
			this._render();
			setTimeout(() => {
				if (this._savedKey === key) {
					this._savedKey = undefined;
					this._render();
				}
			}, 2000);
		} catch {
			this._notification.error(localize('knox.memoryActionFailed', "Memory action failed."));
		}
	}

	private async _confirm(action: string, label: string, detail: string): Promise<void> {
		const confirmed = await this._dialog.confirm({
			type: 'warning',
			message: localize('knox.memoryConfirmAction', "Confirm action"),
			detail,
			primaryButton: label,
		});
		if (confirmed.confirmed) {
			await this._run(action);
		}
	}

	private async _run(action: string): Promise<void> {
		this._busy = action;
		this._render();
		try {
			let message = localize('knox.memoryActionSuccess', "Done");
			if (action === 'optimize') {
				const result = await this._bridge.request(KNOX_MEMORY_PROTOCOL.optimize);
				message = knoxProtocolSuccess(result)
					? String(knoxProtocolObject(result)?.message ?? message)
					: localize('knox.memoryActionFailed', "Memory action failed.");
			} else if (action === 'consolidate') {
				message = knoxFormatConsolidateResult(await this._bridge.request(KNOX_MEMORY_PROTOCOL.consolidate));
			} else if (action === 'heal') {
				const result = await this._bridge.request(KNOX_MEMORY_PROTOCOL.heal);
				message = knoxProtocolSuccess(result) ? message : localize('knox.memoryActionFailed', "Memory action failed.");
			} else if (action === 'prune_expired') {
				const result = await this._bridge.request(KNOX_MEMORY_PROTOCOL.heal, { action: 'prune_expired' });
				message = knoxProtocolSuccess(result) ? message : localize('knox.memoryActionFailed', "Memory action failed.");
			} else {
				await this._bridge.request(KNOX_MEMORY_PROTOCOL.dispatch, { action });
			}
			this._notification.info(message);
		} catch {
			this._notification.error(localize('knox.memoryActionFailed', "Memory action failed."));
		} finally {
			this._busy = '';
			this._render();
		}
	}

	private async _export(): Promise<void> {
		this._busy = 'export';
		this._render();
		try {
			const payload = knoxParseExportPayload(await this._bridge.request(KNOX_MEMORY_PROTOCOL.export, {
				password: this._exportPassword.trim() || undefined,
			}));
			if (!payload) {
				this._notification.error(localize('knox.memoryActionFailed', "Memory action failed."));
				return;
			}
			await this._clipboard.writeText(payload.data);
			const sizeKb = (payload.data.length / 1024).toFixed(1);
			const base = payload.filePath
				? `${localize('knox.memoryExportSuccess', "Export written")} (${sizeKb} KB) → ${payload.filePath}`
				: `${localize('knox.memoryExportCopied', "Export copied")} (${sizeKb} KB)`;
			this._notification.info(payload.encrypted
				? `${base} · ${localize('knox.memoryExportEncrypted', "Encrypted")}`
				: `${base} · ${localize('knox.memoryExportLocalOnly', "Local only")}`);
			this._exportPassword = '';
		} catch {
			this._notification.error(localize('knox.memoryActionFailed', "Memory action failed."));
		} finally {
			this._busy = '';
			this._render();
		}
	}

	private async _import(): Promise<void> {
		const uris = await this._fileDialog.showOpenDialog({
			canSelectFiles: true,
			canSelectMany: false,
			filters: [{ name: 'JSON', extensions: ['json'] }],
			title: localize('knox.memoryImportData', "Import"),
		});
		const uri = uris?.[0];
		if (!uri) {
			return;
		}
		this._busy = 'import';
		this._render();
		try {
			const file = await this._fileService.readFile(uri);
			const text = file.value.toString();
			if (!knoxImportLooksValid(text)) {
				this._notification.error(localize('knox.memoryImportInvalidFile', "That file is not a Knox memory export."));
				return;
			}
			if (knoxImportNeedsPassword(text) && !this._importPassword.trim()) {
				this._notification.error(localize('knox.memoryImportPasswordRequired', "This export is encrypted. Enter the import password."));
				return;
			}
			const result = await this._bridge.request(KNOX_MEMORY_PROTOCOL.import, {
				data: text,
				password: this._importPassword.trim() || undefined,
			});
			if (knoxProtocolSuccess(result)) {
				const unwrapped = knoxUnwrapProtocol(result);
				const resultText = typeof unwrapped.content === 'string'
					? unwrapped.content
					: String(knoxProtocolObject(result)?.result ?? localize('knox.memoryActionSuccess', "Done"));
				this._notification.info(resultText);
				this._importPassword = '';
				await this.refresh();
			} else {
				this._notification.error(localize('knox.memoryActionFailed', "Memory action failed."));
			}
		} catch {
			this._notification.error(localize('knox.memoryActionFailed', "Memory action failed."));
		} finally {
			this._busy = '';
			this._render();
		}
	}

	private _action(parent: HTMLElement, label: string, icon: KnoxGuiIconName, id: string, run: () => void, danger?: boolean): void {
		const button = append(parent, $<HTMLButtonElement>('button.knox-history-tool'));
		button.type = 'button';
		button.disabled = this._busy === id;
		if (danger) {
			button.classList.add('danger');
		}
		append(button, $('span')).className = knoxGuiIconClass(icon);
		append(button, $('span')).textContent = this._busy === id ? localize('knox.working', "Working…") : label;
		this._viewStore.add(addDisposableListener(button, 'click', run));
	}

	private _password(parent: HTMLElement, label: string, value: string, set: (value: string) => void): void {
		const wrap = append(parent, $('label.knox-checkpoint-field'));
		append(wrap, $('span')).textContent = label;
		const input = append(wrap, $<HTMLInputElement>('input'));
		input.type = 'password';
		input.value = value;
		input.placeholder = localize('knox.memoryExportPasswordPlaceholder', "Optional password");
		this._viewStore.add(addDisposableListener(input, 'input', () => set(input.value)));
	}
}
