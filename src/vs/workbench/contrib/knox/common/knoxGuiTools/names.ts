/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IKnoxGuiTool, KnoxToolSetting } from '../knoxGuiState.js';

/** Catalog aliases, permission identity, and tool-setting display. */

export type KnoxGuiToolPermissionDisplay = 'disabled' | 'autoApprove' | 'sessionAlways' | 'requiresApproval';

/**
 * Core `resolveBuiltInToolName` aliases. Models drop `builtin_` or emit
 * Claude/Codex short names; map those onto catalog names so titles, kinds,
 * and permissions stay on the real tool.
 */
const GUI_TOOL_NAME_ALIASES: Record<string, string> = {
	read: 'builtin_read_file',
	read_file: 'builtin_read_file',
	readfile: 'builtin_read_file',
	read_file_line: 'builtin_read_file',
	read_file_lines: 'builtin_read_file',
	read_file_range: 'builtin_read_file',
	read_lines: 'builtin_read_file',
	read_range: 'builtin_read_file',
	view: 'builtin_read_file',
	view_file: 'builtin_read_file',
	cat: 'builtin_read_file',
	open_file: 'builtin_read_file',
	get_file: 'builtin_read_file',
	show_file: 'builtin_read_file',
	write: 'builtin_write_file',
	write_file: 'builtin_write_file',
	writefile: 'builtin_write_file',
	delete: 'builtin_delete_file',
	delete_file: 'builtin_delete_file',
	deletefile: 'builtin_delete_file',
	remove_file: 'builtin_delete_file',
	removefile: 'builtin_delete_file',
	unlink: 'builtin_delete_file',
	edit: 'builtin_edit_file',
	edit_file: 'builtin_edit_file',
	str_replace: 'builtin_edit_file',
	strreplace: 'builtin_edit_file',
	str_replace_editor: 'builtin_edit_file',
	search_replace: 'builtin_edit_file',
	apply_patch: 'builtin_apply_patch',
	applypatch: 'builtin_apply_patch',
	create_file: 'builtin_create_new_file',
	create_new_file: 'builtin_create_new_file',
	bash: 'builtin_run_terminal_command',
	shell: 'builtin_run_terminal_command',
	exec: 'builtin_run_terminal_command',
	execute: 'builtin_run_terminal_command',
	run: 'builtin_run_terminal_command',
	terminal: 'builtin_run_terminal_command',
	run_terminal_command: 'builtin_run_terminal_command',
	grep: 'builtin_exact_search',
	rg: 'builtin_exact_search',
	ripgrep: 'builtin_exact_search',
	exact_search: 'builtin_exact_search',
	search: 'builtin_exact_search',
	search_code: 'builtin_exact_search',
	codebase_search: 'builtin_exact_search',
	find_in_files: 'builtin_exact_search',
	glob: 'builtin_glob',
	find: 'builtin_glob',
	list_dir: 'builtin_view_subdirectory',
	list_directory: 'builtin_view_subdirectory',
	view_subdirectory: 'builtin_view_subdirectory',
	ls: 'builtin_view_subdirectory',
	tree: 'builtin_view_subdirectory',
	web_search: 'builtin_search_web',
	search_web: 'builtin_search_web',
	ask_user: 'builtin_ask_user',
	ask_question: 'builtin_ask_user',
	askquestion: 'builtin_ask_user',
	ask_user_question: 'builtin_ask_user',
	askuserquestion: 'builtin_ask_user',
	task: 'builtin_task',
	workspace_checkpoint: 'builtin_workspace_checkpoint',
	checkpoint: 'builtin_workspace_checkpoint',
	build: 'builtin_build',
	compile: 'builtin_build',
	kbuild: 'builtin_build',
	pty: 'builtin_pty_start',
	pty_start: 'builtin_pty_start',
	pty_send: 'builtin_pty_send',
	pty_read: 'builtin_pty_read',
	qemu: 'builtin_qemu',
	debug: 'builtin_debug',
	gdb: 'builtin_debug',
	dap: 'builtin_debug',
	kconfig: 'builtin_kconfig',
	menuconfig: 'builtin_kconfig',
	maintainers: 'builtin_maintainers',
	get_maintainer: 'builtin_maintainers',
	get_maintainers: 'builtin_maintainers',
	blame: 'builtin_git_blame',
	git_blame: 'builtin_git_blame',
	bisect: 'builtin_git_bisect',
	git_bisect: 'builtin_git_bisect',
	plan: 'builtin_plan',
	task_plan: 'builtin_plan',
	todo: 'builtin_plan',
};

const GUI_TOOL_NAME_PREFIX_RULES: Array<[RegExp, string]> = [
	[/^read_file/, 'builtin_read_file'],
	[/^read_line/, 'builtin_read_file'],
	[/^read_range/, 'builtin_read_file'],
	[/^view_file/, 'builtin_read_file'],
	[/^grep/, 'builtin_exact_search'],
	[/^ripgrep/, 'builtin_exact_search'],
	[/^exact_search/, 'builtin_exact_search'],
	[/^search_code/, 'builtin_exact_search'],
	[/^find_in_files/, 'builtin_exact_search'],
	[/^list_dir/, 'builtin_view_subdirectory'],
	[/^str_replace/, 'builtin_edit_file'],
];

function normalizeToolNameKey(name: string): string {
	return name
		.trim()
		.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '');
}

export function inferGuiToolNameFromArgs(args: Record<string, unknown> | undefined): string | undefined {
	if (!args || typeof args !== 'object') {
		return undefined;
	}
	const keys = new Set(Object.keys(args).map(key => key.toLowerCase().replace(/[^a-z0-9]+/g, '_')).filter(Boolean));
	if (!keys.size) {
		return undefined;
	}
	if (keys.has('old_string') || keys.has('new_string') || keys.has('old_str') || keys.has('new_str')) {
		return 'builtin_edit_file';
	}
	if (keys.has('patch') || keys.has('diff')) {
		return 'builtin_apply_patch';
	}
	if (keys.has('command') || keys.has('cmd') || keys.has('shell_command')) {
		return 'builtin_run_terminal_command';
	}
	if (keys.has('pattern') || keys.has('glob_pattern') || keys.has('glob')) {
		return 'builtin_glob';
	}
	if (keys.has('questions') || keys.has('question')) {
		return 'builtin_ask_user';
	}
	if (keys.has('directory') || keys.has('dir') || keys.has('directory_path') || keys.has('maxfiles') || keys.has('max_files')) {
		return 'builtin_view_subdirectory';
	}
	if (keys.has('query') || keys.has('search_term') || keys.has('pattern_text')) {
		return 'builtin_exact_search';
	}
	if ((keys.has('contents') || keys.has('content') || keys.has('new_contents')) && (keys.has('filepath') || keys.has('file_path') || keys.has('path'))) {
		return 'builtin_write_file';
	}
	if (keys.has('filepath') || keys.has('target_file') || keys.has('file_path') || keys.has('relativefilepath')) {
		return 'builtin_read_file';
	}
	return undefined;
}

const PLACEHOLDER_GUI_TOOL_NAMES = new Set([
	'tool', 'tool_name', 'toolname', 'function', 'function_name', 'func', 'name', 'unknown', 'tool_call', 'function_call', 'callable', 'action',
]);

export function resolveGuiToolName(name: string | undefined, tools: readonly IKnoxGuiTool[] = [], args?: Record<string, unknown>): string {
	if (!name) {
		return inferGuiToolNameFromArgs(args) ?? '';
	}
	const trimmed = name.trim();
	if (!trimmed) {
		return inferGuiToolNameFromArgs(args) ?? '';
	}
	const normalized = normalizeToolNameKey(trimmed);
	const bare = normalized.replace(/^builtin_/, '');
	if (PLACEHOLDER_GUI_TOOL_NAMES.has(bare) || PLACEHOLDER_GUI_TOOL_NAMES.has(normalized)) {
		const inferred = inferGuiToolNameFromArgs(args);
		if (inferred) {
			return tools.find(tool => tool.name === inferred)?.name ?? inferred;
		}
		return bare;
	}
	const exact = tools.find(tool => tool.name === trimmed);
	if (exact) {
		return exact.name;
	}
	const lower = trimmed.toLowerCase();
	const ci = tools.find(tool => tool.name.toLowerCase() === lower);
	if (ci) {
		return ci.name;
	}
	const prefixed = normalized.startsWith('builtin_') ? normalized : `builtin_${normalized}`;
	const fromCatalog = tools.find(tool => {
		const n = tool.name.toLowerCase();
		return n === prefixed || n === normalized;
	});
	if (fromCatalog) {
		return fromCatalog.name;
	}
	const alias = GUI_TOOL_NAME_ALIASES[normalized] ?? GUI_TOOL_NAME_ALIASES[bare] ?? GUI_TOOL_NAME_ALIASES[lower];
	if (alias) {
		return tools.find(tool => tool.name === alias)?.name ?? alias;
	}
	for (const [pattern, mapped] of GUI_TOOL_NAME_PREFIX_RULES) {
		if (pattern.test(bare)) {
			return tools.find(tool => tool.name === mapped)?.name ?? mapped;
		}
	}
	return tools.find(tool => tool.name === prefixed)?.name ?? trimmed;
}

export function isSamePermissionTool(left: string | undefined, right: string | undefined, tools: readonly IKnoxGuiTool[] = []): boolean {
	const a = resolveGuiToolName(left, tools);
	const b = resolveGuiToolName(right, tools);
	return Boolean(a && a === b);
}

export function catalogToolForCall(tools: IKnoxGuiTool[], name: string): IKnoxGuiTool | undefined {
	const resolved = resolveGuiToolName(name, tools);
	if (!resolved) {
		return undefined;
	}
	return tools.find(tool => tool.name === resolved) ?? tools.find(tool => tool.name === name);
}

export function toolPermissionDisplay(params: {
	toolName: string;
	toolSettings: Record<string, KnoxToolSetting>;
	sessionAllowlist: string[];
	tools?: readonly IKnoxGuiTool[];
}): KnoxGuiToolPermissionDisplay {
	const tools = params.tools ?? [];
	const resolved = resolveGuiToolName(params.toolName, tools) || params.toolName;
	const setting = params.toolSettings[resolved] ?? params.toolSettings[params.toolName] ?? 'allowedWithoutPermission';
	if (setting === 'disabled') {
		return 'disabled';
	}
	if (setting === 'allowedWithoutPermission') {
		return 'autoApprove';
	}
	if (params.sessionAllowlist.some(item => isSamePermissionTool(item, params.toolName, tools))) {
		return 'sessionAlways';
	}
	return 'requiresApproval';
}
