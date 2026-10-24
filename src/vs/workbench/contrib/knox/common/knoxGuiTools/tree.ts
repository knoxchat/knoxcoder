/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IKnoxGuiToolOutputItem } from '../knoxGuiState.js';

/** Subdirectory / repo-map trees: ANSI colorize, preview clip, stats, and output parts. */

export const STATIC_TREE_PREVIEW_LINES = 24;

const DARK_ANSI = {
	reset: '\x1b[0m',
	bold: '\x1b[1m',
	dim: '\x1b[2m',
	blue: '\x1b[38;2;97;175;239m',
	cyan: '\x1b[38;2;86;182;194m',
	green: '\x1b[38;2;152;195;121m',
	yellow: '\x1b[38;2;229;192;123m',
	red: '\x1b[38;2;224;108;117m',
	magenta: '\x1b[38;2;198;120;221m',
	gray: '\x1b[38;2;92;99;112m',
	white: '\x1b[38;2;171;178;191m',
};

const LIGHT_ANSI = {
	reset: '\x1b[0m',
	bold: '\x1b[1m',
	dim: '\x1b[2m',
	blue: '\x1b[38;2;64;120;242m',
	cyan: '\x1b[38;2;1;132;188m',
	green: '\x1b[38;2;80;161;79m',
	yellow: '\x1b[38;2;193;132;1m',
	red: '\x1b[38;2;228;86;73m',
	magenta: '\x1b[38;2;166;38;164m',
	gray: '\x1b[38;2;105;108;119m',
	white: '\x1b[38;2;56;58;66m',
};

export function treePreviewLines(plain: string, maxLines = STATIC_TREE_PREVIEW_LINES): { text: string; hiddenLines: number } {
	if (!plain) {
		return { text: '', hiddenLines: 0 };
	}
	const lines = plain.split('\n');
	if (lines.length <= maxLines) {
		return { text: plain, hiddenLines: 0 };
	}
	return { text: lines.slice(0, maxLines).join('\n'), hiddenLines: lines.length - maxLines };
}

/** `LazyColorizedTree.tsx` Terminal options: `scrollback: 5000`, `rows: max(8, floor(height / 20))`. */
export const TREE_TERMINAL_SCROLLBACK = 5000;

export function treeTerminalRows(height: number): number {
	return Math.max(8, Math.floor(height / 20));
}

/**
 * The original streams every line into an xterm with a 5000-line scrollback, so only the last
 * `scrollback + rows` lines stay reachable and a trailing empty line is not written.
 */
export function capTreeTerminalLines(colorized: string, height: number): string {
	if (!colorized) {
		return '';
	}
	const lines = colorized.split('\n');
	if (lines[lines.length - 1] === '') {
		lines.pop();
	}
	const max = TREE_TERMINAL_SCROLLBACK + treeTerminalRows(height);
	return (lines.length > max ? lines.slice(lines.length - max) : lines).join('\n');
}

function ansiForTheme(isLight: boolean): typeof DARK_ANSI {
	return isLight ? LIGHT_ANSI : DARK_ANSI;
}

export function colorizeSummary(summary: string, isLight: boolean): string {
	if (!summary) {
		return '';
	}
	const ANSI = ansiForTheme(isLight);
	let result = summary;
	// allow-any-unicode-next-line
	result = result.replace(/^(.*══+.*)$/gm, `${ANSI.cyan}$1${ANSI.reset}`);
	// allow-any-unicode-next-line
	result = result.replace(/^(📁|📊|📂|💾|📏|🔢|📈|📋|📦|🕐|🔍|⚠️)(.*)$/gm, `${ANSI.yellow}$1${ANSI.reset}${ANSI.white}$2${ANSI.reset}`);
	result = result.replace(/(Path: )(.+)$/gm, `$1${ANSI.blue}$2${ANSI.reset}`);
	result = result.replace(/(\d+)(?= files| folders| directories| B| KB| MB| GB|%|\))/g, `${ANSI.green}$1${ANSI.reset}`);
	result = result.replace(/(\.\w+):/g, `${ANSI.cyan}$1${ANSI.reset}:`);
	// allow-any-unicode-next-line
	result = result.replace(/(█+)/g, `${ANSI.green}$1${ANSI.reset}`);
	result = result.replace(/(\(\d+\.\d+%\))/g, `${ANSI.dim}$1${ANSI.reset}`);
	return result;
}

export function colorizeTreeStructure(content: string, isLight: boolean): string {
	if (!content) {
		return '';
	}
	const ANSI = ansiForTheme(isLight);
	// allow-any-unicode-next-line
	if (content.includes('├──') || content.includes('└──')) {
		return content.split('\n').map(line => {
			// allow-any-unicode-next-line
			let colored = line.replace(/(│|├|└|──|─)/g, `${ANSI.gray}$1${ANSI.reset}`);
			colored = colored.replace(/(\S+)\/$/, `${ANSI.blue}${ANSI.bold}$1/${ANSI.reset}`);
			colored = colored.replace(/(\S+\.tsx?)(?=\s|$|\()/g, `${ANSI.cyan}$1${ANSI.reset}`);
			colored = colored.replace(/(\S+\.jsx?)(?=\s|$|\()/g, `${ANSI.yellow}$1${ANSI.reset}`);
			colored = colored.replace(/(\S+\.py)(?=\s|$|\()/g, `${ANSI.green}$1${ANSI.reset}`);
			colored = colored.replace(/(\S+\.rs)(?=\s|$|\()/g, `${ANSI.red}$1${ANSI.reset}`);
			colored = colored.replace(/(\S+\.json)(?=\s|$|\()/g, `${ANSI.green}$1${ANSI.reset}`);
			colored = colored.replace(/(\S+\.md)(?=\s|$|\()/g, `${ANSI.white}$1${ANSI.reset}`);
			colored = colored.replace(/(\S+\.css|\.scss|\.sass)(?=\s|$|\()/g, `${ANSI.magenta}$1${ANSI.reset}`);
			colored = colored.replace(/(\S+\.html?)(?=\s|$|\()/g, `${ANSI.red}$1${ANSI.reset}`);
			colored = colored.replace(/(\([^)]+\))$/g, `${ANSI.dim}$1${ANSI.reset}`);
			colored = colored.replace(/\[M\]/g, `${ANSI.yellow}[M]${ANSI.reset}`);
			colored = colored.replace(/\[A\]/g, `${ANSI.green}[A]${ANSI.reset}`);
			colored = colored.replace(/\[D\]/g, `${ANSI.red}[D]${ANSI.reset}`);
			colored = colored.replace(/\[\?\]/g, `${ANSI.gray}[?]${ANSI.reset}`);
			return colored;
		}).join('\n');
	}
	return repoMapToTreeColorized(content).colorized;
}

export function repoMapToTreeColorized(repoMapContent: string): { plain: string; colorized: string } {
	if (!repoMapContent || !repoMapContent.trim()) {
		return { plain: '', colorized: '' };
	}
	const lines = repoMapContent.split('\n').filter(line => {
		const trimmed = line.trim();
		return trimmed &&
			!trimmed.startsWith('Below is a repository map') &&
			!trimmed.startsWith('For each file') &&
			!trimmed.startsWith('this map contains');
	});
	if (!lines.length) {
		return { plain: '', colorized: '' };
	}
	// allow-any-unicode-next-line
	if (lines.some(line => line.includes('├──') || line.includes('└──'))) {
		return { plain: lines.join('\n'), colorized: colorizeTreeStructure(lines.join('\n'), false) };
	}
	interface TreeNode { name: string; children: Map<string, TreeNode>; isFile: boolean }
	const root: TreeNode = { name: '', children: new Map(), isFile: false };
	for (const line of lines) {
		const parts = line.trim().split('/').filter(Boolean);
		let current = root;
		for (let i = 0; i < parts.length; i++) {
			const part = parts[i];
			const isFile = i === parts.length - 1;
			if (!current.children.has(part)) {
				current.children.set(part, { name: part, children: new Map(), isFile });
			}
			current = current.children.get(part)!;
		}
	}
	const COLORS = {
		reset: '\x1b[0m',
		directory: '\x1b[38;2;97;175;239m',
		connector: '\x1b[38;2;92;99;112m',
	};
	function treeToString(node: TreeNode, prefix = '', isLast = true, isRoot = false): { plain: string[]; colorized: string[] } {
		const plainResult: string[] = [];
		const colorizedResult: string[] = [];
		if (node.name && !isRoot) {
			// allow-any-unicode-next-line
			const connector = isLast ? '└── ' : '├── ';
			const coloredConnector = `${COLORS.connector}${connector}${COLORS.reset}`;
			if (node.isFile) {
				const fileColor = repoMapFileAnsiColor(node.name);
				plainResult.push(prefix + connector + node.name);
				// allow-any-unicode-next-line
				colorizedResult.push(prefix.replace(/[│├└─]/g, m => `${COLORS.connector}${m}${COLORS.reset}`) + coloredConnector + `${fileColor}${node.name}${COLORS.reset}`);
			} else {
				plainResult.push(prefix + connector + node.name + '/');
				// allow-any-unicode-next-line
				colorizedResult.push(prefix.replace(/[│├└─]/g, m => `${COLORS.connector}${m}${COLORS.reset}`) + coloredConnector + `${COLORS.directory}${node.name}/${COLORS.reset}`);
			}
		}
		const children = Array.from(node.children.values()).sort((a, b) => {
			if (a.isFile !== b.isFile) {
				return a.isFile ? 1 : -1;
			}
			return a.name.localeCompare(b.name);
		});
		for (let i = 0; i < children.length; i++) {
			const child = children[i];
			// allow-any-unicode-next-line
			const newPrefix = isRoot ? prefix : prefix + (isLast ? '    ' : '│   ');
			const childResult = treeToString(child, newPrefix, i === children.length - 1, false);
			plainResult.push(...childResult.plain);
			colorizedResult.push(...childResult.colorized);
		}
		return { plain: plainResult, colorized: colorizedResult };
	}
	const result = treeToString(root, '', true, true);
	return { plain: result.plain.join('\n'), colorized: result.colorized.join('\n') };
}

/** One Dark Pro file colors from `repoMapToTree`. */
export function repoMapFileAnsiColor(filename: string): string {
	const ext = filename.split('.').pop()?.toLowerCase();
	const name = filename.toLowerCase();
	if (name.includes('config') || name.includes('rc') || name === 'package.json' ||
		name === 'tsconfig.json' || name === '.gitignore' || name === '.env') {
		return '\x1b[38;2;92;99;112m';
	}
	switch (ext) {
		case 'ts':
		case 'tsx':
			return '\x1b[38;2;86;182;194m';
		case 'js':
		case 'jsx':
		case 'mjs':
		case 'cjs':
			return '\x1b[38;2;229;192;123m';
		case 'json':
			return '\x1b[38;2;152;195;121m';
		case 'md':
		case 'mdx':
			return '\x1b[38;2;171;178;191m';
		case 'css':
		case 'scss':
		case 'sass':
		case 'less':
			return '\x1b[38;2;198;120;221m';
		case 'html':
		case 'htm':
			return '\x1b[38;2;224;108;117m';
		case 'rs':
		case 'toml':
			return '\x1b[38;2;224;108;117m';
		case 'py':
		case 'pyi':
			return '\x1b[38;2;152;195;121m';
		default:
			return '\x1b[38;2;171;178;191m';
	}
}

export function subdirectoryOutputParts(items: IKnoxGuiToolOutputItem[]): { summary: string; structure: string; notice: string; raw: string } {
	const summary = items.find(item => item.name?.includes('Summary') || item.description?.includes('Analysis'))?.content || '';
	const structure = items.find(item => item.name?.includes('Structure') || item.description?.includes('Structure'))?.content || '';
	const notice = items.find(item => item.name?.includes('Notice'))?.content || '';
	// allow-any-unicode-next-line
	const hasEnhanced = summary.includes('Directory Analysis Summary') || structure.includes('├──') || structure.includes('└──');
	const raw = hasEnhanced
		? structure
		: items.find(item => item.description?.includes('directory') || item.name?.includes('directory') || item.description?.includes('Structure'))?.content || '';
	return { summary, structure, notice, raw };
}

export function repoMapOutput(items: IKnoxGuiToolOutputItem[]): string {
	return items.find(item =>
		item.description?.includes('repo') ||
		item.name?.includes('repo') ||
		item.description?.includes('structure'))?.content || items[0]?.content || '';
}

export function treeStatsFromPlain(plain: string, summary?: string): { files: number; folders: number; total: number; size?: string } {
	if (summary) {
		const fileMatch = summary.match(/Total Files:\s*(\d+)/);
		const dirMatch = summary.match(/Total Directories:\s*(\d+)/);
		const sizeMatch = summary.match(/Total Size:\s*([\d.]+\s*[BKMG]B?)/);
		if (fileMatch || dirMatch) {
			const files = fileMatch ? parseInt(fileMatch[1], 10) : 0;
			const folders = dirMatch ? parseInt(dirMatch[1], 10) : 0;
			return { files, folders, total: files + folders, size: sizeMatch ? sizeMatch[1] : undefined };
		}
	}
	const lines = plain.split('\n').filter(line => line.trim());
	const folders = lines.filter(line =>
		line.endsWith('/') ||
		(!line.includes('.') && !line.includes('└') && !line.includes('├'))).length;
	const files = Math.max(0, lines.length - folders);
	return { files, folders, total: lines.length };
}

export function subdirectoryFilterBadges(args: Record<string, unknown>): string[] {
	const badges: string[] = [];
	const fileTypes = Array.isArray(args.fileTypes) ? args.fileTypes.map(String) : [];
	if (fileTypes.length) {
		badges.push(fileTypes.join(', '));
	}
	if (typeof args.pattern === 'string' && args.pattern) {
		badges.push(args.pattern);
	}
	if (typeof args.depth === 'number' && args.depth !== -1) {
		badges.push(`depth: ${args.depth}`);
	}
	if (args.includeStats) {
		badges.push('stats');
	}
	if (args.includeGitStatus) {
		badges.push('git');
	}
	return badges;
}
