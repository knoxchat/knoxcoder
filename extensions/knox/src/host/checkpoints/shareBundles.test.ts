import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { CheckpointManager } from './CheckpointManager';
import { CheckpointBundleError } from './store/checkpointBundle';
import { loadOrCreateHmacKey } from './store/bundleHmac';

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
        stableIdCheckpoints: manager.stableIdCheckpoints,
        previousCheckpointFiles: manager.previousCheckpointFiles,
        recentlyDeletedFiles: manager.recentlyDeletedFiles,
        recentlyModifiedFiles: manager.recentlyModifiedFiles,
        ignoreFilter: manager.ignoreFilter,
        ignoreFilterFailed: manager.ignoreFilterFailed,
        getStoragePath: manager.getStoragePath,
        workspaceFolderPaths: manager.workspaceFolderPaths,
        healthIssues: manager.healthIssues,
        lastCheckpointLoad: manager.lastCheckpointLoad,
        enableCompression: manager.enableCompression,
        maxCheckpoints: manager.maxCheckpoints,
        maxStorageBytes: manager.maxStorageBytes,
        maxFilesPerCheckpoint: manager.maxFilesPerCheckpoint,
        extensionContext: manager.extensionContext,
        workspaceSessions: manager.workspaceSessions,
        branches: manager.branches,
        activeBranchId: manager.activeBranchId,
        maxScanDepth: manager.maxScanDepth,
        maxFileSize: manager.maxFileSize,
        watcherTrusted: manager.watcherTrusted,
        lastFullScanAt: manager.lastFullScanAt,
        fileWatchers: manager.fileWatchers,
        trackedAIFiles: manager.trackedAIFiles,
    };

    manager.initialized = true;
    manager.currentWorkspacePath = workspacePath;
    manager.checkpointHistory = [];
    manager.lastSnapshotHashes = new Map();
    manager.lastCheckpointTime = Date.now();
    manager.sessionStartTime = Date.now();
    manager.messageCheckpoints = {};
    manager.stableIdCheckpoints = {};
    manager.previousCheckpointFiles = new Set();
    manager.recentlyDeletedFiles = new Set();
    manager.recentlyModifiedFiles = new Set();
    manager.trackedAIFiles = new Set();
    manager.ignoreFilter = null;
    manager.ignoreFilterFailed = false;
    manager.healthIssues = [];
    manager.lastCheckpointLoad = null;
    manager.getStoragePath = () => storagePath;
    manager.enableCompression = true;
    manager.maxCheckpoints = 1000;
    manager.maxStorageBytes = 1_000_000_000;
    manager.maxFilesPerCheckpoint = 10_000;
    manager.maxScanDepth = 0;
    manager.watcherTrusted = false;
    manager.lastFullScanAt = 0;
    manager.fileWatchers = [];
    manager.workspaceFolderPaths = [workspacePath];
    manager.workspaceSessions = new Map();
    manager.branches = [];
    manager.activeBranchId = undefined;
    manager.extensionContext = undefined;

    try {
        await fn(manager);
    } finally {
        Object.assign(manager, backup);
    }
}

function stateMap(state: Map<string, { content: string }> | null): Record<string, string> {
    assert.ok(state, 'Expected a reconstructed checkpoint tree');
    const files: Record<string, string> = {};
    for (const [relativePath, resolved] of state) {
        files[relativePath] = resolved.content;
    }
    return files;
}

suite('Local share bundles (CP-27)', () => {
    test('share produces a file, list shows it, import consumes it', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(workspaceFolder.uri.fsPath, `cp-share-${Date.now()}`);
        const exportStore = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-share-src-'));
        const importStore = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-share-dst-'));
        const hmacKeyPath = path.join(exportStore, 'hmac.key');
        const bundlePath = path.join(exportStore, 'handoff.knoxcp.json');
        const fileA = path.join(fixtureRoot, 'src', 'a.ts');

        await fs.mkdir(path.join(fixtureRoot, 'src'), { recursive: true });
        await fs.writeFile(fileA, 'export const a = 1;\n');

        try {
            let checkpointId = '';
            let tree: Record<string, string> = {};

            await withIsolatedManager(fixtureRoot, exportStore, async (manager) => {
                checkpointId = await manager.createManualCheckpoint({ description: 'share baseline' });
                assert.ok(checkpointId);
                tree = stateMap(await manager.reconstructStateAtCheckpoint(checkpointId));

                const shared = await manager.shareCheckpoints(bundlePath, {
                    checkpointIds: [checkpointId],
                    description: 'USB handoff',
                    hmacKeyPath,
                });
                assert.strictEqual(shared.description, 'USB handoff');
                assert.strictEqual(shared.checkpointCount, 1);
                assert.deepStrictEqual(shared.checkpointIds, [checkpointId]);
                assert.strictEqual(shared.filePath, bundlePath);
                assert.strictEqual(shared.exists, true);
                assert.ok(shared.hmacSha256);
                assert.ok(shared.hmacKeyId);

                const raw = JSON.parse(await fs.readFile(bundlePath, 'utf8'));
                assert.strictEqual(raw.hmacSha256, shared.hmacSha256);
                assert.ok(!JSON.stringify(raw).includes('http://') && !JSON.stringify(raw).includes('https://'));

                const listed = await manager.listSharedBundles();
                assert.ok(listed.some((bundle: { filePath: string; description: string }) =>
                    bundle.filePath === bundlePath && bundle.description === 'USB handoff'));
            });

            await fs.writeFile(fileA, 'export const a = 999;\n');

            await withIsolatedManager(fixtureRoot, importStore, async (manager) => {
                const imported = await manager.importCheckpoints(bundlePath, {
                    merge: false,
                    hmacKeyPath,
                });
                assert.strictEqual(imported, 1);
                assert.deepStrictEqual(
                    stateMap(await manager.reconstructStateAtCheckpoint(checkpointId)),
                    tree,
                );
            });
        } finally {
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(exportStore, { recursive: true, force: true });
            await fs.rm(importStore, { recursive: true, force: true });
        }
    });

    test('same-key HMAC mismatch is rejected; a different key still imports', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(workspaceFolder.uri.fsPath, `cp-share-hmac-${Date.now()}`);
        const exportStore = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-share-hmac-src-'));
        const importStore = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-share-hmac-dst-'));
        const producerKey = path.join(exportStore, 'producer.key');
        const otherKey = path.join(exportStore, 'other.key');
        const bundlePath = path.join(exportStore, 'signed.knoxcp.json');

        await fs.mkdir(fixtureRoot, { recursive: true });
        await fs.writeFile(path.join(fixtureRoot, 'a.ts'), 'export const a = 1;\n');
        await loadOrCreateHmacKey(otherKey);

        try {
            await withIsolatedManager(fixtureRoot, exportStore, async (manager) => {
                const checkpointId = await manager.createManualCheckpoint({ description: 'signed' });
                assert.ok(checkpointId);
                await manager.shareCheckpoints(bundlePath, {
                    checkpointIds: [checkpointId],
                    description: 'signed handoff',
                    hmacKeyPath: producerKey,
                });
            });

            const tampered = JSON.parse(await fs.readFile(bundlePath, 'utf8'));
            tampered.hmacSha256 = '0'.repeat(64);
            await fs.writeFile(bundlePath, JSON.stringify(tampered, null, 2), 'utf8');

            await withIsolatedManager(fixtureRoot, importStore, async (manager) => {
                await assert.rejects(
                    () => manager.importCheckpoints(bundlePath, { merge: false, hmacKeyPath: producerKey }),
                    (error: unknown) => error instanceof CheckpointBundleError && error.code === 'HMAC_MISMATCH',
                );

                const imported = await manager.importCheckpoints(bundlePath, {
                    merge: false,
                    hmacKeyPath: otherKey,
                });
                assert.strictEqual(imported, 1);
            });
        } finally {
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(exportStore, { recursive: true, force: true });
            await fs.rm(importStore, { recursive: true, force: true });
        }
    });
});
