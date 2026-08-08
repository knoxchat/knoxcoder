/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';
import { EditorContributionInstantiation, registerEditorContribution } from '../../../../../editor/browser/editorExtensions.js';
import { IEditorContribution } from '../../../../../editor/common/editorCommon.js';

/**
 * Neutralized stub — editor dictation depended on deleted chat speech-to-text services.
 */
export class EditorDictation extends Disposable implements IEditorContribution {
	static readonly ID = 'editorDictation';

	constructor(_editor: ICodeEditor) {
		super();
	}
}

registerEditorContribution(EditorDictation.ID, EditorDictation, EditorContributionInstantiation.Lazy);
