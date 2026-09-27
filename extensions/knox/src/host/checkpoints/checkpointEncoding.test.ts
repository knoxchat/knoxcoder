import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { CheckpointManager } from './CheckpointManager';
import { bytesFromSnapshotContent } from './store/blobStore';

const MINIMAL_PNG = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
    'hex',
);
const MINIMAL_PDF = Buffer.from('%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n', 'utf8');

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
        captureBinaryFiles: manager.captureBinaryFiles,
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
    manager.captureBinaryFiles = true;
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

suite('Checkpoint binary and encoding round-trip (CP-30)', () => {
    test('PNG, PDF, NUL, and UTF-16 files restore byte-identical', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(workspaceFolder.uri.fsPath, `cp-encoding-${Date.now()}`);
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-enc-'));
        const files = {
            png: path.join(fixtureRoot, 'icon.png'),
            pdf: path.join(fixtureRoot, 'doc.pdf'),
            nul: path.join(fixtureRoot, 'notes.txt'),
            utf16le: path.join(fixtureRoot, 'hello-le.txt'),
            utf16be: path.join(fixtureRoot, 'hello-be.txt'),
            zip: path.join(fixtureRoot, 'pack.zip'),
        };
        const originals = {
            png: MINIMAL_PNG,
            pdf: MINIMAL_PDF,
            nul: Buffer.from('hello\0world', 'binary'),
            utf16le: Buffer.from('\uFEFFHello, 世界', 'utf16le'),
            utf16be: bytesFromSnapshotContent('\uFEFFHello, 世界', 'utf16be'),
            zip: Buffer.from('PK\u0003\u0004not-a-real-zip'),
        };

        await fs.mkdir(fixtureRoot, { recursive: true });
        await fs.writeFile(files.png, originals.png);
        await fs.writeFile(files.pdf, originals.pdf);
        await fs.writeFile(files.nul, originals.nul);
        await fs.writeFile(files.utf16le, originals.utf16le);
        await fs.writeFile(files.utf16be, originals.utf16be);
        await fs.writeFile(files.zip, originals.zip);

        try {
            await withIsolatedManager(fixtureRoot, storagePath, async (manager) => {
                const checkpointId = await manager.createManualCheckpoint({
                    description: 'binary and encoding fixtures',
                });
                assert.ok(checkpointId);
                const detailed = await manager.getCheckpointWithSnapshots(checkpointId);
                assert.ok(detailed);
                const byPath = new Map<string, { relativePath: string; encoding: string }>(
                    (detailed.fileSnapshots ?? []).map((snapshot: { relativePath: string; encoding: string }) => [
                        snapshot.relativePath,
                        snapshot,
                    ]),
                );

                assert.strictEqual(byPath.get('icon.png')?.encoding, 'base64');
                assert.strictEqual(byPath.get('doc.pdf')?.encoding, 'base64');
                assert.strictEqual(byPath.get('notes.txt')?.encoding, 'base64');
                assert.strictEqual(byPath.get('hello-le.txt')?.encoding, 'utf16le');
                assert.strictEqual(byPath.get('hello-be.txt')?.encoding, 'utf16be');
                assert.ok(!byPath.has('pack.zip'), 'zip archives must stay untracked');

                await fs.writeFile(files.png, Buffer.from('corrupted-png'));
                await fs.writeFile(files.pdf, Buffer.from('%PDF-corrupted\n'));
                await fs.writeFile(files.nul, Buffer.from('no-nul'));
                await fs.writeFile(files.utf16le, Buffer.from('ascii now', 'utf8'));
                await fs.writeFile(files.utf16be, Buffer.from('ascii now', 'utf8'));

                const restore = await manager.restoreCheckpoint(checkpointId, {
                    createBackup: false,
                    conflictResolution: 'overwrite',
                    cleanupExtraFiles: false,
                });
                assert.strictEqual(restore.success, true);
                assert.deepStrictEqual(await fs.readFile(files.png), originals.png);
                assert.deepStrictEqual(await fs.readFile(files.pdf), originals.pdf);
                assert.deepStrictEqual(await fs.readFile(files.nul), originals.nul);
                assert.deepStrictEqual(await fs.readFile(files.utf16le), originals.utf16le);
                assert.deepStrictEqual(await fs.readFile(files.utf16be), originals.utf16be);
            });
        } finally {
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });
});
