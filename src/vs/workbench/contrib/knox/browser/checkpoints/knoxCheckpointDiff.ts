/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IKnoxCheckpointDiff, IKnoxCheckpointDiffFile, knoxLanguageFromPath } from '../../common/knoxCheckpoints.js';

export async function knoxOpenCheckpointFileDiff(
	editorService: IEditorService,
	file: IKnoxCheckpointDiffFile,
	leftLabel: string,
	rightLabel: string,
): Promise<void> {
	const languageId = knoxLanguageFromPath(file.relativePath);
	await editorService.openEditor({
		original: {
			resource: undefined,
			contents: file.oldContent ?? '',
			languageId,
		},
		modified: {
			resource: undefined,
			contents: file.newContent ?? '',
			languageId,
		},
		label: `${file.relativePath} (${leftLabel} ↔ ${rightLabel})`,
		options: { pinned: true },
	});
}

export async function knoxOpenCheckpointDiff(
	editorService: IEditorService,
	diff: IKnoxCheckpointDiff,
): Promise<void> {
	const left = diff.oldCheckpoint?.description || diff.oldCheckpoint?.id || '';
	const right = diff.newCheckpoint.description || diff.newCheckpoint.id;
	for (const file of diff.files) {
		await knoxOpenCheckpointFileDiff(editorService, file, left, right);
	}
}
