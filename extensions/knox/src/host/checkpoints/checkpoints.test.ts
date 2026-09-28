import * as assert from 'node:assert';
import * as vscode from 'vscode';

import { AutoCheckpointSystem } from './AutoCheckpointSystem';
import { CheckpointManager, FileSnapshot } from './CheckpointManager';
import { createAutomaticCheckpoint } from './commands';
import {
    CheckpointConflictResolver,
    ConflictType,
    ResolutionStrategy,
} from './ConflictResolver';
import { InlineDiffDecorator } from './InlineDiffDecorator';
import { CheckpointSessionManager, SessionType } from './SessionManager';
import { OperationMode, SmartCheckpointManager } from './SmartCheckpointManager';

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

suite('Checkpoint Managers', () => {
    teardown(() => {
        restoreWindowMethods();
    });

    suite('SmartCheckpointManager', () => {
        test('tracks AI session lifecycle and creates a final checkpoint', async () => {
            const manager = SmartCheckpointManager.getInstance() as any;
            const created: any[] = [];

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
                enableMetrics: false,
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
                    return 'smart-checkpoint-1';
                },
                hasWorkspaceChanges: async () => true,
                getChangesetStats: async () => ({
                    files_tracked: 0,
                    changes_detected: 0,
                    memory_usage_bytes: 0,
                    last_scan_duration_ms: 0,
                    mode: 'chat',
                }),
            };

            await manager.startAISession('agent-session-1');
            await manager.trackAIFiles(['src/a.ts', 'src/b.ts']);

            assert.strictEqual(manager.isInAgentMode(), true);
            assert.strictEqual(manager.getCurrentSession().trackedFiles.size, 2);

            await manager.stopAISession();

            assert.strictEqual(manager.getCurrentSession(), null);
            assert.strictEqual(manager.isInAgentMode(), false);
            assert.strictEqual(created.length, 1);
            assert.match(created[0].description, /Smart: Session agent-session-1 completed/);
        });

        test('honors agentModeOnly, maxFileSizeKB, and maxCheckpoints', async () => {
            const manager = SmartCheckpointManager.getInstance() as any;
            const tracked: string[][] = [];
            const created: any[] = [];
            const tmp = await import('node:os').then((os) => os.tmpdir());
            const fs = await import('node:fs/promises');
            const path = await import('node:path');
            const dir = await fs.mkdtemp(path.join(tmp, 'knox-smart-cap-'));
            const oversized = path.join(dir, 'big.bin');
            await fs.writeFile(oversized, Buffer.alloc(2048, 0x61));

            manager.initialized = true;
            manager.operationMode = OperationMode.Chat;
            manager.currentSession = {
                id: 'chat-session',
                metricsId: 'metrics',
                startTime: new Date(),
                trackedFiles: new Set(),
                operationMode: OperationMode.Chat,
            };
            manager.config = {
                enabled: true,
                agentModeOnly: true,
                maxTrackedFiles: 100,
                maxMemoryUsageMB: 50,
                maxCheckpoints: 1,
                maxFileSizeKB: 1,
                storagePath: '~/.knox/checkpoints',
                verboseLogging: false,
                enableMetrics: false,
            };
            manager.checkpointManager = {
                startAgentSession: async () => undefined,
                stopAgentSession: async () => undefined,
                trackAIFiles: async (files: string[]) => {
                    tracked.push(files);
                },
                getCheckpointHistoryForWorkspace: () => [{
                    id: 'baseline-cp',
                    description: 'prior',
                    created: new Date('2026-04-20T00:00:00.000Z'),
                }],
                createAgentCheckpoint: async (options: any) => {
                    created.push(options);
                    return 'smart-checkpoint-capped';
                },
            };

            try {
                await manager.trackAIFiles(['src/a.ts', oversized]);
                assert.strictEqual(manager.currentSession.trackedFiles.size, 0);
                assert.deepStrictEqual(tracked.at(-1), ['src/a.ts']);

                manager.config.agentModeOnly = false;
                await manager.trackAIFiles(['src/a.ts', oversized]);
                assert.ok(manager.currentSession.trackedFiles.has('src/a.ts'));
                assert.ok([...manager.currentSession.trackedFiles].every((file: string) => !file.includes('big.bin')));
                assert.deepStrictEqual(tracked.at(-1), ['src/a.ts']);

                const skipped = await manager.createAgentCheckpoint({ description: 'over cap' });
                assert.strictEqual(skipped, undefined);
                assert.strictEqual(created.length, 0);

                manager.config.maxCheckpoints = 50;
                const createdId = await manager.createAgentCheckpoint({ description: 'under cap' });
                assert.strictEqual(createdId, 'smart-checkpoint-capped');
                assert.strictEqual(created.length, 1);
            } finally {
                await fs.rm(dir, { recursive: true, force: true });
            }
        });
    });

    suite('AutoCheckpointSystem', () => {
        test('creates an automatic checkpoint on threshold and supports undo/redo navigation', async () => {
            const autoCheckpoint = AutoCheckpointSystem.getInstance() as any;
            const restored: string[] = [];
            const created: string[] = [];

            mockWindowMethod('showInformationMessage', async () => undefined);
            mockWindowMethod('showWarningMessage', async () => undefined);
            mockWindowMethod('showErrorMessage', async () => undefined);

            const origManager = autoCheckpoint.checkpointManager;
            const origConfig = autoCheckpoint.config;
            const origPending = new Set(autoCheckpoint.pendingChanges);
            const origUndo = {
                ...autoCheckpoint.undoRedoState,
                stack: [...autoCheckpoint.undoRedoState.stack],
            };
            autoCheckpoint.config = {
                enabled: true,
                minIntervalMs: 1,
                maxIntervalMs: 60_000,
                fileChangeThreshold: 2,
                checkpointAfterAI: true,
                checkpointBeforeRisky: true,
                maxUndoStack: 50,
                showNotifications: false,
                debounceMs: 1,
            };
            autoCheckpoint.lastCheckpointTime = Date.now() - 10_000;
            autoCheckpoint.pendingChanges = new Set(['a.ts', 'b.ts']);
            autoCheckpoint.undoRedoState = {
                currentIndex: -1,
                stack: [],
                maxSize: 50,
            };
            autoCheckpoint.checkpointManager = {
                createCheckpointForMessage: async (_messageId: string, description: string) => {
                    created.push(description);
                    return `cp-${created.length}`;
                },
                restoreCheckpoint: async (checkpointId: string) => {
                    restored.push(checkpointId);
                },
                getStoragePath: () => undefined,
            };

            try {
                await autoCheckpoint.checkAutoCheckpointTrigger();

                assert.strictEqual(created.length, 1);
                assert.strictEqual(autoCheckpoint.pendingChanges.size, 0);

                autoCheckpoint.addToUndoStack('cp-1');
                autoCheckpoint.addToUndoStack('cp-2');

                const undoResult = await autoCheckpoint.undo();
                const redoResult = await autoCheckpoint.redo();

                assert.strictEqual(undoResult, true);
                assert.strictEqual(redoResult, true);
                assert.deepStrictEqual(restored.slice(-2), ['cp-1', 'cp-2']);
            } finally {
                autoCheckpoint.checkpointManager = origManager;
                autoCheckpoint.config = origConfig;
                autoCheckpoint.pendingChanges = origPending;
                autoCheckpoint.undoRedoState = origUndo;
            }
        });
    });

    suite('createAutomaticCheckpoint', () => {
        test('keeps the description as description and uses a unique message id', async () => {
            const manager = CheckpointManager.getInstance() as any;
            const originalIsReady = manager.isReady;
            const originalCreate = manager.createCheckpointForMessage;
            const calls: Array<{ messageId: string; description?: string }> = [];

            manager.isReady = () => true;
            manager.createCheckpointForMessage = async (
                messageId: string,
                description?: string,
            ) => {
                calls.push({ messageId, description });
                return 'cp-auto';
            };

            try {
                const id = await createAutomaticCheckpoint('before refactor');
                assert.strictEqual(id, 'cp-auto');
                assert.strictEqual(calls.length, 1);
                assert.strictEqual(calls[0].description, 'before refactor');
                assert.notStrictEqual(calls[0].messageId, 'before refactor');
                assert.match(calls[0].messageId, /^auto-[0-9a-f-]{36}$/i);
            } finally {
                manager.isReady = originalIsReady;
                manager.createCheckpointForMessage = originalCreate;
            }
        });
    });

    suite('CheckpointConflictResolver', () => {
        test('applies prompt, backup, queue, auto resolve, and cancel strategies', async () => {
            const resolver = CheckpointConflictResolver.getInstance() as any;
            const backupCalls: any[] = [];

            mockWindowMethod('showWarningMessage', async () => 'Continue with Backup');

            const checkpointManager = CheckpointManager.getInstance() as any;
            const originalCreateManualCheckpoint = checkpointManager.createManualCheckpoint;
            checkpointManager.createManualCheckpoint = async (options: any) => {
                backupCalls.push(options);
                return 'backup-checkpoint-1';
            };

            const baseConflict = {
                type: ConflictType.FILE_MODIFICATION,
                description: 'Files changed outside of the checkpoint system',
                affectedFiles: ['src/example.ts'],
                sessionId: 'session-1',
                timestamp: new Date(),
                severity: 'low' as const,
                suggestedResolution: ResolutionStrategy.AUTO_RESOLVE,
                metadata: { concurrentOperations: [] },
            };

            const auto = await resolver.executeResolution(baseConflict, 'op-auto');
            const prompt = await resolver.executeResolution(
                { ...baseConflict, severity: 'medium', suggestedResolution: ResolutionStrategy.PROMPT_USER },
                'op-prompt',
            );
            const queued = await resolver.executeResolution(
                { ...baseConflict, severity: 'high', suggestedResolution: ResolutionStrategy.QUEUE_OPERATION },
                'op-queue',
            );
            const cancelled = await resolver.executeResolution(
                { ...baseConflict, severity: 'high', suggestedResolution: ResolutionStrategy.CANCEL_OPERATION },
                'op-cancel',
            );

            checkpointManager.createManualCheckpoint = originalCreateManualCheckpoint;

            assert.strictEqual(auto.success, true);
            assert.strictEqual(auto.strategy, ResolutionStrategy.AUTO_RESOLVE);
            assert.strictEqual(prompt.strategy, ResolutionStrategy.CREATE_BACKUP);
            assert.strictEqual(prompt.backupCheckpointId, 'backup-checkpoint-1');
            assert.strictEqual(queued.success, true);
            assert.strictEqual(queued.strategy, ResolutionStrategy.QUEUE_OPERATION);
            assert.strictEqual(cancelled.success, false);
            assert.strictEqual(cancelled.strategy, ResolutionStrategy.CANCEL_OPERATION);
            assert.strictEqual(backupCalls.length, 1);
        });
    });

    suite('CheckpointSessionManager', () => {
        test('creates, switches, and groups workspace sessions by type', async () => {
            const sessionManager = CheckpointSessionManager.getInstance() as any;
            const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '/tmp/workspace';

            sessionManager.resetForTests();
            sessionManager.activeSessions = new Map();
            sessionManager.workspaceSessionMap = new Map();
            sessionManager.currentChatSessionId = undefined;
            sessionManager.currentManualSessionId = undefined;
            sessionManager.sessionLocks = new Map();

            const chatSession = await sessionManager.getSession(SessionType.CHAT, workspacePath);
            const manualSession = await sessionManager.switchSession(SessionType.CHAT, SessionType.MANUAL, workspacePath);

            assert.strictEqual(chatSession.type, SessionType.CHAT);
            assert.strictEqual(manualSession.type, SessionType.MANUAL);
            assert.strictEqual(sessionManager.getCurrentChatSession(workspacePath), chatSession.id);
            assert.strictEqual(sessionManager.getCurrentManualSession(workspacePath), manualSession.id);
            assert.strictEqual(sessionManager.getWorkspaceSessions(workspacePath).length, 2);
        });
    });

    suite('CheckpointManager', () => {
        test('filters history by normalized workspace path and falls back to history-only deletion', async () => {
            const manager = CheckpointManager.getInstance() as any;
            const deletedIds: string[] = [];

            manager.currentWorkspacePath = '/tmp/workspace';
            manager.checkpointHistory = [
                {
                    id: 'cp-a',
                    description: 'Checkpoint A',
                    created: new Date('2026-04-01T00:00:00Z'),
                    workspacePath: 'file:///tmp/workspace/',
                },
                {
                    id: 'cp-b',
                    description: 'Checkpoint B',
                    created: new Date('2026-04-02T00:00:00Z'),
                    workspacePath: '/tmp/other-workspace',
                },
            ];
            manager.saveCheckpointHistory = () => undefined;
            manager.deleteCheckpointFromDisk = async (checkpointId: string) => {
                deletedIds.push(checkpointId);
            };

            const filtered = manager.getCheckpointHistoryForWorkspace('/tmp/workspace');
            const removed = await manager.removeFromHistoryAndDisk('cp-a');

            assert.strictEqual(filtered.length, 1);
            assert.strictEqual(filtered[0].id, 'cp-a');
            assert.strictEqual(removed, true);
            assert.deepStrictEqual(deletedIds, ['cp-a']);
            assert.strictEqual(manager.getCheckpointHistory().some((item: any) => item.id === 'cp-a'), false);
        });
    });

    suite('InlineDiffDecorator', () => {
        test('restores an added line through the gutter restore command path', async () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            assert.ok(workspaceFolder, 'Expected an active workspace folder for inline diff tests');

            const fileUri = vscode.Uri.joinPath(workspaceFolder!.uri, 'inline-gutter-restore.ts');
            const checkpointContent = 'const a = 1;\n';
            const currentContent = 'const a = 1;\nconst b = 2;\n';

            await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(currentContent));

            const document = await vscode.workspace.openTextDocument(fileUri);
            const editor = await vscode.window.showTextDocument(document, { preview: false });

            const decorator = InlineDiffDecorator.getInstance() as any;
            const originalCheckpointManager = decorator.checkpointManager;

            const snapshot: FileSnapshot = {
                relativePath: 'inline-gutter-restore.ts',
                content: checkpointContent,
                encoding: 'utf8',
                lastModified: new Date('2026-04-20T00:00:00.000Z'),
                size: checkpointContent.length,
            };

            try {
                decorator.checkpointManager = {
                    getCheckpointHistory: () => [{
                        id: 'cp-inline',
                        fileSnapshots: [snapshot],
                    }],
                    getCheckpointHistoryForWorkspace: () => [{
                        id: 'cp-inline',
                        fileSnapshots: [snapshot],
                    }],
                };
                decorator.currentDiffs = new Map();
                decorator.gutterRestoreTargets = new Map();
                decorator.activeCheckpointId = 'cp-inline';
                decorator.isEnabled = true;

                decorator.currentDiffs.set(
                    snapshot.relativePath,
                    decorator.computeFileDiff(checkpointContent, currentContent),
                );
                decorator.updateDecorations(editor);

                await decorator.restoreLineFromGutter(fileUri, 2);

                assert.strictEqual(editor.document.getText(), checkpointContent);
            } finally {
                decorator.disableDiffView();
                decorator.checkpointManager = originalCheckpointManager;
                await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                await vscode.workspace.fs.delete(fileUri, { useTrash: false });
            }
        });
    });
});