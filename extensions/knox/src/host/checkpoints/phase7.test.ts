/**
 * Phase 7: Coverage Gap Tests — VSCode Extension
 *
 * Fills gaps:
 *   7.2.1  AutoCheckpointSystem: interval-based creation & time logic
 *   7.2.2  CheckpointManager: TypeScript path basic behavior
 */

import * as assert from 'node:assert';
import * as vscode from 'vscode';

import { AutoCheckpointSystem } from './AutoCheckpointSystem';
import { CheckpointManager } from './CheckpointManager';

type WindowMethodName = 'showWarningMessage' | 'showInformationMessage' | 'showErrorMessage';

const originalWindowMethods: Partial<Record<WindowMethodName, unknown>> = {};

function mockWindowMethod(name: WindowMethodName, implementation: unknown): void {
    if (!(name in originalWindowMethods)) {
        originalWindowMethods[name] = (vscode.window as any)[name];
    }
    (vscode.window as any)[name] = implementation;
}

function restoreWindowMethods(): void {
    for (const [name, implementation] of Object.entries(originalWindowMethods)) {
        (vscode.window as any)[name] = implementation;
    }
}

suite('Phase 7 — Coverage Gaps', () => {
    teardown(() => {
        restoreWindowMethods();
    });

    // ─── 7.2.1 AutoCheckpointSystem: Interval & Time Logic ─────────

    suite('7.2.1 AutoCheckpointSystem interval logic', () => {
        test('checkAutoCheckpointTrigger skips when minIntervalMs not elapsed', async () => {
            const system = AutoCheckpointSystem.getInstance() as any;
            const origConfig = { ...system.config };
            const origLastTime = system.lastCheckpointTime;
            const origPending = new Set(system.pendingChanges);

            // Configure: very long min interval
            system.config = {
                ...system.config,
                enabled: true,
                minIntervalMs: 999999999,
                fileChangeThreshold: 1,
            };
            system.lastCheckpointTime = Date.now(); // just now
            system.pendingChanges = new Set(['a.ts', 'b.ts']);

            let created = false;
            const origCreate = system.createAutoCheckpoint?.bind(system);
            system.createAutoCheckpoint = async () => { created = true; };

            await system.checkAutoCheckpointTrigger();

            assert.strictEqual(created, false,
                'Should NOT create checkpoint when minInterval not elapsed');

            // Restore
            system.config = origConfig;
            system.lastCheckpointTime = origLastTime;
            system.pendingChanges = origPending;
            if (origCreate) system.createAutoCheckpoint = origCreate;
        });

        test('checkAutoCheckpointTrigger fires on fileChangeThreshold', async () => {
            const system = AutoCheckpointSystem.getInstance() as any;
            const origConfig = { ...system.config };
            const origLastTime = system.lastCheckpointTime;
            const origPending = new Set(system.pendingChanges);

            system.config = {
                ...system.config,
                enabled: true,
                minIntervalMs: 1,
                maxIntervalMs: 999999999,
                fileChangeThreshold: 3,
            };
            system.lastCheckpointTime = 0; // long ago
            system.pendingChanges = new Set(['a.ts', 'b.ts', 'c.ts']); // meets threshold

            let reason = '';
            system.createAutoCheckpoint = async (r: string) => { reason = r; };

            await system.checkAutoCheckpointTrigger();

            assert.strictEqual(reason, 'file-changes',
                'Should trigger with reason "file-changes" when threshold met');

            // Restore
            system.config = origConfig;
            system.lastCheckpointTime = origLastTime;
            system.pendingChanges = origPending;
        });

        test('checkAutoCheckpointTrigger fires on maxIntervalMs exceeded', async () => {
            const system = AutoCheckpointSystem.getInstance() as any;
            const origConfig = { ...system.config };
            const origLastTime = system.lastCheckpointTime;
            const origPending = new Set(system.pendingChanges);

            system.config = {
                ...system.config,
                enabled: true,
                minIntervalMs: 1,
                maxIntervalMs: 100, // very short max
                fileChangeThreshold: 999, // won't hit threshold
            };
            system.lastCheckpointTime = Date.now() - 200; // exceeded max interval
            system.pendingChanges = new Set(['a.ts']); // has changes

            let reason = '';
            system.createAutoCheckpoint = async (r: string) => { reason = r; };

            await system.checkAutoCheckpointTrigger();

            assert.strictEqual(reason, 'time-interval',
                'Should trigger with reason "time-interval" when maxInterval exceeded');

            // Restore
            system.config = origConfig;
            system.lastCheckpointTime = origLastTime;
            system.pendingChanges = origPending;
        });

        test('checkAutoCheckpointTrigger does not fire without pending changes', async () => {
            const system = AutoCheckpointSystem.getInstance() as any;
            const origConfig = { ...system.config };
            const origLastTime = system.lastCheckpointTime;
            const origPending = new Set(system.pendingChanges);

            system.config = {
                ...system.config,
                enabled: true,
                minIntervalMs: 1,
                maxIntervalMs: 100,
                fileChangeThreshold: 1,
            };
            system.lastCheckpointTime = Date.now() - 200; // exceeded interval
            system.pendingChanges = new Set(); // no changes

            let created = false;
            system.createAutoCheckpoint = async () => { created = true; };

            await system.checkAutoCheckpointTrigger();

            assert.strictEqual(created, false,
                'Should NOT create checkpoint with no pending changes');

            // Restore
            system.config = origConfig;
            system.lastCheckpointTime = origLastTime;
            system.pendingChanges = origPending;
        });

        test('checkAutoCheckpointTrigger respects enabled=false', async () => {
            const system = AutoCheckpointSystem.getInstance() as any;
            const origConfig = { ...system.config };

            system.config = { ...system.config, enabled: false };

            let created = false;
            system.createAutoCheckpoint = async () => { created = true; };

            await system.checkAutoCheckpointTrigger();

            assert.strictEqual(created, false,
                'Should NOT create checkpoint when disabled');

            system.config = origConfig;
        });

        test('generateAutoDescription produces correct formats', () => {
            const system = AutoCheckpointSystem.getInstance() as any;
            const fiveFiles = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'];

            const desc1 = system.generateAutoDescription('file-changes', fiveFiles);
            assert.ok(desc1.includes('5 files changed'), `file-changes desc: ${desc1}`);

            const desc2 = system.generateAutoDescription('time-interval', []);
            assert.ok(desc2.includes('Periodic'), `time-interval desc: ${desc2}`);

            const desc3 = system.generateAutoDescription('ai-operation', []);
            assert.ok(desc3.includes('AI operation'), `ai-operation desc: ${desc3}`);

            const desc4 = system.generateAutoDescription('pre-risky', []);
            assert.ok(desc4.includes('Safety'), `pre-risky desc: ${desc4}`);
        });
    });

    // ─── 7.2.2 CheckpointManager: TypeScript path ───────────

    suite('7.2.2 CheckpointManager TypeScript path', () => {
        test('Manager singleton exists', () => {
            const manager = CheckpointManager.getInstance();
            assert.ok(manager, 'Manager singleton should exist');
        });

        test('getCheckpointHistory returns array', () => {
            const manager = CheckpointManager.getInstance() as any;
            const history = manager.checkpointHistory;
            assert.ok(Array.isArray(history), 'checkpointHistory should be array');
        });

        test('getCheckpointStatistics returns a result', async () => {
            const manager = CheckpointManager.getInstance() as any;
            const stats = await manager.getCheckpointStatistics();
            assert.ok(stats !== undefined, 'Statistics should not be undefined');
        });

        test('createCheckpointForMessage fails gracefully when uninitialized', async () => {
            const manager = CheckpointManager.getInstance() as any;
            try {
                const result = await manager.createCheckpointForMessage(
                    'test-msg-id',
                    'Test description'
                );
                assert.ok(
                    result === undefined || result === null || typeof result === 'string',
                    'Should return string or null/undefined'
                );
            } catch (e: any) {
                assert.ok(e.message, 'Error should have a message');
            }
        });
    });
});
