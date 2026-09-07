/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

/**
 * Node mocha cannot load the real `vscode` module. Stub it so unit tests can
 * import host files that mention vscode at the top level (e.g. commandIds).
 */
const Module = require('module');
const originalLoad = Module._load;

class EventEmitter {
	event() {
		return { dispose() { } };
	}
	fire() { }
	dispose() { }
}

Module._load = function (request, parent, isMain) {
	if (request === 'vscode') {
		return {
			commands: {
				registerCommand: () => ({ dispose() { } }),
				executeCommand: async () => undefined,
			},
			window: {},
			workspace: {
				getConfiguration: () => ({ get: () => undefined }),
			},
			Uri: {
				file: (p) => ({ fsPath: p, scheme: 'file' }),
				joinPath: () => ({}),
			},
			EventEmitter,
		};
	}
	return originalLoad.call(this, request, parent, isMain);
};
