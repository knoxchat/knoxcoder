/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type KnoxGitFileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked';

export interface IKnoxGitDiffFile {
	filename: string;
	filepath: string;
	displayPath: string;
	uri: string;
	additions: number;
	deletions: number;
	fileType: string;
	isBinary: boolean;
	status: KnoxGitFileStatus;
}

const FILE_TYPE_MAP: Record<string, string> = {
	ts: 'TS',
	tsx: 'TSX',
	js: 'JS',
	jsx: 'JSX',
	py: 'PY',
	rs: 'RS',
	go: 'GO',
	java: 'JAVA',
	css: 'CSS',
	scss: 'SCSS',
	html: 'HTML',
	json: 'JSON',
	md: 'MD',
	yaml: 'YAML',
	yml: 'YAML',
	toml: 'TOML',
	sql: 'SQL',
	sh: 'SH',
	bash: 'SH',
	vue: 'VUE',
	svelte: 'SVEL',
	node: 'BIN',
	wasm: 'BIN',
	so: 'BIN',
	dll: 'BIN',
	exe: 'BIN',
};

const FILE_TYPE_COLORS: Record<string, string> = {
	TS: '#3178c6',
	TSX: '#3178c6',
	JS: '#f7df1e',
	JSX: '#f7df1e',
	PY: '#3776ab',
	RS: '#dea584',
	GO: '#00add8',
	MOD: '#00add8',
	SUM: '#00add8',
	ENV: '#6e6e77',
	GIT: '#6e6e77',
	FILE: '#6e6e77',
	CSS: '#264de4',
	SCSS: '#cc6699',
	HTML: '#e34c26',
	JSON: '#cbcb41',
	MD: '#083fa1',
	YAML: '#cb171e',
	SQL: '#e38c00',
	VUE: '#42b883',
	SVEL: '#ff3e00',
	BIN: '#6e6e77',
};

const CONFIG_FILE_TYPES = new Set(['JSON', 'YAML', 'TOML', 'ENV']);

export function knoxNormalizeGitPath(path: string): string {
	return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

export function knoxGitFileType(filename: string): string {
	const base = filename.split('/').pop() || filename;
	if (base === 'go.mod') {
		return 'MOD';
	}
	if (base === 'go.sum') {
		return 'SUM';
	}
	if (base.startsWith('.env')) {
		return 'ENV';
	}
	if (base === '.gitignore' || base === '.gitattributes') {
		return 'GIT';
	}
	const ext = base.includes('.') ? base.split('.').pop()?.toLowerCase() || '' : '';
	if (FILE_TYPE_MAP[ext]) {
		return FILE_TYPE_MAP[ext];
	}
	if (!ext) {
		return 'FILE';
	}
	return ext.slice(0, 4).toUpperCase();
}

export function knoxGitFileTypeColor(fileType: string): string {
	return FILE_TYPE_COLORS[fileType] || '#6e6e77';
}

export function knoxGitFileTypeIsConfig(fileType: string): boolean {
	return CONFIG_FILE_TYPES.has(fileType);
}

export function knoxParseDiffStats(diffString: string): IKnoxGitDiffFile | null {
	const headerMatch = diffString.match(/^diff --git a\/(.*?) b\/(.*)/m);
	if (!headerMatch) {
		return null;
	}
	const filepath = knoxNormalizeGitPath(headerMatch[2]);
	const filename = filepath.split('/').pop() || filepath;
	const isBinary = /Binary files/.test(diffString);
	let additions = 0;
	let deletions = 0;
	if (!isBinary) {
		const lines = diffString.split('\n');
		let inHunk = false;
		for (const line of lines) {
			if (line.startsWith('@@')) {
				inHunk = true;
				continue;
			}
			if (!inHunk) {
				continue;
			}
			if (line.startsWith('+') && !line.startsWith('+++')) {
				additions++;
			} else if (line.startsWith('-') && !line.startsWith('---')) {
				deletions++;
			}
		}
	}
	return {
		filename,
		filepath,
		displayPath: filepath,
		uri: filepath,
		additions,
		deletions,
		fileType: knoxGitFileType(filename),
		isBinary,
		status: additions > 0 && deletions === 0 ? 'added' : 'modified',
	};
}

export function knoxMergeDiffEntry(map: Map<string, IKnoxGitDiffFile>, parsed: IKnoxGitDiffFile): void {
	const existing = map.get(parsed.filepath);
	if (!existing) {
		map.set(parsed.filepath, parsed);
		return;
	}
	map.set(parsed.filepath, {
		...existing,
		additions: existing.additions + parsed.additions,
		deletions: existing.deletions + parsed.deletions,
		isBinary: existing.isBinary || parsed.isBinary,
	});
}

export function knoxBuildGitDisplayPaths(files: readonly IKnoxGitDiffFile[]): IKnoxGitDiffFile[] {
	const basenameCounts = new Map<string, number>();
	for (const file of files) {
		basenameCounts.set(file.filename, (basenameCounts.get(file.filename) ?? 0) + 1);
	}
	return files.map(file => {
		if ((basenameCounts.get(file.filename) ?? 0) <= 1) {
			return { ...file, displayPath: file.filepath };
		}
		const parts = file.filepath.split('/');
		if (parts.length >= 2) {
			return { ...file, displayPath: parts.slice(-2).join('/') };
		}
		return { ...file };
	});
}

export function knoxSortGitDiffFiles(files: readonly IKnoxGitDiffFile[]): IKnoxGitDiffFile[] {
	return [...files].sort((a, b) => {
		const aDelta = a.additions + a.deletions;
		const bDelta = b.additions + b.deletions;
		if (bDelta !== aDelta) {
			return bDelta - aDelta;
		}
		return a.filepath.localeCompare(b.filepath);
	});
}

const GIT_STATUSES = new Set<KnoxGitFileStatus>(['modified', 'added', 'deleted', 'renamed', 'untracked']);

export function knoxParseGitChangedFiles(content: unknown): IKnoxGitDiffFile[] {
	if (!Array.isArray(content)) {
		return [];
	}
	const files: IKnoxGitDiffFile[] = [];
	for (const item of content) {
		if (!item || typeof item !== 'object') {
			continue;
		}
		const record = item as Record<string, unknown>;
		if (typeof record.filepath !== 'string' || !record.filepath) {
			continue;
		}
		const filepath = knoxNormalizeGitPath(record.filepath);
		const filename = filepath.split('/').pop() || filepath;
		const fileType = knoxGitFileType(filename);
		const additions = typeof record.additions === 'number' ? record.additions : 0;
		const deletions = typeof record.deletions === 'number' ? record.deletions : 0;
		const status = GIT_STATUSES.has(record.status as KnoxGitFileStatus)
			? record.status as KnoxGitFileStatus
			: 'modified';
		files.push({
			filename,
			filepath,
			displayPath: filepath,
			uri: typeof record.uri === 'string' && record.uri ? record.uri : filepath,
			additions,
			deletions,
			fileType,
			isBinary: record.isBinary === true || (fileType === 'BIN' && additions === 0 && deletions === 0),
			status,
		});
	}
	return files;
}

export function knoxParseDiffList(content: unknown): IKnoxGitDiffFile[] {
	if (!Array.isArray(content)) {
		return [];
	}
	const map = new Map<string, IKnoxGitDiffFile>();
	for (const item of content) {
		if (typeof item !== 'string') {
			continue;
		}
		const parsed = knoxParseDiffStats(item);
		if (parsed) {
			knoxMergeDiffEntry(map, parsed);
		}
	}
	return Array.from(map.values());
}

export function knoxFinalizeGitDiffFiles(files: readonly IKnoxGitDiffFile[]): IKnoxGitDiffFile[] {
	return knoxSortGitDiffFiles(knoxBuildGitDisplayPaths(files));
}

export function knoxGitDiffTotals(files: readonly IKnoxGitDiffFile[]): { additions: number; deletions: number } {
	return files.reduce((sum, file) => {
		sum.additions += file.additions;
		sum.deletions += file.deletions;
		return sum;
	}, { additions: 0, deletions: 0 });
}
