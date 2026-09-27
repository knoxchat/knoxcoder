/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IKnoxGuiState } from '../../../common/knoxGuiState.js';
import { knoxGuiT } from '../knoxGuiI18n.js';

export function t(state: IKnoxGuiState, key: string, vars?: Record<string, string | number>): string {
	return knoxGuiT(state.language, key, vars);
}
