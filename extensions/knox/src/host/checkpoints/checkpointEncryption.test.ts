import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { CheckpointManager } from './CheckpointManager';
import { BlobEncryptionError, memoryEncryptionKeyProvider } from './store/blobEncryption';

async function listStoredBlobs(storagePath: string): Promise<string[]> {
    const objectsRoot = path.join(storagePath, 'objects');
    let prefixes: string[];
    try {
        prefixes = await fs.readdir(objectsRoot);
    } catch {
        return [];
    }
    const names: string[] = [];
    for (const prefix of prefixes) {
        const dir = path.join(objectsRoot, prefix);
        let entries: string[];
        try {
            entries = await fs.readdir(dir);
        } catch {
            continue;
        }
        for (const entry of entries) {
            names.push(entry);
        }
    }
    return names;
}

suite('Checkpoint encryption at rest (CP-28)', () => {
    test('encrypted checkpoints restore after reload and fail clearly without a key', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(workspaceFolder.uri.fsPath, `cp-enc-${Date.now()}`);
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-enc-'));
        const source = 'export const secret = "do-not-store-plaintext";\n';
        await fs.mkdir(fixtureRoot, { recursive: true });
        await fs.writeFile(path.join(fixtureRoot, 'secret.ts'), source);

        const manager = CheckpointManager.getInstance() as any;
        const backup = {
            initialized: manager.initialized,
            currentWorkspacePath: manager.currentWorkspacePath,
            checkpointHistory: manager.checkpointHistory,
            lastSnapshotHashes: manager.lastSnapshotHashes,
            lastCheckpointTime: manager.lastCheckpointTime,
            getStoragePath: manager.getStoragePath,
            workspaceFolderPaths: manager.workspaceFolderPaths,
            encryptAtRest: manager.encryptAtRest,
            encryptionKeyProvider: manager.encryptionKeyProvider,
            enableCompression: manager.enableCompression,
            ignoreFilter: manager.ignoreFilter,
            ignoreFilterFailed: manager.ignoreFilterFailed,
            previousCheckpointFiles: manager.previousCheckpointFiles,
            recentlyModifiedFiles: manager.recentlyModifiedFiles,
            recentlyDeletedFiles: manager.recentlyDeletedFiles,
            messageCheckpoints: manager.messageCheckpoints,
            stableIdCheckpoints: manager.stableIdCheckpoints,
            branches: manager.branches,
            activeBranchId: manager.activeBranchId,
            workspaceSessions: manager.workspaceSessions,
        };

        const provider = memoryEncryptionKeyProvider();
        manager.initialized = true;
        manager.currentWorkspacePath = fixtureRoot;
        manager.checkpointHistory = [];
        manager.lastSnapshotHashes = new Map();
        manager.lastCheckpointTime = Date.now();
        manager.getStoragePath = () => storagePath;
        manager.workspaceFolderPaths = [fixtureRoot];
        manager.encryptAtRest = true;
        manager.encryptionKeyProvider = provider;
        manager.enableCompression = false;
        manager.ignoreFilter = null;
        manager.ignoreFilterFailed = false;
        manager.previousCheckpointFiles = new Set();
        manager.recentlyModifiedFiles = new Set();
        manager.recentlyDeletedFiles = new Set();
        manager.messageCheckpoints = {};
        manager.stableIdCheckpoints = {};
        manager.branches = [];
        manager.activeBranchId = undefined;
        manager.workspaceSessions = new Map();

        try {
            const checkpointId = await manager.createManualCheckpoint({ description: 'encrypted' });
            assert.ok(checkpointId);

            const blobs = await listStoredBlobs(storagePath);
            assert.ok(blobs.some((name) => name.endsWith('.enc')));
            assert.ok(blobs.every((name) => !name.endsWith('.gz')));
            const encPath = path.join(
                storagePath,
                'objects',
                blobs.find((name) => name.endsWith('.enc'))!.slice(0, 2),
                blobs.find((name) => name.endsWith('.enc'))!,
            );
            const onDisk = await fs.readFile(encPath);
            assert.ok(!onDisk.toString('utf8').includes('do-not-store-plaintext'));

            await fs.writeFile(path.join(fixtureRoot, 'secret.ts'), 'export const secret = "changed";\n');
            const restored = await manager.restoreCheckpoint(checkpointId, {
                createBackup: false,
                conflictResolution: 'overwrite',
                cleanupExtraFiles: false,
            });
            assert.strictEqual(restored.success, true);
            assert.strictEqual(await fs.readFile(path.join(fixtureRoot, 'secret.ts'), 'utf8'), source);

            manager.encryptionKeyProvider = {
                async get() {
                    return undefined;
                },
                async getOrCreate() {
                    throw new BlobEncryptionError('Checkpoint encryption key is unavailable.', 'missing_key');
                },
            };
            await fs.writeFile(path.join(fixtureRoot, 'secret.ts'), 'export const secret = "changed-again";\n');
            const missingKey = await manager.restoreCheckpoint(checkpointId, {
                createBackup: false,
                conflictResolution: 'overwrite',
                cleanupExtraFiles: false,
            });
            assert.strictEqual(missingKey.success, false);
            assert.ok(
                missingKey.failedFiles.some((file: { error: string }) =>
                    /encryption key is unavailable|missing or incorrect/i.test(file.error),
                ),
            );
            assert.strictEqual(
                await fs.readFile(path.join(fixtureRoot, 'secret.ts'), 'utf8'),
                'export const secret = "changed-again";\n',
                'missing key must not write a mixed or corrupt tree',
            );
        } finally {
            Object.assign(manager, backup);
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });
});
