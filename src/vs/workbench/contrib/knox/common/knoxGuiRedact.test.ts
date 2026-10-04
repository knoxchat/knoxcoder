/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { formatSessionExportMarkdown } from './knoxGuiOverlays.js';
import { knoxGuiRedactSecrets } from './knoxGuiRedact.js';

suite('Knox GUI secret redaction (P0-4)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const j = (...p: string[]) => p.join('');
	const secrets = [
		j('AKIA', 'IOSFODNN7EXAMPLE'),
		j('sk_', 'live_', '4eC39HqLyjWDarjtT1zdp7dc'),
		j('ghp_', 'A'.repeat(36)),
		'postgres://admin:s3cretpass@db.local/x',
		'Authorization: Token abcdefghijklmnop1234567890',
		'API_KEY=abcd1234efgh5678',
		'-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----',
	];

	test('redacts common credential shapes', () => {
		for (const s of secrets) {
			const out = knoxGuiRedactSecrets(`before ${s} after`);
			assert.ok(out.includes('REDACTED'), s);
			assert.ok(!/s3cretpass|abcdefghijklmnop1234567890|abcd1234efgh5678|b3BlbnNzaC1rZXktdjEAAAAA|4eC39HqLyjWDarjtT1zdp7dc|IOSFODNN7EXAMPLE/.test(out), s);
		}
	});

	test('leaves ordinary text alone and stays fast on long input', () => {
		assert.strictEqual(knoxGuiRedactSecrets('const token = getToken();'), 'const token = getToken();');
		const t0 = Date.now();
		knoxGuiRedactSecrets('API_KEY=' + 'a'.repeat(200_000));
		assert.ok(Date.now() - t0 < 3000);
	});

	test('exported session Markdown never contains raw secrets', () => {
		const md = formatSessionExportMarkdown({ title: 'T', history: [{ role: 'user', content: `use ${secrets[0]} and ${secrets[3]}` }] });
		assert.ok(!md.includes('IOSFODNN7EXAMPLE'));
		assert.ok(!md.includes('s3cretpass'));
	});
});
