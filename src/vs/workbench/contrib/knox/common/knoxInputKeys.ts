/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode } from '../../../../base/common/keyCodes.js';

export interface IKnoxInputKeyEvent {
	keyCode: KeyCode;
	shiftKey: boolean;
	altKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
}

export interface IKnoxInputKeyContext {
	atStart: boolean;
	atEnd: boolean;
	streaming: boolean;
	useActiveFile: boolean;
	suggestVisible: boolean;
}

export type KnoxInputKeyAction =
	| { kind: 'submit'; noContext: boolean }
	| { kind: 'newline' }
	| { kind: 'cancelStream'; consume: boolean }
	| { kind: 'historyPrev' }
	| { kind: 'historyNext' }
	| { kind: 'escape' }
	| { kind: 'ignore'; consume: boolean }
	| { kind: 'none' };

export function knoxUseActiveFile(experimental: { defaultContext?: unknown } | undefined): boolean {
	const context = experimental?.defaultContext;
	return Array.isArray(context) && context.includes('activeFile');
}

/** Enter includes the current file when `useActiveFile`; Alt-Enter toggles that. */
export function knoxSubmitNoContext(useActiveFile: boolean, altKey: boolean): boolean {
	return useActiveFile ? altKey : !altKey;
}

export function knoxInputKeyAction(
	event: IKnoxInputKeyEvent,
	context: IKnoxInputKeyContext,
): KnoxInputKeyAction {
	const mod = event.ctrlKey || event.metaKey;

	if (event.keyCode === KeyCode.Backspace && mod) {
		return { kind: 'cancelStream', consume: context.streaming };
	}

	if (event.keyCode === KeyCode.Escape) {
		if (context.suggestVisible) {
			return { kind: 'none' };
		}
		return { kind: 'escape' };
	}

	if (event.keyCode === KeyCode.Enter) {
		if (context.suggestVisible && !event.altKey) {
			return { kind: 'none' };
		}
		if (event.shiftKey && !event.altKey && !mod) {
			return { kind: 'newline' };
		}
		if (context.streaming) {
			return { kind: 'ignore', consume: true };
		}
		return { kind: 'submit', noContext: knoxSubmitNoContext(context.useActiveFile, event.altKey) };
	}

	if (event.keyCode === KeyCode.UpArrow && !event.shiftKey && !event.altKey && !mod) {
		if (context.suggestVisible) {
			return { kind: 'none' };
		}
		return context.atStart ? { kind: 'historyPrev' } : { kind: 'none' };
	}

	if (event.keyCode === KeyCode.DownArrow && !event.shiftKey && !event.altKey && !mod) {
		if (context.suggestVisible) {
			return { kind: 'none' };
		}
		return context.atEnd ? { kind: 'historyNext' } : { kind: 'none' };
	}

	return { kind: 'none' };
}
