/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Catalog names used by doom-loop, permissions, and tool-card routing. */
export const KnoxBuiltInToolName = {
	ReadFile: 'builtin_read_file',
	ReadCurrentlyOpenFile: 'builtin_read_currently_open_file',
	CreateNewFile: 'builtin_create_new_file',
	EditFile: 'builtin_edit_file',
	WriteFile: 'builtin_write_file',
	ApplyPatch: 'builtin_apply_patch',
	RunTerminalCommand: 'builtin_run_terminal_command',
	AwaitShell: 'builtin_await_shell',
	ViewSubdirectory: 'builtin_view_subdirectory',
	Glob: 'builtin_glob',
	ViewRepoMap: 'builtin_view_repo_map',
	ExactSearch: 'builtin_exact_search',
	SearchWeb: 'builtin_search_web',
	ViewDiff: 'builtin_view_diff',
	EnhancedSearch: 'builtin_enhanced_search',
	Skill: 'builtin_skill',
	Lsp: 'builtin_lsp',
	Memory: 'builtin_memory',
	MemoryGraph: 'builtin_memory_graph',
	MemorySessions: 'builtin_memory_sessions',
	MemoryManage: 'builtin_memory_manage',
	MemoryLearn: 'builtin_memory_learn',
	AskUser: 'builtin_ask_user',
	Task: 'builtin_task',
	GenerateTests: 'builtin_generate_tests',
	GitStatus: 'builtin_git_status',
	GitDiff: 'builtin_git_diff',
	GitLog: 'builtin_git_log',
	GitBlame: 'builtin_git_blame',
	GitCommit: 'builtin_git_commit',
	GitBisect: 'builtin_git_bisect',
	WorkspaceCheckpoint: 'builtin_workspace_checkpoint',
	Build: 'builtin_build',
	PtyStart: 'builtin_pty_start',
	PtySend: 'builtin_pty_send',
	PtyRead: 'builtin_pty_read',
	Qemu: 'builtin_qemu',
	Debug: 'builtin_debug',
	Kconfig: 'builtin_kconfig',
	Maintainers: 'builtin_maintainers',
	Plan: 'builtin_plan',
} as const;

export type KnoxBuiltInToolName = (typeof KnoxBuiltInToolName)[keyof typeof KnoxBuiltInToolName];

const BUILT_IN_NAME_SET = new Set<string>(Object.values(KnoxBuiltInToolName));

const TOOL_NAME_ALIASES: Record<string, KnoxBuiltInToolName> = {
	read: KnoxBuiltInToolName.ReadFile,
	read_file: KnoxBuiltInToolName.ReadFile,
	readfile: KnoxBuiltInToolName.ReadFile,
	read_file_line: KnoxBuiltInToolName.ReadFile,
	read_file_lines: KnoxBuiltInToolName.ReadFile,
	read_file_range: KnoxBuiltInToolName.ReadFile,
	read_lines: KnoxBuiltInToolName.ReadFile,
	read_range: KnoxBuiltInToolName.ReadFile,
	view: KnoxBuiltInToolName.ReadFile,
	view_file: KnoxBuiltInToolName.ReadFile,
	write: KnoxBuiltInToolName.WriteFile,
	write_file: KnoxBuiltInToolName.WriteFile,
	edit: KnoxBuiltInToolName.EditFile,
	edit_file: KnoxBuiltInToolName.EditFile,
	str_replace: KnoxBuiltInToolName.EditFile,
	apply_patch: KnoxBuiltInToolName.ApplyPatch,
	create_file: KnoxBuiltInToolName.CreateNewFile,
	create_new_file: KnoxBuiltInToolName.CreateNewFile,
	bash: KnoxBuiltInToolName.RunTerminalCommand,
	shell: KnoxBuiltInToolName.RunTerminalCommand,
	run: KnoxBuiltInToolName.RunTerminalCommand,
	run_terminal_command: KnoxBuiltInToolName.RunTerminalCommand,
	grep: KnoxBuiltInToolName.ExactSearch,
	rg: KnoxBuiltInToolName.ExactSearch,
	exact_search: KnoxBuiltInToolName.ExactSearch,
	glob: KnoxBuiltInToolName.Glob,
	list_dir: KnoxBuiltInToolName.ViewSubdirectory,
	ls: KnoxBuiltInToolName.ViewSubdirectory,
	web_search: KnoxBuiltInToolName.SearchWeb,
	search_web: KnoxBuiltInToolName.SearchWeb,
	ask_user: KnoxBuiltInToolName.AskUser,
	task: KnoxBuiltInToolName.Task,
	workspace_checkpoint: KnoxBuiltInToolName.WorkspaceCheckpoint,
	checkpoint: KnoxBuiltInToolName.WorkspaceCheckpoint,
	generate_tests: KnoxBuiltInToolName.GenerateTests,
	blame: KnoxBuiltInToolName.GitBlame,
	git_blame: KnoxBuiltInToolName.GitBlame,
	bisect: KnoxBuiltInToolName.GitBisect,
	git_bisect: KnoxBuiltInToolName.GitBisect,
	build: KnoxBuiltInToolName.Build,
	compile: KnoxBuiltInToolName.Build,
	pty: KnoxBuiltInToolName.PtyStart,
	pty_start: KnoxBuiltInToolName.PtyStart,
	pty_send: KnoxBuiltInToolName.PtySend,
	pty_read: KnoxBuiltInToolName.PtyRead,
	qemu: KnoxBuiltInToolName.Qemu,
	debug: KnoxBuiltInToolName.Debug,
	gdb: KnoxBuiltInToolName.Debug,
	plan: KnoxBuiltInToolName.Plan,
};

const TOOL_NAME_PREFIX_RULES: Array<[RegExp, KnoxBuiltInToolName]> = [
	[/^read_file/, KnoxBuiltInToolName.ReadFile],
	[/^read_line/, KnoxBuiltInToolName.ReadFile],
	[/^read_range/, KnoxBuiltInToolName.ReadFile],
	[/^view_file/, KnoxBuiltInToolName.ReadFile],
	[/^grep/, KnoxBuiltInToolName.ExactSearch],
	[/^str_replace/, KnoxBuiltInToolName.EditFile],
];

function normalizeToolNameKey(name: string): string {
	return name
		.trim()
		.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '');
}

/**
 * Map model-emitted short names (`read_file`, `Read`, `grep`) onto catalog names.
 */
export function resolveBuiltInToolName(name: string | undefined | null): string {
	if (!name) {
		return '';
	}
	const trimmed = name.trim();
	if (BUILT_IN_NAME_SET.has(trimmed)) {
		return trimmed;
	}
	const lower = trimmed.toLowerCase();
	if (BUILT_IN_NAME_SET.has(lower)) {
		return lower;
	}
	if (TOOL_NAME_ALIASES[lower]) {
		return TOOL_NAME_ALIASES[lower];
	}

	const normalized = normalizeToolNameKey(trimmed);
	if (BUILT_IN_NAME_SET.has(normalized)) {
		return normalized;
	}
	if (TOOL_NAME_ALIASES[normalized]) {
		return TOOL_NAME_ALIASES[normalized];
	}

	const bare = normalized.replace(/^builtin_/, '');
	if (TOOL_NAME_ALIASES[bare]) {
		return TOOL_NAME_ALIASES[bare];
	}

	const withBuiltin = lower.startsWith('builtin_') ? lower : `builtin_${lower}`;
	if (BUILT_IN_NAME_SET.has(withBuiltin)) {
		return withBuiltin;
	}

	for (const [pattern, tool] of TOOL_NAME_PREFIX_RULES) {
		if (pattern.test(bare)) {
			return tool;
		}
	}

	return trimmed;
}
