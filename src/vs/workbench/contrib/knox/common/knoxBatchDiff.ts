/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IKnoxBatchDiffFile {
	filepath: string;
	numDiffs: number;
	selected: boolean;
}

export function knoxParseBatchDiffFiles(value: unknown): IKnoxBatchDiffFile[] {
	const record = value && typeof value === 'object' ? value as { files?: unknown } : undefined;
	const files = Array.isArray(record?.files) ? record.files : (Array.isArray(value) ? value : []);
	return files
		.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
		.map(item => ({
			filepath: String(item.filepath ?? item.fileUri ?? ''),
			numDiffs: typeof item.numDiffs === 'number' && Number.isFinite(item.numDiffs) ? item.numDiffs : 0,
			selected: item.selected !== false,
		}))
		.filter(item => item.filepath.length > 0);
}

export function knoxToggleBatchDiffFile(files: readonly IKnoxBatchDiffFile[], filepath: string): IKnoxBatchDiffFile[] {
	return files.map(file => file.filepath === filepath ? { ...file, selected: !file.selected } : file);
}

export function knoxSelectAllBatchDiffFiles(files: readonly IKnoxBatchDiffFile[], selected: boolean): IKnoxBatchDiffFile[] {
	return files.map(file => ({ ...file, selected }));
}

export function knoxSelectedBatchDiffUris(files: readonly IKnoxBatchDiffFile[]): string[] {
	return files.filter(file => file.selected).map(file => file.filepath);
}

export function knoxBatchDiffTotals(files: readonly IKnoxBatchDiffFile[]): { files: number; diffs: number; selected: number } {
	return {
		files: files.length,
		diffs: files.reduce((sum, file) => sum + file.numDiffs, 0),
		selected: files.filter(file => file.selected).length,
	};
}

export function knoxBatchDiffFileName(filepath: string): { name: string; dir: string } {
	const slash = Math.max(filepath.lastIndexOf('/'), filepath.lastIndexOf('\\'));
	if (slash < 0) {
		return { name: filepath, dir: '' };
	}
	return { name: filepath.slice(slash + 1), dir: filepath.slice(0, slash) };
}
