/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Restore preview and checkpoint diff shapes shared by parsers and the overlay. */

export type KnoxRestorePreviewAction = 'overwrite' | 'create' | 'delete';
export type KnoxCheckpointDiffStatus = 'added' | 'deleted' | 'modified' | 'unchanged';
export type KnoxCheckpointDiffView = 'split' | 'unified';

export interface IKnoxGuiRestorePreviewFile {
	relativePath: string;
	action: KnoxRestorePreviewAction;
	additions: number;
	deletions: number;
	hunkCount: number;
}

export interface IKnoxGuiRestorePreview {
	checkpointId: string;
	description: string;
	modified: number;
	added: number;
	deleted: number;
	files: IKnoxGuiRestorePreviewFile[];
	writePaths: string[];
	extraPaths: string[];
	skippedFiles: Array<{ path: string; reason: string }>;
}

export interface IKnoxGuiCheckpointFileSnapshot {
	relativePath: string;
	content: string;
	encoding: string;
	size: number;
}

export interface IKnoxGuiCheckpointDiffFile {
	relativePath: string;
	status: KnoxCheckpointDiffStatus;
	oldContent: string | null;
	newContent: string | null;
	oldEncoding?: string;
	newEncoding?: string;
	isBinary: boolean;
	additions: number;
	deletions: number;
}

export interface IKnoxGuiCheckpointDiff {
	oldCheckpoint: { id: string; description: string; created: string };
	newCheckpoint: { id: string; description: string; created: string };
	files: IKnoxGuiCheckpointDiffFile[];
}

export interface IKnoxGuiCheckpointFileTreeNode {
	name: string;
	path: string;
	isDirectory: boolean;
	children?: IKnoxGuiCheckpointFileTreeNode[];
}

export interface IKnoxGuiDiffLine {
	type: 'context' | 'added' | 'removed';
	oldLineNum: number | null;
	newLineNum: number | null;
	content: string;
}

export interface IKnoxGuiDiffHunk {
	oldStart: number;
	newStart: number;
	lines: IKnoxGuiDiffLine[];
}
