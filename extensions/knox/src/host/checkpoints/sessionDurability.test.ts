import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { AutoCheckpointSystem } from './AutoCheckpointSystem';
import { CheckpointManager } from './CheckpointManager';
import { groupBySession } from './CheckpointTreeProvider';
import { disposeFileWatcher, initializeFileWatcher } from './manager/watcher';
import { CheckpointSessionManager, SessionType } from './SessionManager';
import { loadUndoStackState } from './store/durableState';

async function withTempDir(prefix: string, fn: (dir: string) => Promise<void>): Promise<void> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    try {
        await fn(dir);
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
}

async function withIsolatedManager(
    workspacePath: string,
    storagePath: string,
    fn: (manager: any) => Promise<void>,
): Promise<void> {
    const manager = CheckpointManager.getInstance() as any;
    const backup = {
        initialized: manager.initialized,
        currentWorkspacePath: manager.currentWorkspacePath,
        checkpointHistory: manager.checkpointHistory,
        lastSnapshotHashes: manager.lastSnapshotHashes,
        lastCheckpointTime: manager.lastCheckpointTime,
        sessionStartTime: manager.sessionStartTime,
        messageCheckpoints: manager.messageCheckpoints,
        getStoragePath: manager.getStoragePath,
        workspaceFolderPaths: manager.workspaceFolderPaths,
        ignoreFilter: manager.ignoreFilter,
        ignoreFilterFailed: manager.ignoreFilterFailed,
        boundAgentSessionId: manager.boundAgentSessionId,
        boundWorkspaceSessionId: manager.boundWorkspaceSessionId,
        boundWorkspaceSessionType: manager.boundWorkspaceSessionType,
        recentlyModifiedFiles: manager.recentlyModifiedFiles,
        recentlyDeletedFiles: manager.recentlyDeletedFiles,
        previousCheckpointFiles: manager.previousCheckpointFiles,
        workspaceSessions: manager.workspaceSessions,
        branches: manager.branches,
        activeBranchId: manager.activeBranchId,
    };

    manager.initialized = true;
    manager.currentWorkspacePath = workspacePath;
    manager.checkpointHistory = [];
    manager.lastSnapshotHashes = new Map();
    manager.lastCheckpointTime = Date.now();
    manager.sessionStartTime = Date.now();
    manager.messageCheckpoints = {};
    manager.ignoreFilter = null;
    manager.ignoreFilterFailed = false;
    manager.boundAgentSessionId = null;
    manager.boundWorkspaceSessionId = null;
    manager.boundWorkspaceSessionType = null;
    manager.recentlyModifiedFiles = new Set();
    manager.recentlyDeletedFiles = new Set();
    manager.previousCheckpointFiles = new Set();
    manager.workspaceSessions = new Map();
    manager.branches = [];
    manager.activeBranchId = undefined;
    manager.getStoragePath = () => storagePath;
    manager.workspaceFolderPaths = [workspacePath];

    try {
        await fn(manager);
    } finally {
        Object.assign(manager, backup);
    }
}

suite('session durability and unified watchers (CP-31)', () => {
    test('initializeFileWatcher creates one watcher per folder', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        assert.ok(workspaceFolder);
        const extraFolder = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-watch-'));
        const host: any = {
            workspaceFolderPaths: [workspaceFolder, extraFolder],
            currentWorkspacePath: workspaceFolder,
            fileWatchers: [],
            fileWatcher: undefined,
            watcherDisposables: [],
            watcherDebounceTimer: undefined,
            watcherTrusted: false,
            captureBinaryFiles: true,
            extraTrackedExtensions: new Set(),
            recordFileChangeForFolder() { /* test host */ },
            notifyWorkspaceFileEvent() { /* test host */ },
        };

        try {
            await initializeFileWatcher(host);
            assert.strictEqual(host.fileWatchers.length, 2);
            assert.ok(host.fileWatchers.every((watcher: { dispose?: unknown }) => typeof watcher.dispose === 'function'));
        } finally {
            disposeFileWatcher(host);
            await fs.rm(extraFolder, { recursive: true, force: true });
        }
    });

    test('AutoCheckpoint subscribes to manager events and does not create watchers', async () => {
        const auto = AutoCheckpointSystem.getInstance() as any;
        auto.checkpointManager = CheckpointManager.getInstance();
        const origCreate = vscode.workspace.createFileSystemWatcher.bind(vscode.workspace);
        let created = 0;
        (vscode.workspace as any).createFileSystemWatcher = (...args: unknown[]) => {
            created += 1;
            return (origCreate as (...inner: unknown[]) => vscode.FileSystemWatcher)(...args);
        };

        const origPending = new Set(auto.pendingChanges);
        const origEnabled = auto.config.enabled;
        auto.config = { ...auto.config, enabled: true };
        auto.pendingChanges = new Set();
        auto.fileEventSubscriptionRegistered = false;
        auto.fileEventDisposable?.dispose();

        try {
            auto.subscribeToWorkspaceFileEvents({ subscriptions: [] });
            assert.strictEqual(created, 0);
            assert.strictEqual(typeof auto.setupFileWatcher, 'undefined');

            const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            assert.ok(folder);
            const uri = vscode.Uri.file(path.join(folder, 'src', 'watched-cp31.ts'));
            CheckpointManager.getInstance().notifyWorkspaceFileEvent({
                uri,
                kind: 'modified',
                folderPath: folder,
            });
            assert.ok(auto.pendingChanges.has(uri.fsPath));
        } finally {
            (vscode.workspace as any).createFileSystemWatcher = origCreate;
            auto.pendingChanges = origPending;
            auto.config = { ...auto.config, enabled: origEnabled };
        }
    });

    test('persisted sessions reload with the same ids and bind CheckpointManager', async () => {
        await withTempDir('knox-cp-sessions-', async (storagePath) => {
            const sessionManager = CheckpointSessionManager.getInstance();
            const manager = CheckpointManager.getInstance() as any;
            const origAgent = manager.boundAgentSessionId;
            const origWorkspace = manager.boundWorkspaceSessionId;
            sessionManager.resetForTests();

            try {
                await sessionManager.initialize({ storagePath });
                const workspacePath = '/tmp/cp31-workspace';
                const chat = await sessionManager.getSession(SessionType.CHAT, workspacePath);
                const chatId = chat.id;

                sessionManager.resetForTests();
                assert.strictEqual(sessionManager.getCurrentChatSession(workspacePath), undefined);

                await sessionManager.initialize({ storagePath });
                const restored = await sessionManager.getSession(SessionType.CHAT, workspacePath);
                assert.strictEqual(restored.id, chatId);
                assert.strictEqual(manager.getBoundSessionId(), chatId);
            } finally {
                sessionManager.resetForTests();
                manager.boundAgentSessionId = origAgent;
                if (origWorkspace) {
                    manager.bindWorkspaceSession(origWorkspace);
                } else {
                    manager.clearWorkspaceSession();
                }
            }
        });
    });

    test('bound sessionId is stamped on manifests without turning manual CPs into AI', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder);
        const fixtureRoot = path.join(workspaceFolder.uri.fsPath, `cp31-session-${Date.now()}`);
        await fs.mkdir(fixtureRoot, { recursive: true });
        await fs.writeFile(path.join(fixtureRoot, 'note.ts'), 'export const n = 1;\n');

        await withTempDir('knox-cp-bind-', async (storagePath) => {
            try {
                await withIsolatedManager(fixtureRoot, storagePath, async (manager) => {
                    manager.bindWorkspaceSession('sess-cp31-manual', 'manual');
                    const checkpointId = await manager.createManualCheckpoint({
                        description: 'Labeled manual checkpoint',
                    });
                    assert.ok(checkpointId);
                    const info = manager.checkpointHistory.find((cp: { id: string }) => cp.id === checkpointId);
                    assert.ok(info);
                    assert.strictEqual(info.sessionId, 'sess-cp31-manual');
                    assert.strictEqual(info.conversationContext, undefined);

                    const groups = groupBySession([info]);
                    assert.ok(groups.some((group) => group.id === 'session:sess-cp31-manual'));
                });
            } finally {
                await fs.rm(fixtureRoot, { recursive: true, force: true });
            }
        });
    });

    test('undo stack survives without ExtensionContext workspaceState', async () => {
        const auto = AutoCheckpointSystem.getInstance() as any;
        await withTempDir('knox-cp-undo-', async (storagePath) => {
            const origManager = auto.checkpointManager;
            const origState = { ...auto.undoRedoState, stack: [...auto.undoRedoState.stack] };
            const origContext = auto.extensionContext;
            auto.checkpointManager = {
                getStoragePath: () => storagePath,
            };
            auto.extensionContext = undefined;
            auto.undoRedoState = {
                currentIndex: -1,
                stack: [],
                maxSize: 50,
            };

            try {
                auto.addToUndoStack('cp_one');
                auto.addToUndoStack('cp_two');
                await auto.persistUndoRedoState();

                const onDisk = await loadUndoStackState(storagePath);
                assert.ok(onDisk);
                assert.deepStrictEqual(onDisk.stack, ['cp_one', 'cp_two']);
                assert.strictEqual(onDisk.currentIndex, 1);

                auto.undoRedoState = { currentIndex: -1, stack: [], maxSize: 50 };
                const loaded = await auto.loadUndoStackFromWorkspaceStore();
                assert.ok(loaded);
                auto.undoRedoState = auto.normalizeUndoState(loaded);
                assert.deepStrictEqual(auto.undoRedoState.stack, ['cp_one', 'cp_two']);
                assert.strictEqual(auto.undoRedoState.currentIndex, 1);
            } finally {
                auto.checkpointManager = origManager;
                auto.undoRedoState = origState;
                auto.extensionContext = origContext;
            }
        });
    });
});
