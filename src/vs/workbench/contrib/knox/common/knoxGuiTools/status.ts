/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isAskUserToolName } from '../knoxGuiChat.js';
import { KnoxToolStatus } from '../knoxGuiState.js';

/** Live tool-card status, titles, template HTML, and collapse/body rules. */

const LIVE_STATUSES: ReadonlySet<KnoxToolStatus> = new Set(['generating', 'generated', 'calling']);

export interface IKnoxGuiFinishedToolSummary {
	name: string;
	detail?: string;
	result?: string;
}

export type KnoxGuiToolStatusIcon = 'spinner' | 'arrow-right' | 'check' | 'x';

export function isLiveToolStatus(status: KnoxToolStatus): boolean {
	return LIVE_STATUSES.has(status);
}

export function shouldRenderToolBody(status: KnoxToolStatus, userCollapsed: boolean, options?: { alwaysShow?: boolean }): boolean {
	if (options?.alwaysShow) {
		return true;
	}
	if (isLiveToolStatus(status)) {
		return true;
	}
	return !userCollapsed;
}

export function toolAlwaysShowsBody(toolName: string | undefined): boolean {
	return isAskUserToolName(toolName);
}

export function formatToolName(name: string, displayTitle?: string): string {
	if (displayTitle) {
		return displayTitle;
	}
	return name
		.replace(/^builtin_/, '')
		.split(/[_-]/g)
		.filter(Boolean)
		.map(word => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ');
}

export function getCategorizedToolName(name: string, displayTitle?: string): string {
	const formatted = formatToolName(name, displayTitle);
	if (name.includes('memory')) {
		return `[Memory] ${formatted}`;
	}
	if (name.includes('file') || name.includes('directory') || name.includes('map')) {
		return `[Files] ${formatted}`;
	}
	if (name.includes('search')) {
		return `[Search] ${formatted}`;
	}
	if (name.includes('terminal') || name.includes('command')) {
		return `[Terminal] ${formatted}`;
	}
	if (name.includes('diff')) {
		return `[Diff] ${formatted}`;
	}
	if (name.includes('web')) {
		return `[Web] ${formatted}`;
	}
	return `[Tool] ${formatted}`;
}

function escapeTemplateValue(value: unknown): string {
	return String(value ?? '').replace(/[&<>"'`=\/]/g, ch => `&#${ch.charCodeAt(0)};`);
}

/**
 * Mustache render of a tool template to HTML, as `ToolCall.tsx` injects it. Argument values
 * are always escaped (also for `{{{ }}}`) because they come from the model.
 */
export function renderToolTemplateHtml(template: string, args: Record<string, unknown>): string {
	// An omitted directory means the workspace root; never render an empty `""`.
	const value = (key: string) => {
		const raw = args[key];
		if (key === 'directory_path' && (raw === undefined || raw === null || String(raw).trim() === '')) {
			return escapeTemplateValue('.');
		}
		return escapeTemplateValue(raw);
	};
	return template
		.replace(/\{\{\{\s*(\w+)\s*\}\}\}/g, (_, key: string) => value(key))
		.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => value(key))
		.trim();
}

export function toolStatusIntroKey(status: KnoxToolStatus): string {
	if (status === 'generating') {
		return 'toolGenerating';
	}
	if (status === 'generated') {
		return 'toolWouldLikeTo';
	}
	if (status === 'calling') {
		return 'toolFor';
	}
	if (status === 'canceled') {
		return 'toolCanceled';
	}
	if (status === 'errored') {
		return 'toolFailed';
	}
	return '';
}

export function toolStatusFallbackKey(status: KnoxToolStatus): string {
	if (status === 'calling') {
		return 'toolUsing';
	}
	if (status === 'done') {
		return 'toolUsed';
	}
	return 'toolUse';
}

export function toolStatusIcon(status: KnoxToolStatus): KnoxGuiToolStatusIcon {
	if (status === 'generating' || status === 'calling') {
		return 'spinner';
	}
	if (status === 'generated') {
		return 'arrow-right';
	}
	if (status === 'done') {
		return 'check';
	}
	return 'x';
}

export function finishedToolSummaryText(summary: IKnoxGuiFinishedToolSummary): string {
	return [summary.detail, summary.result].filter(Boolean).join(' · ');
}
