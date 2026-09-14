/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { knoxGuiIconClass, KnoxGuiIconName } from '../knoxGuiIcons.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import {
	IKnoxCheckpointAnalysis,
	IKnoxCheckpointAuditRecord,
	IKnoxCheckpointBranch,
	IKnoxCheckpointDashboardData,
	IKnoxCheckpointGroupingSuggestion,
	IKnoxCheckpointTimeline,
	IKnoxCheckpointTimelineItem,
	IKnoxSharedBundle,
	knoxFormatBytes,
	knoxNormalizeCheckpointConfig,
	knoxParseStorageBytes,
	parseKnoxCheckpointAnalysis,
	parseKnoxCheckpointConfigResult,
	parseKnoxCheckpointList,
	parseKnoxCheckpointTimeline,
	parseKnoxDashboard,
	parseKnoxGroupingSuggestions,
	parseKnoxShareBundles,
} from '../../common/knoxCheckpoints.js';
import { IKnoxGuiBridge, knoxProtocolSuccess } from '../../common/knoxGuiProtocol.js';
import { formatKnoxSessionDate, parseKnoxSessionDate } from '../../common/knoxHistory.js';
import { KnoxCheckpointList } from './knoxCheckpointList.js';

function muted(parent: HTMLElement, text: string): HTMLElement {
	const p = append(parent, $('p.knox-muted'));
	p.textContent = text;
	return p;
}

export class KnoxCheckpointTimelineView extends Disposable {

	readonly element: HTMLElement;
	private readonly _viewStore = this._register(new DisposableStore());

	constructor(
		parent: HTMLElement,
		private readonly _list: KnoxCheckpointList,
		@IKnoxGuiBridge private readonly _bridge: IKnoxGuiBridge,
		@IQuickInputService private readonly _quickInput: IQuickInputService,
		@ICommandService private readonly _commandService: ICommandService,
		@IDialogService private readonly _dialog: IDialogService,
		@INotificationService private readonly _notification: INotificationService,
	) {
		super();
		this.element = append(parent, $('.knox-checkpoint-tab'));
		void this.refresh();
	}

	async refresh(): Promise<void> {
		this._viewStore.clear();
		clearNode(this.element);
		muted(this.element, localize('knox.checkpointTimeline.loading', "Loading timeline…"));
		try {
			const timeline = parseKnoxCheckpointTimeline(await this._bridge.request('getCheckpointTimeline', { limit: 500 }));
			this._render(timeline);
		} catch (error) {
			clearNode(this.element);
			muted(this.element, error instanceof Error ? error.message : String(error));
		}
	}

	private _render(timeline: IKnoxCheckpointTimeline): void {
		this._viewStore.clear();
		clearNode(this.element);
		const header = append(this.element, $('.knox-history-title-row'));
		append(header, $('h3')).textContent = localize('knox.timeline', "Timeline");
		append(header, $('span.knox-history-count')).textContent = String(timeline.checkpoints.length);

		const branches = append(this.element, $('.knox-checkpoint-branches'));
		for (const branch of timeline.branches) {
			const chip = append(branches, $<HTMLButtonElement>('button.knox-lump-chip'));
			chip.type = 'button';
			chip.classList.toggle('selected', branch.isActive);
			chip.textContent = branch.name;
			chip.style.borderColor = branch.color;
			this._viewStore.add(addDisposableListener(chip, 'click', () => void this._switch(branch)));
		}
		this._button(branches, localize('knox.deleteBranch', "Delete branch"), () => void this._commandService.executeCommand('knox.checkpoints.deleteBranch'));

		if (!timeline.checkpoints.length) {
			muted(this.element, localize('knox.noCheckpointsFound', "No checkpoints found"));
			return;
		}
		for (const item of timeline.checkpoints) {
			this._renderItem(item, timeline.branches);
		}
	}

	private _renderItem(item: IKnoxCheckpointTimelineItem, branches: readonly IKnoxCheckpointBranch[]): void {
		const row = append(this.element, $('.knox-history-row'));
		const body = append(row, $('.knox-history-row-body'));
		append(body, $('span.knox-history-row-title')).textContent = item.description || item.id;
		const meta = append(body, $('.knox-history-row-meta'));
		append(meta, $('span')).textContent = item.type;
		append(meta, $('span')).textContent = formatKnoxSessionDate(parseKnoxSessionDate(item.created));
		if (item.branchId) {
			const branch = branches.find(b => b.id === item.branchId);
			append(meta, $('span')).textContent = branch?.name ?? item.branchId;
		}
		const actions = append(row, $('.knox-history-actions'));
		this._icon(actions, 'git-branch', localize('knox.branch', "Branch"), () => void this._createBranch(item.id));
		this._icon(actions, 'rotate-ccw', localize('knox.restore', "Restore"), () => this._list.openRestore(item.id));
		this._icon(actions, 'trash-2', localize('knox.delete', "Delete"), () => void this._delete(item.id));
	}

	private async _createBranch(baseCheckpointId: string): Promise<void> {
		const name = await this._quickInput.input({
			placeHolder: localize('knox.enterBranchName', "Branch name"),
			prompt: localize('knox.enterBranchName', "Branch name"),
		});
		if (!name?.trim()) {
			return;
		}
		const result = await this._bridge.request('createCheckpointBranch', { name: name.trim(), baseCheckpointId });
		if (knoxProtocolSuccess(result)) {
			await this.refresh();
		} else {
			this._notification.error(localize('knox.branchFailed', "Could not create the branch."));
		}
	}

	private async _switch(branch: IKnoxCheckpointBranch): Promise<void> {
		const result = await this._bridge.request('switchCheckpointBranch', { branchId: branch.id });
		if (knoxProtocolSuccess(result)) {
			await this.refresh();
		}
	}

	private async _delete(checkpointId: string): Promise<void> {
		const confirmed = await this._dialog.confirm({
			message: localize('knox.deleteCheckpointConfirm', "Delete this checkpoint?"),
			primaryButton: localize('knox.delete', "Delete"),
		});
		if (!confirmed.confirmed) {
			return;
		}
		await this._bridge.request('deleteCheckpoints', { checkpointIds: [checkpointId] });
		await this.refresh();
	}

	private _button(parent: HTMLElement, label: string, onClick: () => void): void {
		const button = append(parent, $<HTMLButtonElement>('button.knox-history-tool'));
		button.type = 'button';
		button.textContent = label;
		this._viewStore.add(addDisposableListener(button, 'click', onClick));
	}

	private _icon(parent: HTMLElement, icon: KnoxGuiIconName, label: string, onClick: () => void): void {
		const button = append(parent, $<HTMLButtonElement>('button.knox-icon-button'));
		button.type = 'button';
		button.title = label;
		append(button, $('span')).className = knoxGuiIconClass(icon);
		this._viewStore.add(addDisposableListener(button, 'click', e => {
			e.stopPropagation();
			onClick();
		}));
	}
}

export class KnoxCheckpointAnalysisView extends Disposable {

	readonly element: HTMLElement;
	private readonly _viewStore = this._register(new DisposableStore());
	private _selectedId: string | undefined;

	constructor(
		parent: HTMLElement,
		@IKnoxGuiBridge private readonly _bridge: IKnoxGuiBridge,
	) {
		super();
		this.element = append(parent, $('.knox-checkpoint-tab'));
		void this.refresh();
	}

	async refresh(): Promise<void> {
		this._viewStore.clear();
		clearNode(this.element);
		append(this.element, $('h3')).textContent = localize('knox.checkpointAnalysis.title', "Analysis");
		muted(this.element, localize('knox.checkpointAnalysis.subtitle', "Local heuristics from manifests and diffs. Not an LLM summary."));
		try {
			const { checkpoints } = parseKnoxCheckpointList(await this._bridge.request('listCheckpoints', { limit: 50 }));
			if (!checkpoints.length) {
				muted(this.element, localize('knox.noCheckpointsFound', "No checkpoints found"));
				return;
			}
			this._selectedId = this._selectedId && checkpoints.some(item => item.id === this._selectedId)
				? this._selectedId
				: checkpoints[0].id;
			const select = append(this.element, $<HTMLSelectElement>('select.knox-checkpoint-workspace'));
			for (const checkpoint of checkpoints) {
				const option = append(select, $<HTMLOptionElement>('option'));
				option.value = checkpoint.id;
				option.textContent = checkpoint.description || checkpoint.id;
			}
			select.value = this._selectedId;
			this._viewStore.add(addDisposableListener(select, 'change', () => {
				this._selectedId = select.value;
				void this.refresh();
			}));
			const [analysisResult, groupsResult] = await Promise.all([
				this._bridge.request('analyzeCheckpoint', { checkpointId: this._selectedId }),
				this._bridge.request('suggestCheckpointGroups', { limit: 50 }),
			]);
			this._renderAnalysis(parseKnoxCheckpointAnalysis(analysisResult), parseKnoxGroupingSuggestions(groupsResult));
		} catch (error) {
			muted(this.element, error instanceof Error ? error.message : String(error));
		}
	}

	private _renderAnalysis(analysis: IKnoxCheckpointAnalysis | undefined, groups: IKnoxCheckpointGroupingSuggestion[]): void {
		if (!analysis) {
			muted(this.element, localize('knox.checkpointAnalysis.empty', "No analysis for this checkpoint."));
			return;
		}
		const risk = append(this.element, $('.knox-checkpoint-card'));
		append(risk, $('strong')).textContent = localize('knox.risk', "Risk: {0} ({1})", analysis.riskAssessment.level, analysis.riskAssessment.score);
		if (analysis.generatedDescription) {
			append(risk, $('p')).textContent = analysis.generatedDescription;
		}
		for (const rec of analysis.riskAssessment.recommendations) {
			append(risk, $('p.knox-muted')).textContent = rec;
		}
		const impact = append(this.element, $('.knox-checkpoint-card'));
		append(impact, $('strong')).textContent = localize('knox.impact', "Impact: {0}", analysis.impactAnalysis.scope);
		for (const feature of analysis.impactAnalysis.affectedFeatures) {
			append(impact, $('p')).textContent = `${feature.name} (${feature.changedFiles.length})`;
		}
		if (groups.length || analysis.groupingSuggestion) {
			const box = append(this.element, $('.knox-checkpoint-card'));
			append(box, $('strong')).textContent = localize('knox.groupingSuggestions', "Grouping suggestions");
			const all = analysis.groupingSuggestion ? [analysis.groupingSuggestion, ...groups] : groups;
			for (const group of all) {
				append(box, $('p')).textContent = `${group.groupName} — ${group.rationale}`;
			}
		}
	}
}

export class KnoxCheckpointDashboardView extends Disposable {

	readonly element: HTMLElement;

	constructor(
		parent: HTMLElement,
		@IKnoxGuiBridge private readonly _bridge: IKnoxGuiBridge,
	) {
		super();
		this.element = append(parent, $('.knox-checkpoint-tab'));
		void this.refresh();
	}

	async refresh(): Promise<void> {
		clearNode(this.element);
		muted(this.element, localize('knox.checkpointDashboard.loading', "Loading dashboard…"));
		try {
			const data = parseKnoxDashboard(await this._bridge.request('getPerformanceDashboard', { historyDays: 30 }));
			this._render(data);
		} catch (error) {
			clearNode(this.element);
			muted(this.element, error instanceof Error ? error.message : String(error));
		}
	}

	private _render(data: IKnoxCheckpointDashboardData): void {
		clearNode(this.element);
		append(this.element, $('h3')).textContent = localize('knox.checkpointDashboard.tab', "Dashboard");
		const summary = data.summary;
		const cards = append(this.element, $('.knox-checkpoint-metrics'));
		this._metric(cards, localize('knox.checkpoints', "Checkpoints"), String(summary?.totalCheckpointsCreated ?? data.currentStorage?.checkpointCount ?? 0), 'lucide-database');
		this._metric(cards, localize('knox.storage', "Storage"), knoxFormatBytes(data.currentStorage?.totalBytes ?? 0), 'hard-drive');
		this._metric(cards, localize('knox.restorations', "Restorations"), String(summary?.totalRestorations ?? data.restorationEvents.length), 'rotate-ccw');
		this._metric(cards, localize('knox.successRate', "Success rate"), summary ? `${Math.round(summary.restorationSuccessRate * 100)}%` : '—', 'activity');
		this._metric(cards, localize('knox.aiSessions', "AI sessions"), String(summary?.totalAiSessions ?? data.aiSessionMetrics.length), 'bot');

		append(this.element, $('h4')).textContent = localize('knox.restorationHistory', "Restoration history");
		if (!data.restorationEvents.length) {
			muted(this.element, localize('knox.noRestorations', "No restorations yet."));
		} else {
			for (const event of data.restorationEvents.slice(0, 20)) {
				const row = append(this.element, $('p.knox-muted'));
				row.textContent = `${formatKnoxSessionDate(parseKnoxSessionDate(event.timestamp))} · ${event.checkpointId.slice(0, 8)} · ${event.success ? localize('knox.ok', "ok") : localize('knox.failed', "failed")} · ${event.filesRestored} files`;
			}
		}

		append(this.element, $('h4')).textContent = localize('knox.aiSessionMetrics', "AI session metrics");
		if (!data.aiSessionMetrics.length) {
			muted(this.element, localize('knox.noAiSessions', "No AI session metrics."));
		} else {
			for (const session of data.aiSessionMetrics.slice(0, 20)) {
				const row = append(this.element, $('p.knox-muted'));
				row.textContent = `${session.sessionId.slice(0, 8)} · ${session.filesChanged} files · ${session.checkpointsCreated} checkpoints`;
			}
		}
	}

	private _metric(parent: HTMLElement, label: string, value: string, icon: KnoxGuiIconName): void {
		const card = append(parent, $('.knox-checkpoint-card'));
		const heading = append(card, $('h3'));
		append(heading, $('span')).className = knoxGuiIconClass(icon);
		append(heading, $('span.knox-muted')).textContent = label;
		append(card, $('strong')).textContent = value;
	}
}

export class KnoxCheckpointShareView extends Disposable {

	readonly element: HTMLElement;
	private readonly _viewStore = this._register(new DisposableStore());

	constructor(
		parent: HTMLElement,
		@IKnoxGuiBridge private readonly _bridge: IKnoxGuiBridge,
		@INotificationService private readonly _notification: INotificationService,
	) {
		super();
		this.element = append(parent, $('.knox-checkpoint-tab'));
		void this.refresh();
	}

	async refresh(): Promise<void> {
		this._viewStore.clear();
		clearNode(this.element);
		muted(this.element, localize('knox.checkpointShare.loading', "Loading share bundles…"));
		try {
			const payload = parseKnoxShareBundles(await this._bridge.request('getSharedCheckpointBundles', { limit: 100 }));
			this._render(payload.bundles, payload.auditRecords);
		} catch (error) {
			clearNode(this.element);
			muted(this.element, error instanceof Error ? error.message : String(error));
		}
	}

	private _render(bundles: IKnoxSharedBundle[], audit: IKnoxCheckpointAuditRecord[]): void {
		this._viewStore.clear();
		clearNode(this.element);
		const header = append(this.element, $('.knox-history-title-row'));
		append(header, $('h3')).textContent = localize('knox.checkpointShare.sharedBundles', "Shared bundles");
		const share = append(header, $<HTMLButtonElement>('button.knox-history-tool'));
		share.type = 'button';
		append(share, $('span')).className = knoxGuiIconClass('share-2');
		append(share, $('span')).textContent = localize('knox.checkpointShare.shareNew', "Share checkpoints");
		this._viewStore.add(addDisposableListener(share, 'click', () => void this._share()));

		if (!bundles.length) {
			muted(this.element, localize('knox.checkpointShare.noBundles', "No shared bundles yet. Write a checksummed bundle file to share over USB, email, or a PR. Nothing is uploaded."));
		} else {
			for (const bundle of bundles) {
				const row = append(this.element, $('.knox-history-row'));
				const body = append(row, $('.knox-history-row-body'));
				append(body, $('span.knox-history-row-title')).textContent = bundle.description || bundle.id;
				append(body, $('.knox-history-row-meta')).textContent = `${bundle.checkpointCount} · ${bundle.filePath}`;
				const actions = append(row, $('.knox-history-actions'));
				this._textButton(actions, localize('knox.import', "Import"), () => void this._import(bundle));
				this._textButton(actions, localize('knox.reveal', "Reveal"), () => void this._bridge.request('revealSharedBundle', { filePath: bundle.filePath }));
			}
		}

		append(this.element, $('h4')).textContent = localize('knox.auditLog', "Audit log");
		if (!audit.length) {
			muted(this.element, localize('knox.noAudit', "No audit records."));
			return;
		}
		for (const record of audit.slice(0, 30)) {
			append(this.element, $('p.knox-muted')).textContent = `${formatKnoxSessionDate(parseKnoxSessionDate(record.timestamp))} · ${record.action} · ${record.outcome} · ${record.details}`;
		}
	}

	private async _share(): Promise<void> {
		const result = await this._bridge.request('shareCheckpoints', {});
		if (knoxProtocolSuccess(result)) {
			await this.refresh();
		} else {
			this._notification.error(localize('knox.shareFailed', "Could not share checkpoints."));
		}
	}

	private async _import(bundle: IKnoxSharedBundle): Promise<void> {
		const result = await this._bridge.request('importSharedBundle', { filePath: bundle.filePath });
		if (knoxProtocolSuccess(result)) {
			await this.refresh();
		} else {
			this._notification.error(localize('knox.importFailed', "Could not import the bundle."));
		}
	}

	private _textButton(parent: HTMLElement, label: string, onClick: () => void): void {
		const button = append(parent, $<HTMLButtonElement>('button.knox-history-tool'));
		button.type = 'button';
		button.textContent = label;
		this._viewStore.add(addDisposableListener(button, 'click', onClick));
	}
}

export class KnoxCheckpointConfigView extends Disposable {

	readonly element: HTMLElement;
	private readonly _viewStore = this._register(new DisposableStore());
	private _config = knoxNormalizeCheckpointConfig(undefined);

	constructor(
		parent: HTMLElement,
		@IKnoxGuiBridge private readonly _bridge: IKnoxGuiBridge,
		@INotificationService private readonly _notification: INotificationService,
	) {
		super();
		this.element = append(parent, $('.knox-checkpoint-tab'));
		void this.refresh();
	}

	async refresh(): Promise<void> {
		this._viewStore.clear();
		clearNode(this.element);
		try {
			this._config = parseKnoxCheckpointConfigResult(await this._bridge.request('getCheckpointConfig', undefined));
		} catch {
			this._config = knoxNormalizeCheckpointConfig(undefined);
		}
		this._render();
	}

	private _render(): void {
		this._viewStore.clear();
		clearNode(this.element);
		append(this.element, $('h3')).textContent = localize('knox.configuration', "Configuration");
		const form = append(this.element, $('div.knox-checkpoint-form'));
		this._number(form, localize('knox.maxCheckpoints', "Max checkpoints"), this._config.maxCheckpoints, value => this._config.maxCheckpoints = value);
		this._number(form, localize('knox.retentionDays', "Retention days"), this._config.retentionDays, value => this._config.retentionDays = value);
		const storage = this._text(form, localize('knox.maxStorage', "Max storage"), knoxFormatBytes(this._config.maxStorageBytes));
		this._number(form, localize('knox.maxFilesPerCheckpoint', "Max files per checkpoint"), this._config.maxFilesPerCheckpoint, value => this._config.maxFilesPerCheckpoint = value);
		this._check(form, localize('knox.captureBinaryFiles', "Capture binary files"), this._config.captureBinaryFiles, value => this._config.captureBinaryFiles = value);
		this._check(form, localize('knox.enableCompression', "Enable compression"), this._config.enableCompression, value => this._config.enableCompression = value);
		this._check(form, localize('knox.enableAutoCheckpoints', "Automatic checkpoints"), this._config.enableAutoCheckpoints, value => this._config.enableAutoCheckpoints = value);
		this._check(form, localize('knox.autoCleanup', "Auto cleanup"), this._config.autoCleanup, value => this._config.autoCleanup = value);
		this._number(form, localize('knox.autoMinIntervalMs', "Auto min interval (ms)"), this._config.autoMinIntervalMs, value => this._config.autoMinIntervalMs = value);
		this._number(form, localize('knox.autoFileChangeThreshold', "File change threshold"), this._config.autoFileChangeThreshold, value => this._config.autoFileChangeThreshold = value);
		const exts = this._text(form, localize('knox.trackedExtensions', "Tracked extensions"), this._config.trackedExtensions.join(', '));

		const save = append(this.element, $<HTMLButtonElement>('button.knox-history-tool.primary'));
		save.type = 'button';
		save.textContent = localize('knox.save', "Save");
		this._viewStore.add(addDisposableListener(save, 'click', () => void this._save(storage.value, exts.value)));
	}

	private async _save(storageInput: string, extensionsInput: string): Promise<void> {
		const parsed = knoxParseStorageBytes(storageInput);
		if (parsed) {
			this._config.maxStorageBytes = parsed;
		}
		this._config.trackedExtensions = extensionsInput.split(/[\s,]+/).map(item => item.replace(/^\./, '')).filter(Boolean);
		const result = await this._bridge.request('saveCheckpointConfig', { config: knoxNormalizeCheckpointConfig(this._config) });
		if (knoxProtocolSuccess(result)) {
			this._notification.info(localize('knox.checkpointConfigSaved', "Checkpoint configuration saved."));
			await this.refresh();
		} else {
			this._notification.error(localize('knox.checkpointConfigSaveFailed', "Could not save checkpoint configuration."));
		}
	}

	private _number(parent: HTMLElement, label: string, value: number, set: (value: number) => void): HTMLInputElement {
		const wrap = append(parent, $('label.knox-checkpoint-field'));
		append(wrap, $('span')).textContent = label;
		const input = append(wrap, $<HTMLInputElement>('input'));
		input.type = 'number';
		input.value = String(value);
		this._viewStore.add(addDisposableListener(input, 'change', () => set(Number(input.value) || value)));
		return input;
	}

	private _text(parent: HTMLElement, label: string, value: string): HTMLInputElement {
		const wrap = append(parent, $('label.knox-checkpoint-field'));
		append(wrap, $('span')).textContent = label;
		const input = append(wrap, $<HTMLInputElement>('input'));
		input.type = 'text';
		input.value = value;
		return input;
	}

	private _check(parent: HTMLElement, label: string, value: boolean, set: (value: boolean) => void): void {
		const wrap = append(parent, $('label.knox-checkpoint-field'));
		const input = append(wrap, $<HTMLInputElement>('input'));
		input.type = 'checkbox';
		input.checked = value;
		append(wrap, $('span')).textContent = label;
		this._viewStore.add(addDisposableListener(input, 'change', () => set(input.checked)));
	}
}
