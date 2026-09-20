/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../../base/browser/dom.js';
import { IKnoxContextItem, IKnoxToolCallState } from '../../common/knoxChatTypes.js';
import { capDisplayText } from '../../common/knoxDisplayCap.js';
import { knoxTaskSubagentInfo } from '../../common/knoxTaskCard.js';

export function renderKnoxTaskCard(
	parent: HTMLElement,
	state: IKnoxToolCallState,
	output: readonly IKnoxContextItem[],
): void {
	const info = knoxTaskSubagentInfo(state.parsedArgs, output);
	const root = append(parent, $('.knox-task-card'));
	append(root, $('div.knox-task-meta')).textContent = info.label;
	if (info.output) {
		append(root, $('pre.knox-task-output')).textContent = capDisplayText(info.output).text;
	}
}
