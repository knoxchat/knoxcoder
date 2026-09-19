/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { knoxExtensionRoot } from './paths';

/**
 * T1.3: `knoxchat.focusKnoxInput` must forward to the *non*-new-session native
 * command. The live GUI listener (`useWebviewListeners.ts`) saves the current
 * session and focuses the input — it never opens a new chat. Regression guard
 * for the P0 gap recorded in `knox-native-impl.md` §3.
 */
suite('focusKnoxInput command mapping (T1.3)', () => {
	const source = fs.readFileSync(
		path.join(knoxExtensionRoot(), 'src/commands.ts'),
		'utf8',
	);

	/** Grab the handler body of a `"<command>": async () => { ... }` entry. */
	function handlerBody(command: string): string {
		const start = source.indexOf(`"${command}": async`);
		assert.ok(start >= 0, `${command} must be registered in commands.ts`);
		const open = source.indexOf('{', source.indexOf('=>', start));
		let depth = 0;
		for (let i = open; i < source.length; i++) {
			if (source[i] === '{') {
				depth += 1;
			} else if (source[i] === '}') {
				depth -= 1;
				if (depth === 0) {
					return source.slice(open, i + 1);
				}
			}
		}
		throw new Error(`unbalanced braces for ${command}`);
	}

	test('knoxchat.focusKnoxInput does not start a new session', () => {
		const body = handlerBody('knoxchat.focusKnoxInput');
		assert.ok(
			body.includes('knox.native.focusInput"'),
			'focusKnoxInput must execute knox.native.focusInput',
		);
		assert.ok(
			!body.includes('focusInputWithNewSession'),
			'focusKnoxInput must not execute knox.native.focusInputWithNewSession',
		);
	});

	test('a separate command still exposes the new-session focus', () => {
		const body = handlerBody('knoxchat.focusKnoxInputWithNewSession');
		assert.ok(body.includes('knox.native.focusInputWithNewSession'));
	});

	test('knoxchat.focusKnoxInputWithoutClear keeps forwarding without clear', () => {
		const body = handlerBody('knoxchat.focusKnoxInputWithoutClear');
		assert.ok(body.includes('knox.native.focusInputWithoutClear'));
	});
});