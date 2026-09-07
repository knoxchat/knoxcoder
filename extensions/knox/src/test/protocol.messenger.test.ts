/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import * as assert from 'node:assert';

import { InProcessMessenger } from '../../core/protocol/messenger';

type PingProtocol = {
	ping: [string, string];
	echo: [{ n: number }, { n: number }];
};

suite('InProcessMessenger', () => {
	test('on + invoke round-trips Core handlers', () => {
		const messenger = new InProcessMessenger<PingProtocol, PingProtocol>();
		messenger.on('ping', (message) => `pong:${message.data}`);
		assert.strictEqual(messenger.invoke('ping', 'hi'), 'pong:hi');
	});

	test('externalOn + request round-trips IDE handlers', async () => {
		const messenger = new InProcessMessenger<PingProtocol, PingProtocol>();
		messenger.externalOn('echo', (message) => ({ n: message.data.n + 1 }));
		const result = await messenger.request('echo', { n: 41 });
		assert.deepStrictEqual(result, { n: 42 });
	});

	test('request throws when no handler is registered', async () => {
		const messenger = new InProcessMessenger<PingProtocol, PingProtocol>();
		await assert.rejects(
			() => messenger.request('ping', 'x'),
			/No handler for message type/,
		);
	});

	test('send delivers to external listeners and returns a message id', () => {
		const messenger = new InProcessMessenger<PingProtocol, PingProtocol>();
		let seen: string | undefined;
		messenger.externalOn('ping', (message) => {
			seen = message.data;
		});
		const id = messenger.send('ping', 'hello');
		assert.ok(typeof id === 'string' && id.length > 0);
		assert.strictEqual(seen, 'hello');
	});
});
