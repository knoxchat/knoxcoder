import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { writeFileAtomic, writeFileAtomicSync, writeBufferAtomic } from './atomicWrite';

suite('atomicWrite', () => {
    test('replaces the target with complete contents and leaves no temp files', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-atomic-'));
        const filePath = path.join(dir, 'cp_example.json');
        await fs.writeFile(filePath, '{"old":true}', 'utf8');

        await writeFileAtomic(filePath, '{\n  "id": "cp_new",\n  "ok": true\n}');

        const contents = await fs.readFile(filePath, 'utf8');
        assert.deepStrictEqual(JSON.parse(contents), { id: 'cp_new', ok: true });
        const leftovers = (await fs.readdir(dir)).filter((name) => name.includes('.tmp'));
        assert.deepStrictEqual(leftovers, []);

        await fs.rm(dir, { recursive: true, force: true });
    });

    test('sync replace leaves a parseable history file', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-atomic-sync-'));
        const filePath = path.join(dir, 'checkpoint-history.json');
        writeFileAtomicSync(filePath, '{"checkpointHistory":[]}');
        writeFileAtomicSync(filePath, '{"checkpointHistory":[{"id":"cp_1"}]}');

        const stored = JSON.parse(await fs.readFile(filePath, 'utf8'));
        assert.strictEqual(stored.checkpointHistory[0].id, 'cp_1');
        await fs.rm(dir, { recursive: true, force: true });
    });

    test('buffer replace writes binary contents atomically', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-atomic-buf-'));
        const filePath = path.join(dir, 'blob');
        await writeBufferAtomic(filePath, Buffer.from([0, 1, 2, 255]));
        const stored = await fs.readFile(filePath);
        assert.deepStrictEqual(stored, Buffer.from([0, 1, 2, 255]));
        await fs.rm(dir, { recursive: true, force: true });
    });
});
