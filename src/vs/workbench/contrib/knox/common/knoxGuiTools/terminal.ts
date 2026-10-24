/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Terminal / build / PTY command display, output extraction, and tail clipping. */

export const TERMINAL_TAIL_LINES = 400;
export const TERMINAL_TAIL_CHARS = 32_000;
/** Visible rows in a chat terminal card before the body scrolls. */
export const TERMINAL_VISIBLE_LINES = 5;
export const TERMINAL_LINE_HEIGHT_PX = 18;
export const TERMINAL_BODY_PAD_PX = 24;
export const TERMINAL_BODY_MIN_PX = 80;
export const TERMINAL_BODY_MAX_PX = TERMINAL_VISIBLE_LINES * TERMINAL_LINE_HEIGHT_PX + TERMINAL_BODY_PAD_PX;

export function terminalBodyHeight(tail: string, hasCommand: boolean, minHeight = TERMINAL_BODY_MIN_PX, maxHeight = TERMINAL_BODY_MAX_PX): number {
	const lineCount = (tail ? tail.split('\n').length : 0) + (hasCommand ? 1 : 0);
	return Math.min(Math.max(lineCount * TERMINAL_LINE_HEIGHT_PX + TERMINAL_BODY_PAD_PX, minHeight), maxHeight);
}

export function extractTerminalOutput(items: Array<{ name?: string; description?: string; content?: string }> | undefined): string {
	if (!items?.length) {
		return '';
	}
	const match = items.find(item =>
		item.name === 'Terminal' ||
		item.name === 'Build' ||
		item.name === 'Terminal command output' ||
		item.description === 'Terminal command output' ||
		item.description?.startsWith('Terminal command') ||
		item.description?.startsWith('Background shell') ||
		item.description?.startsWith('Shell job') ||
		item.description === 'Unknown shell job' ||
		item.description?.includes('shell job'));
	return match?.content || items[0]?.content || '';
}

export function displayBuildCommand(args: Record<string, unknown> | undefined): string {
	if (!args) {
		return 'project build';
	}
	const explain = typeof args.explain === 'string' ? args.explain.trim() : '';
	if (explain) {
		const code = explain.toUpperCase().match(/E\d{4}/);
		return code ? `rustc --explain ${code[0]}` : `rustc --explain ${explain}`;
	}
	const doc = (typeof args.doc === 'string' && args.doc.trim()) || (typeof args.symbol === 'string' && args.symbol.trim()) || '';
	const action = typeof args.action === 'string' ? args.action.trim().toLowerCase() : '';
	if (action === 'doc' || doc) {
		return doc ? `rustdoc ${doc}` : 'rustdoc lookup';
	}
	if (typeof args.command === 'string' && args.command.trim()) {
		return args.command.trim();
	}
	const extra = (typeof args.extraArgs === 'string' && args.extraArgs.trim()) || (typeof args.extra_args === 'string' && args.extra_args.trim()) || '';
	const jobsRaw = args.jobs;
	const jobs = typeof jobsRaw === 'number' && Number.isFinite(jobsRaw) && jobsRaw > 0 ? `-j${Math.min(Math.floor(jobsRaw), 256)}` : '';
	const target = typeof args.target === 'string' ? args.target.trim() : '';
	const pkg = target && /^[\w.-]+$/.test(target) && !target.includes('/') ? `-p ${target}` : target;
	const cargoVerb: Record<string, string> = {
		check: 'check', build: 'build', bench: 'bench', clippy: 'clippy', test: 'test',
		fix: 'fix --allow-dirty', expand: 'expand', miri: '+nightly miri test', deny: 'deny check',
		audit: 'audit', tree: 'tree', fmt: 'fmt --check',
	};
	const verb = cargoVerb[action];
	if (verb) {
		return ['cargo', verb, jobs, pkg, extra].filter(Boolean).join(' ');
	}
	if (!action && !jobs && !pkg && !extra) {
		return 'project build';
	}
	return ['build', jobs, pkg, extra].filter(Boolean).join(' ');
}

export function terminalCommandForTool(name: string, args: Record<string, unknown>, t: (key: string, vars?: Record<string, string | number>) => string): string {
	const n = name.replace(/^builtin_/, '').toLowerCase().replace(/-/g, '_');
	if (n === 'build') {
		return displayBuildCommand(args);
	}
	if (n === 'await_shell') {
		const id = typeof args.job_id === 'string' ? args.job_id : '';
		if (!id) {
			return t('jobsListCommand');
		}
		return args.kill ? t('jobsKillCommand', { id }) : t('jobsAwaitCommand', { id });
	}
	if (n === 'pty_start') {
		return String(args.command ?? '');
	}
	if (n === 'pty_send') {
		return args.job_id ? `pty send ${args.job_id}` : 'pty send';
	}
	if (n === 'pty_read') {
		const id = typeof args.job_id === 'string' ? args.job_id : '';
		if (!id) {
			return 'pty read';
		}
		return args.kill ? t('jobsKillCommand', { id }) : `pty read ${id}`;
	}
	if (n === 'qemu') {
		if (args.action === 'start') {
			return String(args.command || `qemu ${args.kernel || args.arch || 'session'}`);
		}
		return args.job_id ? `qemu ${args.action || 'status'} ${args.job_id}` : `qemu ${args.action || 'session'}`;
	}
	if (n === 'debug') {
		return `debug ${args.op || 'session'}`;
	}
	return String(args.command ?? '');
}

export function takeTerminalTail(content: string, maxLines = TERMINAL_TAIL_LINES, maxChars = TERMINAL_TAIL_CHARS): { tail: string; truncated: boolean; hiddenLines: number } {
	if (!content) {
		return { tail: '', truncated: false, hiddenLines: 0 };
	}
	const lines = content.split('\n');
	const start = Math.max(0, lines.length - maxLines);
	let tail = lines.slice(start).join('\n');
	if (tail.length > maxChars) {
		tail = tail.slice(-maxChars);
		const nl = tail.indexOf('\n');
		if (nl !== -1 && nl < tail.length - 1) {
			tail = tail.slice(nl + 1);
		}
		const tailLineCount = tail ? tail.split('\n').length : 0;
		return { tail, truncated: true, hiddenLines: Math.max(0, lines.length - tailLineCount) };
	}
	return { tail, truncated: start > 0, hiddenLines: start };
}

export function extractLogPathFromTerminalOutput(text: string): string | undefined {
	const match = text.match(/^Full log:\s*(.+)$/m);
	const path = match?.[1]?.trim();
	return path || undefined;
}
