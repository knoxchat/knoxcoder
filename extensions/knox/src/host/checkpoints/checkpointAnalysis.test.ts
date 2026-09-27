import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { CheckpointManager } from './CheckpointManager';

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
        extensionContext: manager.extensionContext,
        workspaceSessions: manager.workspaceSessions,
        branches: manager.branches,
        activeBranchId: manager.activeBranchId,
        boundWorkspaceSessionId: manager.boundWorkspaceSessionId,
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
    manager.ignoreFilter = null;
    manager.ignoreFilterFailed = false;
    manager.healthIssues = [];
    manager.lastCheckpointLoad = null;
    manager.getStoragePath = () => storagePath;
    manager.enableCompression = true;
    manager.workspaceFolderPaths = [workspacePath];
    manager.workspaceSessions = new Map();
    manager.branches = [];
    manager.activeBranchId = undefined;
    manager.extensionContext = undefined;
    manager.boundWorkspaceSessionId = null;

    try {
        await fn(manager);
    } finally {
        Object.assign(manager, backup);
    }
}

suite('Checkpoint analysis integration (CP-26)', () => {
    test('analyzeCheckpoint reports config/test/deletion counts from the diff', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(workspaceFolder.uri.fsPath, `cp-analysis-${Date.now()}`);
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-analysis-'));
        await fs.mkdir(path.join(fixtureRoot, 'src'), { recursive: true });
        await fs.writeFile(path.join(fixtureRoot, 'package.json'), '{"name":"demo"}\n');
        await fs.writeFile(path.join(fixtureRoot, 'src', 'app.ts'), 'export const n = 1;\n');
        await fs.writeFile(path.join(fixtureRoot, 'src', 'app.test.ts'), 'test("n", () => {});\n');
        await fs.writeFile(path.join(fixtureRoot, 'gone.ts'), 'export const gone = 1;\n');

        try {
            await withIsolatedManager(fixtureRoot, storagePath, async (manager) => {
                const baselineId = await manager.createManualCheckpoint({ description: 'base' });
                assert.ok(baselineId);

                await fs.writeFile(path.join(fixtureRoot, 'package.json'), '{"name":"demo","version":"2"}\n');
                await fs.writeFile(path.join(fixtureRoot, 'src', 'app.ts'), 'export const n = 2;\nexport const m = 3;\n');
                await fs.unlink(path.join(fixtureRoot, 'gone.ts'));
                manager.recentlyDeletedFiles.add(path.join(fixtureRoot, 'gone.ts'));

                const deltaId = await manager.createManualCheckpoint({ description: 'risky edit' });
                assert.ok(deltaId);

                const missing = await manager.analyzeCheckpoint('cp_missing');
                assert.strictEqual(missing, null);

                const analysis = await manager.analyzeCheckpoint(deltaId);
                assert.ok(analysis);
                assert.strictEqual(analysis.checkpointId, deltaId);
                assert.ok(analysis.counts.config >= 1);
                assert.ok(analysis.counts.deleted >= 1);
                assert.ok(analysis.impactAnalysis.linesAdded + analysis.impactAnalysis.linesDeleted > 0);
                assert.strictEqual(analysis.impactAnalysis.scope, 'SystemWide');
                assert.notStrictEqual(analysis.riskAssessment.level, 'Low');
                assert.ok(analysis.generatedDescription.includes('risky edit'));
                assert.ok(analysis.riskAssessment.recommendations.length > 0);
            });
        } finally {
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });

    test('suggestCheckpointGroups clusters a bound session', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(workspaceFolder.uri.fsPath, `cp-groups-${Date.now()}`);
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-groups-'));
        await fs.mkdir(fixtureRoot, { recursive: true });
        await fs.writeFile(path.join(fixtureRoot, 'a.ts'), 'export const a = 1;\n');

        try {
            await withIsolatedManager(fixtureRoot, storagePath, async (manager) => {
                manager.bindWorkspaceSession('session-alpha');
                const first = await manager.createManualCheckpoint({ description: 'one' });
                await fs.writeFile(path.join(fixtureRoot, 'a.ts'), 'export const a = 2;\n');
                const second = await manager.createManualCheckpoint({ description: 'two' });
                assert.ok(first && second);

                const groups = await manager.suggestCheckpointGroups();
                const sessionGroup = groups.find((group: { kind: string }) => group.kind === 'session');
                assert.ok(sessionGroup, `expected a session group, got ${JSON.stringify(groups)}`);
                assert.ok(sessionGroup.checkpointIds.includes(first));
                assert.ok(sessionGroup.checkpointIds.includes(second));
                const timeGroup = groups.find((group: { kind: string }) => group.kind === 'time');
                assert.ok(timeGroup);
                assert.ok(timeGroup.checkpointIds.length >= 2);
            });
        } finally {
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });
});
