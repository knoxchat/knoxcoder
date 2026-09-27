import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
    appendAuditEvent,
    eventsLogPath,
    listAuditTrail,
    readAuditEvents,
    rotateAuditEvents,
    type AuditEvent,
} from './auditLog';

async function withTempStore(fn: (storageRoot: string) => Promise<void>): Promise<void> {
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-audit-'));
    try {
        await fn(storageRoot);
    } finally {
        await fs.rm(storageRoot, { recursive: true, force: true });
    }
}

function event(overrides: Partial<AuditEvent> & Pick<AuditEvent, 'action' | 'timestamp'>): AuditEvent {
    return {
        userId: 'machine-1',
        outcome: 'success',
        ...overrides,
    };
}

suite('auditLog (CP-20)', () => {
    test('append writes JSONL and listAuditTrail returns newest first', async () => {
        await withTempStore(async (storageRoot) => {
            await appendAuditEvent(storageRoot, {
                timestamp: '2026-08-17T10:00:00.000Z',
                action: 'create',
                userId: 'machine-1',
                resourceId: 'cp_one',
                outcome: 'success',
                counts: { files: 2 },
            });
            await appendAuditEvent(storageRoot, {
                timestamp: '2026-08-17T11:00:00.000Z',
                action: 'restore',
                userId: 'machine-1',
                resourceId: 'cp_one',
                outcome: 'success',
                durationMs: 40,
                counts: { filesRestored: 2, filesFailed: 0 },
            });

            const raw = await fs.readFile(eventsLogPath(storageRoot), 'utf8');
            const lines = raw.trim().split('\n');
            assert.strictEqual(lines.length, 2);
            assert.ok(!raw.includes('databaseBytes'));

            const trail = await listAuditTrail(storageRoot, 10);
            assert.strictEqual(trail[0].action, 'restore');
            assert.strictEqual(trail[1].action, 'create');

            const restores = await listAuditTrail(storageRoot, 10, 'restore');
            assert.strictEqual(restores.length, 1);
            assert.strictEqual(restores[0].resourceId, 'cp_one');
        });
    });

    test('skips corrupt JSONL lines instead of failing the log', async () => {
        await withTempStore(async (storageRoot) => {
            await fs.mkdir(storageRoot, { recursive: true });
            await fs.writeFile(
                eventsLogPath(storageRoot),
                [
                    '{"timestamp":"2026-08-17T10:00:00.000Z","action":"create","userId":"m","outcome":"success"}',
                    '{not-json',
                    '{"timestamp":"2026-08-17T11:00:00.000Z","action":"pin","userId":"m","outcome":"success","resourceId":"cp_x"}',
                    '',
                ].join('\n'),
                'utf8',
            );
            const events = await readAuditEvents(storageRoot);
            assert.strictEqual(events.length, 2);
            assert.strictEqual(events[1].action, 'pin');
        });
    });

    test('rotation drops events older than 30 days and caps at maxEvents', () => {
        const now = Date.parse('2026-08-17T00:00:00.000Z');
        const events: AuditEvent[] = [
            event({ action: 'create', timestamp: '2026-06-01T00:00:00.000Z', resourceId: 'old' }),
            event({ action: 'create', timestamp: '2026-08-10T00:00:00.000Z', resourceId: 'a' }),
            event({ action: 'restore', timestamp: '2026-08-11T00:00:00.000Z', resourceId: 'b' }),
            event({ action: 'delete', timestamp: '2026-08-12T00:00:00.000Z', resourceId: 'c' }),
        ];
        const rotated = rotateAuditEvents(events, { maxEvents: 2, maxAgeMs: 30 * 24 * 60 * 60 * 1000 }, now);
        assert.deepStrictEqual(rotated.map((item) => item.resourceId), ['b', 'c']);
    });

    test('append rotates the on-disk log when over the cap', async () => {
        await withTempStore(async (storageRoot) => {
            for (let i = 0; i < 4; i++) {
                await appendAuditEvent(
                    storageRoot,
                    {
                        timestamp: `2026-08-17T0${i}:00:00.000Z`,
                        action: 'create',
                        userId: 'machine-1',
                        resourceId: `cp_${i}`,
                        outcome: 'success',
                    },
                    { maxEvents: 2, maxAgeMs: 30 * 24 * 60 * 60 * 1000 },
                );
            }
            const events = await readAuditEvents(storageRoot);
            assert.strictEqual(events.length, 2);
            assert.strictEqual(events[0].resourceId, 'cp_2');
            assert.strictEqual(events[1].resourceId, 'cp_3');
        });
    });
});
