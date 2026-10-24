/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Code-preview language tags, markdown fences, and read-file collapse. */

export function collapseFileToolCodePreview(toolName?: string): boolean {
	if (!toolName) {
		return false;
	}
	const n = toolName.replace(/^builtin_/, '').toLowerCase().replace(/-/g, '_');
	return n === 'read_file' || n === 'readfile' || n === 'read_currently_open_file' || n === 'readcurrentlyopenfile';
}

export function calculateFence(contents: string): string {
	const backtickMatches = contents.match(/`{3,}/g);
	if (backtickMatches) {
		const maxLength = Math.max(...backtickMatches.map(m => m.length));
		return '`'.repeat(maxLength + 1);
	}
	return '```';
}

export function getMarkdownLanguageTagForFile(filepath: string): string {
	const extToLangMap: Record<string, string> = {
		py: 'python', js: 'javascript', jsx: 'jsx', tsx: 'tsx', ts: 'typescript',
		java: 'java', class: 'java', go: 'go', rb: 'ruby', rs: 'rust', c: 'c',
		cpp: 'cpp', cs: 'csharp', php: 'php', scala: 'scala', swift: 'swift',
		kt: 'kotlin', md: 'markdown', json: 'json', html: 'html', css: 'css',
		sh: 'shell', yaml: 'yaml', toml: 'toml', tex: 'latex', sql: 'sql', ps1: 'powershell',
	};
	const raw = filepath.split('.').pop();
	const match = raw?.match(/^(\S+)\s*(?:\(.*\))?$/);
	const ext = match?.[1]?.toLowerCase();
	return ext ? (extToLangMap[ext] ?? ext) : '';
}

export function displayLanguageForFile(filepath: string, contentKey?: string): string {
	if (contentKey === 'patch' || contentKey === 'diff') {
		return 'diff';
	}
	if (!filepath) {
		return '';
	}
	const lang = getMarkdownLanguageTagForFile(filepath);
	if (lang === 'markdown') {
		return 'text';
	}
	return lang;
}
