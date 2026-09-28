import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { CheckpointManager } from './CheckpointManager';
import { OperationMode, SmartCheckpointManager } from './SmartCheckpointManager';

suite('Implementation Plan Integrations', () => {
    suite('SmartCheckpointManager', () => {
        test('records AI session metrics when metrics are enabled', async () => {
            const manager = SmartCheckpointManager.getInstance() as any;
            const created: any[] = [];
            const metrics: any[] = [];

            manager.initialized = true;
            manager.operationMode = OperationMode.Chat;
            manager.currentSession = null;
            manager.config = {
                enabled: true,
                agentModeOnly: true,
                maxTrackedFiles: 100,
                maxMemoryUsageMB: 50,
                maxCheckpoints: 50,
                maxFileSizeKB: 100,
                storagePath: '~/.knox/checkpoints',
                verboseLogging: false,
                enableMetrics: true,
            };
            manager.checkpointManager = {
                startAgentSession: async () => undefined,
                stopAgentSession: async () => undefined,
                trackAIFiles: async () => undefined,
                getCheckpointHistoryForWorkspace: () => [{
                    id: 'baseline-cp',
                    description: 'prior',
                    created: new Date('2026-04-20T00:00:00.000Z'),
                }],
                createAgentCheckpoint: async (options: any) => {
                    created.push(options);
                    return 'smart-checkpoint-42';
                },
                recordAISessionMetrics: async (payload: any) => {
                    metrics.push(payload);
                    return true;
                },
                computeCheckpointDiff: async () => ({
                    files: [{
                        relativePath: 'src/feature.ts',
                        status: 'modified',
                        oldContent: 'line1\n',
                        newContent: 'line1\nline2\n',
                        oldEncoding: 'utf8',
                        newEncoding: 'utf8',
                    }],
                }),
                getAuditTrail: async () => [{
                    timestamp: new Date().toISOString(),
                    outcome: 'success',
                }],
            };

            await manager.startAISession('agent-session-with-metrics');
            await manager.trackAIFiles(['src/feature.ts']);
            await manager.stopAISession();

            assert.strictEqual(created.length, 1);
            assert.strictEqual(metrics.length, 1);
            assert.strictEqual(metrics[0].filesChanged, 1);
            assert.strictEqual(metrics[0].checkpointsCreated, 1);
            assert.strictEqual(metrics[0].linesAdded, 1);
            assert.strictEqual(metrics[0].linesDeleted, 0);
            assert.strictEqual(metrics[0].rollbacks, 1);
            assert.match(metrics[0].sessionId, /^[0-9a-f-]{36}$/i);
            assert.ok(metrics[0].startedAt);
            assert.ok(metrics[0].endedAt);
            assert.ok(metrics[0].durationSeconds >= 0);
        });
    });

    suite('CheckpointManager', () => {
        test('records a restoration event after restoring checkpoint files', async () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            assert.ok(workspaceFolder, 'Expected an active workspace folder for checkpoint restore tests');

            const manager = CheckpointManager.getInstance() as any;
            const fileName = 'implementation-plan-restore.ts';
            const filePath = path.join(workspaceFolder!.uri.fsPath, fileName);
            const restorationEvents: any[] = [];

            manager.initialized = true;
            manager.currentWorkspacePath = workspaceFolder!.uri.fsPath;
            manager.checkpointHistory = [{
                id: 'cp-restore-metrics',
                description: 'Restore checkpoint',
                created: new Date('2026-04-20T00:00:00.000Z'),
                workspacePath: workspaceFolder!.uri.fsPath,
            }];
            manager.loadCheckpointFromDisk = async () => ({
                id: 'cp-restore-metrics',
                fileSnapshots: [{
                    relativePath: fileName,
                    content: 'export const restored = true;\n',
                    encoding: 'utf8',
                    lastModified: new Date('2026-04-20T00:00:00.000Z'),
                    size: 30,
                }],
                fileInventory: [fileName],
            });
            manager.createManualCheckpoint = async () => 'backup-checkpoint';
            manager.cleanupFilesNotInInventory = async () => undefined;
            manager.cleanupExtraFiles = async () => undefined;
            manager.recordRestorationEvent = async (payload: any) => {
                restorationEvents.push(payload);
                return true;
            };

            await fs.rm(filePath, { force: true });

            try {
                const result = await manager.restoreCheckpoint('cp-restore-metrics', {
                    createBackup: false,
                    conflictResolution: 'overwrite',
                    cleanupExtraFiles: false,
                });

                assert.strictEqual(result.success, true);
                assert.strictEqual(await fs.readFile(filePath, 'utf8'), 'export const restored = true;\n');
                assert.strictEqual(restorationEvents.length, 1);
                assert.strictEqual(restorationEvents[0].checkpointId, 'cp-restore-metrics');
                assert.strictEqual(restorationEvents[0].filesRestored, 1);
                assert.strictEqual(restorationEvents[0].filesFailed, 0);
                assert.strictEqual(restorationEvents[0].success, true);
            } finally {
                await fs.rm(filePath, { force: true });
            }
        });
    });
});