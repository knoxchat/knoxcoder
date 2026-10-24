/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { arr, rec } from './parse.js';
import { buildCheckpointDiffFiles } from './diff.js';
import type { IKnoxGuiCheckpointDiff, IKnoxGuiCheckpointFileSnapshot } from './types.js';

/** Checkpoint details modal: snapshots, compare targets, and tree sizing. */

export interface IKnoxGuiCheckpointDetailsSnapshot extends IKnoxGuiCheckpointFileSnapshot {
	lastModified: string;
}

export interface IKnoxGuiCheckpointDetails {
	id: string;
	description: string;
	created: string;
	workspacePath?: string;
	messageId?: string;
	conversationContext?: { role: string; messageContent: string; index: number; timestamp: string };
	fileSnapshots: IKnoxGuiCheckpointDetailsSnapshot[];
}

export type KnoxCheckpointDetailsTab = 'basic' | 'files' | 'diff';

/** View state of the checkpoint details modal (`CheckpointTableRow.tsx`). */
export interface IKnoxGuiCheckpointDetailsView {
	id: string;
	loading: boolean;
	details?: IKnoxGuiCheckpointDetails;
	tab: KnoxCheckpointDetailsTab;
	selectedFile?: string;
	expandedDirs: Set<string>;
	/** `previous`, `workspace`, or a checkpoint id. */
	compareTarget: string;
	diff?: IKnoxGuiCheckpointDiff;
	diffLoading: boolean;
	diffSeq: number;
	restoringFile?: string;
	wrap: boolean;
	copied: boolean;
}

/** `getCheckpointDetails` / `getPreviousCheckpoint` both answer `{ success, details }`. */
export function parseCheckpointDetails(value: unknown): IKnoxGuiCheckpointDetails | undefined {
	const root = rec(value);
	if (root && root.success === false) {
		return undefined;
	}
	const details = rec(root?.details) ?? (typeof root?.id === 'string' ? root : undefined);
	if (!details || typeof details.id !== 'string') {
		return undefined;
	}
	const context = rec(details.conversationContext);
	return {
		id: details.id,
		description: String(details.description ?? ''),
		created: String(details.created ?? ''),
		workspacePath: typeof details.workspacePath === 'string' ? details.workspacePath : undefined,
		messageId: typeof details.messageId === 'string' ? details.messageId : undefined,
		conversationContext: context ? {
			role: String(context.role ?? ''),
			messageContent: String(context.messageContent ?? ''),
			index: Number(context.index ?? 0),
			timestamp: String(context.timestamp ?? ''),
		} : undefined,
		fileSnapshots: arr(details.fileSnapshots).map(item => {
			const file = rec(item) ?? {};
			const content = String(file.content ?? '');
			const encoding = String(file.encoding ?? 'utf8');
			return {
				relativePath: String(file.relativePath ?? ''),
				content,
				encoding,
				size: Number(file.size ?? content.length),
				lastModified: String(file.lastModified ?? details.created ?? ''),
			};
		}).filter(file => file.relativePath),
	};
}

export function checkpointDetailsDefaultTab(details: IKnoxGuiCheckpointDetails): KnoxCheckpointDetailsTab {
	return details.fileSnapshots.length ? 'files' : 'basic';
}

/**
 * `CheckpointTableRow.tsx` `loadPreviousCheckpointFallback`: when the host
 * cannot reconstruct a diff, compare the raw snapshots of the previous
 * checkpoint against this one.
 */
export function diffFromCheckpointSnapshots(oldDetails: IKnoxGuiCheckpointDetails, newDetails: IKnoxGuiCheckpointDetails): IKnoxGuiCheckpointDiff {
	const oldByPath = new Map(oldDetails.fileSnapshots.map(file => [file.relativePath, file]));
	const newByPath = new Map(newDetails.fileSnapshots.map(file => [file.relativePath, file]));
	const paths = [...new Set([...oldByPath.keys(), ...newByPath.keys()])].sort();
	return {
		oldCheckpoint: { id: oldDetails.id, description: oldDetails.description, created: oldDetails.created },
		newCheckpoint: { id: newDetails.id, description: newDetails.description, created: newDetails.created },
		files: buildCheckpointDiffFiles(paths.map(relativePath => {
			const before = oldByPath.get(relativePath);
			const after = newByPath.get(relativePath);
			return {
				relativePath,
				oldContent: before ? before.content : null,
				newContent: after ? after.content : null,
				oldEncoding: before?.encoding,
				newEncoding: after?.encoding,
			};
		})),
	};
}

/** `checkpointListQuery.ts`: every other checkpoint, newest first. */
export function compareCheckpointTargets<T extends { id: string; created: string }>(catalog: readonly T[], currentId: string): T[] {
	return catalog
		.filter(checkpoint => checkpoint.id !== currentId)
		.sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());
}

/** `FileTreeView.tsx`: expand the folders leading to the first file. */
export function checkpointTreeAncestors(relativePath: string): string[] {
	const parts = relativePath.split('/').filter(Boolean).slice(0, -1);
	return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
}

/** `FileTreeView.tsx` / `CodeViewer.tsx` `formatFileSize`. */
export function formatSnapshotSize(bytes: number): string {
	if (!bytes) {
		return '0 B';
	}
	const sizes = ['B', 'KB', 'MB', 'GB'];
	const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
	return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(1))} ${sizes[i]}`;
}

const CHECKPOINT_IMAGE_MIME: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	ico: 'image/x-icon',
	bmp: 'image/bmp',
	avif: 'image/avif',
};

export function checkpointImageMime(relativePath: string, encoding: string | undefined): string | undefined {
	if (encoding !== 'base64') {
		return undefined;
	}
	return CHECKPOINT_IMAGE_MIME[relativePath.split('.').pop()?.toLowerCase() ?? ''];
}

export const CHECKPOINT_TREE_WIDTH = { default: 320, min: 200, max: 500 } as const;

/** `ResizableSplitter.tsx`: bounds tighten to 15%-60% of the container. */
export function clampCheckpointTreeWidth(width: number, containerWidth: number): number {
	const min = Math.max(CHECKPOINT_TREE_WIDTH.min, containerWidth * 0.15);
	const max = Math.min(CHECKPOINT_TREE_WIDTH.max, containerWidth * 0.6);
	return Math.round(Math.max(min, Math.min(max, width)));
}
