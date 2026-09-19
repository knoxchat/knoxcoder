/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Native port of `knox/core/context/soul/extractToolFiles.ts#formatRestoreNotice`
 * and the `injectedContextCache` restore-notice cache used by
 * `knox/gui/src/hooks/useSetup.ts` + `redux/thunks/streamResponse.ts`.
 *
 * The workbench must not import `extensions/knox` `core`, so this mirrors the
 * exact copy the model sees after a checkpoint restore.
 */

export interface IKnoxRestoreNoticePayload {
	checkpointId: string;
	description?: string;
	restoredFiles: string[];
	sessionId?: string;
	memoryRewound?: boolean;
	memoryMessage?: string;
}

const MAX_RESTORED_FILES = 20;

/** Exact copy of Core `formatRestoreNotice`. */
export function knoxFormatRestoreNotice(input: {
	checkpointId: string;
	description?: string;
	restoredFiles: string[];
	memoryRewound?: boolean;
	memoryMessage?: string;
}): string {
	const files = input.restoredFiles.length > 0
		? input.restoredFiles.slice(0, MAX_RESTORED_FILES).join(', ')
		: '(see checkpoint details)';
	const extra = input.restoredFiles.length > MAX_RESTORED_FILES
		? ` (+${input.restoredFiles.length - MAX_RESTORED_FILES} more)`
		: '';
	const memoryLine = input.memoryRewound
		? [
			'Working memory was rewound to this checkpoint.',
			input.memoryMessage || '',
		].filter(Boolean).join(' ')
		: [
			'Memory was not rewound.',
			`Use builtin_workspace_checkpoint action=restore checkpoint_id=${input.checkpointId} rewind_memory=true if you also want working memory to match this disk state.`,
		].join(' ');
	return [
		'## Workspace restore',
		`The workspace was restored to checkpoint ${input.checkpointId}${input.description ? ` (${input.description})` : ''}.`,
		`Restored files: ${files}${extra}`,
		memoryLine,
		'Do not assume later edits still exist. Re-read files before editing.',
	].join('\n');
}

/**
 * One pending restore notice per session, scoped like GUI
 * `injectedContextCache.setRestoreNotice` / `getRestoreNotice` / `clearRestoreNotice`.
 */
export class KnoxRestoreNoticeCache {
	private _notice: { sessionId: string; content: string } | null = null;

	set(sessionId: string, content: string): void {
		this._notice = { sessionId, content };
	}

	get(sessionId: string): string | null {
		return this._notice && this._notice.sessionId === sessionId
			? this._notice.content
			: null;
	}

	clear(): void {
		this._notice = null;
	}

	get pending(): boolean {
		return this._notice != null;
	}
}